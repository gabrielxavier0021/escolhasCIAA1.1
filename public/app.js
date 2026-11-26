'use strict';
const $ = (s) => document.querySelector(s);
const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const km = (n) => Number(n).toLocaleString('pt-BR') + ' km';
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) e.append(c instanceof Node ? c : document.createTextNode(c == null ? '' : c));
  return e;
}
let S, vehicles = [], teams = [];

async function init() {
  const d = await (await fetch('/api/public')).json();
  S = d.settings; vehicles = d.vehicles; teams = d.teams;
  document.title = S.name;
  document.documentElement.style.setProperty('--c', S.color);
  $('#brand').replaceChildren(S.logo ? h('img', { src: S.logo, alt: S.name }) : h('span', { class: 'mark' }, S.name.slice(0, 1)), S.logo ? '' : S.name);
  $('#heroName').textContent = S.name;
  $('#heroSlogan').textContent = S.slogan;
  $('#about').textContent = S.about;
  const brands = [...new Set(vehicles.map((v) => v.brand).filter(Boolean))].sort();
  $('#fb').append(...brands.map((b) => h('option', { value: b }, b)));
  for (const id of ['fq', 'fb', 'fp', 'fs']) $('#' + id).addEventListener('input', renderList);
  renderList(); renderTeams(); renderContact();
}

function renderList() {
  const q = $('#fq').value.toLowerCase(), b = $('#fb').value, p = Number($('#fp').value) || Infinity, s = $('#fs').value;
  let l = vehicles.filter((v) => (!q || (v.title + ' ' + v.brand + ' ' + v.model).toLowerCase().includes(q)) && (!b || v.brand === b) && v.price <= p);
  const sorters = { new: (a, c) => c.createdAt.localeCompare(a.createdAt), pa: (a, c) => a.price - c.price, pd: (a, c) => c.price - a.price, km: (a, c) => a.km - c.km };
  l.sort(sorters[s]);
  $('#empty').hidden = l.length > 0;
  $('#list').replaceChildren(...l.map((v) => h('div', { class: 'card vcard', onclick: () => openVehicle(v) },
    h('div', { class: 'ph' }, v.photos[0] ? h('img', { src: v.photos[0], alt: v.title, loading: 'lazy' }) : 'Sem foto', v.status === 'reservado' ? h('span', { class: 'tag' }, 'Reservado') : ''),
    h('div', { class: 'in' }, h('h3', {}, v.title), h('div', { class: 'meta' }, [v.year || '', v.km ? km(v.km) : '', v.transmission].filter(Boolean).join(' · ')), h('div', { class: 'price' }, v.price ? brl(v.price) : 'Consulte')))));
}

function renderTeams() {
  $('#teams').replaceChildren(...teams.map((t) => h('div', { class: 'card team' },
    h('h3', {}, t.name), h('div', { class: 'meta' }, t.desc),
    h('div', { class: 'lead' }, t.leader ? 'Responsável: ' + t.leader : 'Responsável a definir'),
    t.members.length ? h('ul', {}, t.members.map((m) => h('li', {}, m))) : '')));
}

function renderContact() {
  const rows = [['Telefone', S.phone], ['E-mail', S.email], ['Endereço', S.address], ['Horário', S.hours], ['Instagram', S.instagram]].filter((r) => r[1]);
  $('#contact').replaceChildren(h('strong', {}, S.name), rows.map((r) => h('div', {}, r[0] + ': ', r[0] === 'Telefone' ? h('a', { href: 'tel:' + r[1].replace(/[^\d+]/g, '') }, r[1]) : r[1])), h('div', { style: 'margin-top:14px;opacity:.7' }, '© ' + new Date().getFullYear() + ' ' + S.name));
  const w = (S.whatsapp || '').replace(/\D/g, '');
  if (w) { const a = $('#wa'); a.hidden = false; a.href = 'https://wa.me/' + w + '?text=' + encodeURIComponent('Olá! Vim pelo site da ' + S.name + '.'); }
}

function openVehicle(v) {
  const main = h('div', { class: 'main' }, v.photos[0] ? h('img', { src: v.photos[0], alt: v.title }) : 'Sem foto');
  const thumbs = h('div', { class: 'thumbs' }, v.photos.length > 1 ? v.photos.map((u, i) => h('img', { src: u, alt: '', class: i ? '' : 'on', onclick: (e) => { main.firstChild.src = u; thumbs.querySelectorAll('img').forEach((x) => x.classList.remove('on')); e.target.classList.add('on'); } })) : []);
  const spec = (k, val) => val ? [h('b', {}, k), h('span', {}, val)] : [];
  const open = teams.filter((t) => t.receivesProposals);
  const form = h('form', { onsubmit: (e) => sendProposal(e, v) },
    h('h3', { style: 'margin:14px 0 0' }, 'Peça uma proposta'),
    h('label', {}, 'Qual equipe vai montar a proposta?'),
    h('select', { name: 'teamId', required: true }, open.map((t) => h('option', { value: t.id }, t.name + (t.leader ? ' (resp. ' + t.leader + ')' : '')))),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Seu nome'), h('input', { name: 'name', required: true, maxlength: 100 })), h('div', {}, h('label', {}, 'Telefone / WhatsApp'), h('input', { name: 'phone', required: true, type: 'tel', maxlength: 30 }))),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'E-mail (opcional)'), h('input', { name: 'email', type: 'email', maxlength: 120 })), h('div', {}, h('label', {}, 'Valor que pretende pagar (opcional)'), h('input', { name: 'offer', type: 'number', min: 0, step: 100 }))),
    h('label', {}, 'Mensagem'), h('textarea', { name: 'message', maxlength: 1500, placeholder: 'Ex.: tenho um carro na troca, quero financiar...' }),
    h('div', { id: 'fmsg' }), h('button', { class: 'btn', style: 'margin-top:10px' }, 'Enviar pedido'));
  $('#box').replaceChildren(h('button', { class: 'x', 'aria-label': 'Fechar', onclick: closeModal }, '×'),
    h('div', { class: 'gal' }, h('div', {}, main, thumbs),
      h('div', {}, h('h2', { style: 'margin:0 0 4px' }, v.title), v.status === 'reservado' ? h('span', { class: 'badge' }, 'Reservado') : '', h('div', { class: 'price', style: 'font-size:1.7rem' }, v.price ? brl(v.price) : 'Consulte'),
        h('div', { class: 'specs' }, spec('Ano', v.year), spec('Quilometragem', v.km ? km(v.km) : ''), spec('Combustível', v.fuel), spec('Câmbio', v.transmission), spec('Cor', v.color), spec('Marca', v.brand)),
        h('p', { class: 'meta', style: 'white-space:pre-line' }, v.description), form)));
  $('#modal').classList.add('open');
}
function closeModal() { $('#modal').classList.remove('open'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

async function sendProposal(e, v) {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const box = $('#fmsg');
  const r = await fetch('/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, vehicleId: v.id }) });
  const d = await r.json();
  box.className = 'msg ' + (r.ok ? 'ok' : 'err');
  box.textContent = r.ok ? 'Pedido enviado para a equipe ' + d.team + (d.leader ? ' (responsável: ' + d.leader + ')' : '') + '. Em breve entram em contato.' : d.error;
  if (r.ok) e.target.reset();
}
init();
