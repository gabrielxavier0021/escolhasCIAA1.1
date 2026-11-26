'use strict';
const $ = (s) => document.querySelector(s);
const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) e.append(c instanceof Node ? c : document.createTextNode(c == null ? '' : c));
  return e;
}
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && url !== '/api/login') return showLogin(); throw new Error(d.error || 'Erro'); }
  return d;
}
const toast = (m, bad) => { const t = h('div', { class: 'msg ' + (bad ? 'err' : 'ok'), style: 'position:fixed;right:16px;bottom:16px;z-index:99' }, m); document.body.append(t); setTimeout(() => t.remove(), 3500); };
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const ROLE = { admin: 'Administrador', gerente: 'Gerente (superior da equipe)', vendedor: 'Membro da equipe' };
const STATUS = { nova: 'Nova', em_atendimento: 'Em atendimento', respondida: 'Respondida', fechada: 'Fechada', recusada: 'Recusada' };
const field = (label, input) => h('div', {}, h('label', {}, label), input);
let ME, CTX, tab = 'propostas';

function showLogin() {
  $('#app').replaceChildren(h('form', { class: 'card login', onsubmit: guard(async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await api('POST', '/api/login', f); start();
  }) }, h('h2', {}, 'Área restrita'), h('p', { class: 'meta' }, 'Entre com seu usuário para gerenciar o site.'),
    field('Usuário', h('input', { name: 'username', autocomplete: 'username', required: true })),
    field('Senha', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { class: 'btn', style: 'margin-top:14px;width:100%' }, 'Entrar'), h('p', {}, h('a', { href: '/' }, '← Voltar ao site'))));
}

async function start() {
  try { CTX = await api('GET', '/api/me'); } catch { return; }
  if (!CTX) return;
  ME = CTX.user;
  tab = ME.role === 'admin' || CTX.canStock ? tab : 'propostas';
  render();
}

function render() {
  const tabs = [['propostas', 'Propostas']];
  if (CTX.canStock) tabs.push(['veiculos', 'Veículos']);
  if (ME.role === 'admin') tabs.push(['equipes', 'Equipes'], ['usuarios', 'Usuários'], ['site', 'Site e logo']);
  const body = h('div', { class: 'wrap pad' });
  $('#app').replaceChildren(
    h('div', { class: 'bar' }, h('div', { class: 'wrap' },
      tabs.map(([k, n]) => h('button', { class: 'tab' + (k === tab ? ' on' : ''), onclick: () => { tab = k; render(); } }, n)),
      h('span', { class: 'sp' }), h('span', { class: 'meta' }, ME.name + ' · ' + ROLE[ME.role]), h('a', { class: 'btn ghost sm', href: '/' }, 'Ver site'),
      h('button', { class: 'btn ghost sm', onclick: guard(async () => { await api('POST', '/api/logout'); showLogin(); }) }, 'Sair'))),
    body);
  ({ propostas: viewProposals, veiculos: viewVehicles, equipes: viewTeams, usuarios: viewUsers, site: viewSite })[tab](body).catch((e) => toast(e.message, true));
}

/* ---------- propostas ---------- */
async function viewProposals(root) {
  const list = await api('GET', '/api/admin/proposals');
  const userName = (id) => (CTX.users.find((u) => u.id === id) || {}).name || '—';
  const teamName = (id) => (CTX.teams.find((t) => t.id === id) || {}).name || '—';
  root.append(h('h2', {}, ME.role === 'vendedor' ? 'Propostas atribuídas a você' : ME.role === 'gerente' ? 'Propostas da sua equipe' : 'Todas as propostas'));
  if (!list.length) root.append(h('p', { class: 'meta' }, 'Nenhuma proposta ainda.'));
  for (const p of list) {
    const members = CTX.users.filter((u) => u.teamId === p.teamId);
    const reply = h('textarea', { placeholder: 'Resposta ao cliente / condições da proposta' });
    const val = h('input', { type: 'number', min: 0, step: 100, placeholder: 'Valor proposto (R$)' });
    const st = h('select', {}, Object.entries(STATUS).map(([k, n]) => h('option', { value: k, selected: k === p.status }, n)));
    const asg = h('select', { disabled: ME.role === 'vendedor' }, h('option', { value: '' }, '— sem responsável —'), members.map((u) => h('option', { value: u.id, selected: u.id === p.assignedTo }, u.name)));
    root.append(h('div', { class: 'card pad', style: 'margin-bottom:14px' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap' }, h('strong', {}, p.vehicleTitle || 'Sem veículo'), h('span', { class: 'st ' + p.status }, STATUS[p.status])),
      h('div', { class: 'meta' }, new Date(p.createdAt).toLocaleString('pt-BR') + ' · Equipe: ' + teamName(p.teamId) + ' · Responsável: ' + userName(p.assignedTo)),
      h('p', {}, h('b', {}, p.name), ' · ', h('a', { href: 'tel:' + p.phone.replace(/[^\d+]/g, '') }, p.phone), p.email ? ' · ' + p.email : '', p.offer ? ' · oferta do cliente: ' + brl(p.offer) : ''),
      p.message ? h('p', { style: 'white-space:pre-line' }, p.message) : '',
      p.replies.map((r) => h('div', { class: 'reply' }, h('b', {}, r.by), ' (' + new Date(r.at).toLocaleString('pt-BR') + ')', r.value ? ' · proposta ' + brl(r.value) : '', h('div', { style: 'white-space:pre-line' }, r.text))),
      h('div', { class: 'row' }, field('Status', st), field('Responsável', asg), field('Valor da proposta', val)),
      field('Resposta', reply),
      h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: guard(async () => {
        const b = { status: st.value, reply: reply.value, replyValue: val.value };
        if (ME.role !== 'vendedor') b.assignedTo = asg.value || null;
        await api('PUT', '/api/admin/proposals/' + p.id, b); toast('Salvo'); render();
      }) }, 'Salvar')));
  }
}

/* ---------- veículos ---------- */
async function uploadFile(file) {
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  return (await api('POST', '/api/upload', { dataUrl })).url;
}
async function viewVehicles(root) {
  const list = await api('GET', '/api/admin/vehicles');
  root.append(h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('h2', {}, 'Veículos (' + list.length + ')'), h('button', { class: 'btn', onclick: () => vehicleForm(root, null) }, '+ Novo veículo')));
  root.append(h('table', {}, h('thead', {}, h('tr', {}, ['Foto', 'Veículo', 'Ano', 'Km', 'Preço', 'Status', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, list.map((v) => h('tr', {}, h('td', {}, v.photos[0] ? h('img', { src: v.photos[0], style: 'width:64px;height:48px;object-fit:cover;border-radius:6px' }) : '—'), h('td', {}, v.title), h('td', {}, v.year || ''), h('td', {}, Number(v.km).toLocaleString('pt-BR')), h('td', {}, brl(v.price)), h('td', {}, v.status),
      h('td', {}, h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: () => vehicleForm(root, v) }, 'Editar'),
        h('button', { class: 'btn bad sm', onclick: guard(async () => { if (confirm('Apagar "' + v.title + '"?')) { await api('DELETE', '/api/admin/vehicles/' + v.id); render(); } }) }, 'Apagar'))))))));
}
function vehicleForm(root, v) {
  const d = v || { title: '', brand: '', model: '', year: new Date().getFullYear(), price: 0, km: 0, fuel: 'Flex', transmission: 'Manual', color: '', description: '', status: 'disponivel', featured: true, photos: [] };
  const photos = [...d.photos];
  const inp = (name, label, type = 'text') => field(label, h('input', { name, type, value: d[name] ?? '', ...(type === 'number' ? { min: 0 } : {}) }));
  const box = h('div', { class: 'modal open' });
  const pw = h('div', { class: 'photos' });
  const drawPhotos = () => pw.replaceChildren(...photos.map((u, i) => h('div', { class: 'p' }, h('img', { src: u }), h('button', { type: 'button', title: 'Remover', onclick: () => { photos.splice(i, 1); drawPhotos(); } }, '×'))));
  drawPhotos();
  const form = h('form', { class: 'box', onsubmit: guard(async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { ...f, featured: e.target.featured.checked, photos };
    await (v ? api('PUT', '/api/admin/vehicles/' + v.id, body) : api('POST', '/api/admin/vehicles', body));
    box.remove(); toast('Veículo salvo'); render();
  }) },
    h('button', { type: 'button', class: 'x', onclick: () => box.remove() }, '×'), h('h2', {}, v ? 'Editar veículo' : 'Novo veículo'),
    h('div', { class: 'row' }, inp('title', 'Título do anúncio'), inp('brand', 'Marca'), inp('model', 'Modelo'), inp('year', 'Ano', 'number')),
    h('div', { class: 'row' }, inp('price', 'Preço (R$)', 'number'), inp('km', 'Odômetro (km)', 'number'), inp('fuel', 'Combustível'), inp('transmission', 'Câmbio'), inp('color', 'Cor')),
    h('div', { class: 'row' }, field('Situação', h('select', { name: 'status' }, [['disponivel', 'Disponível'], ['reservado', 'Reservado'], ['vendido', 'Vendido (some do site)']].map(([k, n]) => h('option', { value: k, selected: k === d.status }, n)))),
      field('Destaque', h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px' }, h('input', { type: 'checkbox', name: 'featured', style: 'width:auto', checked: d.featured }), 'Mostrar em destaque'))),
    field('Descrição', h('textarea', { name: 'description' }, d.description)),
    h('label', {}, 'Fotos (PNG, JPG ou WEBP, até 6 MB cada)'), pw,
    h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, onchange: guard(async (e) => {
      for (const f of e.target.files) photos.push(await uploadFile(f));
      e.target.value = ''; drawPhotos();
    }) }),
    h('button', { class: 'btn', style: 'margin-top:16px' }, 'Salvar'));
  form.querySelector('textarea').value = d.description;
  box.append(form); document.body.append(box);
}

/* ---------- equipes ---------- */
async function viewTeams(root) {
  root.append(h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('h2', {}, 'Equipes e superiores'),
    h('button', { class: 'btn', onclick: guard(async () => { const n = prompt('Nome da nova equipe:'); if (n) { await api('POST', '/api/admin/teams', { name: n }); await start(); } }) }, '+ Nova equipe')));
  root.append(h('p', { class: 'meta' }, 'Cada equipe tem um superior (líder). Ele vê as propostas da equipe e distribui entre os membros. A equipe marcada com "gerencia estoque" pode editar veículos.'));
  for (const t of CTX.teams) {
    const members = CTX.users.filter((u) => u.teamId === t.id);
    const f = h('form', { class: 'card pad', style: 'margin-bottom:14px', onsubmit: guard(async (e) => {
      e.preventDefault();
      await api('PUT', '/api/admin/teams/' + t.id, { name: e.target.name.value, desc: e.target.desc.value, manageStock: e.target.manageStock.checked, receivesProposals: e.target.receivesProposals.checked, leaderId: e.target.leaderId.value });
      toast('Equipe salva'); await start();
    }) },
      h('div', { class: 'row' }, field('Nome', h('input', { name: 'name', value: t.name })), field('Superior (líder)', h('select', { name: 'leaderId' }, h('option', { value: '' }, '— definir —'), members.map((u) => h('option', { value: u.id, selected: u.id === t.leaderId }, u.name))))),
      field('Descrição pública', h('input', { name: 'desc', value: t.desc })),
      h('label', { style: 'display:inline-flex;gap:6px;align-items:center;margin-right:18px' }, h('input', { type: 'checkbox', name: 'receivesProposals', style: 'width:auto', checked: t.receivesProposals }), 'Recebe propostas do site'),
      h('label', { style: 'display:inline-flex;gap:6px;align-items:center' }, h('input', { type: 'checkbox', name: 'manageStock', style: 'width:auto', checked: t.manageStock }), 'Gerencia estoque'),
      h('p', { class: 'meta' }, 'Membros: ' + (members.map((u) => u.name).join(', ') || 'nenhum')),
      h('div', { class: 'actions' }, h('button', { class: 'btn sm' }, 'Salvar'), h('button', { type: 'button', class: 'btn bad sm', onclick: guard(async () => { if (confirm('Apagar a equipe "' + t.name + '"?')) { await api('DELETE', '/api/admin/teams/' + t.id); await start(); } }) }, 'Apagar')));
    root.append(f);
  }
}

/* ---------- usuários ---------- */
async function viewUsers(root) {
  const teamName = (id) => (CTX.teams.find((t) => t.id === id) || {}).name || '—';
  root.append(h('h2', {}, 'Usuários'));
  root.append(h('table', {}, h('thead', {}, h('tr', {}, ['Nome', 'Login', 'Cargo', 'Equipe', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, CTX.users.map((u) => h('tr', {}, h('td', {}, u.name), h('td', {}, u.username), h('td', {}, ROLE[u.role]), h('td', {}, teamName(u.teamId)),
      h('td', {}, h('div', { class: 'actions' },
        h('button', { class: 'btn sm', onclick: guard(async () => { const n = prompt('Nova senha (mínimo 8 caracteres):'); if (n) { await api('PUT', '/api/admin/users/' + u.id, { password: n }); toast('Senha alterada'); } }) }, 'Trocar senha'),
        u.id !== ME.id ? h('button', { class: 'btn bad sm', onclick: guard(async () => { if (confirm('Apagar ' + u.name + '?')) { await api('DELETE', '/api/admin/users/' + u.id); await start(); } }) }, 'Apagar') : '')))))));
  const f = h('form', { class: 'card pad', style: 'margin-top:18px', onsubmit: guard(async (e) => {
    e.preventDefault();
    await api('POST', '/api/admin/users', Object.fromEntries(new FormData(e.target))); toast('Usuário criado'); await start();
  }) }, h('h3', { style: 'margin-top:0' }, 'Novo usuário'),
    h('div', { class: 'row' }, field('Nome', h('input', { name: 'name', required: true })), field('Login', h('input', { name: 'username', required: true })), field('Senha (8+)', h('input', { name: 'password', type: 'password', minlength: 8, required: true })),
      field('Cargo', h('select', { name: 'role' }, Object.entries(ROLE).map(([k, n]) => h('option', { value: k }, n)))),
      field('Equipe', h('select', { name: 'teamId' }, h('option', { value: '' }, '— nenhuma (admin) —'), CTX.teams.map((t) => h('option', { value: t.id }, t.name))))),
    h('button', { class: 'btn', style: 'margin-top:12px' }, 'Criar'));
  root.append(f);
}

/* ---------- site e logo ---------- */
async function viewSite(root) {
  const S = (await api('GET', '/api/public')).settings;
  let logo = S.logo;
  const lp = h('div', { class: 'photos' });
  const drawLogo = () => lp.replaceChildren(logo ? h('div', { class: 'p' }, h('img', { src: logo, style: 'width:auto;height:64px' }), h('button', { type: 'button', onclick: () => { logo = ''; drawLogo(); } }, '×')) : h('span', { class: 'meta' }, 'Sem logo (aparece só o nome).'));
  drawLogo();
  const inp = (n, l, t = 'text') => field(l, h('input', { name: n, type: t, value: S[n] || '' }));
  const f = h('form', { class: 'card pad', onsubmit: guard(async (e) => {
    e.preventDefault();
    await api('PUT', '/api/admin/settings', { ...Object.fromEntries(new FormData(e.target)), logo }); toast('Site atualizado');
  }) }, h('h2', { style: 'margin-top:0' }, 'Dados do site'),
    h('label', {}, 'Logo da loja'), lp,
    h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: guard(async (e) => { if (e.target.files[0]) { logo = await uploadFile(e.target.files[0]); drawLogo(); } }) }),
    h('div', { class: 'row' }, inp('name', 'Nome da loja'), inp('slogan', 'Frase de destaque'), inp('phone', 'Telefone'), inp('whatsapp', 'WhatsApp (com DDD)'), inp('email', 'E-mail'), inp('address', 'Endereço'), inp('hours', 'Horário'), inp('instagram', 'Instagram'), inp('color', 'Cor principal', 'color')),
    field('Texto "Sobre a loja"', h('textarea', { name: 'about', style: 'min-height:140px' }, S.about)),
    h('button', { class: 'btn', style: 'margin-top:12px' }, 'Salvar'));
  f.querySelector('textarea').value = S.about;
  root.append(f);
}

start().then(() => { if (!CTX) showLogin(); });
