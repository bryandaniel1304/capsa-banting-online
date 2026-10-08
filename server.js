// Capsa Banting Online — authoritative realtime game server (Express + Socket.IO).
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const R = require('./shared/rules');
const store = require('./store');
const accounts = require('./auth');

const PORT = process.env.PORT || 3000;
const TURN_MS = 20000;
const MULTS = [250, 500, 1000, 2000];
const MAX_MULT = 1000000;
const BOT_NAMES = ['Budi', 'Sari', 'Joko', 'Rina', 'Agus', 'Dewi', 'Tono', 'Lina'];
const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🐨', '🐰', '🐻', '🦁', '🐷', '🐙', '🦄', '🤖'];

const app = express();
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', accounts.router({ presenceOf: (id) => presenceOf(id), emitToUser: (id, ev, data) => emitToUser(id, ev, data) }));
app.get('/rules.js', (_, res) => res.sendFile(path.join(__dirname, 'shared', 'rules.js')));
app.get('/healthz', (_, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 20000 });

const rooms = new Map(); // code -> room

// ---------- presence (friends see who is online / at a table) ----------
// every logged-in socket joins the socket.io room 'user:<id>'
const emitToUser = (userId, ev, data) => io.to('user:' + userId).emit(ev, data);
function presenceOf(userId) {
  const online = (io.sockets.adapter.rooms.get('user:' + userId) || new Set()).size > 0;
  const room = rooms.get(tokenRoom.get('u:' + userId));
  return { online, room: online && room ? room.code : null, state: online && room ? room.state : null, players: room ? room.seats.filter(Boolean).length : 0 };
}
const presTimers = new Map();
function notifyPresence(userId) {
  if (!userId) return;
  clearTimeout(presTimers.get(userId));
  presTimers.set(userId, setTimeout(async () => {
    presTimers.delete(userId);
    try {
      const ids = await store.friendIds(userId);
      const pr = { userId, ...presenceOf(userId) };
      ids.forEach((f) => emitToUser(f, 'presence', pr));
    } catch (e) { console.error('presence', e.message); }
  }, 300));
}
const roomPresence = (room) => room.seats.forEach((p) => p && p.userId && !p.bot && notifyPresence(p.userId));
const lastInvite = new Map();
const tokenRoom = new Map(); // player token -> room code

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

const clean = (s, n = 16) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const validMult = (m) => Number.isInteger(m) && m >= 1 && m <= MAX_MULT;
const occupied = (room) => room.seats.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
const seatOf = (room, token) => room.seats.findIndex((p) => p && p.token === token);
const humans = (room) => room.seats.filter((p) => p && !p.bot);

function createRoom(mult) {
  const room = {
    code: makeCode(), mult: validMult(mult) ? mult : MULTS[0],
    hostToken: null, seats: [null, null, null, null], state: 'lobby',
    game: null, result: null, lastWinner: null, gameNo: 0, timer: null, botTimer: null, created: Date.now(),
    history: [], endVote: null, final: null,
    match: { id: null }, dbChain: Promise.resolve(),
  };
  rooms.set(room.code, room);
  return room;
}

function seatPlayer(room, player, prefer) {
  const seat = prefer != null && !room.seats[prefer] ? prefer : room.seats.findIndex((p) => !p);
  if (seat < 0) return -1;
  player.seat = seat;
  player.score = player.score || 0;
  player.games = player.games || 0;
  player.wins = player.wins || 0;
  room.seats[seat] = player;
  if (!player.bot) tokenRoom.set(player.token, room.code);
  if (!room.hostToken && !player.bot) room.hostToken = player.token;
  return seat;
}

function removePlayer(room, seat) {
  const p = room.seats[seat];
  if (!p) return;
  room.seats[seat] = null;
  if (!p.bot) { tokenRoom.delete(p.token); notifyPresence(p.userId); }
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
  // 13 cards each; with fewer than 4 players the rest stays in the dealer's deck unplayed
  const deck = R.shuffle(R.newDeck());
  const hands = {};
  seats.forEach((s, i) => (hands[s] = R.sortHand(deck.slice(i * 13, i * 13 + 13))));
  seats.forEach((s) => (room.seats[s].ready = false));

  // First game: holder of the lowest dealt card leads and must play it. Afterwards the last winner leads.
  let leader, mustInclude = null;
  if (room.lastWinner != null && room.seats[room.lastWinner]) leader = room.lastWinner;
  else {
    const lowest = Math.min(...seats.flatMap((s) => hands[s]));
    leader = seats.find((s) => hands[s].includes(lowest));
    mustInclude = lowest;
  }

  room.gameNo++;
  roomPresence(room);
  room.state = 'playing';
  room.result = null;
  const bonus = {};
  seats.forEach((s) => (bonus[s] = []));
  room.game = {
    hands, turn: leader, lastPlay: null, passed: [], mustInclude, history: [], deadline: 0,
    startedWith: seats, bonus, ceki: [], dealerLeft: 52 - seats.length * 13,
  };
  io.to(room.code).emit('fx', { type: 'deal' });
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
  const leading = !g.lastPlay || g.free;
  if (ev.kind === 'dragon' && !leading) return 'Dragon hanya bisa dibuang saat membuka ronde';
  if (g.mustInclude != null && !cards.includes(g.mustInclude)) return 'Giliran pertama harus memakai ' + R.label(g.mustInclude);
  if (!leading && !R.beats(ev, g.lastPlay.ev)) {
    return g.lastPlay.ev.count !== ev.count ? 'Harus ' + g.lastPlay.ev.count + ' kartu' : 'Kartu kurang tinggi';
  }
  g.hands[seat] = hand.filter((c) => !cards.includes(c));
  g.mustInclude = null;
  g.free = false;
  if (leading) { g.passed = []; g.history = []; }
  g.lastPlay = { seat, cards: [...cards].sort((a, b) => a - b), ev };
  g.history.push({ seat, cards: g.lastPlay.cards, name: ev.name });
  if (g.history.length > 4) g.history.shift();
  io.to(room.code).emit('fx', { type: 'play', seat, cards: g.lastPlay.cards, name: ev.name, kind: ev.kind });

  const bonus = R.bonusFor(ev);
  if (bonus) {
    g.bonus[seat].push({ label: ev.name, points: bonus });
    io.to(room.code).emit('fx', { type: 'bonus', seat, name: ev.name, points: bonus });
  }
  if (!g.hands[seat].length) { endGame(room, seat, ev, g.lastPlay.cards); return null; }
  if (g.hands[seat].length === 1 && !g.ceki.includes(seat)) {
    g.ceki.push(seat);
    io.to(room.code).emit('fx', { type: 'ceki', seat });
  }
  if (R.freeTurnAfter(ev, cards)) {
    // 2♠ can't be beaten: the same player plays again right away
    g.free = true; g.passed = [];
    io.to(room.code).emit('fx', { type: 'twoSpade', seat });
    startTurn(room);
    return null;
  }
  advance(room, seat);
  return null;
}

function doPass(room, seat) {
  const g = room.game;
  if (!g || room.state !== 'playing') return 'Permainan belum dimulai';
  if (g.turn !== seat) return 'Bukan giliranmu';
  if (!g.lastPlay || g.free) return 'Kamu memulai ronde, harus buang kartu';
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

// Points per game (lower is better): winner -10 (-20 when closing with a single 2),
// losers +cards left x (1-6: 1, 7-9: 2, 10-12: 3, 13: 4) and +10 per 2 still in hand,
// plus package bonuses for whoever played them (a dragon win is -70 only).
function endGame(room, winner, finalEv, finalCards) {
  const g = room.game;
  clearTimeout(room.timer); clearTimeout(room.botTimer);
  const rows = [];
  for (const s of g.startedWith) {
    const p = room.seats[s];
    const left = (g.hands[s] || []).length;
    const items = [];
    if (s === winner) {
      const wp = R.winPoints(finalEv, finalCards);
      if (wp) items.push({ label: wp === R.WIN_WITH_TWO_POINTS ? 'Menang tutup 2' : 'Menang', points: wp });
    } else {
      items.push({ label: 'Sisa ' + left + ' kartu ×' + R.penaltyPerCard(left), points: R.penaltyPoints(left) });
      const twos = R.twosLeft(g.hands[s] || []);
      if (twos) items.push({ label: 'Sisa ' + twos + ' kartu 2', points: twos * R.TWO_LEFT_POINTS });
    }
    items.push(...g.bonus[s]);
    const points = items.reduce((a, b) => a + b.points, 0);
    if (p) {
      p.score += points; p.games++;
      if (s === winner) p.wins++;
    }
    rows.push({
      seat: s, name: p ? p.name : '-', avatar: p ? p.avatar : '?', left, cards: g.hands[s] || [],
      items, points, total: p ? p.score : points, winner: s === winner,
    });
  }
  rows.sort((a, b) => b.winner - a.winner || a.points - b.points);
  room.result = { winner, rows, mult: room.mult, dragon: finalEv.kind === 'dragon' };
  room.history.push({
    no: room.history.length + 1, winner: room.seats[winner].name, at: Date.now(),
    rows: rows.map((r) => ({ seat: r.seat, name: r.name, points: r.points, detail: r.items.map((i) => i.label + ' ' + i.points).join(', ') })),
  });
  persistGame(room, rows);
  room.lastWinner = winner;
  room.state = 'result';
  room.seats.forEach((p) => p && (p.ready = !!p.bot));
  io.to(room.code).emit('fx', { type: 'win', seat: winner });
  roomPresence(room);
  broadcast(room);
}

// ---------- persistence (accounts' play history) ----------
const pkeyOf = (p) => (p.userId ? 'u:' + p.userId : p.token);

// DB writes run in order per room and never block the game.
function dbTask(room, fn) {
  room.dbChain = room.dbChain.then(fn).catch((e) => console.error('db error', room.code, e.message));
}
async function ensureMatch(room, match) {
  if (!match.id) match.id = await store.createMatch(room.code, room.mult);
  return match.id;
}
function persistGame(room, rows) {
  const match = room.match;
  const last = room.history[room.history.length - 1];
  const game = {
    gameNo: last.no, winnerName: last.winner, mult: room.mult,
    rows: rows.map((r) => {
      const p = room.seats[r.seat];
      return { pkey: p ? pkeyOf(p) : 'seat:' + r.seat, userId: p && p.userId, name: r.name, points: r.points, left: r.left,
        detail: r.items.map((i) => i.label + ' ' + i.points).join(', '), winner: r.winner };
    }),
    totals: room.seats.filter((p) => p && p.games).map((p) => ({
      pkey: pkeyOf(p), userId: p.userId, name: p.name, avatar: p.avatar, bot: !p.userId, score: p.score, wins: p.wins, games: p.games,
    })),
  };
  dbTask(room, async () => store.recordGame(await ensureMatch(room, match), game));
}
function persistFinal(room) {
  const match = room.match;
  const final = { mult: room.mult, players: room.final.players.map((p, i) => ({ pkey: p.pkey, rank: i + 1, net: p.net })) };
  dbTask(room, async () => { if (match.id) await store.finishMatch(match.id, final); });
}

// Timeouts / disconnected players: lead the lowest card, otherwise pass.
function autoAct(room) {
  const g = room.game;
  if (!g || room.state !== 'playing') return;
  const seat = g.turn;
  if (!g.lastPlay || g.free) doPlay(room, seat, [g.mustInclude != null ? g.mustInclude : Math.min(...g.hands[seat])]);
  else doPass(room, seat);
}

function botAct(room) {
  const g = room.game;
  if (!g || room.state !== 'playing') return;
  const seat = g.turn;
  const hand = g.hands[seat];
  const toBeat = g.lastPlay && !g.free ? g.lastPlay.ev : null;
  let pick = R.suggest(hand, toBeat, g.mustInclude);
  if (pick && toBeat) {
    // hold back 2s early unless an opponent is close to going out
    const danger = occupied(room).some((s) => s !== seat && g.hands[s] && g.hands[s].length <= 3);
    const usesTwo = pick.some((c) => R.rankOf(c) === R.RANK_TWO);
    if (!danger && usesTwo && hand.length > 4 && Math.random() < 0.7) pick = null;
  }
  if (pick) doPlay(room, seat, pick); else doPass(room, seat);
}

// Final settlement: rank by total points (highest = #1). Every higher-ranked player pays every
// lower-ranked player (difference in points) x multiplier.
function settle(room) {
  const players = room.seats.filter(Boolean).map((p) => ({ seat: p.seat, pkey: pkeyOf(p), name: p.name, avatar: p.avatar, score: p.score, wins: p.wins, games: p.games }));
  players.sort((a, b) => b.score - a.score);
  const pays = [];
  players.forEach((p) => (p.net = 0));
  for (let i = 0; i < players.length; i++) {
    for (let j = players.length - 1; j > i; j--) {
      const diff = players[i].score - players[j].score;
      const amount = diff * room.mult;
      pays.push({ from: players[i].name, fromRank: i + 1, to: players[j].name, toRank: j + 1, diff, amount });
      players[i].net -= amount; players[j].net += amount;
    }
  }
  return { players, pays, mult: room.mult, games: room.history.length, at: Date.now() };
}

function finishSession(room) {
  clearTimeout(room.timer);
  room.final = settle(room);
  persistFinal(room);
  room.state = 'final';
  roomPresence(room);
  room.endVote = null;
  io.to(room.code).emit('fx', { type: 'final' });
  broadcast(room);
}

function checkEndVote(room) {
  const v = room.endVote;
  if (!v) return;
  const voters = room.seats.filter((p) => p && !p.bot);
  if (voters.some((p) => v.votes[p.token] === false)) {
    const who = voters.find((p) => v.votes[p.token] === false);
    room.endVote = null;
    io.to(room.code).emit('toast', { msg: who.name + ' menolak mengakhiri permainan' });
    broadcast(room);
    maybeAutoStart(room);
    return;
  }
  if (voters.every((p) => v.votes[p.token] === true)) finishSession(room);
  else broadcast(room);
}

function maybeAutoStart(room) {
  if (room.state !== 'result' || room.endVote) return;
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
    code: room.code, mult: room.mult, mults: MULTS, state: room.state, gameNo: room.gameNo,
    you: me, host: seatOf(room, room.hostToken),
    seats: room.seats.map((p, i) => p && {
      name: p.name, avatar: p.avatar, score: p.score, games: p.games, wins: p.wins,
      bot: !!p.bot, connected: !!(p.bot || p.connected), ready: !!p.ready, voice: !!p.voice, muted: !!p.muted, userId: p.userId || null,
      count: playing && g.hands[i] ? g.hands[i].length : 0,
      passed: playing && g.passed.includes(i),
      inGame: playing && !!g.hands[i],
      bonus: playing && g.bonus[i] ? g.bonus[i].reduce((a, b) => a + b.points, 0) : 0,
    }),
    hand: playing && me >= 0 && g.hands[me] ? g.hands[me] : [],
    dealerLeft: playing ? g.dealerLeft : 0,
    turn: playing ? g.turn : -1,
    remaining: playing ? Math.max(0, g.deadline - Date.now()) : 0,
    turnMs: TURN_MS,
    lastPlay: playing && g.lastPlay ? { seat: g.lastPlay.seat, cards: g.lastPlay.cards, name: g.lastPlay.ev.name } : null,
    history: playing ? g.history : [],
    mustInclude: playing ? g.mustInclude : null,
    free: playing && !!g.free,
    result: room.result,
    gameLog: room.history,
    endVote: room.endVote && {
      by: room.endVote.by,
      agreed: room.seats.filter((p) => p && !p.bot && room.endVote.votes[p.token] === true).map((p) => p.name),
      waiting: room.seats.filter((p) => p && !p.bot && room.endVote.votes[p.token] == null).map((p) => p.name),
      myVote: room.endVote.votes[token] == null ? null : room.endVote.votes[token],
    },
    final: room.final,
  };
}

function broadcast(room) {
  for (const p of room.seats) {
    if (p && !p.bot && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.token));
  }
}

// ---------- sockets ----------
io.on('connection', (socket) => {
  let token = null; // room identity: 'u:<userId>' for logged-in players
  let user = null;
  const roomOf = () => { const c = token && tokenRoom.get(token); return c ? rooms.get(c) : null; };
  const fail = (msg) => socket.emit('toast', { msg, error: true });
  const ack = (cb, v) => typeof cb === 'function' && cb(v);
  const newPlayer = () => ({
    token, userId: user.id, name: clean(user.name, 14) || user.username, avatar: user.avatar || '🦊', bot: false,
  });

  function attach(room, p) {
    if (p.voice && p.socketId !== socket.id) voiceLeave(room, p); // voice connections belong to the old socket
    p.socketId = socket.id; p.connected = true;
    socket.join(room.code);
    broadcast(room);
    notifyPresence(p.userId);
  }

  // ---------- voice chat (WebRTC mesh; the server only relays signaling) ----------
  function voiceLeave(room, p) {
    if (!p || !p.voice) return;
    p.voice = false; p.muted = false;
    io.to(room.code).emit('voice:left', { seat: p.seat });
    broadcast(room);
  }
  socket.on('voice:join', (_, cb) => {
    const room = roomOf();
    if (!room) return ack(cb, { error: 'Tidak di meja' });
    const s = seatOf(room, token);
    const p = room.seats[s];
    const peers = room.seats.map((x, i) => (x && !x.bot && x.voice && x.socketId && i !== s ? i : -1)).filter((i) => i >= 0);
    p.voice = true; p.muted = false;
    socket.to(room.code).emit('voice:joined', { seat: s });
    broadcast(room);
    ack(cb, { seat: s, peers });
  });
  socket.on('voice:signal', ({ to, data } = {}) => {
    const room = roomOf();
    if (!room || !data) return;
    const from = seatOf(room, token);
    const target = room.seats[to];
    if (from < 0 || !target || !target.voice || !target.socketId) return;
    io.to(target.socketId).emit('voice:signal', { from, data });
  });
  socket.on('voice:mute', ({ muted } = {}) => {
    const room = roomOf();
    const p = room && room.seats[seatOf(room, token)];
    if (!p || !p.voice) return;
    p.muted = !!muted;
    broadcast(room);
  });
  socket.on('voice:leave', () => {
    const room = roomOf();
    if (room) voiceLeave(room, room.seats[seatOf(room, token)]);
  });

  // ---------- invite an online friend to my table ----------
  socket.on('invite', async ({ friendId } = {}, cb) => {
    try {
      if (!user) return ack(cb, { error: 'Silakan masuk dulu' });
      const room = roomOf();
      if (!room) return ack(cb, { error: 'Buat atau masuk meja dulu' });
      const fid = parseInt(friendId, 10);
      if (!(await store.areFriends(user.id, fid))) return ack(cb, { error: 'Bukan teman' });
      if (!presenceOf(fid).online) return ack(cb, { error: 'Teman sedang offline' });
      const k = user.id + ':' + fid;
      if (Date.now() - (lastInvite.get(k) || 0) < 8000) return ack(cb, { error: 'Tunggu sebentar sebelum mengundang lagi' });
      lastInvite.set(k, Date.now());
      emitToUser(fid, 'invite', {
        from: { id: user.id, name: user.name, username: user.username, avatar: user.avatar },
        room: room.code, mult: room.mult, players: room.seats.filter(Boolean).length, state: room.state,
      });
      ack(cb, { ok: true });
    } catch (e) { console.error('invite', e.message); ack(cb, { error: 'Gagal mengundang' }); }
  });

  function leave(room) {
    const s = seatOf(room, token);
    if (s < 0) return;
    socket.leave(room.code);
    const p = room.seats[s];
    voiceLeave(room, p);
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
    if (rooms.has(room.code)) { io.to(room.code).emit('toast', { msg: p.name + ' keluar' }); broadcast(room); checkEndVote(room); }
  }

  // Logged-in players only: the account's session token identifies the player on every device.
  socket.on('hello', async ({ auth } = {}, cb) => {
    const prevId = user && user.id;
    try { user = await store.userByToken(auth); } catch (e) { console.error('auth', e.message); user = null; }
    token = user ? 'u:' + user.id : null;
    if (prevId && (!user || user.id !== prevId)) { socket.leave('user:' + prevId); notifyPresence(prevId); }
    if (!user) return ack(cb, { room: null, user: null });
    socket.join('user:' + user.id);
    notifyPresence(user.id);
    const room = roomOf();
    const p = room && room.seats[seatOf(room, token)];
    if (p) { p.name = clean(user.name, 14) || p.name; p.avatar = user.avatar || p.avatar; attach(room, p); return ack(cb, { room: room.code, user }); }
    ack(cb, { room: null, user });
  });

  socket.on('create', ({ mult } = {}, cb) => {
    if (!user) return ack(cb, { error: 'Silakan masuk dulu' });
    const old = roomOf();
    if (old) leave(old);
    const room = createRoom(+mult);
    const p = newPlayer();
    seatPlayer(room, p, 0);
    attach(room, p);
    ack(cb, { room: room.code });
  });

  socket.on('join', ({ code } = {}, cb) => {
    if (!user) return ack(cb, { error: 'Silakan masuk dulu' });
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
    const p = newPlayer();
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
    if (room.state === 'final') return fail('Mulai sesi baru dulu');
    if (room.endVote) return fail('Sedang voting untuk mengakhiri permainan');
    const err = startGame(room);
    if (err) fail(err);
  });

  socket.on('ready', () => {
    const room = roomOf();
    if (!room || room.state !== 'result' || room.endVote) return;
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
    const avatar = AVATARS[Math.floor(Math.random() * (AVATARS.length - 1))];
    seatPlayer(room, { token: 'bot-' + Math.random().toString(36).slice(2), name, avatar, bot: true, ready: true, connected: true }, seat);
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

  socket.on('mult', ({ mult } = {}) => {
    const room = roomOf();
    if (!room || room.hostToken !== token || room.state === 'playing') return;
    if (!validMult(+mult)) return fail('Pengali harus 1 - ' + MAX_MULT.toLocaleString('id-ID'));
    room.mult = +mult;
    broadcast(room);
  });

  function resetSession(room) {
    room.seats.forEach((p) => p && Object.assign(p, { score: 0, games: 0, wins: 0, ready: !!p.bot }));
    room.history = []; room.final = null; room.endVote = null; room.result = null; room.lastWinner = null;
    room.match = { id: null }; // next games belong to a new saved session
    room.state = 'lobby';
  }

  socket.on('resetScores', () => {
    const room = roomOf();
    if (!room || room.hostToken !== token || room.state === 'playing') return;
    resetSession(room);
    io.to(room.code).emit('toast', { msg: 'Poin & riwayat direset' });
    broadcast(room);
  });

  // Ending the whole session needs every human player to agree.
  socket.on('proposeEnd', () => {
    const room = roomOf();
    if (!room || room.hostToken !== token || room.endVote) return;
    if (room.state !== 'result' && room.state !== 'lobby') return fail('Tunggu game selesai dulu');
    if (!room.history.length) return fail('Belum ada game yang dimainkan');
    clearTimeout(room.timer);
    room.endVote = { by: room.seats[seatOf(room, token)].name, votes: { [token]: true } };
    io.to(room.code).emit('toast', { msg: room.endVote.by + ' mengusulkan mengakhiri permainan' });
    checkEndVote(room);
  });

  socket.on('voteEnd', ({ agree } = {}) => {
    const room = roomOf();
    if (!room || !room.endVote || seatOf(room, token) < 0) return;
    room.endVote.votes[token] = !!agree;
    checkEndVote(room);
  });

  socket.on('newSession', () => {
    const room = roomOf();
    if (!room || room.hostToken !== token || room.state !== 'final') return;
    resetSession(room);
    io.to(room.code).emit('toast', { msg: 'Sesi baru dimulai, poin direset' });
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

  let lastChat = 0;
  socket.on('chat', ({ text } = {}) => {
    const room = roomOf();
    if (!room || Date.now() - lastChat < 800) return; // light anti-spam
    lastChat = Date.now();
    const s = seatOf(room, token);
    const t = clean(text, 80);
    if (s >= 0 && t) io.to(room.code).emit('chat', { seat: s, text: t });
  });

  socket.on('disconnect', () => {
    if (user) notifyPresence(user.id);
    const room = roomOf();
    if (!room) return;
    const p = room.seats[seatOf(room, token)];
    if (!p || p.socketId !== socket.id) return;
    voiceLeave(room, p);
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

store.init().then((kind) => {
  if (kind === 'pglite') console.log('Database: embedded PGlite (~/.capsa-banting-online). Set DATABASE_URL to use Postgres in production.');
  else console.log('Database: Postgres');
  server.listen(PORT, () => console.log('Capsa Banting Online on http://localhost:' + PORT));
}).catch((e) => { console.error('Database init failed:', e); process.exit(1); });