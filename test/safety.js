// Play Store requirements: block / report players, moderator ban, delete account (app + web), legal pages.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const PORT = 3987, url = 'http://localhost:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, PGLITE_DIR: path.join(os.tmpdir(), 'capsa-safety-' + Date.now()), DATABASE_URL: '', ADMIN_USERNAMES: 'moda', CONTACT_EMAIL: 'kontak@contoh.id' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
async function api(p, { method = 'GET', body, token } = {}) {
  const r = await fetch(url + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, ...d };
}
const signup = async (u) => (await api('/signup', { method: 'POST', body: { username: u, password: 'rahasia1', name: u } }));

(async () => {
  for (let i = 0; i < 60; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(200); } }
  const A = await signup('ana'), B = await signup('budi'), M = await signup('moda');
  const idA = A.user.id, idB = B.user.id;

  // legal pages render with the contact email
  for (const p of ['/privasi', '/ketentuan', '/hapus-akun']) {
    const html = await (await fetch(url + p)).text();
    assert(html.includes('kontak@contoh.id') && !html.includes('{{'), p + ' renders');
  }
  console.log('legal pages OK');

  // friends, then a table with chat
  await api('/friends', { method: 'POST', token: A.token, body: { username: 'budi' } });
  await api('/friends/' + idA + '/accept', { method: 'POST', token: B.token });
  assert.equal((await api('/users/' + idB, { token: A.token })).relation, 'friends');
  const a = io(url, { transports: ['websocket'] }), b = io(url, { transports: ['websocket'] });
  a.on('state', (v) => (a.v = v)); b.on('state', (v) => (b.v = v));
  const bGone = new Promise((res) => b.on('account:gone', res));
  await call(a, 'hello', { auth: A.token }); await call(b, 'hello', { auth: B.token });
  const { room } = await call(a, 'create', { mult: 250 });
  await call(b, 'join', { code: room });
  b.emit('chat', { text: 'kata kasar' });
  await sleep(300);
  assert.equal(a.v.seats[b.v.you].userId, idB, 'seat carries the account id (client hides blocked chat)');

  // report with table chat context, then block
  let r = await api('/reports', { method: 'POST', token: A.token, body: { userId: idB, reason: 'Kata-kata kasar / menghina', details: 'menghina' } });
  assert(r.ok, r.error);
  assert.equal((await api('/reports', { method: 'POST', token: A.token, body: { userId: idB, reason: 'bukan alasan' } })).status, 400, 'reason must be from the list');
  r = await api('/blocks/' + idB, { method: 'POST', token: A.token }); assert(r.ok);
  assert.equal((await api('/users/' + idB, { token: A.token })).relation, 'none', 'blocking ends the friendship');
  assert.equal((await api('/users/' + idB, { token: A.token })).blocked, true);
  assert.equal((await api('/friends', { method: 'POST', token: B.token, body: { username: 'ana' } })).status, 403, 'no friend request from a blocked player');
  assert.equal((await api('/messages/' + idA, { method: 'POST', token: B.token, body: { body: 'halo' } })).status, 403, 'no DM');
  await call(a, 'leave', {}); await sleep(200);
  const inv = await call(b, 'invite', { userId: idA });
  assert(inv.error, 'no invite to someone who blocked you');
  const ol = await call(b, 'online:list');
  assert(!ol.players.some((p) => p.id === idA), 'hidden from the online list');
  assert.equal((await api('/blocks', { token: A.token })).blocked[0].id, idB);
  console.log('report + block OK');

  // moderator: sees the report with chat context, bans budi -> signed out, can't log in
  assert.equal((await api('/admin/reports', { token: A.token })).status, 403, 'only moderators');
  const reps = (await api('/admin/reports', { token: M.token })).reports;
  assert.equal(reps.length, 1); assert(/kata kasar/.test(reps[0].context), 'table chat attached: ' + reps[0].context);
  assert.equal((await api('/me', { token: M.token })).admin, true);
  r = await api('/admin/users/' + idB + '/ban', { method: 'POST', token: M.token, body: { banned: true } }); assert(r.ok);
  await Promise.race([bGone, sleep(2000).then(() => { throw new Error('banned player not signed out'); })]);
  assert.equal((await api('/me', { token: B.token })).status, 401, 'old session no longer works');
  assert.equal((await api('/login', { method: 'POST', body: { username: 'budi', password: 'rahasia1' } })).status, 403, 'banned: no login');
  await api('/admin/reports/' + reps[0].id, { method: 'POST', token: M.token, body: { status: 'done' } });
  assert.equal((await api('/admin/reports', { token: M.token })).reports.length, 0, 'resolved');
  await api('/admin/users/' + idB + '/ban', { method: 'POST', token: M.token, body: { banned: false } });
  const B2 = await api('/login', { method: 'POST', body: { username: 'budi', password: 'rahasia1' } });
  assert(B2.token, 'unbanned: can log in again');
  console.log('moderation OK');

  // play a saved game with a third account, then delete it: history keeps the row under a neutral name
  const C = await signup('citra');
  const c = io(url, { transports: ['websocket'] }); c.on('state', (v) => (c.v = v));
  const auto = (s) => s.on('state', (v) => {
    if (v.state === 'playing' && v.turn === v.you && !s.busy) {
      s.busy = true;
      setTimeout(async () => { const last = v.lastPlay && !v.free ? R.evaluate(v.lastPlay.cards) : null; const pick = R.suggest(v.hand, last, v.mustInclude);
        await call(s, pick ? 'play' : 'pass', pick ? { cards: pick } : undefined); s.busy = false; }, 5);
    }
  });
  auto(a); auto(c);
  await call(c, 'hello', { auth: C.token });
  const t2 = await call(a, 'create', { mult: 250 });
  await call(c, 'join', { code: t2.room });
  a.emit('start');
  for (let i = 0; i < 600 && !(a.v && a.v.state === 'result'); i++) await sleep(100);
  assert.equal(a.v.state, 'result');
  await sleep(500);
  assert.equal((await api('/me', { method: 'DELETE', token: C.token, body: { confirm: 'salah' } })).status, 400, 'needs the username');
  r = await api('/me', { method: 'DELETE', token: C.token, body: { confirm: 'Citra' } }); assert(r.ok, r.error);
  await sleep(400);
  assert.equal((await api('/login', { method: 'POST', body: { username: 'citra', password: 'rahasia1' } })).status, 401, 'account gone');
  const h = await api('/history', { token: A.token });
  const det = await api('/match/' + h.matches[0].id, { token: A.token });
  assert(det.players.some((p) => /^Akun dihapus/.test(p.name)) && !det.players.some((p) => p.name === 'citra'), 'name replaced in the others\' history');
  assert(/^Akun dihapus/.test(a.v.seats.find((p) => p && p.name !== 'ana').name), 'live table shows the neutral name');
  // the table can still be played and saved after the account is gone
  a.emit('ready');
  console.log('delete account (app) OK');

  // web deletion page flow: login + DELETE /me
  const D = await signup('dodi');
  const tok = (await api('/login', { method: 'POST', body: { username: 'dodi', password: 'rahasia1' } })).token;
  assert((await api('/me', { method: 'DELETE', token: tok, body: { confirm: 'dodi' } })).ok);
  assert.equal((await api('/me', { token: D.token })).status, 401, 'all sessions removed');
  console.log('delete account (web) OK');

  console.log('safety ok');
  a.close(); b.close(); c.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
