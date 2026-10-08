// Rules checks + end-to-end simulation: 2 socket clients + 2 bots play full games.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const C = (s) => s.split(' ').map((t) => R.RANKS.indexOf(t.slice(0, -1)) * 4 + '♦♣♥♠'.indexOf(t.slice(-1)));
const ev = (s) => R.evaluate(C(s));

// ----- rules -----
assert.equal(ev('3♦').key, 0);
assert(R.beats(ev('7♠'), ev('7♦')), 'suit breaks ties');
assert(R.beats(ev('3♦'), ev('2♠')) === false);
assert(R.beats(ev('4♥ 4♠'), ev('4♦ 4♣')), 'pair with higher suit');
assert(!ev('4♥ 5♠'), 'not a pair');
assert(R.beats(ev('9♦ 9♠ 9♥'), ev('7♣ 7♦ 7♠')));
assert.equal(ev('3♣ 4♥ 5♦ 6♠ 7♦').name, 'Urutan');
assert(!ev('2♣ 3♥ 4♦ 5♠ 6♦'), 'no 2 in straights');
assert(!ev('J♣ Q♥ K♦ A♠ 2♦'), 'no 2 in straights');
assert(R.beats(ev('5♣ 6♥ 7♦ 8♠ 9♠'), ev('3♣ 4♥ 5♦ 6♠ 7♦')));
assert(R.beats(ev('3♣ 4♥ 5♦ 6♠ 7♠'), ev('3♣ 4♥ 5♦ 6♠ 7♥')), 'same straight: top suit');
assert.equal(ev('3♠ 5♠ 7♠ 8♠ A♠').name, 'Flush');
assert(R.beats(ev('3♠ 5♠ 7♠ 8♠ 9♠'), ev('3♥ 5♥ 7♥ 8♥ A♥')), 'flush: suit first');
assert(R.beats(ev('3♠ 5♠ 7♠ 8♠ 10♠'), ev('4♠ 5♠ 7♠ 8♠ 9♠')), 'flush same suit: top rank');
assert(R.beats(ev('3♠ 3♥ J♣ J♦ J♠'), ev('4♠ 4♥ 7♣ 7♦ 7♠')), 'full house by triple');
assert(R.beats(ev('3♠ J♥ J♣ J♦ J♠'), ev('4♠ 7♥ 7♣ 7♦ 7♠')), 'four by quad');
assert(R.beats(ev('3♠ J♥ J♣ J♦ J♠'), ev('4♠ 4♥ A♣ A♦ A♠')), 'four > full house');
assert(R.beats(ev('3♦ 4♦ 5♦ 6♦ 7♦'), ev('3♠ J♥ J♣ J♦ J♠')), 'straight flush > four');
assert.equal(ev('10♠ J♠ Q♠ K♠ A♠').name, 'Royal Flush');
assert(R.beats(ev('10♠ J♠ Q♠ K♠ A♠'), ev('10♦ J♦ Q♦ K♦ A♦')));
assert(R.beats(ev('10♦ J♦ Q♦ K♦ A♦'), ev('9♠ 10♠ J♠ Q♠ K♠')), 'royal > straight flush');
assert(!R.beats(ev('3♦ 4♦ 5♦ 6♦ 7♦'), ev('9♠')), 'count must match');
assert.deepEqual([1, 8, 9, 12, 13].map(R.penaltyPoints), [1, 8, 18, 24, 39]);
console.log('rules ok');

// ----- simulation -----
const PORT = 3999;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
const url = 'http://localhost:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));

function client(name) {
  const s = io(url, { transports: ['websocket'] });
  s.view = null; s.name = name; s.errors = [];
  s.on('state', (v) => {
    s.view = v;
    if (v.state === 'playing' && v.turn === v.you && !s.acting) {
      s.acting = true;
      setTimeout(async () => {
        const last = v.lastPlay ? R.evaluate(v.lastPlay.cards) : null;
        const pick = R.suggest(v.hand, last, v.mustInclude);
        const res = pick ? await call(s, 'play', { cards: pick }) : await call(s, 'pass');
        if (res && res.error) s.errors.push(res.error);
        s.acting = false;
      }, 5);
    }
    if (v.state === 'result' && !v.seats[v.you].ready) s.emit('ready');
  });
  return s;
}

(async () => {
  await sleep(800);
  const a = client('Ana'), b = client('Beni');
  await call(a, 'hello', { token: 'tokA' });
  await call(b, 'hello', { token: 'tokB' });
  const { room } = await call(a, 'create', { name: 'Ana', avatar: '🐼', stake: 40000 });
  assert(room, 'room created');
  const j = await call(b, 'join', { code: room, name: 'Beni', avatar: '🐯' });
  assert(!j.error, j.error);
  a.emit('addBot', { seat: 2 }); a.emit('addBot', { seat: 3 });
  await sleep(200);
  assert.equal(a.view.seats.filter(Boolean).length, 4);
  a.emit('start');
  const t0 = Date.now();
  let games = 0, lastNo = 0;
  while (games < 3 && Date.now() - t0 < 150000) {
    await sleep(100);
    const v = a.view;
    if (v.state === 'result' && v.gameNo !== lastNo) {
      lastNo = v.gameNo; games++;
      const total = v.seats.reduce((s, p) => s + p.chips, 0);
      const w = v.result.rows[0];
      console.log('game', v.gameNo, 'winner', w.name, '+' + w.delta, 'losers', v.result.rows.slice(1).map((r) => r.left + ' left').join(', '), 'chips total', total);
      assert.equal(v.result.rows.reduce((s, r) => s + r.delta, 0), 0, 'zero-sum payouts');
    }
  }
  assert.equal(games, 3, 'played 3 games');
  assert.deepEqual([...a.errors, ...b.errors], [], 'no rejected suggested moves');

  // reconnect keeps the seat
  const seatBefore = b.view.you;
  b.disconnect();
  const b2 = client('Beni2');
  const h = await call(b2, 'hello', { token: 'tokB' });
  assert.equal(h.room, room, 'resumed room');
  await sleep(100);
  assert.equal(b2.view.you, seatBefore, 'same seat after reconnect');
  console.log('simulation ok');
  a.close(); b2.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });