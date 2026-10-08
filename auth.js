// Account endpoints: signup / login / logout / profile / play history.
const crypto = require('crypto');
const express = require('express');
const store = require('./store');

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
  const r = express.Router();
  r.use(express.json({ limit: '10kb' }));

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
      const user = await store.updateUser(req.user.id, { name: cleanName(name) || null, avatar: AVATARS.includes(avatar) ? avatar : null });
      res.json({ user });
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

  // ---------- voice chat ICE servers (STUN by default; set ICE_SERVERS to a JSON array to add TURN) ----------
  r.get('/ice', (req, res) => {
    let servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    try { if (process.env.ICE_SERVERS) servers = JSON.parse(process.env.ICE_SERVERS); } catch { console.error('Invalid ICE_SERVERS'); }
    res.json({ iceServers: servers });
  });

  r.use((err, req, res, _next) => {
    console.error('api error', err);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  });
  return r;
}

module.exports = { router, AVATARS };