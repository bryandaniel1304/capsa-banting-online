// Auto-pass: a player with fewer cards than the play on the table is skipped by the system.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const C = (s) => s.split(' ').map((t) => R.RANKS.indexOf(t.slice(0, -1)) * 4 + '♦♣♥♠'.indexOf(t.slice(-1)));
// A leads a straight flush with 3♦; B answers with two straight flushes, then is left with 2 cards
const HANDS = [
  C('3♦ 4♦ 5♦ 6♦ 7♦ A♥ 5♣ 5♥ 5♠ 6♣ 6♥ J♦ J♣'),
  C('8♠ 9♠ 10♠ J♠ Q♠ 8♥ 9♥ 10♥ J♥ Q♥ K♣ A♣ 2♣'),
];
const PORT = 3994;
const url = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'capsa-autopass-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, PGLITE_DIR: DATA, DATABASE_URL: '', CAPSA_TEST_HANDS: JSON.stringify(HANDS) }, stdio: ['ignore', 'pipe', 'inherit'],
});
const signup = async (u) => (await fetch(url + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'rahasia1', name: u }) })).json();
function client(tok) {
  const s = io(url, { transports: ['websocket'] });
  s.view = null; s.fx = [];
  s.on('state', (v) => (s.view = v));
  s.on('fx', (f) => s.fx.push(f));
  s.hello = () => call(s, 'hello', { auth: tok });
  return s;
}
const play = async (s, cards) => { const r = await call(s, 'play', { cards: C(cards) }); assert(!r.error, cards + ': ' + r.error); await sleep(120); };
const pass = async (s) => { const r = await call(s, 'pass'); assert(!r.error, 'pass: ' + r.error); await sleep(120); };

(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(150); } }
  const A = await signup('ana'), B = await signup('budi');
  const a = client(A.token), b = client(B.token);
  await a.hello(); await b.hello();
  const { room } = await call(a, 'create', { mult: 250 });
  await call(b, 'join', { code: room });
  await sleep(150);
  a.emit('start');
  await sleep(300);
  const sa = a.view.you, sb = b.view.you;
  assert.equal(a.view.turn, sa, 'A holds 3♦ and leads');
  await play(a, '3♦ 4♦ 5♦ 6♦ 7♦');
  await play(b, '8♠ 9♠ 10♠ J♠ Q♠');
  await pass(a);
  await play(b, '8♥ 9♥ 10♥ J♥ Q♥');
  await pass(a);
  await play(b, 'K♣');
  await play(a, 'A♥');
  await pass(b); // B keeps A♣ 2♣
  assert.equal(a.view.turn, sa, 'A leads again');
  a.fx.length = 0;
  await play(a, '5♣ 5♥ 5♠ 6♣ 6♥'); // B has only 2 cards: can't answer a 5-card hand
  await sleep(150);
  const auto = a.fx.find((f) => f.type === 'pass' && f.seat === sb);
  assert(auto && auto.auto === 'cards' && auto.need === 5, 'B is skipped by the system: ' + JSON.stringify(a.fx));
  assert.equal(a.view.turn, sa, 'everyone else passed: A leads a new round');
  assert.equal(a.view.lastPlay, null, 'table cleared for the new round');
  assert.equal(a.view.seats[sb].count, 2, 'B still has 2 cards');
  // a pair against 2 cards is answerable: B gets the turn
  await play(a, 'J♦ J♣');
  assert(a.view.state === 'result' || a.view.turn === sb, 'B (2 cards) may answer a pair');
  console.log('autopass ok');
  a.close(); b.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
