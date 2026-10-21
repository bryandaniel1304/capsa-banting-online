// Invite notifications: sent only when none of the player's devices shows the game; offline friends can be
// invited by notification; dead subscriptions are dropped. Web Push and FCM go to local mock servers.
const assert = require('assert');
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3984, url = 'http://localhost:' + PORT, WEB = 4443, FCM = 4444;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capsa-push-'));

// --- mock push services ---
const hits = { web: [], fcm: [], token: 0 };
let tls = null;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem')], { stdio: 'ignore' });
  tls = { key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) };
} catch { console.log('openssl not found: web push part skipped'); }
const webSrv = tls && https.createServer(tls, (req, res) => {
  let n = 0; req.on('data', (c) => (n += c.length));
  req.on('end', () => {
    hits.web.push({ path: req.url, ttl: req.headers.ttl, auth: req.headers.authorization || '', enc: req.headers['content-encoding'], bytes: n });
    res.writeHead(req.url === '/gone' ? 410 : 201).end();
  });
}).listen(WEB);
const fcmSrv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/token') { hits.token++; return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 })); }
    const msg = JSON.parse(body).message;
    hits.fcm.push({ auth: req.headers.authorization, msg });
    if (msg.token === 'dead-token-xxxxxxxxxxxxxxxx') return res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"name":"projects/p/messages/1"}');
  });
}).listen(FCM);

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, PGLITE_DIR: path.join(tmp, 'db'), DATABASE_URL: '', NODE_TLS_REJECT_UNAUTHORIZED: '0',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'capsa-test', client_email: 'push@capsa-test.iam.gserviceaccount.com', private_key: privateKey }),
    FCM_API_BASE: 'http://localhost:' + FCM, GOOGLE_OAUTH_URL: 'http://localhost:' + FCM + '/token' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
async function api(p, { method = 'GET', body, token } = {}) {
  const r = await fetch(url + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
const signup = (u) => api('/signup', { method: 'POST', body: { username: u, password: 'rahasia1', name: u } });
const fakeSub = (p) => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: 'https://localhost:' + WEB + p, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
};

(async () => {
  for (let i = 0; i < 400; i++) { try { await fetch(url + "/healthz"); break; } catch { await sleep(200); } }
  const cfg = await api('/push/config');
  assert(cfg.web && cfg.vapidPublicKey && cfg.android, 'web + android push configured: ' + JSON.stringify(cfg));

  const B = await signup('budi');
  const hosts = [];
  for (const u of ['ana', 'citra', 'eko']) {
    const H = await signup(u);
    await api('/friends', { method: 'POST', token: H.token, body: { username: 'budi' } });
    await api('/friends/' + H.user.id + '/accept', { method: 'POST', token: B.token });
    const s = io(url, { transports: ['websocket'] });
    await call(s, 'hello', { auth: H.token });
    const { room } = await call(s, 'create', { mult: 500 });
    hosts.push({ H, s, room });
  }
  const X = await signup('xeno'); // not a friend
  const xs = io(url, { transports: ['websocket'] }); await call(xs, 'hello', { auth: X.token }); await call(xs, 'create', { mult: 250 });

  // budi's devices: browser (web push), a dead browser subscription, the Android app (FCM) and a stale app token
  assert((await api('/push/subscribe', { method: 'POST', token: B.token, body: { kind: 'web', subscription: { endpoint: 'http://evil', keys: {} } } })).status === 400);
  if (tls) {
    assert((await api('/push/subscribe', { method: 'POST', token: B.token, body: { kind: 'web', subscription: fakeSub('/sub1') } })).ok);
    assert((await api('/push/subscribe', { method: 'POST', token: B.token, body: { kind: 'web', subscription: fakeSub('/gone') } })).ok);
  }
  assert((await api('/push/subscribe', { method: 'POST', token: B.token, body: { kind: 'fcm', token: 'app-token-xxxxxxxxxxxxxxxxxxxxxxxx' } })).ok);
  assert((await api('/push/subscribe', { method: 'POST', token: B.token, body: { kind: 'fcm', token: 'dead-token-xxxxxxxxxxxxxxxx' } })).ok);

  // 1) budi has the game on screen: in-game invite only, no notification
  const b = io(url, { transports: ['websocket'] });
  const invites = []; b.on('invite', (v) => invites.push(v));
  await call(b, 'hello', { auth: B.token });
  let r = await call(hosts[0].s, 'invite', { userId: B.user.id });
  assert(r.ok, r.error); await sleep(400);
  assert.equal(invites.length, 1); assert.equal(hits.web.length + hits.fcm.length, 0, 'no push while the game is visible');
  console.log('visible: in-game invite only OK');

  // 2) app in the background (still connected): in-game invite + notification on every device
  b.emit('visible', { visible: false }); await sleep(150);
  r = await call(hosts[1].s, 'invite', { userId: B.user.id });
  assert(r.ok, r.error); await sleep(1200);
  assert.equal(invites.length, 2);
  const f = hits.fcm.find((h) => h.msg.token.startsWith('app-token'));
  assert(f && f.auth === 'Bearer ya29.test', 'FCM call with OAuth token');
  assert.equal(f.msg.data.room, hosts[1].room); assert.equal(f.msg.android.notification.channel_id, 'invites');
  assert(/citra/.test(f.msg.notification.title) && /x500/.test(f.msg.notification.body), f.msg.notification.body);
  if (tls) {
    const w = hits.web.find((h) => h.path === '/sub1');
    assert(w && /^vapid t=/.test(w.auth) && w.enc === 'aes128gcm' && +w.ttl > 0 && w.bytes > 50, 'web push request ' + JSON.stringify(w));
    assert(hits.web.some((h) => h.path === '/gone'));
  }
  console.log('background: notification to browser + app OK');

  // 3) budi offline: friends can still invite (notification only); strangers can't; dead subscriptions are gone
  b.close(); await sleep(400);
  const before = { web: hits.web.length, fcm: hits.fcm.length };
  r = await call(hosts[2].s, 'invite', { userId: B.user.id });
  assert(r.ok && r.pushed, 'offline friend invited by notification: ' + JSON.stringify(r)); await sleep(1200);
  const newWeb = hits.web.slice(before.web), newFcm = hits.fcm.slice(before.fcm);
  assert(newFcm.length === 1 && newFcm[0].msg.token.startsWith('app-token'), 'dead FCM token was removed');
  if (tls) assert(newWeb.length === 1 && newWeb[0].path === '/sub1', 'expired web subscription (410) was removed');
  assert.equal(hits.token, 1, 'OAuth token cached');
  r = await call(xs, 'invite', { userId: B.user.id });
  assert(r.error, 'stranger cannot invite an offline player');
  console.log('offline: friends invite by notification, cleanup OK');

  // 4) unsubscribe (log out on that device): no more notifications there
  await api('/push/unsubscribe', { method: 'POST', token: B.token, body: { token: 'app-token-xxxxxxxxxxxxxxxxxxxxxxxx' } });
  if (tls) await api('/push/unsubscribe', { method: 'POST', token: B.token, body: { endpoint: 'https://localhost:' + WEB + '/sub1' } });
  await sleep(8200); // invite throttle per pair
  r = await call(hosts[0].s, 'invite', { userId: B.user.id });
  assert(r.error, 'nobody to notify -> offline error');
  console.log('unsubscribe OK');

  console.log('push ok');
  hosts.forEach((h) => h.s.close()); xs.close(); srv.kill(); fcmSrv.close(); if (webSrv) webSrv.close(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
