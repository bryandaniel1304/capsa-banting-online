// Table rules, rule presets and public profiles.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const PORT = 3997;
const url = 'http://localhost:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, PGLITE_DIR: path.join(os.tmpdir(), 'capsa-rules-' + Date.now()), DATABASE_URL: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
async function api(p, { method = 'GET', body, token } = {}) {
  const r = await fetch(url + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}
function client(rc) {
  const s = io(url, { transports: ['websocket'] });
  s.on('state', (v) => {
    s.view = v;
    if (v.state !== 'playing' || v.turn !== v.you || s.busy) return;
    s.busy = true;
    setTimeout(async () => {
      const g = R.make(v.rules);
      const last = v.lastPlay && !v.free ? g.evaluate(v.lastPlay.cards) : null;
      const pick = g.suggest(v.hand, last, v.mustInclude);
      if (pick) await call(s, 'play', { cards: pick }); else await call(s, 'pass');
      s.busy = false;
    }, 5);
  });
  return s;
}

(async () => {
  for (let i = 0; i < 60; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(200); } }
  const A = (await api('/signup', { method: 'POST', body: { username: 'dina', password: 'rahasia1', name: 'Dina' } })).data;
  const B = (await api('/signup', { method: 'POST', body: { username: 'eko', password: 'rahasia2', name: 'Eko' } })).data;

  // ----- presets -----
  const custom = { turnSec: 30, suitOrder: 'CDHS', passLock: false, winPoints: -15, tiers: [{ upTo: 8, x: 1 }, { upTo: 12, x: 2 }, { upTo: 13, x: 3 }], flushTwoHigh: true, twoLeftPoints: 0 };
  assert.equal((await api('/presets', { method: 'POST', token: A.token, body: { name: '', rules: custom } })).status, 400, 'preset needs a name');
  assert.equal((await api('/presets', { method: 'POST', token: A.token, body: { name: 'Default', rules: custom } })).status, 400, 'reserved name');
  const saved = (await api('/presets', { method: 'POST', token: A.token, body: { name: 'Geng Kantor', rules: { ...custom, turnSec: 999 } } })).data.preset;
  assert.equal(saved.rules.turnSec, 90, 'rules are clamped');
  await api('/presets', { method: 'POST', token: A.token, body: { name: 'Geng Kantor', rules: custom } }); // overwrite same name
  let list = (await api('/presets', { token: A.token })).data;
  assert.equal(list.presets.length, 1); assert.equal(list.presets[0].rules.turnSec, 30); assert.equal(list.defaults.turnSec, 20);
  assert.equal((await api('/presets', { token: B.token })).data.presets.length, 0, 'presets are per account');

  // ----- profiles -----
  let prof = (await api('/users/' + B.user.id, { token: A.token })).data;
  assert.equal(prof.user.username, 'eko'); assert.equal(prof.relation, 'none'); assert(prof.stats);
  assert.equal(prof.user.pass_hash, undefined, 'no secrets in profile');
  await api('/friends', { method: 'POST', token: A.token, body: { username: 'eko' } });
  assert.equal((await api('/users/' + B.user.id, { token: A.token })).data.relation, 'outgoing');
  assert.equal((await api('/users/' + A.user.id, { token: B.token })).data.relation, 'incoming');
  assert.equal((await api('/users/' + A.user.id, { token: A.token })).data.relation, 'self');
  console.log('presets + profiles ok');

  // ----- table rules -----
  const a = client(), b = client();
  await call(a, 'hello', { auth: A.token }); await call(b, 'hello', { auth: B.token });
  const { room } = await call(a, 'create', { mult: 250, rules: list.presets[0].rules });
  await call(b, 'join', { code: room });
  await sleep(200);
  assert.equal(a.view.rules.suitOrder, 'CDHS'); assert.equal(a.view.turnMs, 30000);
  assert.equal(a.view.canEditRules, true); assert.equal(b.view.canEditRules, false, 'joiner cannot edit');
  assert.equal(b.view.creator, a.view.you);
  assert((await call(b, 'setRules', { rules: R.DEFAULT_RULES })).error, 'joiner is refused');
  assert((await call(a, 'setRules', { rules: { ...custom, winPoints: -12 } })).ok, 'creator can change before playing');
  await sleep(100);
  assert.equal(b.view.rules.winPoints, -12, 'everyone sees the new rules');
  a.emit('addBot', { seat: 2 }); a.emit('addBot', { seat: 3 });
  await sleep(200);
  a.emit('start');
  await sleep(300);
  assert((await call(a, 'setRules', { rules: R.DEFAULT_RULES })).error, 'locked once the game started');
  for (let i = 0; i < 1500 && a.view.state !== 'result'; i++) await sleep(100);
  assert.equal(a.view.state, 'result');
  const g = R.make(a.view.rules);
  for (const row of a.view.result.rows) {
    if (row.winner) assert(row.items[0].points === -12 || row.items[0].points === -20 || row.items.length === 1, 'custom win points');
    else assert.equal(row.items[0].points, g.penaltyPoints(row.left), 'custom remaining-card tiers');
    assert(!row.items.some((i) => /kartu 2$/.test(i.label)), 'two-left points disabled');
  }
  console.log('table rules ok', a.view.result.rows.map((r) => r.name + ' ' + r.points).join(' | '));
  a.close(); b.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });