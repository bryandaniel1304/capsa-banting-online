// Leaving a table: "keluar sementara" (turns skipped until back, sits out new games) vs "keluar dari permainan"
// (others may end the session mid-game), plus inviting online players who aren't friends.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');
const R = require('../shared/rules');

const PORT = 3996;
const url = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'capsa-leave-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, d) => new Promise((res) => s.emit(ev, d, res));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, PGLITE_DIR: DATA, DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });

async function signup(username, name) {
  const r = await fetch(url + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'rahasia1', name }) });
  return r.json();
}
function client(auth) {
  const s = io(url, { transports: ['websocket'], reconnection: false });
  s.view = null; s.autoReady = true; s.got = [];
  s.on('invite', (d) => s.got.push(d));
  s.on('state', (v) => {
    s.view = v;
    if (v.state === 'playing' && v.turn === v.you && !s.busy) {
      s.busy = true;
      setTimeout(async () => {
        const rc = R.make(v.rules);
        const last = v.lastPlay && !v.free ? rc.evaluate(v.lastPlay.cards) : null;
        const pick = rc.suggest(v.hand, last, v.mustInclude);
        if (pick) await call(s, 'play', { cards: pick }); else await call(s, 'pass');
        s.busy = false;
      }, 5);
    }
    if (v.state === 'result' && s.autoReady && !v.seats[v.you].ready) s.emit('ready');
  });
  s.hello = () => call(s, 'hello', { auth });
  return s;
}
async function until(fn, ms = 120000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(30); }
  throw new Error('timed out waiting for ' + what);
}

(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(150); } }
  const L = await signup('lia', 'Lia'), M = await signup('mia', 'Mia'), N = await signup('nia', 'Nia');
  const l = client(L.token), m = client(M.token), n = client(N.token);
  n.autoReady = false;
  await l.hello(); await m.hello(); await n.hello();
  const { room } = await call(l, 'create', { mult: 500 });
  await call(m, 'join', { code: room });
  await call(n, 'join', { code: room });
  l.emit('addBot', { seat: 3 });
  await sleep(200);
  const nSeat = n.view.you, mSeat = m.view.you;
  l.emit('start');
  await until(() => l.view.state === 'playing' && l.view.seats.reduce((a, p) => a + (p ? p.count : 0), 0) <= 46, 60000, 'some plays');

  // ----- keluar sementara: seat and cards stay, turns are skipped (passed) until she is back -----
  await call(n, 'leave', { mode: 'pause' });
  await sleep(100);
  assert(l.view.seats[nSeat] && l.view.seats[nSeat].paused, 'Nia shows as paused, seat kept');
  const frozen = l.view.seats[nSeat].count;
  let turnWhilePaused = false;
  const watch = (v) => { if (v.state === 'playing' && v.gameNo === 1 && v.seats[nSeat] && v.seats[nSeat].paused && v.turn === nSeat) turnWhilePaused = true; };
  l.on('state', watch);
  await until(() => l.view.state !== 'playing' || l.view.seats[nSeat].passed, 60000, 'paused player skipped');
  assert(!turnWhilePaused, 'a paused player never gets the turn');
  if (l.view.state === 'playing') {
    assert(l.view.seats[nSeat].passed, 'skipped = passed for this round');
    assert.equal(l.view.seats[nSeat].count, frozen, 'her cards stay as they were');
    console.log('paused player auto-skipped this round');
  }
  const h = await n.hello();
  assert(h.resume && h.resume.paused, 'resume offer knows she paused');
  assert.equal((await call(n, 'resume')).room, room, 'back at the table');
  await sleep(100);
  assert(!l.view.seats[nSeat].paused, 'no longer paused');
  assert.equal(n.view.hand.length, l.view.state === 'playing' ? frozen : n.view.hand.length, 'same hand after coming back');
  l.off('state', watch);

  // ----- paused at the result screen: the next game starts without her, she keeps her seat -----
  await until(() => l.view.state === 'result', 120000, 'game 1 result');
  await call(n, 'leave', { mode: 'pause' });
  await until(() => l.view.state === 'playing' && l.view.gameNo === 2, 20000, 'game 2 without Nia');
  assert(l.view.seats[nSeat] && l.view.seats[nSeat].paused, 'seat kept while paused');
  assert(!l.view.seats[nSeat].inGame, 'not dealt into game 2');
  await n.hello();
  await call(n, 'resume');
  await sleep(100);
  assert(n.view.waitNext, 'came back mid-game: waits for the next game');
  console.log('paused player kept her seat and sat out game 2');

  // ----- keluar dari permainan mid-game: the others can end the session right away -----
  await call(m, 'leave', { mode: 'quit' });
  await sleep(100);
  assert(l.view.seats[mSeat].sitOut, 'Mia left for good');
  l.emit('proposeEnd');
  await sleep(150);
  assert(l.view.endVote, 'ending allowed mid-game after someone left');
  assert.deepEqual(l.view.endVote.waiting, ['Nia'], 'Nia (back) votes, Mia does not');
  n.emit('voteEnd', { agree: true });
  await sleep(300);
  assert.equal(l.view.state, 'final', 'session ended');
  assert.equal(l.view.final.games, 1, 'unfinished game 2 not counted');
  assert(l.view.final.players.some((p) => p.name === 'Mia'), 'Mia still in the settlement');
  console.log('ended mid-game after a player quit:', l.view.final.players.map((p) => p.name + ' ' + p.score).join(' | '));

  // ----- online players: anyone logged in, and inviting a non-friend -----
  const list = await call(l, 'online:list');
  const names = list.players.map((p) => p.username).sort();
  assert.deepEqual(names, ['mia', 'nia'], 'online list shows the other logged-in players');
  const mia = list.players.find((p) => p.username === 'mia');
  assert.equal(mia.friend, false);
  assert(!mia.presence.room, 'Mia is not at a table any more');
  const inv = await call(l, 'invite', { userId: mia.id });
  assert(inv.ok, JSON.stringify(inv));
  await sleep(150);
  assert(m.got.length && m.got[0].room === room && m.got[0].friend === false, 'non-friend receives the invite');
  assert((await call(l, 'invite', { userId: list.players.find((p) => p.username === 'nia').id })).error, 'cannot invite someone already at the table');
  console.log('leave ok');
  l.close(); m.close(); n.close(); srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
