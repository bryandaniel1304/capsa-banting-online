// Restart test: a live table must survive a server restart and continue in the same round.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const PORT = 3998;
const url = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'capsa-restart-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
let srv = null;

async function startServer() {
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, PGLITE_DIR: DATA, DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  srv.stdout.on('data', (d) => { const t = String(d); if (/restored table/.test(t)) process.stdout.write('  server: ' + t); });
  for (let i = 0; i < 100; i++) { try { await fetch(url + '/healthz'); return; } catch { await sleep(150); } }
  throw new Error('server did not start');
}
async function api(p, body) {
  const r = await fetch(url + '/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function client(auth, autoplay) {
  const s = io(url, { transports: ['websocket'], reconnection: false });
  s.view = null;
  s.act = (v) => {
    if (!s.autoplay || v.state !== 'playing' || v.turn !== v.you || s.busy) return;
    s.busy = true;
    setTimeout(async () => {
      const last = v.lastPlay && !v.free ? R.evaluate(v.lastPlay.cards) : null;
      const pick = R.suggest(v.hand, last, v.mustInclude);
      if (pick) await call(s, 'play', { cards: pick }); else await call(s, 'pass');
      s.busy = false;
    }, 5);
  };
  s.on('state', (v) => { s.view = v; s.act(v); });
  s.autoplay = autoplay;
  s.hello = () => call(s, 'hello', { auth });
  return s;
}

(async () => {
  await startServer();
  const A = await api('/signup', { username: 'rina', password: 'rahasia1', name: 'Rina' });
  const B = await api('/signup', { username: 'tono', password: 'rahasia2', name: 'Tono' });
  let a = client(A.token, true), b = client(B.token, true);
  await a.hello(); await b.hello();
  const { room } = await call(a, 'create', { mult: 500 });
  await call(b, 'join', { code: room });
  a.emit('addBot', { seat: 2 }); a.emit('addBot', { seat: 3 });
  await sleep(300);
  a.emit('start');
  // play until a few cards are gone and it is a human's turn, then freeze the humans so the snapshot is stable
  for (let i = 0; i < 400; i++) {
    await sleep(100);
    const v = a.view;
    if (v.state === 'playing' && v.hand.length <= 11 && (v.turn === v.you || v.turn === b.view.you)) break;
  }
  a.autoplay = false; b.autoplay = false;
  // wait until bots are done and the table is quiet (a human's turn, unchanged for 1.5s), so the save has landed
  for (let i = 0, last = '', since = Date.now(); i < 300; i++) {
    await sleep(100);
    const k = JSON.stringify([a.view.turn, a.view.lastPlay, a.view.seats.map((p) => p && p.count)]);
    if (k !== last) { last = k; since = Date.now(); continue; }
    if ((a.view.turn === a.view.you || a.view.turn === b.view.you) && Date.now() - since > 1500) break;
  }
  const before = { a: a.view, b: b.view };
  assert.equal(before.a.state, 'playing', 'game in progress before restart');
  console.log('before restart: game', before.a.gameNo, 'turn seat', before.a.turn, 'my cards', before.a.hand.length, 'table', before.a.lastPlay ? before.a.lastPlay.name : '-');

  // hard kill (no graceful flush) and start a fresh server on the same database
  srv.kill('SIGKILL');
  a.close(); b.close();
  await sleep(500);
  await startServer();

  a = client(A.token, false); b = client(B.token, false);
  const ha = await a.hello();
  assert.equal(ha.resume && ha.resume.code, room, 'player is offered the same table');
  assert.equal((await call(a, 'resume')).room, room, 'player is put back at the same table');
  await sleep(200);
  const hb = await b.hello();
  assert.equal(hb.resume && hb.resume.code, room, 'second player is offered the same table');
  assert.equal((await call(b, 'resume')).room, room, 'second player back at the same table');
  await sleep(300);
  const after = a.view;
  assert.equal(after.state, 'playing', 'still playing');
  assert.equal(after.gameNo, before.a.gameNo, 'same game');
  assert.deepEqual(after.hand, before.a.hand, 'same cards in hand');
  assert.deepEqual(b.view.hand, before.b.hand, 'same cards for the other player');
  if (after.turn !== before.a.turn) console.log('DEBUG before', JSON.stringify({ turn: before.a.turn, you: before.a.you, bYou: before.b.you, lastPlay: before.a.lastPlay, seats: before.a.seats.map((p) => p && [p.name, p.count, p.passed]), rem: before.a.remaining }), 'after', JSON.stringify({ turn: after.turn, lastPlay: after.lastPlay, seats: after.seats.map((p) => p && [p.name, p.count, p.passed]), rem: after.remaining }));
  assert.equal(after.turn, before.a.turn, 'same turn');
  assert.deepEqual(after.lastPlay, before.a.lastPlay, 'same cards on the table');
  assert.equal(after.mult, 500, 'same multiplier');
  assert(after.remaining > 20000, 'reconnect grace on the current turn');
  console.log('after restart: same table, same game, same hand, same turn OK');

  // the game can be finished normally and is saved to the account
  a.autoplay = true; b.autoplay = true;
  a.act(a.view); b.act(b.view);
  for (let i = 0; i < 1500; i++) { await sleep(100); if (a.view.state === 'result') break; }
  assert.equal(a.view.state, 'result', 'game finished after restart');
  await sleep(800);
  const hist = await (await fetch(url + '/api/history', { headers: { Authorization: 'Bearer ' + A.token } })).json();
  assert.equal(hist.matches[0].games, 1, 'finished game saved to history');
  console.log('game finished after restart and saved OK');
  a.close(); b.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); if (srv) srv.kill(); process.exit(1); });