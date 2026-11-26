'use strict';
// Servidor sem dependências externas (só Node 18+).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

/* ---------- utilidades ---------- */
const uid = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

/* ---------- banco (JSON em arquivo) ---------- */
let db;
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function seed() {
  const creds = [];
  const mk = (username, name, role, teamId) => {
    const pw = crypto.randomBytes(5).toString('hex');
    creds.push(`${username}  senha: ${pw}  (${role})`);
    return { id: uid(), username, name, role, teamId: teamId || null, pw: hashPw(pw) };
  };
  const teams = [
    { id: 't-vendas', name: 'Vendas Seminovos', desc: 'Apresenta o veículo, negocia valores e fecha a compra.', manageStock: true, receivesProposals: true },
    { id: 't-fin', name: 'Financiamento', desc: 'Simula parcelas e cuida da aprovação de crédito.', manageStock: false, receivesProposals: true },
    { id: 't-troca', name: 'Avaliação e Troca', desc: 'Avalia o seu veículo e propõe o valor de entrada na troca.', manageStock: false, receivesProposals: true },
    { id: 't-pos', name: 'Pós-venda e Garantia', desc: 'Documentação, transferência e garantia depois da compra.', manageStock: false, receivesProposals: true },
  ];
  const users = [mk('admin', 'Administrador', 'admin', null)];
  for (const t of teams) {
    const u = mk('gerente-' + t.id.slice(2), 'Gerente ' + t.name, 'gerente', t.id);
    t.leaderId = u.id;
    users.push(u);
  }
  const sample = (title, brand, model, year, price, km, fuel, trans, color, desc) => ({
    id: uid(), title, brand, model, year, price, km, fuel, transmission: trans, color,
    description: desc, photos: [], status: 'disponivel', featured: true, createdAt: now(),
  });
  db = {
    settings: {
      name: 'Pinheiro Veículos', slogan: 'Seminovos com procedência e atendimento de verdade',
      about: 'Texto de apresentação da loja. Edite em Admin > Site.',
      phone: '', whatsapp: '', email: '', address: '', hours: '', instagram: '', logo: '', color: '#0b3d91',
    },
    teams, users,
    vehicles: [
      sample('EXEMPLO: Hatch 1.0 Flex', 'Exemplo', 'Hatch 1.0', 2019, 42900, 61000, 'Flex', 'Manual', 'Prata', 'Veículo de exemplo. Apague ou edite em Admin > Veículos.'),
      sample('EXEMPLO: Sedã 1.6 Automático', 'Exemplo', 'Sedã 1.6', 2020, 68900, 48000, 'Flex', 'Automático', 'Preto', 'Veículo de exemplo. Apague ou edite em Admin > Veículos.'),
      sample('EXEMPLO: SUV 2.0 Automático', 'Exemplo', 'SUV 2.0', 2021, 99900, 35000, 'Flex', 'Automático', 'Branco', 'Veículo de exemplo. Apague ou edite em Admin > Veículos.'),
    ],
    proposals: [],
  };
  save();
  fs.writeFileSync(path.join(DATA, 'credenciais-iniciais.txt'),
    'Logins criados no primeiro start. Troque as senhas em Admin > Usuários e apague este arquivo.\n\n' + creds.join('\n') + '\n');
  console.log('\n=== PRIMEIRO START: logins criados (também em data/credenciais-iniciais.txt) ===\n' + creds.join('\n') + '\n');
}
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); else seed();

/* ---------- sessões e limite de tentativas ---------- */
const sessions = new Map();
const hits = new Map();
function limited(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  return arr.length > max;
}
function parseCookies(req) {
  const o = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return o;
}
function userOf(req) {
  const s = sessions.get(parseCookies(req).sid);
  if (!s || s.exp < Date.now()) return null;
  return db.users.find((u) => u.id === s.userId) || null;
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, teamId: u.teamId });

/* ---------- permissões ---------- */
const isAdmin = (u) => u.role === 'admin';
const canStock = (u) => isAdmin(u) || (u.role === 'gerente' && (db.teams.find((t) => t.id === u.teamId) || {}).manageStock);
function visibleProposals(u) {
  if (isAdmin(u)) return db.proposals;
  if (u.role === 'gerente') return db.proposals.filter((p) => p.teamId === u.teamId);
  return db.proposals.filter((p) => p.assignedTo === u.id);
}

/* ---------- imagens ---------- */
function saveImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw httpErr(400, 'Imagem inválida. Use PNG, JPG, WEBP ou GIF.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw httpErr(413, 'Imagem acima de 6 MB.');
  const h = buf.subarray(0, 12);
  const ok = (m[1] === 'image/png' && h[0] === 0x89 && h[1] === 0x50) ||
    (m[1] === 'image/jpeg' && h[0] === 0xff && h[1] === 0xd8) ||
    (m[1] === 'image/gif' && h.toString('latin1', 0, 3) === 'GIF') ||
    (m[1] === 'image/webp' && h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP');
  if (!ok) throw httpErr(400, 'O conteúdo não é a imagem declarada.');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[m[1]];
  const name = uid() + uid() + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return '/uploads/' + name;
}
const urlOk = (u) => typeof u === 'string' && /^\/uploads\/[a-f0-9]+\.(png|jpg|gif|webp)$/.test(u);

/* ---------- HTTP ---------- */
function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 9 * 1024 * 1024) { reject(httpErr(413, 'Corpo grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(httpErr(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };
function serveFile(res, base, rel) {
  const file = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Não encontrado');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': base === UPLOADS ? 'public, max-age=86400' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const vehicleIn = (b, old = {}) => ({
  ...old,
  title: str(b.title, 120) || old.title || 'Veículo',
  brand: str(b.brand, 60), model: str(b.model, 80),
  year: num(b.year), price: num(b.price), km: num(b.km),
  fuel: str(b.fuel, 30), transmission: str(b.transmission, 30), color: str(b.color, 30),
  description: str(b.description, 2000),
  status: ['disponivel', 'reservado', 'vendido'].includes(b.status) ? b.status : 'disponivel',
  featured: !!b.featured,
  photos: (Array.isArray(b.photos) ? b.photos : []).filter(urlOk).slice(0, 20),
});

async function api(req, res, url) {
  const m = req.method;
  const p = url.pathname;
  const me = userOf(req);
  const ip = req.socket.remoteAddress;
  const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
  let r;

  /* públicas */
  if (m === 'GET' && p === '/api/public') {
    const vehicles = db.vehicles.filter((v) => v.status !== 'vendido');
    const teams = db.teams.map((t) => ({
      id: t.id, name: t.name, desc: t.desc, receivesProposals: t.receivesProposals,
      leader: (db.users.find((u) => u.id === t.leaderId) || {}).name || null,
      members: db.users.filter((u) => u.teamId === t.id && u.id !== t.leaderId).map((u) => u.name),
    }));
    return send(res, 200, { settings: db.settings, vehicles, teams });
  }
  if (m === 'POST' && p === '/api/proposals') {
    if (limited('prop:' + ip, 5, 10 * 60 * 1000)) throw httpErr(429, 'Muitos envios. Tente de novo em alguns minutos.');
    const team = db.teams.find((t) => t.id === body.teamId && t.receivesProposals);
    if (!team) throw httpErr(400, 'Escolha uma equipe.');
    const v = db.vehicles.find((x) => x.id === body.vehicleId);
    const prop = {
      id: uid(), vehicleId: v ? v.id : null, vehicleTitle: v ? v.title : str(body.vehicleTitle, 120),
      teamId: team.id, name: str(body.name, 100), phone: str(body.phone, 30), email: str(body.email, 120),
      message: str(body.message, 1500), offer: num(body.offer),
      status: 'nova', assignedTo: null, replies: [], createdAt: now(),
    };
    if (!prop.name || prop.phone.replace(/\D/g, '').length < 8) throw httpErr(400, 'Informe nome e telefone válidos.');
    db.proposals.unshift(prop); save();
    return send(res, 201, { ok: true, team: team.name, leader: (db.users.find((u) => u.id === team.leaderId) || {}).name || null });
  }
  if (m === 'POST' && p === '/api/login') {
    if (limited('login:' + ip, 10, 15 * 60 * 1000)) throw httpErr(429, 'Muitas tentativas. Aguarde 15 minutos.');
    const u = db.users.find((x) => x.username === str(body.username, 60).toLowerCase());
    if (!u || !checkPw(String(body.password || ''), u.pw)) throw httpErr(401, 'Usuário ou senha incorretos.');
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { userId: u.id, exp: Date.now() + 8 * 3600 * 1000 });
    return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
  }
  if (m === 'POST' && p === '/api/logout') {
    sessions.delete(parseCookies(req).sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  /* autenticadas */
  if (!me) throw httpErr(401, 'Faça login.');
  if (m === 'GET' && p === '/api/me') {
    return send(res, 200, { user: publicUser(me), canStock: canStock(me), teams: db.teams, users: isAdmin(me) || me.role === 'gerente' ? db.users.map(publicUser) : [publicUser(me)] });
  }
  if (m === 'POST' && p === '/api/upload') return send(res, 201, { url: saveImage(body.dataUrl) });

  if (m === 'GET' && p === '/api/admin/vehicles') { if (!canStock(me)) throw httpErr(403, 'Sem permissão.'); return send(res, 200, db.vehicles); }
  if (m === 'POST' && p === '/api/admin/vehicles') {
    if (!canStock(me)) throw httpErr(403, 'Sem permissão.');
    const v = { id: uid(), createdAt: now(), ...vehicleIn(body) }; db.vehicles.unshift(v); save(); return send(res, 201, v);
  }
  if ((r = /^\/api\/admin\/vehicles\/(\w+)$/.exec(p))) {
    if (!canStock(me)) throw httpErr(403, 'Sem permissão.');
    const i = db.vehicles.findIndex((v) => v.id === r[1]);
    if (i < 0) throw httpErr(404, 'Veículo não encontrado.');
    if (m === 'PUT') { db.vehicles[i] = vehicleIn(body, db.vehicles[i]); save(); return send(res, 200, db.vehicles[i]); }
    if (m === 'DELETE') { db.vehicles.splice(i, 1); save(); return send(res, 200, { ok: true }); }
  }

  if (m === 'GET' && p === '/api/admin/proposals') return send(res, 200, visibleProposals(me));
  if ((r = /^\/api\/admin\/proposals\/(\w+)$/.exec(p)) && m === 'PUT') {
    const pr = visibleProposals(me).find((x) => x.id === r[1]);
    if (!pr) throw httpErr(404, 'Proposta não encontrada.');
    if (body.status && ['nova', 'em_atendimento', 'respondida', 'fechada', 'recusada'].includes(body.status)) pr.status = body.status;
    if (body.assignedTo !== undefined && (isAdmin(me) || me.role === 'gerente')) {
      if (body.assignedTo === null || body.assignedTo === '') pr.assignedTo = null;
      else {
        const a = db.users.find((u) => u.id === body.assignedTo && u.teamId === pr.teamId);
        if (!a) throw httpErr(400, 'O responsável precisa ser da equipe da proposta.');
        pr.assignedTo = a.id; if (pr.status === 'nova') pr.status = 'em_atendimento';
      }
    }
    if (str(body.reply) || num(body.replyValue)) {
      pr.replies.push({ by: me.name, text: str(body.reply, 1500), value: num(body.replyValue), at: now() });
      if (['nova', 'em_atendimento'].includes(pr.status)) pr.status = 'respondida';
    }
    save(); return send(res, 200, pr);
  }

  /* somente admin */
  if (!isAdmin(me)) throw httpErr(403, 'Somente o administrador.');
  if (m === 'PUT' && p === '/api/admin/settings') {
    const s = db.settings, keys = ['name', 'slogan', 'about', 'phone', 'whatsapp', 'email', 'address', 'hours', 'instagram'];
    for (const k of keys) if (k in body) s[k] = str(body[k], k === 'about' ? 2000 : 200);
    if (/^#[0-9a-f]{6}$/i.test(body.color || '')) s.color = body.color;
    if ('logo' in body) s.logo = body.logo === '' ? '' : urlOk(body.logo) ? body.logo : s.logo;
    save(); return send(res, 200, s);
  }
  if (m === 'POST' && p === '/api/admin/teams') {
    const t = { id: 't-' + uid(), name: str(body.name, 80) || 'Nova equipe', desc: str(body.desc, 300), manageStock: !!body.manageStock, receivesProposals: body.receivesProposals !== false, leaderId: null };
    db.teams.push(t); save(); return send(res, 201, t);
  }
  if ((r = /^\/api\/admin\/teams\/([\w-]+)$/.exec(p))) {
    const t = db.teams.find((x) => x.id === r[1]);
    if (!t) throw httpErr(404, 'Equipe não encontrada.');
    if (m === 'PUT') {
      t.name = str(body.name, 80) || t.name; t.desc = str(body.desc, 300);
      t.manageStock = !!body.manageStock; t.receivesProposals = !!body.receivesProposals;
      if ('leaderId' in body) {
        const l = db.users.find((u) => u.id === body.leaderId && u.teamId === t.id);
        t.leaderId = l ? l.id : null;
        if (l && l.role === 'vendedor') l.role = 'gerente';
      }
      save(); return send(res, 200, t);
    }
    if (m === 'DELETE') {
      if (db.users.some((u) => u.teamId === t.id)) throw httpErr(400, 'Mova ou remova os usuários da equipe antes.');
      db.teams = db.teams.filter((x) => x !== t); save(); return send(res, 200, { ok: true });
    }
  }
  if (m === 'GET' && p === '/api/admin/users') return send(res, 200, db.users.map(publicUser));
  if (m === 'POST' && p === '/api/admin/users') {
    const username = str(body.username, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!username || db.users.some((u) => u.username === username)) throw httpErr(400, 'Usuário vazio ou já existe.');
    if (str(body.password).length < 8) throw httpErr(400, 'Senha com no mínimo 8 caracteres.');
    const role = ['admin', 'gerente', 'vendedor'].includes(body.role) ? body.role : 'vendedor';
    const teamId = db.teams.some((t) => t.id === body.teamId) ? body.teamId : null;
    if (role !== 'admin' && !teamId) throw httpErr(400, 'Escolha a equipe.');
    const u = { id: uid(), username, name: str(body.name, 80) || username, role, teamId: role === 'admin' ? null : teamId, pw: hashPw(String(body.password)) };
    db.users.push(u);
    if (role === 'gerente') { const t = db.teams.find((x) => x.id === teamId); if (t && !t.leaderId) t.leaderId = u.id; }
    save(); return send(res, 201, publicUser(u));
  }
  if ((r = /^\/api\/admin\/users\/(\w+)$/.exec(p))) {
    const u = db.users.find((x) => x.id === r[1]);
    if (!u) throw httpErr(404, 'Usuário não encontrado.');
    if (m === 'PUT') {
      u.name = str(body.name, 80) || u.name;
      if (body.password) { if (str(body.password).length < 8) throw httpErr(400, 'Senha com no mínimo 8 caracteres.'); u.pw = hashPw(String(body.password)); }
      if (u.id !== me.id) {
        if (['admin', 'gerente', 'vendedor'].includes(body.role)) u.role = body.role;
        if (body.teamId !== undefined) u.teamId = db.teams.some((t) => t.id === body.teamId) ? body.teamId : null;
        if (u.role === 'admin') u.teamId = null;
      }
      for (const t of db.teams) if (t.leaderId === u.id && u.teamId !== t.id) t.leaderId = null;
      save(); return send(res, 200, publicUser(u));
    }
    if (m === 'DELETE') {
      if (u.id === me.id) throw httpErr(400, 'Você não pode apagar o próprio usuário.');
      db.users = db.users.filter((x) => x !== u);
      for (const t of db.teams) if (t.leaderId === u.id) t.leaderId = null;
      for (const pr of db.proposals) if (pr.assignedTo === u.id) pr.assignedTo = null;
      for (const [k, s] of sessions) if (s.userId === u.id) sessions.delete(k);
      save(); return send(res, 200, { ok: true });
    }
  }
  throw httpErr(404, 'Rota não encontrada.');
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/uploads/')) return serveFile(res, UPLOADS, url.pathname.slice(9));
    const map = { '/': 'index.html', '/admin': 'admin.html' };
    return serveFile(res, PUB, map[url.pathname] || url.pathname.slice(1));
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : 'Erro interno.' });
  }
}).listen(PORT, () => console.log(`Pinheiro Veículos em http://localhost:${PORT}  (painel: /admin)`));
