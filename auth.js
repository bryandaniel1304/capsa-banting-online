// Account endpoints: signup / login / logout / profile / play history.
const crypto = require('crypto');
const express = require('express');
const store = require('./store');
const R = require('./shared/rules');

const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🐨', '🐰', '🐻', '🦁', '🐷', '🐙', '🦄'];
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}
function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---------- TURN / STUN servers for voice chat ----------
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const hasTurn = (list) => list.some((s) => [].concat(s.urls || s.url || []).some((u) => /^turns?:/.test(u)));
let iceCache = null; // { at, value }
async function iceConfig() {
  if (iceCache && Date.now() - iceCache.at < 30 * 60000) return iceCache.value; // TURN credentials are short-lived
  let list = null, source = 'stun';
  try {
    if (process.env.ICE_SERVERS) {
      list = JSON.parse(process.env.ICE_SERVERS); source = 'ICE_SERVERS';
    } else if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
      const domain = process.env.METERED_DOMAIN.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const r = await fetch('https://' + domain + '/api/v1/turn/credentials?apiKey=' + encodeURIComponent(process.env.METERED_API_KEY), { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error('Metered ' + r.status);
      list = await r.json(); source = 'metered';
    } else if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) {
      const r = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + process.env.CF_TURN_KEY_ID + '/credentials/generate', {
        method: 'POST', signal: AbortSignal.timeout(6000),
        headers: { Authorization: 'Bearer ' + process.env.CF_TURN_API_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      });
      if (!r.ok) throw new Error('Cloudflare TURN ' + r.status);
      const d = await r.json();
      list = Array.isArray(d.iceServers) ? d.iceServers : [d.iceServers]; source = 'cloudflare';
    }
  } catch (e) { console.error('TURN config:', e.message); list = null; source = 'error'; }
  if (!Array.isArray(list) || !list.length) { list = []; if (source !== 'error') source = 'stun'; }
  const value = { iceServers: [...STUN, ...list], turn: hasTurn(list), source };
  iceCache = { at: source === 'error' ? Date.now() - 29 * 60000 : Date.now(), value }; // retry a failed provider after a minute
  if (source !== 'stun' && !value.turn) console.error('TURN config: no turn: urls in', source);
  return value;
}

// simple per-IP throttle for login/signup attempts
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, reset: now + 10 * 60000 };
  if (now > a.reset) { a.n = 0; a.reset = now + 10 * 60000; }
  a.n++;
  attempts.set(ip, a);
  return a.n > 30;
}

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
const cleanName = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 14);

// hooks: presenceOf(userId) -> { online, room, state }, emitToUser(userId, event, data)
function router(hooks = {}) {
  const presenceOf = hooks.presenceOf || (() => ({ online: false }));
  const emitToUser = hooks.emitToUser || (() => {});
  const onProfile = hooks.onProfile || (() => {}); // name / avatar changed: refresh live tables
  const r = express.Router();
  const small = express.json({ limit: '10kb' });
  r.use((req, res, next) => (req.path === '/me/photo' ? next() : small(req, res, next))); // photos get their own limit

  const auth = async (req, res, next) => {
    try {
      req.user = await store.userByToken(bearer(req));
      if (!req.user) return res.status(401).json({ error: 'Silakan masuk dulu' });
      next();
    } catch (e) { next(e); }
  };

  r.post('/signup', async (req, res, next) => {
    try {
      if (throttled(req.ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi nanti' });
      const { username, password, name, avatar } = req.body || {};
      if (!USERNAME_RE.test(username || '')) return res.status(400).json({ error: 'Username 3-20 karakter: huruf, angka, _ atau .' });
      if (typeof password !== 'string' || password.length < 6 || password.length > 100) return res.status(400).json({ error: 'Password minimal 6 karakter' });
      if (await store.findUserByUsername(username)) return res.status(409).json({ error: 'Username sudah dipakai' });
      const user = await store.createUser({
        username, passHash: hashPassword(password),
        name: cleanName(name) || username.slice(0, 14),
        avatar: AVATARS.includes(avatar) ? avatar : AVATARS[Math.floor(Math.random() * AVATARS.length)],
      });
      const token = await store.createSession(user.id);
      res.json({ token, user });
    } catch (e) { next(e); }
  });

  r.post('/login', async (req, res, next) => {
    try {
      if (throttled(req.ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi nanti' });
      const { username, password } = req.body || {};
      const u = await store.findUserByUsername(username || '');
      if (!u || typeof password !== 'string' || !verifyPassword(password, u.pass_hash)) {
        return res.status(401).json({ error: 'Username atau password salah' });
      }
      const token = await store.createSession(u.id);
      res.json({ token, user: { id: u.id, username: u.username, name: u.name, avatar: u.avatar } });
    } catch (e) { next(e); }
  });

  r.post('/logout', async (req, res, next) => {
    try { await store.deleteSession(bearer(req)); res.json({ ok: true }); } catch (e) { next(e); }
  });

  r.get('/me', auth, async (req, res, next) => {
    try { res.json({ user: req.user, stats: await store.stats(req.user.id) }); } catch (e) { next(e); }
  });

  r.patch('/me', auth, async (req, res, next) => {
    try {
      const { name, avatar } = req.body || {};
      const emoji = AVATARS.includes(avatar) ? avatar : null;
      if (emoji) await store.deletePhoto(req.user.id); // picking an emoji replaces the photo
      const user = await store.updateUser(req.user.id, { name: cleanName(name) || null, avatar: emoji });
      onProfile(user);
      res.json({ user });
    } catch (e) { next(e); }
  });

  // ---------- profile picture from the gallery ----------
  // The phone crops and shrinks the picture first (about 15 KB); the server only checks it really is an image.
  const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
  r.post('/me/photo', express.json({ limit: '400kb' }), auth, async (req, res, next) => {
    try {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).image || ''));
      if (!m) return res.status(400).json({ error: 'Format foto tidak didukung (pakai JPG / PNG / WebP)' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length < 100 || buf.length > 250 * 1024) return res.status(400).json({ error: 'Ukuran foto tidak valid' });
      if (!MAGIC[m[1]].every((b, i) => buf[i] === b)) return res.status(400).json({ error: 'File bukan gambar' });
      const user = await store.savePhoto(req.user.id, m[1], buf.toString('base64'));
      onProfile(user);
      res.json({ user });
    } catch (e) { next(e); }
  });
  r.get('/photo/:id', async (req, res, next) => {
    try {
      const ph = await store.getPhoto(parseInt(req.params.id, 10) || 0);
      if (!ph) return res.status(404).end();
      res.set({ 'Content-Type': ph.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      res.send(Buffer.from(ph.data, 'base64')); // the URL carries a version, so it can be cached for good
    } catch (e) { next(e); }
  });

  // Change password while signed in. The signed-in session proves ownership, so the old password is only
  // checked when given (players who forgot it can still set a new one from a device that is logged in).
  r.post('/password', auth, async (req, res, next) => {
    try {
      const { newPassword, currentPassword } = req.body || {};
      if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 100) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
      if (currentPassword) {
        const u = await store.findUserByUsername(req.user.username);
        if (!verifyPassword(String(currentPassword), u.pass_hash)) return res.status(401).json({ error: 'Password lama salah' });
      }
      await store.setPassword(req.user.id, hashPassword(newPassword));
      await store.deleteOtherSessions(req.user.id, bearer(req));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.get('/history', auth, async (req, res, next) => {
    try { res.json(await store.history(req.user.id)); } catch (e) { next(e); }
  });

  r.get('/match/:id', auth, async (req, res, next) => {
    try {
      const d = await store.matchDetail(parseInt(req.params.id, 10) || 0, req.user.id);
      if (!d) return res.status(404).json({ error: 'Riwayat tidak ditemukan' });
      res.json(d);
    } catch (e) { next(e); }
  });

  // ---------- friends ----------
  const idParam = (req) => parseInt(req.params.id, 10) || 0;
  const changed = (...ids) => ids.forEach((id) => emitToUser(id, 'friends:update', {}));

  r.get('/friends', auth, async (req, res, next) => {
    try {
      const rows = await store.listFriends(req.user.id);
      const out = { friends: [], incoming: [], outgoing: [] };
      for (const f of rows) {
        const item = { id: f.id, username: f.username, name: f.name, avatar: f.avatar, unread: f.unread };
        if (f.status === 'accepted') out.friends.push({ ...item, presence: presenceOf(f.id) });
        else if (f.outgoing) out.outgoing.push(item);
        else out.incoming.push(item);
      }
      out.friends.sort((a, b) => (b.presence.online - a.presence.online) || a.name.localeCompare(b.name));
      res.json(out);
    } catch (e) { next(e); }
  });

  r.post('/friends', auth, async (req, res, next) => {
    try {
      const other = await store.findUserByUsername(String((req.body || {}).username || '').trim().replace(/^@/, ''));
      if (!other) return res.status(404).json({ error: 'Username tidak ditemukan' });
      if (other.id === req.user.id) return res.status(400).json({ error: 'Itu username kamu sendiri' });
      const status = await store.requestFriend(req.user.id, other.id);
      changed(req.user.id, other.id);
      const msg = { pending: 'Permintaan pertemanan dikirim ke @' + other.username, accepted: 'Kamu sekarang berteman dengan ' + other.name, already: 'Sudah berteman dengan ' + other.name };
      if (status === 'pending') emitToUser(other.id, 'friends:request', { from: { id: req.user.id, name: req.user.name, username: req.user.username } });
      res.json({ status, message: msg[status] });
    } catch (e) { next(e); }
  });

  r.post('/friends/:id/accept', auth, async (req, res, next) => {
    try {
      const ok = await store.acceptFriend(req.user.id, idParam(req));
      if (!ok) return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
      changed(req.user.id, idParam(req));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.delete('/friends/:id', auth, async (req, res, next) => {
    try {
      await store.removeFriend(req.user.id, idParam(req));
      changed(req.user.id, idParam(req));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- direct messages (friends only) ----------
  r.get('/messages/:id', auth, async (req, res, next) => {
    try {
      const other = idParam(req);
      if (!(await store.areFriends(req.user.id, other))) return res.status(403).json({ error: 'Hanya bisa chat dengan teman' });
      const list = await store.messages(req.user.id, other, parseInt(req.query.before, 10) || null);
      await store.markRead(req.user.id, other);
      res.json({ messages: list });
    } catch (e) { next(e); }
  });

  r.post('/messages/:id', auth, async (req, res, next) => {
    try {
      const other = idParam(req);
      const body = String((req.body || {}).body || '').trim().slice(0, 500);
      if (!body) return res.status(400).json({ error: 'Pesan kosong' });
      if (!(await store.areFriends(req.user.id, other))) return res.status(403).json({ error: 'Hanya bisa chat dengan teman' });
      const m = await store.addMessage(req.user.id, other, body);
      const payload = { ...m, from: { id: req.user.id, name: req.user.name, avatar: req.user.avatar } };
      emitToUser(other, 'dm', payload);
      emitToUser(req.user.id, 'dm', payload);
      res.json({ message: m });
    } catch (e) { next(e); }
  });

  r.post('/messages/:id/read', auth, async (req, res, next) => {
    try { await store.markRead(req.user.id, idParam(req)); res.json({ ok: true }); } catch (e) { next(e); }
  });

  // ---------- public player profile (tap a player at the table) ----------
  r.get('/users/:id', auth, async (req, res, next) => {
    try {
      const id = idParam(req);
      const u = await store.publicUser(id);
      if (!u) return res.status(404).json({ error: 'Pemain tidak ditemukan' });
      const [stats, rel] = await Promise.all([store.stats(id), store.relation(req.user.id, id)]);
      res.json({ user: u, stats, relation: rel, presence: rel === 'friends' || rel === 'self' ? presenceOf(id) : null });
    } catch (e) { next(e); }
  });

  // ---------- saved table-rule presets ----------
  r.get('/presets', auth, async (req, res, next) => {
    try { res.json({ presets: await store.listPresets(req.user.id), defaults: R.DEFAULT_RULES }); } catch (e) { next(e); }
  });
  r.post('/presets', auth, async (req, res, next) => {
    try {
      const name = String((req.body || {}).name || '').replace(/[<>]/g, '').trim().slice(0, 30);
      if (!name) return res.status(400).json({ error: 'Beri nama aturan' });
      if (/^default$|^aturan default$/i.test(name)) return res.status(400).json({ error: 'Nama itu dipakai untuk aturan bawaan' });
      const existing = (await store.listPresets(req.user.id)).some((p) => p.name === name);
      if (!existing && (await store.countPresets(req.user.id)) >= 20) return res.status(400).json({ error: 'Maksimal 20 aturan tersimpan' });
      const rules = R.normalizeRules((req.body || {}).rules);
      const saved = await store.savePreset(req.user.id, name, JSON.stringify(rules));
      res.json({ preset: { ...saved, rules } });
    } catch (e) { next(e); }
  });
  r.delete('/presets/:id', auth, async (req, res, next) => {
    try { await store.deletePreset(req.user.id, idParam(req)); res.json({ ok: true }); } catch (e) { next(e); }
  });

  // ---------- voice chat ICE servers ----------
  // STUN alone only connects players whose networks allow a direct link; on mobile data (carrier NAT) voice
  // needs a TURN relay. Configure one of: ICE_SERVERS (JSON array), Metered (METERED_DOMAIN + METERED_API_KEY)
  // or Cloudflare (CF_TURN_KEY_ID + CF_TURN_API_TOKEN). Signed-in players only, so relay credentials aren't public.
  r.get('/ice', auth, async (req, res, next) => {
    try { res.json(await iceConfig()); } catch (e) { next(e); }
  });

  r.use((err, req, res, _next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: req.path === '/me/photo' ? 'Foto terlalu besar' : 'Data terlalu besar' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Data tidak valid' });
    console.error('api error', err);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  });
  return r;
}

module.exports = { router, AVATARS };