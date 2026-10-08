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

function router() {
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

  r.use((err, req, res, _next) => {
    console.error('api error', err);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  });
  return r;
}

module.exports = { router, AVATARS };