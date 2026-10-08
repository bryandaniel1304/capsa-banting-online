// Capsa Banting Online — authoritative realtime game server (Express + Socket.IO).
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const R = require('./shared/rules');

const PORT = process.env.PORT || 3000;
const TURN_MS = 20000;
const START_CHIPS = 2000000;
const STAKES = [40000, 200000, 1000000, 5000000];
const BOT_NAMES = ['Budi', 'Sari', 'Joko', 'Rina', 'Agus', 'Dewi', 'Tono', 'Lina'];
const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🐨', '🐰', '🐻', '🦁', '🐷', '🐙', '🦄'];

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/rules.js', (_, res) => res.sendFile(path.join(__dirname, 'shared', 'rules.js')));
app.get('/healthz', (_, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 20000 });

const rooms = new Map(); // code -> room
const tokenRoom = new Map(); // player token -> room code

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

const clean = (s, n = 16) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const occupied = (room) => room.seats.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
const seatOf = (room, token) => room.seats.findIndex((p) => p && p.token === token);
const humans = (room) => room.seats.filter((p) => p && !p.bot);

function createRoom(stake) {
  const room = {
    code: makeCode(), stake: STAKES.includes(stake) ? stake : STAKES[0],
    hostToken: null, seats: [null, null, null, null], state: 'lobby',
    game: null, result: null, lastWinner: null, gameNo: 0, timer: null, botTimer: null, created: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function seatPlayer(room, player, prefer) {
  const seat = prefer != null && !room.seats[prefer] ? prefer : room.seats.findIndex((p) => !p);
  if (seat < 0) return -1;
  player.seat = seat;
  room.seats[seat] = player;
  if (!player.bot) tokenRoom.set(player.token, room.code);
  if (!room.hostToken && !player.bot) room.hostToken = player.token;
  return seat;
}

function removePlayer(room, seat) {
  const p = room.seats[seat];
  if (!p) return;
  room.seats[seat] = null;
  if (!p.bot) tokenRoom.delete(p.token);
  if (room.hostToken === p.token) {
    const h = humans(room)[0];
    room.hostToken = h ? h.token : null;
  }
  if (room.lastWinner === seat) room.lastWinner = null;
  if (!humans(room).length) destroyRoom(room);
}

function destroyRoom(room) {
  clearTimeout(room.timer); clearTimeout(room.botTimer);
  rooms.delete(room.code);
}

// ---------- game flow ----------
function startGame(room) {
  const seats = occupied(room);
  if (seats.length < 2) return 'Butuh minimal 2 pemain';
  clearTimeout(room.timer);
  const deck = R.shuffle(R.newDeck());
  const hands = {};
  seats.forEach((s, i) => (hands[s] = R.sortHand(deck.slice(i * 13, i * 13 + 13))));
  seats.forEach((s) => {
    const p = room.seats[s];
    if (p.chips < room.stake * 10) p.chips = START_CHIPS; // free gold refill
    p.ready = false;
  });

  // First game: holder of the lowest dealt card leads and must play it. Afterwards the last winner leads.
  let leader, mustInclude = null;
  if (room.lastWinner != null && room.seats[room.lastWinner]) leader = room.lastWinner;
  else {
    const lowest = Math.min(...seats.flatMap((s) => hands[s]));
    leader = seats.find((s) => hands[s].includes(lowest));
    mustInclude = lowest;
  }

  room.gameNo++;
  room.state = 'playing';
  room.result = null;
  room.game = { hands, turn: leader, lastPlay: null, passed: [], mustInclude, history: [], deadline: 0, startedWith: seats };
  io.to(room.code).emit('fx', { type: 'deal', stake: room.stake });
  startTurn(room);
  return null;
}

function startTurn(room) {
  const g = room.game;
  clearTimeout(room.timer); clearTimeout(room.botTimer);
  g.deadline = Date.now() + TURN_MS;
  const p = room.seats[g.turn];
  room.timer = setTimeout(() => autoAct(room), TURN_MS + 300);
  if (p && p.bot) room.botTimer = setTimeout(() => botAct(room), 900 + Math.random() * 1300);
  else if (p && !p.connected) room.botTimer = setTimeout(() => autoAct(room), 2500);
  broadcast(room);
}

function doPlay(room, seat, cards) {
  const g = room.game;
  if (!g || room.state !== 'playing') return 'Permainan belum dimulai';
  if (g.turn !== seat) return 'Bukan giliranmu';
  if (!Array.isArray(cards) || !cards.length) return 'Pilih kartu';
  const hand = g.hands[seat];
  if (!cards.every((c) => hand.includes(c))) return 'Kartu tidak valid';
  const ev = R.evaluate(cards);
  if (!ev) return 'Kombinasi tidak valid';
  if (g.mustInclude != null && !cards.includes(g.mustInclude)) return 'Giliran pertama harus memakai ' + R.label(g.mustInclude);
  if (g.lastPlay && !R.beats(ev, g.lastPlay.ev)) {
    return g.lastPlay.ev.count !== ev.count ? 'Harus ' + g.lastPlay.ev.count + ' kartu' : 'Kartu kurang tinggi';
  }
  g.hands[seat] = hand.filter((c) => !cards.includes(c));
  g.mustInclude = null;
  g.lastPlay = { seat, cards: [...cards].sort((a, b) => a - b), ev };
  g.history.push({ seat, cards: g.lastPlay.cards, name: ev.name });
  if (g.history.length > 4) g.history.shift();
  io.to(room.code).emit('fx', { type: 'play', seat, cards: g.lastPlay.cards, name: ev.name, kind: ev.kind });
  if (!g.hands[seat].length) { endGame(room, seat); return null; }
  advance(room, seat);
  return null;
}

function doPass(room, seat) {
  const g = room.game;
  if (!g || room.state !== 'playing') return 'Permainan belum dimulai';
  if (g.turn !== seat) return 'Bukan giliranmu';
  if (!g.lastPlay) return 'Kamu memulai ronde, harus buang kartu';
  g.passed.push(seat);
  io.to(room.code).emit('fx', { type: 'pass', seat });
  advance(room, seat);
  return null;
}

// Counter-clockwise turn order. A pass locks the player out until the round ends.
function advance(room, from) {
  const g = room.game;
  for (let k = 1; k <= 4; k++) {
    const t = (from + k) % 4;
    if (!g.hands[t] || g.passed.includes(t)) continue;
    if (g.lastPlay && t === g.lastPlay.seat) { // everyone else passed -> new round
      g.lastPlay = null; g.passed = []; g.history = [];
      io.to(room.code).emit('fx', { type: 'newround', seat: t });
    }
    g.turn = t;
    startTurn(room);
    return;
  }
}

function endGame(room, winner) {
  const g = room.game;
  clearTimeout(room.timer); clearTimeout(room.botTimer);
  const rows = [];
  let won = 0;
  for (const s of g.startedWith) {
    if (s === winner) continue;
    const p = room.seats[s];
    const left = (g.hands[s] || []).length;
    const pts = R.penaltyPoints(left);
    let pay = pts * room.stake;
    if (p) { pay = Math.min(pay, p.chips); p.chips -= pay; }
    won += pay;
    rows.push({ seat: s, name: p ? p.name : '-', avatar: p ? p.avatar : '?', left, cards: g.hands[s] || [], points: -pts, delta: -pay });
  }
  const wp = room.seats[winner];
  wp.chips += won;
  rows.unshift({ seat: winner, name: wp.name, avatar: wp.avatar, left: 0, cards: [], points: 0, delta: won, winner: true });
  room.result = { winner, rows, stake: room.stake };
  room.lastWinner = winner;
  room.state = 'result';
  room.seats.forEach((p) => p && (p.ready = !!p.bot));
  io.to(room.code).emit('fx', { type: 'win', seat: winner, amount: won });
  broadcast(room);
}

// Timeouts / disconnected players: lead the lowest card, otherwise pass.
function autoAct(room) {
  const g = room.game;
  if (!g || room.state !== 'playing') return;
  const seat = g.turn;
  if (!g.lastPlay) doPlay(room, seat, [g.mustInclude != null ? g.mustInclude : Math.min(...g.hands[seat])]);
  else doPass(room, seat);
}

function botAct(room) {
  const g = room.game;
  if (!g || room.state !== 'playing') return;
  const seat = g.turn;
  const hand = g.hands[seat];
  let pick = R.suggest(hand, g.lastPlay ? g.lastPlay.ev : null, g.mustInclude);
  if (pick && g.lastPlay) {
    // hold back 2s early unless an opponent is close to going out
    const danger = occupied(room).some((s) => s !== seat && g.hands[s] && g.hands[s].length <= 3);
    const usesTwo = pick.some((c) => R.rankOf(c) === R.RANK_TWO);
    if (!danger && usesTwo && hand.length > 4 && Math.random() < 0.7) pick = null;
  }
  if (pick) doPlay(room, seat, pick); else doPass(room, seat);
}

function maybeAutoStart(room) {
  if (room.state !== 'result') return;
  const seats = occupied(room);
  if (seats.length >= 2 && seats.every((s) => room.seats[s].ready)) {
    clearTimeout(room.timer);
    room.timer = setTimeout(() => room.state === 'result' && startGame(room), 1200);
  }
}

// ---------- views ----------
function viewFor(room, token) {
  const me = seatOf(room, token);
  const g = room.game;
  const playing = room.state === 'playing';
  return {
    code: room.code, stake: room.stake, state: room.state, gameNo: room.gameNo,
    you: me, host: seatOf(room, room.hostToken),
    seats: room.seats.map((p, i) => p && {
      name: p.name, avatar: p.avatar, chips: p.chips, bot: !!p.bot, connected: !!(p.bot || p.connected), ready: !!p.ready,
      count: playing && g.hands[i] ? g.hands[i].length : 0,
      passed: playing && g.passed.includes(i),
      inGame: playing && !!g.hands[i],
    }),
    hand: playing && me >= 0 && g.hands[me] ? g.hands[me] : [],
    turn: playing ? g.turn : -1,
    remaining: playing ? Math.max(0, g.deadline - Date.now()) : 0,
    turnMs: TURN_MS,
    lastPlay: playing && g.lastPlay ? { seat: g.lastPlay.seat, cards: g.lastPlay.cards, name: g.lastPlay.ev.name } : null,
    history: playing ? g.history : [],
    mustInclude: playing ? g.mustInclude : null,
    result: room.result,
    stakes: STAKES,
  };
}

function broadcast(room) {
  for (const p of room.seats) {
    if (p && !p.bot && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.token));
  }
}

// ---------- sockets ----------
io.on('connection', (socket) => {
  let token = null;
  const roomOf = () => { const c = token && tokenRoom.get(token); return c ? rooms.get(c) : null; };
  const fail = (msg) => socket.emit('toast', { msg, error: true });
  const ack = (cb, v) => typeof cb === 'function' && cb(v);
  const newPlayer = (name, avatar) => ({
    token, name: clean(name) || 'Pemain', avatar: AVATARS.includes(avatar) ? avatar : '🦊', chips: START_CHIPS, bot: false,
  });

  function attach(room, p) {
    p.socketId = socket.id; p.connected = true;
    socket.join(room.code);
    broadcast(room);
  }

  function leave(room) {
    const s = seatOf(room, token);
    if (s < 0) return;
    socket.leave(room.code);
    const p = room.seats[s];
    if (room.state === 'playing' && room.game.hands[s]) {
      // a bot takes over the hand so the game can finish
      tokenRoom.delete(token);
      p.bot = true; p.name = clean(p.name, 10) + ' 🤖'; p.socketId = null; p.token = 'bot-' + token;
      if (room.hostToken === token) { const h = humans(room)[0]; room.hostToken = h ? h.token : null; }
      if (!humans(room).length) { destroyRoom(room); return; }
      if (room.game.turn === s) { clearTimeout(room.botTimer); room.botTimer = setTimeout(() => botAct(room), 800); }
    } else {
      removePlayer(room, s);
    }
    if (rooms.has(room.code)) { io.to(room.code).emit('toast', { msg: p.name + ' keluar' }); broadcast(room); }
  }

  socket.on('hello', ({ token: t } = {}, cb) => {
    token = clean(t, 64);
    const room = roomOf();
    const p = room && room.seats[seatOf(room, token)];
    if (p) { attach(room, p); return ack(cb, { room: room.code }); }
    ack(cb, { room: null });
  });

  socket.on('create', ({ name, avatar, stake } = {}, cb) => {
    if (!token) return fail('Sesi tidak valid');
    const old = roomOf();
    if (old) leave(old);
    const room = createRoom(+stake);
    const p = newPlayer(name, avatar);
    seatPlayer(room, p, 0);
    attach(room, p);
    ack(cb, { room: room.code });
  });

  socket.on('join', ({ code, name, avatar } = {}, cb) => {
    if (!token) return fail('Sesi tidak valid');
    const room = rooms.get(clean(code, 8).toUpperCase());
    if (!room) return ack(cb, { error: 'Meja tidak ditemukan' });
    const existing = seatOf(room, token);
    if (existing >= 0) { attach(room, room.seats[existing]); return ack(cb, { room: room.code }); }
    if (room.state === 'playing') return ack(cb, { error: 'Permainan sedang berlangsung, coba lagi setelah ronde selesai' });
    let seat = room.seats.findIndex((p) => !p);
    if (seat < 0) seat = room.seats.findIndex((p) => p && p.bot);
    if (seat < 0) return ack(cb, { error: 'Meja penuh (4 pemain)' });
    const old = roomOf();
    if (old) leave(old);
    room.seats[seat] = null; // replaces a bot if the table was full of bots
    const p = newPlayer(name, avatar);
    seatPlayer(room, p, seat);
    attach(room, p);
    io.to(room.code).emit('toast', { msg: p.name + ' bergabung' });
    ack(cb, { room: room.code });
  });

  socket.on('leave', (_, cb) => { const r = roomOf(); if (r) leave(r); ack(cb, {}); });

  socket.on('start', () => {
    const room = roomOf();
    if (!room || room.state === 'playing') return;
    if (room.hostToken !== token) return fail('Hanya host yang bisa memulai');
    const err = startGame(room);
    if (err) fail(err);
  });

  socket.on('ready', () => {
    const room = roomOf();
    if (!room || room.state !== 'result') return;
    const p = room.seats[seatOf(room, token)];
    if (p) p.ready = true;
    broadcast(room);
    maybeAutoStart(room);
  });

  socket.on('addBot', ({ seat } = {}) => {
    const room = roomOf();
    if (!room || room.hostToken !== token || room.state === 'playing') return;
    if (!(seat >= 0 && seat < 4) || room.seats[seat]) return;
    const used = room.seats.filter(Boolean).map((p) => p.name);
    const name = BOT_NAMES.find((n) => !used.includes(n)) || 'Bot';
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    seatPlayer(room, { token: 'bot-' + Math.random().toString(36).slice(2), name, avatar, chips: START_CHIPS, bot: true, ready: true, connected: true }, seat);
    broadcast(room);
    maybeAutoStart(room);
  });

  socket.on('kick', ({ seat } = {}) => {
    const room = roomOf();
    if (!room || room.hostToken !== token || room.state === 'playing') return;
    const p = room.seats[seat];
    if (!p || p.token === token) return;
    if (!p.bot && p.socketId) io.to(p.socketId).emit('kicked');
    removePlayer(room, seat);
    if (rooms.has(room.code)) broadcast(room);
  });

  socket.on('stake', ({ stake } = {}) => {
    const room = roomOf();
    if (!room || room.hostToken !== token || room.state === 'playing' || !STAKES.includes(+stake)) return;
    room.stake = +stake;
    broadcast(room);
  });

  socket.on('play', ({ cards } = {}, cb) => {
    const room = roomOf();
    if (!room) return ack(cb, { error: 'Tidak di meja' });
    ack(cb, { error: doPlay(room, seatOf(room, token), (cards || []).map(Number)) });
  });

  socket.on('pass', (_, cb) => {
    const room = roomOf();
    if (!room) return ack(cb, { error: 'Tidak di meja' });
    ack(cb, { error: doPass(room, seatOf(room, token)) });
  });

  socket.on('chat', ({ text } = {}) => {
    const room = roomOf();
    if (!room) return;
    const s = seatOf(room, token);
    const t = clean(text, 60);
    if (s >= 0 && t) io.to(room.code).emit('chat', { seat: s, text: t });
  });

  socket.on('disconnect', () => {
    const room = roomOf();
    if (!room) return;
    const p = room.seats[seatOf(room, token)];
    if (!p || p.socketId !== socket.id) return;
    p.connected = false; p.socketId = null;
    broadcast(room);
    if (room.state === 'playing' && room.game.turn === p.seat) {
      clearTimeout(room.botTimer); room.botTimer = setTimeout(() => autoAct(room), 2500);
    }
    // drop players who stay away from a table that is not mid-game
    setTimeout(() => {
      if (!rooms.has(room.code) || p.connected || room.seats[p.seat] !== p) return;
      if (room.state !== 'playing') { removePlayer(room, p.seat); if (rooms.has(room.code)) broadcast(room); }
    }, 120000);
  });
});

// sweep abandoned rooms
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.seats.some((p) => p && !p.bot && p.connected) && Date.now() - room.created > 30 * 60000) destroyRoom(room);
  }
}, 60000);

server.listen(PORT, () => console.log('Capsa Banting Online on http://localhost:' + PORT));