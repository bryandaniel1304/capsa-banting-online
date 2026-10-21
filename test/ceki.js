// Optional "ceki" rule with fixed hands (CAPSA_TEST_HANDS): the player right before someone on their last card
// must play their highest single; otherwise, if the ceki player wins right away, they get the penalty.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const C = (s) => s.split(' ').map((t) => R.RANKS.indexOf(t.slice(0, -1)) * 4 + '♦♣♥♠'.indexOf(t.slice(-1)));
let port = 3990;

async function scenario(name, hands, rules, moves) {
  const PORT = port++;
  const url = 'http://localhost:' + PORT;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, PGLITE_DIR: path.join(os.tmpdir(), 'capsa-ceki-' + Date.now() + PORT), DATABASE_URL: '', CAPSA_TEST_HANDS: JSON.stringify(hands.map(C)) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    for (let i = 0; i < 400; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(200); } }
    const signup = async (u) => (await (await fetch(url + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'rahasia1', name: u }) })).json()).token;
    const a = io(url, { transports: ['websocket'] }), b = io(url, { transports: ['websocket'] });
    a.on('state', (v) => (a.v = v)); b.on('state', (v) => (b.v = v));
    await call(a, 'hello', { auth: await signup('ana') });
    await call(b, 'hello', { auth: await signup('budi') });
    const { room } = await call(a, 'create', { mult: 250, rules: { ...R.DEFAULT_RULES, ...rules } });
    await call(b, 'join', { code: room });
    a.emit('start');
    await sleep(300);
    const who = { A: a, B: b };
    for (const [p, act, cards] of moves) {
      await sleep(80);
      const s = who[p];
      if (act === 'duty?') { assert.equal(s.v.cekiDuty, cards, name + ': duty flag'); continue; }
      if (act === 'wait') { await sleep(cards); continue; }
      const res = act === 'play' ? await call(s, 'play', { cards: C(cards) }) : await call(s, 'pass');
      assert(!res || !res.error, name + ': ' + p + ' ' + act + ' ' + (cards || '') + ' -> ' + (res && res.error));
    }
    await sleep(300);
    assert.equal(a.v.state, 'result', name + ': game over');
    const rowA = a.v.result.rows.find((r) => r.name === 'ana');
    const fine = rowA.items.find((i) => /^Ceki/.test(i.label));
    a.close(); b.close();
    return fine ? fine.points : 0;
  } finally { srv.kill(); }
}

(async () => {
  const on = { cekiDuty: true };
  // ana: 3♦ 9♣ A♠   budi: 4♣ K♦  -> after 3♦ / 4♣ budi is ceki and ana acts right before him
  let f = await scenario('lower single', [['3♦ 9♣ A♠'][0], '4♣ K♦'], on,
    [['A', 'play', '3♦'], ['B', 'play', '4♣'], ['A', 'duty?', 1], ['A', 'play', '9♣'], ['B', 'play', 'K♦']]);
  assert.equal(f, 150, 'lower single then ceki wins -> +150'); console.log('lower single foul: +150 OK');

  f = await scenario('pass', ['3♦ 9♣ A♠', '4♣ K♦'], on,
    [['A', 'play', '3♦'], ['B', 'play', '4♣'], ['A', 'pass'], ['B', 'play', 'K♦']]);
  assert.equal(f, 150, 'passing although the highest card could block -> +150'); console.log('pass foul: +150 OK');

  f = await scenario('highest', ['3♦ 9♣ Q♠', '4♣ 2♦'], on,
    [['A', 'play', '3♦'], ['B', 'play', '4♣'], ['A', 'play', 'Q♠'], ['B', 'play', '2♦']]);
  assert.equal(f, 0, 'played the highest card -> no penalty'); console.log('highest played, ceki still wins: no penalty OK');

  f = await scenario('rule off', ['3♦ 9♣ A♠', '4♣ K♦'], {},
    [['A', 'play', '3♦'], ['B', 'play', '4♣'], ['A', 'duty?', null], ['A', 'play', '9♣'], ['B', 'play', 'K♦']]);
  assert.equal(f, 0, 'rule off -> no penalty'); console.log('rule off: no penalty OK');

  f = await scenario('pair block', ['3♦ 9♣ 9♠ 5♥', '4♣ K♦'], { ...on, winnerLeads: false },
    [['A', 'play', '3♦'], ['B', 'play', '4♣'], ['A', 'play', '5♥'], ['B', 'pass'], ['A', 'play', '9♣ 9♠']]);
  assert.equal(f, 0, 'foul cleared when the ceki player does not win right away'); console.log('foul cleared when ceki does not win next: no penalty OK');
  // a timed-out player is auto-played safely (highest card), so they are never fined
  f = await scenario('timeout', ['3♦ 9♣ A♠', '4♣ K♦'], { ...on, turnSec: 10 },
    [['A', 'play', '3♦'], ['B', 'play', '4♣'], ['A', 'wait', 11500], ['B', 'pass'], ['A', 'play', '9♣']]);
  assert.equal(f, 0, 'timeout auto-play follows the rule'); console.log('timeout auto-plays the highest card: no penalty OK');
  console.log('ceki ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });