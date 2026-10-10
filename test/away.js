// Away players: a player who comes back and chooses not to continue sits out (hand frozen, still counted),
// the others continue without them, and offline players don't block ending the session.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const PORT = 3997;
const url = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'capsa-away-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, PGLITE_DIR: DATA, DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });

async function signup(username, name) {
  const r = await fetch(url + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'rahasia1', name }) });
  return r.json();
}
function client(auth) {
  const s = io(url, { transports: ['websocket'], reconnection: false });
  s.view = null; s.autoReady = true;
  s.on('state', (v) => {
    s.view = v;
    if (v.state === 'playing' && v.turn === v.you && !s.busy) {
      s.busy = true;
      setTimeout(async () => {
        const last = v.lastPlay && !v.free ? R.evaluate(v.lastPlay.cards) : null;
        const pick = R.suggest(v.hand, last, v.mustInclude);
        if (pick) await call(s, 'play', { cards: pick }); else await call(s, 'pass');
        s.busy = false;
      }, 5);
    }
    if (v.state === 'result' && s.autoReady && !v.seats[v.you].ready) s.emit('ready');
  });
  s.hello = () => call(s, 'hello', { auth });
  return s;
}
async function until(fn, ms = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(50); }
  throw new Error('timed out');
}

(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(150); } }
  const X = await signup('xena', 'Xena'), Y = await signup('yuda', 'Yuda'), Z = await signup('zaki', 'Zaki');
  const x = client(X.token), y = client(Y.token);
  let z = client(Z.token);
  await x.hello(); await y.hello(); await z.hello();
  const { room } = await call(x, 'create', { mult: 1000 });
  await call(y, 'join', { code: room });
  await call(z, 'join', { code: room });
  x.emit('addBot', { seat: 3 });
  await sleep(200);
  const zSeat = z.view.you, ySeat = y.view.you;
  x.emit('start');
  await until(() => x.view.state === 'playing' && x.view.seats.reduce((a, p) => a + (p ? p.count : 0), 0) <= 48);

  // Zaki drops out and comes back: he is asked first instead of being put straight back at the table
  z.close();
  await sleep(300);
  assert(x.view.seats[zSeat].away && !x.view.seats[zSeat].connected, 'Zaki shows offline');
  z = client(Z.token);
  const h = await z.hello();
  assert.equal(h.room, null, 'not put back without asking');
  assert.equal(h.resume.code, room, 'offered the table');
  assert.equal(h.resume.state, 'playing');
  await call(z, 'abandon');
  await sleep(200);
  assert(x.view.seats[zSeat].sitOut, 'Zaki sits out');
  const frozen = x.view.seats[zSeat].count;
  assert(!(await z.hello()).resume, 'no resume offer after choosing not to continue');

  // the game goes on without him: never his turn, his hand stays as it is
  let hisTurn = false;
  x.on('state', (v) => { if (v.state === 'playing' && v.gameNo === 1 && v.turn === zSeat) hisTurn = true; });
  await until(() => x.view.state === 'result' || (x.view.state === 'playing' && x.view.gameNo === 2));
  assert(!hisTurn, 'sat-out player is skipped');
  const g1 = x.view.gameLog[0];
  const zRow = g1.rows.find((r) => r.seat === zSeat);
  assert(zRow.detail.startsWith('Sisa ' + frozen + ' kartu'), 'his cards left still count: ' + zRow.detail);
  const zScore = zRow.points;
  console.log('game 1:', g1.rows.map((r) => r.name + ' ' + r.points).join(' | '));

  // everyone still here confirmed: Zaki leaves the table and game 2 starts with the rest
  x.autoReady = false; y.autoReady = false;
  await until(() => x.view.state === 'playing' && x.view.gameNo === 2);
  assert.equal(x.view.seats[zSeat], null, 'Zaki removed from the table');
  assert.equal(x.view.seats.filter(Boolean).length, 3, 'continues with the rest');
  console.log('game 2 started without Zaki');

  // after game 2 the host proposes to end; Yuda goes offline instead of voting -> he doesn't block it
  await until(() => x.view.state === 'result' && x.view.gameNo === 2);
  x.emit('proposeEnd');
  await sleep(200);
  assert.deepEqual(x.view.endVote.waiting, ['Yuda'], 'vote waits for the online player');
  y.close();
  await sleep(400);
  assert.equal(x.view.state, 'final', 'offline player does not block ending');
  const f = x.view.final;
  assert.equal(f.players.length, 4, 'settlement includes the player who left');
  const zf = f.players.find((p) => p.name === 'Zaki');
  assert(zf.gone && zf.score === zScore, 'Zaki keeps his points from game 1');
  assert.equal(f.players.reduce((s, p) => s + p.net, 0), 0, 'settlement nets to zero');
  console.log('final', f.players.map((p) => p.name + ' ' + p.score + ' net ' + p.net).join(' | '));
  await sleep(600);
  const hist = await (await fetch(url + '/api/history', { headers: { Authorization: 'Bearer ' + Z.token } })).json();
  assert.equal(hist.matches[0].players.find((p) => p.name === 'Zaki').net, zf.net, 'Zaki net saved to his history');
  console.log('away ok');
  x.close(); z.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
