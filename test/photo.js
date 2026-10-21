// Profile pictures from the gallery: upload, serve, validation, back to an emoji, live update at the table.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');

const PORT = 3995;
const url = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'capsa-photo-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, PGLITE_DIR: DATA, DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });

async function api(p, { method = 'GET', body, token } = {}) {
  const r = await fetch(url + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
// a fake JPEG: the server only checks the type, the size and the file signature
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
const dataUrl = (buf, mime = 'image/jpeg') => 'data:' + mime + ';base64,' + buf.toString('base64');

(async () => {
  for (let i = 0; i < 400; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(150); } }
  const A = (await api('/signup', { method: 'POST', body: { username: 'foto', password: 'rahasia1', name: 'Foto' } })).data;
  const s = io(url, { transports: ['websocket'] });
  s.on('state', (v) => (s.view = v));
  await call(s, 'hello', { auth: A.token });
  await call(s, 'create', { mult: 250 });
  await sleep(150);

  assert.equal((await api('/me/photo', { method: 'POST', body: { image: dataUrl(jpeg) } })).status, 401, 'needs login');
  assert.equal((await api('/me/photo', { method: 'POST', token: A.token, body: { image: 'data:image/gif;base64,R0lGOD' } })).status, 400, 'gif rejected');
  assert.equal((await api('/me/photo', { method: 'POST', token: A.token, body: { image: dataUrl(Buffer.alloc(400, 1)) } })).status, 400, 'not really a JPEG');
  const big = await api('/me/photo', { method: 'POST', token: A.token, body: { image: dataUrl(Buffer.concat([jpeg, Buffer.alloc(300 * 1024)])) } });
  assert(big.status === 413 && /besar/.test(big.data.error), 'too big: ' + JSON.stringify(big));
  const mid = await api('/me/photo', { method: 'POST', token: A.token, body: { image: dataUrl(Buffer.concat([jpeg, Buffer.alloc(260 * 1024)])) } });
  assert.equal(mid.status, 400, 'over 250 KB decoded');

  const up = await api('/me/photo', { method: 'POST', token: A.token, body: { image: dataUrl(jpeg) } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const av = up.data.user.avatar;
  assert(/^\/api\/photo\/\d+\?v=/.test(av), 'avatar becomes the photo URL: ' + av);
  const img = await fetch(url + av);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert(Buffer.from(await img.arrayBuffer()).equals(jpeg), 'same bytes back');
  await sleep(150);
  assert.equal(s.view.seats[s.view.you].avatar, av, 'table shows the new picture right away');
  assert.equal((await api('/me', { token: A.token })).data.user.avatar, av);

  const back = await api('/me', { method: 'PATCH', token: A.token, body: { avatar: '🐼' } });
  assert.equal(back.data.user.avatar, '🐼', 'emoji again');
  assert.equal((await fetch(url + av)).status, 404, 'photo removed');
  await sleep(150);
  assert.equal(s.view.seats[s.view.you].avatar, '🐼', 'table shows the emoji again');
  // a table created after changing the picture (same login) uses the new one
  const up2 = await api('/me/photo', { method: 'POST', token: A.token, body: { image: dataUrl(jpeg) } });
  await call(s, 'leave', { mode: 'quit' });
  await call(s, 'create', { mult: 500 });
  await sleep(150);
  assert.equal(s.view.seats[s.view.you].avatar, up2.data.user.avatar, 'new table uses the current picture');
  console.log('photo ok');
  s.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
