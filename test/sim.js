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
assert.deepEqual([1, 6, 7, 9, 10, 12, 13].map(R.penaltyPoints), [1, 6, 14, 18, 30, 36, 52]);
assert.equal(R.winPoints(ev('2♠'), C('2♠')), -20, 'closing with single 2');
assert.equal(R.winPoints(ev('2♥ 2♠'), C('2♥ 2♠')), -10, 'closing with pair of 2 stays -10');
assert.equal(R.winPoints(ev('A♠'), C('A♠')), -10);
assert.equal(R.bonusFor(ev('3♠ J♥ J♣ J♦ J♠')), -20, 'four of a kind');
assert.equal(R.bonusFor(ev('3♦ 4♦ 5♦ 6♦ 7♦')), -30, 'straight flush');
assert.equal(R.bonusFor(ev('10♠ J♠ Q♠ K♠ A♠')), -50, 'royal flush');
assert.equal(R.bonusFor(ev('3♠ 3♥ J♣ J♦ J♠')), 0, 'full house no bonus');
const dragon = C('3♦ 4♣ 5♥ 6♠ 7♦ 8♣ 9♥ 10♠ J♦ Q♣ K♥ A♠ 2♦');
assert.equal(R.evaluate(dragon).name, 'Dragon');
assert.equal(R.bonusFor(R.evaluate(dragon)), -70);
assert.deepEqual(R.suggest(dragon, null, null).length, 13, 'dragon suggested on lead');
assert(!R.evaluate(C('3♦ 4♣ 5♥ 6♠ 7♦ 8♣ 9♥ 10♠ J♦ Q♣ K♥ A♠ A♦')), 'not a dragon');
assert.equal(R.winPoints(R.evaluate(dragon), dragon) + R.bonusFor(R.evaluate(dragon)), -70, 'dragon win is -70 only');
assert.equal(R.twosLeft(C('2♦ 2♠ 5♥ 9♣')), 2);
const free = (x) => R.freeTurnAfter(ev(x), C(x));
assert(free('2♠') && free('2♦ 2♠') && free('2♦ 2♣ 2♠'), '2♠ plays give a free turn');
assert(!free('2♥') && !free('2♦ 2♥') && !free('2♠ 2♦ 2♣ 2♥ 3♦'), 'other plays do not');
console.log('rules ok');

// ----- simulation -----
const PORT = 3999;
const os = require('os');
const DATA = path.join(os.tmpdir(), 'capsa-test-' + Date.now());
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, PGLITE_DIR: DATA, DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
const url = 'http://localhost:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));
async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(url + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

function client(name) {
  const s = io(url, { transports: ['websocket'] });
  s.view = null; s.name = name; s.errors = [];
  s.on('state', (v) => {
    s.view = v;
    if (v.state === 'playing' && v.turn === v.you && !s.acting) {
      s.acting = true;
      setTimeout(async () => {
        const last = v.lastPlay && !v.free ? R.evaluate(v.lastPlay.cards) : null;
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
  for (let i = 0; i < 50; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(200); } }

  // ----- accounts -----
  const su = await api('/signup', { method: 'POST', body: { username: 'ana', password: 'rahasia1', name: 'Ana', avatar: '🐼' } });
  assert.equal(su.status, 200, JSON.stringify(su.data));
  assert.equal((await api('/signup', { method: 'POST', body: { username: 'ANA', password: 'rahasia1' } })).status, 409, 'duplicate username (case-insensitive)');
  assert.equal((await api('/signup', { method: 'POST', body: { username: 'x', password: 'rahasia1' } })).status, 400, 'short username');
  assert.equal((await api('/signup', { method: 'POST', body: { username: 'budi2', password: '123' } })).status, 400, 'short password');
  const sb = await api('/signup', { method: 'POST', body: { username: 'beni', password: 'rahasia2', name: 'Beni', avatar: '🐯' } });
  assert.equal((await api('/login', { method: 'POST', body: { username: 'ana', password: 'salah' } })).status, 401, 'wrong password');
  const la = await api('/login', { method: 'POST', body: { username: 'Ana', password: 'rahasia1' } });
  assert.equal(la.status, 200, 'login');
  const tokA = la.data.token, tokB = sb.data.token;
  assert.equal((await api('/me', { token: tokA })).data.user.username, 'ana');
  assert.equal((await api('/me')).status, 401, 'me requires auth');

  const anon = client('Anon');
  const ha = await call(anon, 'hello', { auth: 'not-a-token' });
  assert.equal(ha.user, null, 'bad token rejected');
  assert.equal((await call(anon, 'create', { mult: 250 })).error, 'Silakan masuk dulu', 'guests cannot create');
  anon.close();

  const a = client('Ana'), b = client('Beni');
  const got = { a: [], b: [] };
  for (const ev of ['dm', 'invite', 'presence', 'friends:request', 'voice:signal', 'voice:joined']) {
    a.on(ev, (d) => got.a.push([ev, d])); b.on(ev, (d) => got.b.push([ev, d]));
  }
  await call(a, 'hello', { auth: tokA });
  await call(b, 'hello', { auth: tokB });

  // ----- friends -----
  const idA = la.data.user.id, idB = sb.data.user.id;
  assert.equal((await api('/friends', { method: 'POST', token: tokA, body: { username: 'nobody' } })).status, 404, 'unknown username');
  assert.equal((await api('/friends', { method: 'POST', token: tokA, body: { username: 'ana' } })).status, 400, 'cannot add self');
  assert.equal((await api('/messages/' + idB, { method: 'POST', token: tokA, body: { body: 'hai' } })).status, 403, 'no DM before friendship');
  assert.equal((await api('/friends', { method: 'POST', token: tokA, body: { username: '@Beni' } })).data.status, 'pending');
  await sleep(150);
  assert(got.b.some(([e]) => e === 'friends:request'), 'Beni notified of request');
  const fb = (await api('/friends', { token: tokB })).data;
  assert.equal(fb.incoming.length, 1); assert.equal(fb.incoming[0].username, 'ana');
  assert.equal((await api('/friends/' + idA + '/accept', { method: 'POST', token: tokB })).status, 200);
  const fa = (await api('/friends', { token: tokA })).data;
  assert.equal(fa.friends.length, 1); assert.equal(fa.friends[0].username, 'beni');
  assert.equal(fa.friends[0].presence.online, true, 'Beni shows online');

  // ----- direct messages -----
  await api('/messages/' + idB, { method: 'POST', token: tokA, body: { body: 'Halo Beni <b>!</b>' } });
  await sleep(150);
  const dmB = got.b.find(([e]) => e === 'dm');
  assert(dmB && dmB[1].body === 'Halo Beni <b>!</b>', 'Beni receives DM live');
  assert.equal((await api('/friends', { token: tokB })).data.friends[0].unread, 1, 'unread count');
  const thread = (await api('/messages/' + idA, { token: tokB })).data.messages;
  assert.equal(thread.length, 1);
  assert.equal((await api('/friends', { token: tokB })).data.friends[0].unread, 0, 'read after opening');

  // ----- invite to a table -----
  const { room } = await call(a, 'create', { mult: 250 });
  assert(room, 'room created');
  await sleep(500);
  const presA = got.b.filter(([e, d]) => e === 'presence' && d.userId === idA).pop();
  assert(presA && presA[1].room === room, 'Beni sees Ana at her table');
  const inv = await call(a, 'invite', { friendId: idB });
  assert(inv.ok, JSON.stringify(inv));
  await sleep(150);
  const invB = got.b.find(([e]) => e === 'invite');
  assert(invB && invB[1].room === room && invB[1].from.username === 'ana', 'Beni receives invite');
  assert((await call(a, 'invite', { friendId: idB })).error, 'invite throttled');
  const j = await call(b, 'join', { code: invB[1].room });

  // ----- voice signaling relay -----
  const va = await call(a, 'voice:join');
  assert.deepEqual(va.peers, [], 'first in voice has no peers');
  const vb = await call(b, 'voice:join');
  assert.deepEqual(vb.peers, [va.seat], 'second sees the first');
  b.emit('voice:signal', { to: va.seat, data: { sdp: { type: 'offer', sdp: 'x' } } });
  await sleep(150);
  const sig = got.a.find(([e]) => e === 'voice:signal');
  assert(sig && sig[1].from === vb.seat && sig[1].data.sdp.type === 'offer', 'offer relayed');
  assert(a.view.seats[vb.seat].voice, 'voice flag in view');
  b.emit('voice:mute', { muted: true }); await sleep(100);
  assert(a.view.seats[vb.seat].muted, 'mute flag in view');
  a.emit('voice:leave'); b.emit('voice:leave'); await sleep(100);
  assert(!j.error, j.error);
  a.emit('addBot', { seat: 2 }); a.emit('addBot', { seat: 3 });
  await sleep(200);
  assert.equal(a.view.seats.filter(Boolean).length, 4);
  // the previous game's winner must open the next game; table history must stay card plays
  const firstTurn = {};
  let twoSpades = 0;
  a.on('state', (v) => {
    if (v.state === 'playing' && !(v.gameNo in firstTurn)) firstTurn[v.gameNo] = v.turn;
    if (v.state === 'playing') for (const h of v.history) assert(Array.isArray(h.cards), 'table history holds cards');
    // 2♠ (single / pair / triple of 2s with 2♠): the same player plays again immediately
    if (v.state === 'playing' && v.lastPlay && R.freeTurnAfter(R.evaluate(v.lastPlay.cards), v.lastPlay.cards)) {
      assert(v.free, 'free turn after 2♠');
      assert.equal(v.turn, v.lastPlay.seat, '2♠ player plays again');
      twoSpades++;
    }
  });
  a.emit('start');
  const t0 = Date.now();
  let games = 0, lastNo = 0;
  while (games < 3 && Date.now() - t0 < 150000) {
    await sleep(100);
    const v = a.view;
    if (v.state === 'result' && v.gameNo !== lastNo) {
      lastNo = v.gameNo; games++;
      const w = v.result.rows[0];
      console.log('game', v.gameNo, v.result.rows.map((r) => r.name + ' ' + r.points + ' [' + r.items.map((i) => i.label + ' ' + i.points).join(', ') + '] total ' + r.total).join(' | '));
      assert(w.winner && (w.items[0].points === -10 || w.items[0].points === -20), 'winner base points');
      for (const r of v.result.rows) {
        if (!r.winner) {
          assert.equal(r.items[0].points, R.penaltyPoints(r.left), 'loser penalty');
          const twos = R.twosLeft(r.cards);
          assert.equal(r.items.filter((i) => /kartu 2$/.test(i.label)).reduce((a, b) => a + b.points, 0), twos * 10, '+10 per 2 left');
        }
        assert.equal(r.points, r.items.reduce((a, b) => a + b.points, 0), 'row sum');
        assert.equal(v.seats[r.seat].score, r.total, 'cumulative score');
      }
    }
  }
  assert.equal(games, 3, 'played 3 games');
  console.log('2♠ free-turn states seen:', twoSpades);
  assert.equal(a.view.gameLog.length, 3, 'history recorded');
  const seatByName = (n) => a.view.seats.findIndex((p) => p && p.name === n);
  for (let gNo = 2; gNo <= 3; gNo++) {
    assert.equal(firstTurn[gNo], seatByName(a.view.gameLog[gNo - 2].winner), 'game ' + gNo + ' opened by previous winner');
  }

  // end the session: host proposes, the other human agrees -> pairwise settlement
  a.emit('proposeEnd');
  await sleep(200);
  assert(b.view.endVote && b.view.endVote.waiting.includes('Beni'), 'vote pending for Beni');
  b.emit('voteEnd', { agree: true });
  await sleep(300);
  assert.equal(a.view.state, 'final', 'session finished');
  const f = a.view.final;
  const sc = f.players.map((p) => p.score);
  assert.deepEqual(sc, [...sc].sort((x, y) => y - x), 'ranked highest points first');
  assert.equal(f.pays.length, 6, '4 players -> 6 pairs');
  for (const p of f.pays) assert.equal(p.amount, (f.players[p.fromRank - 1].score - f.players[p.toRank - 1].score) * 250);
  assert.equal(f.players.reduce((s, p) => s + p.net, 0), 0, 'settlement nets to zero');
  console.log('final', f.players.map((p) => p.name + ' ' + p.score + ' net ' + p.net).join(' | '));
  console.log('pays', f.pays.map((p) => p.fromRank + '->' + p.toRank + ' ' + p.amount).join(', '));
  // ----- saved history -----
  await sleep(500);
  const hist = (await api('/history', { token: tokA })).data;
  assert.equal(hist.matches.length, 1, 'one saved session');
  const m = hist.matches[0];
  assert.equal(m.games, 3); assert.equal(m.mult, 250); assert(m.ended_at, 'session ended');
  assert.equal(m.players.length, 4, 'all 4 players saved');
  for (const p of f.players) {
    const saved = m.players.find((x) => x.name === p.name);
    assert.equal(saved.total_points, p.score, 'saved total for ' + p.name);
    assert.equal(saved.net, p.net, 'saved net for ' + p.name);
  }
  assert.equal(hist.friends.length, 1, 'Beni is a friend'); assert.equal(hist.friends[0].name, 'Beni');
  const det = (await api('/match/' + m.id, { token: tokA })).data;
  assert.equal(det.games.length, 3);
  for (const g of det.games) assert.equal(g.rows.length, 4, 'rows per game');
  assert.equal((await api('/match/' + m.id)).status, 401, 'detail requires auth');
  const st = (await api('/me', { token: tokB })).data.stats;
  assert.equal(st.games, 3); assert.equal(st.matches, 1);
  assert.equal(st.points, f.players.find((p) => p.name === 'Beni').score, 'Beni stats points');
  console.log('saved', JSON.stringify(st));
  // removing a friend ends the friendship both ways
  await api('/friends/' + idA, { method: 'DELETE', token: tokB });
  assert.equal((await api('/friends', { token: tokA })).data.friends.length, 0, 'friend removed');
  assert.equal((await api('/messages/' + idB, { method: 'POST', token: tokA, body: { body: 'hai' } })).status, 403, 'no DM after removal');

  a.emit('newSession');
  await sleep(200);
  assert.equal(a.view.state, 'lobby'); assert.equal(a.view.gameLog.length, 0);
  assert(a.view.seats.every((p) => !p || p.score === 0), 'scores reset');
  assert.deepEqual([...a.errors, ...b.errors], [], 'no rejected suggested moves');

  // reconnect keeps the seat, after the player confirms going back to the table
  const seatBefore = b.view.you;
  b.disconnect();
  const b2 = client('Beni2');
  const h = await call(b2, 'hello', { auth: tokB });
  assert.equal(h.room, null, 'not put back at the table without asking');
  assert.equal(h.resume && h.resume.code, room, 'asked to resume the table');
  assert.equal((await call(b2, 'resume')).room, room, 'resumed room');
  await sleep(100);
  assert.equal(b2.view.you, seatBefore, 'same seat after reconnect');
  console.log('simulation ok');
  a.close(); b2.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });