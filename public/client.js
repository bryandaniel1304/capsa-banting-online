/* Capsa Banting Online — client */
(() => {
  const R = window.CapsaRules;
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🐨', '🐰', '🐻', '🦁', '🐷', '🐙', '🦄'];
  const TIERS = [
    { name: 'Peasant', art: '🧑‍🌾', stake: 40000, range: '200K - 2M' },
    { name: 'Merchant', art: '🧑‍💼', stake: 200000, range: '2M - 12M' },
    { name: 'Tycoon', art: '🤵', stake: 1000000, range: '12M - 70M' },
    { name: 'Raja', art: '🤴', stake: 5000000, range: '70M+' },
  ];
  const CHATS = ['Halo semua! 👋', 'Cepetan dong 😴', 'Mantap! 🔥', 'Waduh 😱', 'Hoki banget 🍀', 'GG 🤝', 'Sabar ya 😅', 'Ayo main lagi!'];

  // ---------- persistent identity ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('capsa.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('capsa.' + k, JSON.stringify(v)); } catch {} },
  };
  let token = store.get('token', null);
  if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('token', token); }
  const me = { name: store.get('name', ''), avatar: store.get('avatar', AVATARS[Math.floor(Math.random() * AVATARS.length)]) };
  let muted = store.get('muted', false);

  // ---------- layout: always landscape ----------
  function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const portrait = h > w;
    const W = portrait ? h : w, H = portrait ? w : h;
    stage.classList.toggle('rotated', portrait);
    stage.style.setProperty('--W', W + 'px');
    stage.style.setProperty('--H', H + 'px');
    // size by height, but keep everything inside narrow-ish landscape screens
    const u = Math.min(H / 100, W / 190);
    stage.style.setProperty('--u', u.toFixed(3) + 'px');
    if (V) renderHand();
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 200));

  // ---------- sound ----------
  let actx = null;
  function beep(freq = 600, dur = 0.08, type = 'triangle', vol = 0.15, when = 0) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + when;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  }
  const sfx = {
    card: () => { beep(320, 0.05, 'square', 0.06); beep(180, 0.06, 'triangle', 0.08, 0.03); },
    pass: () => beep(240, 0.12, 'sine', 0.1),
    turn: () => { beep(880, 0.08); beep(1175, 0.1, 'triangle', 0.12, 0.09); },
    tick: () => beep(1400, 0.03, 'square', 0.04),
    win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.18, 'triangle', 0.14, i * 0.12)),
    lose: () => [392, 330, 262].forEach((f, i) => beep(f, 0.2, 'sine', 0.12, i * 0.14)),
    deal: () => { for (let i = 0; i < 8; i++) beep(500 + Math.random() * 200, 0.03, 'square', 0.03, i * 0.05); },
  };

  // ---------- helpers ----------
  const fmt = (n) => {
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + +(a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + +(a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return s + +(a / 1e3).toFixed(1) + 'K';
    return s + a;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function cardHTML(c, extra = '') {
    const red = R.isRed(c) ? ' red' : '';
    const s = R.SUITS[R.suitOf(c)];
    return '<div class="card' + red + extra + '" data-id="' + c + '"><div class="cr">' + R.RANKS[R.rankOf(c)] + '</div><div class="cs">' + s + '</div><div class="cb">' + s + '</div></div>';
  }
  const miniHTML = (cards) => '<div class="mini">' + cards.map((c) => cardHTML(c)).join('') + '</div>';
  function toast(msg, error) {
    const t = document.createElement('div');
    t.className = 'toast' + (error ? ' error' : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  const rel = (seat) => (V ? (seat - V.you + 4) % 4 : seat); // 0 me, 1 right, 2 top, 3 left (counter-clockwise)
  const seatEl = (seat) => $('#seat' + rel(seat));

  // ---------- socket ----------
  const socket = io({ transports: ['websocket', 'polling'] });
  let V = null; // latest view from server
  let deadline = 0;
  let selected = new Set();
  let handOrder = [];
  let sortMode = store.get('sort', 'rank');
  let lastPlayKey = '';
  let lastTurnKey = '';
  let dealAnim = false;
  let hintIdx = -1;

  socket.on('connect', () => {
    $('#conn').classList.add('hidden');
    socket.emit('hello', { token }, (res) => {
      const want = new URLSearchParams(location.search).get('room');
      if (res && res.room) return;
      if (want) { if (me.name) joinRoom(want); else { $('#codeInput').value = want.toUpperCase(); showHome(); } }
      else showHome();
    });
  });
  socket.on('disconnect', () => $('#conn').classList.remove('hidden'));
  socket.on('toast', ({ msg, error }) => toast(msg, error));
  socket.on('kicked', () => { V = null; toast('Kamu dikeluarkan dari meja', true); setRoomUrl(null); showHome(); });
  socket.on('state', (v) => {
    const prev = V;
    V = v;
    deadline = Date.now() + v.remaining;
    if (!prev || prev.code !== v.code) { setRoomUrl(v.code); }
    if (v.state === 'playing' && (!prev || prev.gameNo !== v.gameNo)) {
      selected.clear(); handOrder = []; dealAnim = true; lastPlayKey = ''; hintIdx = -1;
      $('#result').classList.add('hidden');
    }
    showTable();
    render(prev);
  });
  socket.on('fx', (fx) => {
    if (fx.type === 'play') { sfx.card(); if (fx.kind === 'five') banner(fx.name); }
    else if (fx.type === 'pass') sfx.pass();
    else if (fx.type === 'deal') sfx.deal();
    else if (fx.type === 'win') { if (V && fx.seat === V.you) sfx.win(); else sfx.lose(); coinsTo(fx.seat); }
    else if (fx.type === 'newround') { /* table clears in render */ }
  });
  socket.on('chat', ({ seat, text }) => bubble(seat, text));

  function setRoomUrl(code) {
    const u = new URL(location.href);
    if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
    history.replaceState(null, '', u);
  }

  // ---------- home ----------
  function showHome() {
    $('#home').classList.remove('hidden');
    $('#table').classList.add('hidden');
    $('#nameInput').value = me.name;
    $('#avatarBtn').textContent = me.avatar;
  }
  function showTable() {
    $('#home').classList.add('hidden');
    $('#table').classList.remove('hidden');
  }
  $('#tiers').innerHTML = TIERS.map((t) =>
    '<button class="tier" data-stake="' + t.stake + '"><div class="t-head">' + t.name + '</div><div class="t-art">' + t.art + '</div><div class="t-stake">' + fmt(t.stake) + (t.name === 'Raja' ? '+' : '') + '</div><div class="t-range">' + t.range + '</div></button>').join('');
  $('#avatarPicker').innerHTML = AVATARS.map((a) => '<button data-a="' + a + '">' + a + '</button>').join('');
  $('#avatarBtn').onclick = () => {
    $('#avatarPicker').classList.toggle('hidden');
    [...$('#avatarPicker').children].forEach((b) => b.classList.toggle('on', b.dataset.a === me.avatar));
  };
  $('#avatarPicker').onclick = (e) => {
    const a = e.target.closest('button'); if (!a) return;
    me.avatar = a.dataset.a; store.set('avatar', me.avatar);
    $('#avatarBtn').textContent = me.avatar; $('#avatarPicker').classList.add('hidden');
  };
  function needName() {
    me.name = $('#nameInput').value.trim().slice(0, 14);
    if (!me.name) { toast('Isi nama dulu ya', true); $('#nameInput').focus(); return true; }
    store.set('name', me.name);
    return false;
  }
  $('#tiers').onclick = (e) => {
    const t = e.target.closest('.tier'); if (!t || needName()) return;
    unlockAudio();
    socket.emit('create', { name: me.name, avatar: me.avatar, stake: +t.dataset.stake }, () => {});
  };
  function joinRoom(code) {
    socket.emit('join', { code, name: me.name, avatar: me.avatar }, (res) => {
      if (res && res.error) { toast(res.error, true); setRoomUrl(null); showHome(); }
    });
  }
  $('#joinBtn').onclick = () => {
    const code = $('#codeInput').value.trim().toUpperCase();
    if (needName()) return;
    if (code.length < 4) return toast('Masukkan kode meja', true);
    unlockAudio();
    joinRoom(code);
  };
  $('#codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());
  function unlockAudio() { if (!muted) beep(1, 0.001, 'sine', 0.0001); }

  // ---------- table rendering ----------
  function render(prev) {
    const v = V;
    $('#roomCode').textContent = v.code;
    $('#stakeLbl').textContent = fmt(v.stake);
    $('#potVal').textContent = fmt(v.stake);
    $('#soundBtn').textContent = muted ? '🔇' : '🔊';
    for (let s = 0; s < 4; s++) renderSeat(s);
    renderCenter(prev);
    renderLobby();
    renderHand();
    renderActions();
    renderResult(prev);
  }

  function renderSeat(seat) {
    const el = seatEl(seat);
    const p = V.seats[seat];
    const isMe = seat === V.you;
    el.className = 'seat ' + ['me', 'right', 'top', 'left'][rel(seat)];
    if (!p) {
      const host = V.host === V.you && V.state !== 'playing';
      el.innerHTML = '<div class="empty-seat">+</div>' + (host ? '<div class="seat-acts"><button data-bot="' + seat + '">+ Bot</button><button data-inv="1">Undang</button></div>' : '<div class="plate"><div class="nm">Kosong</div></div>');
      return;
    }
    const playing = V.state === 'playing';
    const turn = playing && V.turn === seat;
    el.classList.toggle('turn', turn);
    el.classList.toggle('offline', !p.connected);
    const tags = [];
    if (V.host === seat) tags.push('<span class="tag">HOST</span>');
    if (p.bot) tags.push('<span class="tag bot">BOT</span>');
    if (V.state === 'result' && p.ready) tags.push('<span class="tag ready">SIAP</span>');
    if (!p.connected) tags.push('<span class="tag">OFFLINE</span>');
    const showCount = playing && p.inGame && !isMe;
    const kick = V.host === V.you && !isMe && !playing ? '<div class="seat-acts"><button data-kick="' + seat + '">Keluarkan</button></div>' : '';
    el.innerHTML =
      '<div class="ava-wrap"><div class="ring"></div><div class="avatar">' + esc(p.avatar) + '</div>' +
      (p.passed ? '<div class="passhand">✋</div>' : '') +
      '<div class="tags">' + tags.join('') + '</div></div>' +
      '<div class="plate"><div class="nm">' + esc(p.name) + '</div><div class="ch"><span class="coin"></span> ' + fmt(p.chips) + '</div></div>' +
      (showCount ? '<div class="count' + (p.count <= 3 ? ' warn' : '') + '">' + p.count + '</div>' : '') +
      (turn && !isMe ? '<div class="tmr">' + Math.ceil((deadline - Date.now()) / 1000) + '</div>' : '') + kick;
  }

  $('#table').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bot],[data-kick],[data-inv]');
    if (!b) return;
    if (b.dataset.bot) socket.emit('addBot', { seat: +b.dataset.bot });
    if (b.dataset.kick) socket.emit('kick', { seat: +b.dataset.kick });
    if (b.dataset.inv) share();
  });

  const SEAT_VEC = [[0, 40], [38, -5], [0, -38], [-38, -5]]; // where plays fly in from, in units of --u
  function renderCenter() {
    const c = $('#center');
    if (V.state !== 'playing') { c.innerHTML = ''; return; }
    const lp = V.lastPlay;
    if (!lp) {
      const who = V.seats[V.turn];
      const must = V.mustInclude != null ? '<br><span style="font-size:.7em">Wajib memakai ' + R.label(V.mustInclude) + '</span>' : '';
      c.innerHTML = '<div class="lead-msg"><div>' + (V.turn === V.you ? 'Giliranmu membuka ronde' : esc(who ? who.name : '') + ' membuka ronde') + must + '</div></div>';
      lastPlayKey = '';
      return;
    }
    const key = lp.seat + ':' + lp.cards.join(',');
    const isNew = key !== lastPlayKey;
    lastPlayKey = key;
    const hist = (V.history || []).slice(0, -1).slice(-2);
    let html = hist.map((h, i) => '<div class="play old" style="transform:translate(calc(-50% + ' + (i - hist.length) * 3 + 'px), calc(-50% - ' + (hist.length - i) * 6 + 'px)) rotate(' + ((i % 2 ? 1 : -1) * 4) + 'deg)">' + h.cards.map((x) => cardHTML(x)).join('') + '</div>').join('');
    const v = SEAT_VEC[rel(lp.seat)];
    html += '<div class="play' + (isNew ? ' new' : '') + '" style="transform:translate(-50%,-50%);--fx:calc(var(--u)*' + v[0] + ');--fy:calc(var(--u)*' + v[1] + ')">' + lp.cards.map((x) => cardHTML(x)).join('') + '</div>';
    c.innerHTML = html;
  }

  function banner(name) {
    const b = $('#banner');
    b.textContent = name.toUpperCase();
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  function renderLobby() {
    const el = $('#lobbyPanel');
    if (V.state !== 'lobby') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const isHost = V.host === V.you;
    const n = V.seats.filter(Boolean).length;
    el.innerHTML =
      '<h3>Kode Meja</h3><div class="code">' + V.code + '</div>' +
      '<div class="sub">Bagikan kode/link ke teman. ' + n + '/4 pemain di meja.</div>' +
      (isHost
        ? '<div class="stake-pick">' + V.stakes.map((s) => '<button data-stake="' + s + '" class="' + (s === V.stake ? 'on' : '') + '">' + fmt(s) + '</button>').join('') + '</div>' +
          '<div class="row"><button class="btn blue small" id="lobbyShare">🔗 Undang Teman</button><button class="btn green" id="startBtn"' + (n < 2 ? ' disabled' : '') + '>Mulai Main</button></div>' +
          (n < 2 ? '<div class="sub" style="margin-top:6px">Tunggu teman atau tambah Bot di kursi kosong</div>' : '')
        : '<div class="row"><button class="btn blue small" id="lobbyShare">🔗 Undang Teman</button></div><div class="sub" style="margin-top:6px">Menunggu host memulai…</div>');
    const sb = $('#startBtn'); if (sb) sb.onclick = () => { unlockAudio(); socket.emit('start'); };
    $('#lobbyShare').onclick = share;
    el.querySelectorAll('[data-stake]').forEach((b) => (b.onclick = () => socket.emit('stake', { stake: +b.dataset.stake })));
  }

  // hand: keep the player's own ordering stable between updates
  function syncHandOrder() {
    const hand = V.hand || [];
    const set = new Set(hand);
    handOrder = handOrder.filter((c) => set.has(c));
    const missing = hand.filter((c) => !handOrder.includes(c));
    if (missing.length) handOrder = R.sortHand(handOrder.concat(missing), sortMode);
    for (const c of [...selected]) if (!set.has(c)) selected.delete(c);
  }
  function renderHand() {
    const el = $('#hand');
    if (!V || V.state !== 'playing' || !V.hand.length) { el.innerHTML = ''; return; }
    syncHandOrder();
    const n = handOrder.length;
    const W = el.clientWidth;
    const u = parseFloat(getComputedStyle(stage).getPropertyValue('--u')) || 4;
    const cw = 21 * u;
    const step = n > 1 ? Math.min(cw * 0.98, (W - cw) / (n - 1)) : 0;
    const total = cw + step * (n - 1);
    const x0 = (W - total) / 2;
    el.innerHTML = handOrder.map((c, i) => {
      const cls = (selected.has(c) ? ' sel' : '') + (V.mustInclude === c ? ' must' : '') + (dealAnim ? ' deal' : '');
      return cardHTML(c, cls).replace('class="card', 'style="left:' + (x0 + i * step).toFixed(1) + 'px;z-index:' + i + ';animation-delay:' + (dealAnim ? i * 45 : 0) + 'ms" class="card');
    }).join('');
    if (dealAnim) setTimeout(() => (dealAnim = false), 50);
  }

  // tap or drag across cards to select
  let dragging = false, dragMode = true, dragSeen = new Set();
  function cardAt(x, y) { const t = document.elementFromPoint(x, y); return t && t.closest('#hand .card'); }
  function toggleCard(el, forceMode) {
    const id = +el.dataset.id;
    const on = forceMode != null ? forceMode : !selected.has(id);
    if (on) selected.add(id); else selected.delete(id);
    el.classList.toggle('sel', on);
    hintIdx = -1;
    renderActions();
    return on;
  }
  $('#hand').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.card'); if (!el) return;
    dragging = true; dragSeen = new Set([el.dataset.id]);
    dragMode = toggleCard(el);
    sfx.tick();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const el = cardAt(e.clientX, e.clientY);
    if (el && !dragSeen.has(el.dataset.id)) { dragSeen.add(el.dataset.id); toggleCard(el, dragMode); }
  });
  window.addEventListener('pointerup', () => (dragging = false));

  function myTurn() { return V && V.state === 'playing' && V.turn === V.you; }
  function lastEv() { return V.lastPlay ? R.evaluate(V.lastPlay.cards) : null; }

  // up to three suggestions, weakest first (like the "Kartu Tinggi / Sepasang" chips)
  function suggestions() {
    if (!myTurn()) return [];
    let cands = R.allCombos(V.hand);
    if (V.mustInclude != null) cands = cands.filter((c) => c.cards.includes(V.mustInclude));
    const le = lastEv();
    const str = (c) => (c.ev.kind === 'five' ? c.ev.type * 1e7 : 0) + c.ev.key;
    if (le) cands = cands.filter((c) => R.beats(c.ev, le)).sort((a, b) => str(a) - str(b));
    else {
      const first = R.suggest(V.hand, null, V.mustInclude);
      const low = Math.min(...V.hand);
      cands = cands.filter((c) => c.cards.includes(V.mustInclude != null ? V.mustInclude : low))
        .sort((a, b) => b.cards.length - a.cards.length || str(a) - str(b));
      if (first) cands.unshift({ cards: first, ev: R.evaluate(first) });
    }
    const out = [], seenKinds = new Map();
    for (const c of cands) {
      const sig = c.ev.kind + (c.ev.kind === 'five' ? c.ev.type : '') + ':' + c.cards.map(R.rankOf).join('.');
      if (out.some((o) => o.sig === sig)) continue;
      const k = c.ev.kind + c.ev.type;
      if ((seenKinds.get(k) || 0) >= (le ? 3 : 1)) continue;
      seenKinds.set(k, (seenKinds.get(k) || 0) + 1);
      out.push({ ...c, sig });
      if (out.length === 3) break;
    }
    return out;
  }
  const HINT_NAME = { single: 'Kartu Tinggi', pair: 'Sepasang', triple: 'Tiga Kembar' };

  function renderActions() {
    const act = $('#actions'), hints = $('#hints');
    if (!myTurn()) { act.classList.add('hidden'); hints.innerHTML = ''; return; }
    act.classList.remove('hidden');
    const sel = [...selected];
    const ev = R.evaluate(sel);
    let ok = !!ev && (!V.lastPlay || R.beats(ev, lastEv()));
    if (V.mustInclude != null && !sel.includes(V.mustInclude)) ok = false;
    $('#playBtn').disabled = !ok;
    $('#passBtn').disabled = !V.lastPlay;
    const sug = suggestions();
    hints.innerHTML = sug.map((s, i) => '<button class="hint' + (i === hintIdx ? ' on' : '') + '" data-h="' + i + '">' + miniHTML(s.cards) + '<span>' + (s.ev.kind === 'five' ? s.ev.name : HINT_NAME[s.ev.kind]) + '</span></button>').join('');
    hints.querySelectorAll('.hint').forEach((b) => (b.onclick = () => {
      const s = sug[+b.dataset.h];
      if (hintIdx === +b.dataset.h) return play(); // second tap plays it
      selected = new Set(s.cards); renderHand(); hintIdx = +b.dataset.h; renderActions();
    }));
  }

  function play() {
    if (!myTurn() || !selected.size) return;
    const cards = [...selected];
    socket.emit('play', { cards }, (res) => {
      if (res && res.error) toast(res.error, true);
      else { selected.clear(); hintIdx = -1; }
    });
  }
  $('#playBtn').onclick = play;
  $('#passBtn').onclick = () => {
    if (!myTurn()) return;
    socket.emit('pass', null, (res) => { if (res && res.error) toast(res.error, true); else { selected.clear(); renderHand(); } });
  };
  $('#sortBtn').onclick = () => {
    sortMode = sortMode === 'rank' ? 'suit' : 'rank';
    store.set('sort', sortMode);
    handOrder = R.sortHand(handOrder, sortMode);
    toast(sortMode === 'rank' ? 'Urutkan: nilai' : 'Urutkan: jenis');
    renderHand();
  };

  // timer ring + clock
  let lastSec = -1;
  function tick() {
    requestAnimationFrame(tick);
    if (!V || V.state !== 'playing') return;
    const left = Math.max(0, deadline - Date.now());
    const p = left / V.turnMs;
    const el = seatEl(V.turn);
    if (el) {
      el.style.setProperty('--p', p.toFixed(3));
      el.style.setProperty('--ringc', p > 0.5 ? '#4cff7a' : p > 0.25 ? '#ffd23f' : '#ff4b3a');
      const t = el.querySelector('.tmr'); if (t) t.textContent = Math.ceil(left / 1000);
    }
    const sec = Math.ceil(left / 1000);
    if (myTurn()) {
      $('#clockNum').textContent = sec;
      $('.clock').classList.toggle('low', sec <= 5);
      if (sec !== lastSec && sec <= 5 && sec > 0) sfx.tick();
    }
    lastSec = sec;
    const tk = V.gameNo + ':' + V.turn + ':' + (V.lastPlay ? V.lastPlay.cards.join() : '-');
    if (tk !== lastTurnKey) { lastTurnKey = tk; if (myTurn()) sfx.turn(); }
  }
  requestAnimationFrame(tick);

  // ---------- result ----------
  function renderResult() {
    const el = $('#result');
    if (V.state !== 'result' || !V.result) { el.classList.add('hidden'); return; }
    const r = V.result;
    const iWon = r.winner === V.you;
    const meReady = V.seats[V.you] && V.seats[V.you].ready;
    const waiting = V.seats.filter((p) => p && !p.ready).map((p) => p.name);
    el.classList.remove('hidden');
    el.innerHTML = '<div class="result-box"><div class="result-head"><div class="crown">👑</div><div class="title">' +
      (iWon ? 'KAMU MENANG!' : esc(V.seats[r.winner] ? V.seats[r.winner].name : 'Pemenang') + ' Menang') + '</div></div>' +
      '<div class="result-rows">' + r.rows.map((row) =>
        '<div class="rrow' + (row.winner ? ' win' : '') + '"><div class="avatar">' + esc(row.avatar) + '</div>' +
        '<div><div class="rn">' + esc(row.name) + (row.seat === V.you ? ' (kamu)' : '') + '</div><div class="rl">' +
        (row.winner ? 'Kartu habis 🏆' : 'Sisa ' + row.left + ' kartu · ' + row.points + ' poin') + '</div></div>' +
        '<div>' + (row.cards.length ? miniHTML(row.cards) : '') + '</div>' +
        '<div class="delta ' + (row.delta >= 0 ? 'pos' : 'neg') + '">' + (row.delta >= 0 ? '+' : '') + fmt(row.delta) + '</div></div>').join('') + '</div>' +
      '<div class="result-foot">' + (meReady ? '<span class="wait">Menunggu: ' + esc(waiting.join(', ')) + '</span>' : '<button class="btn green" id="readyBtn">Lanjut Main</button>') +
      '<button class="btn ghost small" id="resLeave" style="color:#1d6f6c;box-shadow:inset 0 0 0 2px #1d6f6c">Keluar</button></div></div>';
    const rb = $('#readyBtn'); if (rb) rb.onclick = () => socket.emit('ready');
    $('#resLeave').onclick = leave;
  }

  function coinsTo(seat) {
    const target = seatEl(seat); if (!target) return;
    const tr = target.querySelector('.avatar').getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const from = $('#pot').getBoundingClientRect();
    for (let i = 0; i < 14; i++) {
      const c = document.createElement('div');
      c.className = 'coin coin-fly';
      stage.appendChild(c);
      const toLocal = (x, y) => (stage.classList.contains('rotated') ? [y - sr.top, sr.right - x] : [x - sr.left, y - sr.top]);
      const [fx, fy] = toLocal(from.left + from.width / 2, from.top + from.height / 2);
      const [tx, ty] = toLocal(tr.left + tr.width / 2, tr.top + tr.height / 2);
      c.style.left = fx + (Math.random() * 40 - 20) + 'px'; c.style.top = fy + (Math.random() * 20 - 10) + 'px';
      setTimeout(() => { c.style.transform = 'translate(' + (tx - fx) + 'px,' + (ty - fy) + 'px)'; c.style.opacity = '0.2'; }, 30 + i * 40);
      setTimeout(() => c.remove(), 1200 + i * 40);
    }
  }

  // ---------- chat ----------
  $('#chatMenu').innerHTML = CHATS.map((t) => '<button>' + t + '</button>').join('');
  $('#chatBtn').onclick = () => $('#chatMenu').classList.toggle('hidden');
  $('#chatMenu').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; socket.emit('chat', { text: b.textContent }); $('#chatMenu').classList.add('hidden'); };
  function bubble(seat, text) {
    const el = seatEl(seat); if (!el) return;
    const b = document.createElement('div'); b.className = 'bubble'; b.textContent = text;
    el.appendChild(b); setTimeout(() => b.remove(), 3000);
  }

  // ---------- menu / share / rules ----------
  function share() {
    if (!V) return;
    const url = location.origin + location.pathname + '?room=' + V.code;
    const text = 'Ayo main Capsa Banting bareng! Kode meja: ' + V.code;
    if (navigator.share) navigator.share({ title: 'Capsa Banting', text, url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link meja disalin!'), () => prompt('Salin link ini:', url));
    else prompt('Salin link ini:', url);
  }
  function leave() {
    socket.emit('leave', null, () => {});
    V = null; setRoomUrl(null);
    $('#menu').classList.add('hidden'); $('#result').classList.add('hidden');
    showHome();
  }
  $('#shareBtn').onclick = share;
  $('#menuBtn').onclick = () => $('#menu').classList.remove('hidden');
  $('#closeMenu').onclick = () => $('#menu').classList.add('hidden');
  $('#leaveBtn').onclick = leave;
  $('#fsBtn').onclick = () => {
    $('#menu').classList.add('hidden');
    const d = document.documentElement;
    (d.requestFullscreen ? d.requestFullscreen() : Promise.reject()).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => toast('Layar penuh tidak didukung di browser ini'));
  };
  $('#soundBtn').onclick = () => { muted = !muted; store.set('muted', muted); $('#soundBtn').textContent = muted ? '🔇' : '🔊'; };

  const C = (s) => s.split(' ').map((t) => { const r = R.RANKS.indexOf(t.slice(0, -1)); const su = '♦♣♥♠'.indexOf(t.slice(-1)); return r * 4 + su; });
  const combo = (name, cards, note) => '<div class="combo"><b>' + name + '</b>' + miniHTML(C(cards)) + '<small>' + note + '</small></div>';
  $('#rules').innerHTML = '<div class="rules-box"><div class="rules-head">Aturan Capsa Banting<button id="rulesClose">✕</button></div><div class="rules-body">' +
    '<h4>Pengaturan &amp; Tujuan</h4><p>2 - 4 pemain, masing-masing dibagikan 13 kartu. Jadilah yang pertama menghabiskan semua kartu.</p>' +
    '<h4>Peringkat Kartu</h4><p>3 &lt; 4 &lt; 5 &lt; 6 &lt; 7 &lt; 8 &lt; 9 &lt; 10 &lt; J &lt; Q &lt; K &lt; A &lt; 2. Jika nilainya sama, bandingkan jenis: ♦ &lt; ♣ &lt; ♥ &lt; ♠. Kartu terendah 3♦, tertinggi 2♠.</p>' +
    '<h4>Cara Bermain</h4><p>Giliran pertama: pemain dengan kartu terendah memulai dan wajib memakai kartu itu. Giliran berjalan berlawanan arah jarum jam.</p>' +
    '<p><b>Buang</b>: kalahkan permainan sebelumnya dengan kombinasi yang sama (jumlah kartu sama) dengan nilai lebih tinggi. <b>Lewat</b>: lewati giliran; kamu tidak bisa ikut lagi sampai ronde berikutnya.</p>' +
    '<p><b>Ronde baru</b>: saat semua pemain lain lewat, pemain terakhir yang membuang kartu memulai ronde baru dengan kombinasi apa pun. Pemenang permainan sebelumnya membuka permainan berikutnya.</p>' +
    '<h4>Kombinasi</h4><div class="combos">' +
    combo('Tunggal', '4♠', '1 kartu') + combo('Sepasang', '4♥ 4♠', '2 kartu nilai sama') + combo('Tiga Kembar', '9♦ 9♠ 9♥', '3 kartu nilai sama') +
    combo('Urutan', '10♠ J♥ Q♣ K♦ A♠', '5 kartu berurutan (tanpa 2)') + combo('Flush', '3♠ 5♠ 7♠ 8♠ A♠', '5 kartu jenis sama') + combo('Full House', '4♥ 4♠ 9♦ 9♠ 9♥', 'tiga kembar + sepasang') +
    combo('Empat Kembar', '4♥ 9♣ 9♦ 9♠ 9♥', '4 kartu sama + 1 kartu') + combo('Straight Flush', '5♥ 6♥ 7♥ 8♥ 9♥', 'urutan jenis sama (tanpa 2)') + combo('Royal Flush', '10♠ J♠ Q♠ K♠ A♠', '10-J-Q-K-A jenis sama') +
    '</div><p>Urutan 5 kartu (rendah ke tinggi): Urutan &lt; Flush &lt; Full House &lt; Empat Kembar &lt; Straight Flush &lt; Royal Flush.</p>' +
    '<h4>Perbandingan</h4><p>Tunggal &amp; pasangan: bandingkan nilai, lalu jenis kartu tertinggi. Tiga kembar, full house, empat kembar: bandingkan nilai kartu kembarnya. Urutan &amp; straight flush: bandingkan kartu tertinggi (nilai lalu jenis). Flush: bandingkan jenis dulu, lalu kartu tertinggi. Royal flush: bandingkan jenis.</p>' +
    '<h4>Akhir Permainan</h4><p>Pemenang menerima pembayaran dari semua yang kalah. Pembayaran = Poin Penalti × Taruhan.</p>' +
    '<table><tr><th>Sisa Kartu</th><th>Penalti per Kartu</th></tr><tr><td>1 - 8</td><td>-1 Poin</td></tr><tr><td>9 - 12</td><td>-2 Poin</td></tr><tr><td>13</td><td>-3 Poin</td></tr></table>' +
    '<p>Contoh: sisa 10 kartu = 10 × 2 = 20 poin × taruhan.</p></div></div>';
  const openRules = () => $('#rules').classList.remove('hidden');
  $('#rulesBtn').onclick = openRules; $('#rulesBtnHome').onclick = openRules;
  $('#rules').addEventListener('click', (e) => { if (e.target.id === 'rulesClose' || e.target.id === 'rules') $('#rules').classList.add('hidden'); });

  layout();
  showHome();
})();