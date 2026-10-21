// Winning (last) play is shown and saved; table-specific notes / point items extend the rules,
// and the creator gives point items by hand on the result screen (saved to history, undoable).
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const C = (s) => s.split(' ').map((t) => R.RANKS.indexOf(t.slice(0, -1)) * 4 + '♦♣♥♠'.indexOf(t.slice(-1)));
const PORT = 3988, url = 'http://localhost:' + PORT;

// normalizeRules: extras are cleaned up and never touch the platform rules
const n = R.normalizeRules({ customNotes: [{ title: '<b>Kartu</b> akhir', text: 'x'.repeat(400) }, { title: '', text: '' }],
  customPoints: [{ name: 'Tutup As', points: -15 }, { name: 'nol', points: 0 }, { name: 'besar', points: 9999 }] });
assert.equal(n.customNotes.length, 1); assert.equal(n.customNotes[0].title, 'bKartu/b akhir'); assert.equal(n.customNotes[0].text.length, 300);
assert.deepEqual(n.customPoints, [{ name: 'Tutup As', points: -15 }, { name: 'besar', points: 500 }]);
assert.equal(n.winPoints, R.DEFAULT_RULES.winPoints);
assert(!R.sameRules(n, R.DEFAULT_RULES) && R.sameRules({}, R.DEFAULT_RULES));
console.log('normalize extras OK');

const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT, PGLITE_DIR: path.join(os.tmpdir(), 'capsa-extras-' + Date.now()), DATABASE_URL: '', CAPSA_TEST_HANDS: JSON.stringify(['3♦ 9♣ A♠', '4♣ K♦'].map(C)) },
  stdio: ['ignore', 'ignore', 'inherit'],
});
(async () => {
  for (let i = 0; i < 400; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(200); } }
  const signup = async (u) => (await (await fetch(url + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'rahasia1', name: u }) })).json()).token;
  const A = await signup('ana'), B = await signup('budi');
  const a = io(url, { transports: ['websocket'] }), b = io(url, { transports: ['websocket'] });
  a.on('state', (v) => (a.v = v)); b.on('state', (v) => (b.v = v));
  await call(a, 'hello', { auth: A }); await call(b, 'hello', { auth: B });
  const rules = { customNotes: [{ title: 'Kartu terakhir', text: 'Tutup pakai As dapat bonus' }], customPoints: [{ name: 'Tutup pakai As', points: -15 }, { name: 'Lupa bilang ceki', points: 25 }] };
  const { room } = await call(a, 'create', { mult: 250, rules, rulesName: 'Geng' });
  await call(b, 'join', { code: room });
  assert.deepEqual(b.v.rules.customPoints, rules.customPoints, 'everyone sees the extra rules');
  assert.deepEqual(b.v.rules.customNotes, rules.customNotes);
  a.emit('start'); await sleep(300);
  for (const [s, cards] of [[a, '3♦'], [b, '4♣'], [a, '9♣'], [b, 'K♦']]) {
    const res = await call(s, 'play', { cards: C(cards) }); assert(!res || !res.error, cards + ' ' + (res && res.error)); await sleep(60);
  }
  await sleep(200);
  assert.equal(a.v.state, 'result');
  assert.deepEqual(a.v.result.final.cards, C('K♦'), 'winning play on the result screen');
  assert.deepEqual(a.v.gameLog[0].finalCards, C('K♦'), 'winning play in the table history');
  const seatA = a.v.you, seatB = b.v.you;
  const rowOf = (seat) => a.v.result.rows.find((r) => r.seat === seat);
  const before = rowOf(seatA).points;

  let res = await call(b, 'adjust', { op: 'add', seat: seatA, idx: 1 });
  assert(res.error, 'only the creator / host gives extra points');
  res = await call(a, 'adjust', { op: 'add', seat: seatA, idx: 1 }); assert(res.ok, res.error);
  res = await call(a, 'adjust', { op: 'add', seat: seatB, idx: 0 }); assert(res.ok, res.error);
  await sleep(100);
  assert.equal(rowOf(seatA).points, before + 25); assert.equal(rowOf(seatA).total, before + 25);
  assert.equal(a.v.seats[seatA].score, before + 25);
  const bRow = rowOf(seatB);
  assert(bRow.items.some((i) => i.manual && i.label === 'Tutup pakai As' && i.points === -15));
  assert(/Lupa bilang ceki 25/.test(a.v.gameLog[0].rows.find((r) => r.seat === seatA).detail), 'history detail updated');
  // undo
  const item = rowOf(seatA).items.find((i) => i.manual);
  res = await call(a, 'adjust', { op: 'remove', seat: seatA, id: item.id }); assert(res.ok, res.error);
  await sleep(100);
  assert.equal(rowOf(seatA).points, before, 'undo restores points');
  console.log('manual extra points + undo OK');

  await sleep(500);
  const hist = await (await fetch(url + '/api/history', { headers: { Authorization: 'Bearer ' + A } })).json();
  const d = await (await fetch(url + '/api/match/' + hist.matches[0].id, { headers: { Authorization: 'Bearer ' + A } })).json();
  assert.deepEqual(d.games[0].final_cards, C('K♦'), 'winning play saved to the account history');
  const gb = d.games[0].rows.find((r) => r.name === 'budi');
  assert.equal(gb.points, bRow.points); assert(/Tutup pakai As -15/.test(gb.detail));
  assert.equal(d.games[0].rows.find((r) => r.name === 'ana').points, before);
  assert.equal(d.players.find((p) => p.name === 'budi').total_points, bRow.total, 'session total saved');
  console.log('saved history OK');

  // presets keep the extras
  const p = await (await fetch(url + '/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A }, body: JSON.stringify({ name: 'Geng', rules }) })).json();
  assert.deepEqual(p.preset.rules.customPoints, rules.customPoints, 'preset keeps point items');
  console.log('extras ok');
  a.close(); b.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
