/* Capsa Banting Online — client */
(() => {
  const R = window.CapsaRules;
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage');
  const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🐨', '🐰', '🐻', '🦁', '🐷', '🐙', '🦄'];
  const TIERS = [
    { name: 'Santai', art: '🙂', mult: 250 },
    { name: 'Seru', art: '😎', mult: 500 },
    { name: 'Serius', art: '🔥', mult: 1000 },
    { name: 'Sultan', art: '👑', mult: 2000 },
    { name: 'Custom', art: '✏️', mult: 0 },
  ];
  const CHATS = ['Halo semua! 👋', 'Cepetan dong 😴', 'Mantap! 🔥', 'Waduh 😱', 'Hoki banget 🍀', 'GG 🤝', 'Sabar ya 😅', 'Ayo main lagi!'];

  // ---------- persistent identity ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('capsa.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('capsa.' + k, JSON.stringify(v)); } catch {} },
  };
  // account session (token from /api/login or /api/signup)
  let authToken = store.get('auth', null);
  const me = { user: null, stats: null };
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Gagal (' + res.status + ')'); e.status = res.status; throw e; }
    return data;
  }
  let muted = store.get('muted', false);

  // ---------- layout: always landscape ----------
  // Phones held upright get the table rotated; a tall desktop window gets a centered landscape table instead.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const portrait = h > w;
    const rotate = portrait && touch;
    let W = rotate ? h : w, H = rotate ? w : h;
    if (portrait && !touch) H = Math.min(h, Math.round(w * 0.56));
    stage.classList.toggle('rotated', rotate);
    stage.style.top = !rotate && H < h ? Math.round((h - H) / 2) + 'px' : '0px';
    stage.style.setProperty('--W', W + 'px');
    stage.style.setProperty('--H', H + 'px');
    // size by height, but keep everything inside narrow-ish landscape screens
    const u = Math.min(H / 100, W / 190);
    stage.style.setProperty('--u', u.toFixed(3) + 'px');
    if (V) renderHand();
  }
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(() => layout()).observe(document.documentElement);
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
    ceki: () => [988, 1319, 988, 1319].forEach((f, i) => beep(f, 0.09, 'square', 0.08, i * 0.1)),
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
  const num = (n) => Number(n).toLocaleString('id-ID');
  const pts = (n) => (n > 0 ? '+' : '') + n;
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

  function hello() {
    socket.emit('hello', { auth: authToken }, (res) => {
      me.user = (res && res.user) || null;
      if (me.user) refreshFriends();
      if (!me.user && authToken) { authToken = null; store.set('auth', null); }
      if (res && res.room) return;
      const want = new URLSearchParams(location.search).get('room');
      if (want && me.user) joinRoom(want);
      else { if (want) $('#codeInput').value = want.toUpperCase(); showHome(); }
    });
  }
  socket.on('connect', () => {
    $('#conn').classList.add('hidden');
    if (voice.on) { voiceStop(true); toast('Voice terputus, ketuk 🎤 untuk sambung lagi'); }
    hello();
  });
  socket.on('disconnect', () => $('#conn').classList.remove('hidden'));
  socket.on('toast', ({ msg, error }) => toast(msg, error));
  socket.on('kicked', () => { V = null; toast('Kamu dikeluarkan dari meja', true); setRoomUrl(null); showHome(); });
  let leftCode = null; // ignore late updates from a table we just left
  socket.on('state', (v) => {
    if (leftCode && v.code === leftCode) return;
    leftCode = null;
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
    if (fx.type === 'play') { sfx.card(); if (fx.kind === 'five' || fx.kind === 'dragon') banner(fx.name); }
    else if (fx.type === 'pass') sfx.pass();
    else if (fx.type === 'deal') sfx.deal();
    else if (fx.type === 'win') { if (V && fx.seat === V.you) sfx.win(); else sfx.lose(); }
    else if (fx.type === 'bonus') {
      const p = V && V.seats[fx.seat];
      bubble(fx.seat, fx.name + ' ' + fx.points, 'bonus');
      toast((p ? p.name : '') + ': ' + fx.name + ' ' + fx.points + ' poin');
      sfx.win();
    }
    else if (fx.type === 'ceki') {
      const p = V && V.seats[fx.seat];
      bubble(fx.seat, 'CEKI!', 'ceki');
      toast('🔔 ' + (p ? p.name : '') + ': CEKI! (sisa 1 kartu)');
      sfx.ceki();
    }
    else if (fx.type === 'newround') { /* table clears in render */ }
    else if (fx.type === 'twoSpade') {
      const p = V && V.seats[fx.seat];
      banner('2♠ MAIN LAGI');
      toast('♠ ' + (p ? p.name : '') + ' mengeluarkan 2♠, langsung main lagi');
    }
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
    renderAccount();
  }
  const stat = (label, value) => '<div class="st"><b>' + value + '</b><span>' + label + '</span></div>';
  const statsHTML = (s) => stat('Game', s.games || 0) + stat('Menang', s.wins || 0) + stat('Total poin', pts(s.points || 0)) +
    stat('Sesi', s.matches || 0) + stat('Bersih', ((s.net || 0) > 0 ? '+' : '') + num(s.net || 0));
  async function renderAccount() {
    const logged = !!me.user;
    $('#authBox').classList.toggle('hidden', logged);
    $('#meBox').classList.toggle('hidden', !logged);
    $('#home').classList.toggle('guest', !logged);
    if (!logged) return;
    const paint = () => {
      $('#avatarBtn').textContent = me.user.avatar;
      $('#meName').textContent = me.user.name;
      $('#meUser').textContent = '@' + me.user.username;
      if (me.stats) $('#meStats').innerHTML = statsHTML(me.stats);
    };
    paint();
    try { const d = await api('/me'); me.user = d.user; me.stats = d.stats; paint(); }
    catch (e) { if (e.status === 401) logoutLocal(); }
  }

  // login / signup
  let authMode = 'login';
  function setAuthMode(m) {
    authMode = m;
    $('#authBox').classList.toggle('signup', m === 'signup');
    document.querySelectorAll('.auth-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === m));
    $('#authBtn').textContent = m === 'signup' ? 'Daftar' : 'Masuk';
    $('#authPass').setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
  }
  document.querySelector('.auth-tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setAuthMode(b.dataset.tab); };
  $('#authBtn').onclick = async () => {
    const body = { username: $('#authUser').value.trim(), password: $('#authPass').value };
    if (authMode === 'signup') body.name = $('#authName').value.trim();
    if (!body.username || !body.password) return toast('Isi username dan password', true);
    $('#authBtn').disabled = true;
    try {
      const d = await api(authMode === 'signup' ? '/signup' : '/login', { method: 'POST', body });
      authToken = d.token; store.set('auth', authToken); me.user = d.user;
      $('#authPass').value = '';
      toast(authMode === 'signup' ? 'Akun dibuat. Selamat datang, ' + d.user.name + '!' : 'Selamat datang, ' + d.user.name + '!');
      hello();
    } catch (e) { toast(e.message, true); }
    finally { $('#authBtn').disabled = false; }
  };
  function logoutLocal() {
    authToken = null; store.set('auth', null); me.user = null; me.stats = null;
    renderAccount();
  }
  $('#logoutBtn').onclick = async () => {
    if (!(await ask({ title: 'Keluar akun?', text: 'Kamu bisa masuk lagi kapan saja.', ok: 'Keluar' }))) return;
    try { await api('/logout', { method: 'POST' }); } catch {}
    logoutLocal();
    socket.disconnect(); socket.connect();
  };
  const needLogin = () => { if (me.user) return false; toast('Masuk atau daftar dulu ya', true); return true; };
  function showTable() {
    $('#home').classList.add('hidden');
    $('#table').classList.remove('hidden');
  }
  $('#tiers').innerHTML = TIERS.map((t) =>
    '<button class="tier" data-mult="' + t.mult + '"><div class="t-head">' + t.name + '</div><div class="t-art">' + t.art + '</div><div class="t-stake">' + (t.mult ? 'x' + num(t.mult) : 'x ?') + '</div><div class="t-range">' + (t.mult ? '1 poin = ' + num(t.mult) : 'Atur sendiri') + '</div></button>').join('');
  // In-page dialogs: native confirm()/prompt() are blocked in many in-app browsers.
  function ask({ title, text, input, numeric = true, ok = 'Ya', cancel = 'Batal' }) {
    return new Promise((resolve) => {
      const el = $('#ask');
      el.innerHTML = '<div class="dialog ask-box"><div class="dlg-title">' + esc(title) + '</div>' + (text ? '<p>' + esc(text) + '</p>' : '') +
        (input != null ? '<input id="askInput"' + (numeric ? ' inputmode="numeric"' : ' readonly') + ' autocomplete="off" value="' + esc(input) + '">' : '') +
        '<div class="row"><button class="btn green" id="askOk">' + esc(ok) + '</button><button class="btn ghost dark" id="askNo">' + esc(cancel) + '</button></div></div>';
      el.classList.remove('hidden');
      const done = (v) => { el.classList.add('hidden'); el.innerHTML = ''; resolve(v); };
      $('#askOk').onclick = () => done(input != null ? $('#askInput').value : true);
      $('#askNo').onclick = () => done(input != null ? null : false);
      const i = $('#askInput');
      if (i) { i.focus(); i.select(); i.onkeydown = (e) => e.key === 'Enter' && $('#askOk').click(); }
    });
  }
  async function askMult(cur) {
    const v = await ask({ title: 'Pengali Custom', text: 'Masukkan pengali (1 - 1.000.000)', input: cur || '', ok: 'Simpan' });
    if (v == null) return 0;
    const m = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
    if (!(m >= 1 && m <= 1000000)) { toast('Pengali tidak valid', true); return 0; }
    return m;
  }
  $('#avatarPicker').innerHTML = AVATARS.map((a) => '<button data-a="' + a + '">' + a + '</button>').join('');
  $('#avatarBtn').onclick = () => {
    $('#avatarPicker').classList.toggle('hidden');
    [...$('#avatarPicker').children].forEach((b) => b.classList.toggle('on', me.user && b.dataset.a === me.user.avatar));
  };
  $('#avatarPicker').onclick = async (e) => {
    const a = e.target.closest('button'); if (!a || !me.user) return;
    $('#avatarPicker').classList.add('hidden');
    try { const d = await api('/me', { method: 'PATCH', body: { avatar: a.dataset.a } }); me.user = d.user; $('#avatarBtn').textContent = d.user.avatar; }
    catch (err) { toast(err.message, true); }
  };
  $('#tiers').onclick = async (e) => {
    const t = e.target.closest('.tier'); if (!t || needLogin()) return;
    const mult = +t.dataset.mult || await askMult();
    if (!mult) return;
    unlockAudio();
    socket.emit('create', { mult }, (res) => res && res.error && toast(res.error, true));
  };
  function joinRoom(code) {
    if (String(code).toUpperCase() === leftCode) leftCode = null;
    socket.emit('join', { code }, (res) => {
      if (res && res.error) { toast(res.error, true); setRoomUrl(null); showHome(); }
    });
  }
  $('#joinBtn').onclick = () => {
    const code = $('#codeInput').value.trim().toUpperCase();
    if (needLogin()) return;
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
    $('#stakeLbl').textContent = 'x' + num(v.mult);
    $('#potVal').textContent = 'x' + num(v.mult);
    $('#soundBtn').textContent = muted ? '🔇' : '🔊';
    for (let s = 0; s < 4; s++) renderSeat(s);
    renderCenter(prev);
    renderLobby();
    renderHand();
    renderActions();
    renderResult(prev);
    renderVote();
    renderFinal();
    if (!$('#history').classList.contains('hidden')) renderHistory();
  }

  function renderSeat(seat) {
    const el = seatEl(seat);
    const bubbles = [...el.querySelectorAll('.bubble')]; // keep chat bubbles across re-renders
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
      (p.voice ? '<div class="vbadge' + (p.muted ? ' muted' : '') + '">' + (p.muted ? '🔇' : '🎙️') + '</div>' : '') +
      (p.passed ? '<div class="passhand">✋</div>' : '') +
      '<div class="tags">' + tags.join('') + '</div></div>' +
      '<div class="plate"><div class="nm">' + esc(p.name) + '</div><div class="ch">⭐ ' + pts(p.score) + ' poin' + (p.bonus ? ' <span class="bn">' + p.bonus + '</span>' : '') + '</div></div>' +
      (showCount ? '<div class="count' + (p.count <= 3 ? ' warn' : '') + '">' + p.count + '</div>' : '') +
      (turn && !isMe ? '<div class="tmr">' + Math.ceil((deadline - Date.now()) / 1000) + '</div>' : '') + kick;
    bubbles.forEach((x) => el.appendChild(x));
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
    if (V.free) {
      const who = V.seats[lp.seat];
      html += '<div class="free-tag">2♠ · ' + (lp.seat === V.you ? 'Kamu main lagi!' : esc(who ? who.name : '') + ' main lagi') + '</div>';
    }
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
      '<div class="sub">Bagikan kode/link ke teman. ' + n + '/4 pemain di meja. Pengali x' + num(V.mult) + '</div>' +
      (isHost
        ? '<div class="stake-pick">' + V.mults.map((m) => '<button data-mult="' + m + '" class="' + (m === V.mult ? 'on' : '') + '">x' + num(m) + '</button>').join('') +
          '<button data-mult="custom" class="' + (V.mults.includes(V.mult) ? '' : 'on') + '">' + (V.mults.includes(V.mult) ? 'Custom' : 'x' + num(V.mult)) + '</button></div>' +
          '<div class="row"><button class="btn blue small" id="lobbyShare">🔗 Undang Teman</button><button class="btn green" id="startBtn"' + (n < 2 ? ' disabled' : '') + '>Mulai Main</button>' +
          (V.seats.some((p) => p && p.games) ? '<button class="btn ghost small" id="resetBtn">Reset Poin</button>' : '') + '</div>' +
          (n < 2 ? '<div class="sub" style="margin-top:6px">Tunggu teman atau tambah Bot di kursi kosong</div>' : '')
        : '<div class="row"><button class="btn blue small" id="lobbyShare">🔗 Undang Teman</button></div><div class="sub" style="margin-top:6px">Menunggu host memulai…</div>');
    const sb = $('#startBtn'); if (sb) sb.onclick = () => { unlockAudio(); socket.emit('start'); };
    const rb = $('#resetBtn'); if (rb) rb.onclick = async () => (await ask({ title: 'Reset Poin?', text: 'Semua poin dan riwayat akan direset ke 0.', ok: 'Reset' })) && socket.emit('resetScores');
    $('#lobbyShare').onclick = share;
    el.querySelectorAll('[data-mult]').forEach((b) => (b.onclick = async () => {
      const m = b.dataset.mult === 'custom' ? await askMult(V.mult) : +b.dataset.mult;
      if (m) socket.emit('mult', { mult: m });
    }));
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
    if (press && press.moving) { pendingHand = true; return; } // don't rebuild under a dragged card
    if (!V || V.state !== 'playing' || !V.hand.length) { el.innerHTML = ''; return; }
    syncHandOrder();
    const n = handOrder.length;
    const W = el.clientWidth;
    const u = parseFloat(getComputedStyle(stage).getPropertyValue('--u')) || 4;
    const cw = 21 * u;
    const step = n > 1 ? Math.min(cw * 0.98, (W - cw) / (n - 1)) : 0;
    const total = cw + step * (n - 1);
    const x0 = (W - total) / 2;
    handLayout = { x0, step };
    el.innerHTML = handOrder.map((c, i) => {
      const cls = (selected.has(c) ? ' sel' : '') + (V.mustInclude === c ? ' must' : '') + (dealAnim ? ' deal' : '');
      return cardHTML(c, cls).replace('class="card', 'style="left:' + (x0 + i * step).toFixed(1) + 'px;z-index:' + i + ';animation-delay:' + (dealAnim ? i * 45 : 0) + 'ms" class="card');
    }).join('');
    if (dealAnim) setTimeout(() => (dealAnim = false), 50);
  }

  // Hand: tap a card to select it; press and slide it sideways to move it and arrange your own groups.
  let handLayout = { x0: 0, step: 0 };
  let press = null, pendingHand = false;
  function stagePoint(e) {
    const r = stage.getBoundingClientRect();
    return stage.classList.contains('rotated') ? { x: e.clientY - r.top, y: r.right - e.clientX } : { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toggleCard(el) {
    const id = +el.dataset.id;
    const on = !selected.has(id);
    if (on) selected.add(id); else selected.delete(id);
    el.classList.toggle('sel', on);
    hintIdx = -1;
    renderActions();
  }
  function placeCards(skipId) {
    const els = [...$('#hand').children];
    handOrder.forEach((c, i) => {
      const el = els.find((x) => +x.dataset.id === c);
      if (el && c !== skipId) { el.style.left = (handLayout.x0 + i * handLayout.step).toFixed(1) + 'px'; el.style.zIndex = i; }
    });
  }
  $('#hand').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.card'); if (!el || press) return;
    e.preventDefault();
    press = { el, id: +el.dataset.id, x0: stagePoint(e).x, startLeft: parseFloat(el.style.left) || 0, moving: false, pointerId: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  $('#hand').addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    const dx = stagePoint(e).x - press.x0;
    if (!press.moving) {
      if (Math.abs(dx) < 12) return;
      press.moving = true;
      press.el.classList.add('dragging');
    }
    const left = press.startLeft + dx;
    press.el.style.left = left + 'px';
    const idx = Math.max(0, Math.min(handOrder.length - 1, Math.round((left - handLayout.x0) / (handLayout.step || 1))));
    const cur = handOrder.indexOf(press.id);
    if (idx !== cur) { handOrder.splice(cur, 1); handOrder.splice(idx, 0, press.id); placeCards(press.id); }
  });
  function endPress(e, cancelled) {
    if (!press || (e && e.pointerId !== press.pointerId)) return;
    const p = press; press = null;
    if (p.moving) { p.el.classList.remove('dragging'); sortMode = 'custom'; pendingHand = false; renderHand(); }
    else if (!cancelled) { toggleCard(p.el); sfx.tick(); }
    if (pendingHand) { pendingHand = false; renderHand(); }
  }
  $('#hand').addEventListener('pointerup', (e) => endPress(e));
  $('#hand').addEventListener('pointercancel', (e) => endPress(e, true));

  function myTurn() { return V && V.state === 'playing' && V.turn === V.you; }
  // after 2♠ the same player leads freely, so there is nothing to beat
  function lastEv() { return V.lastPlay && !V.free ? R.evaluate(V.lastPlay.cards) : null; }

  // up to three suggestions, weakest first (like the "Kartu Tinggi / Sepasang" chips)
  function suggestions() {
    if (!myTurn()) return [];
    let cands = R.allCombos(V.hand);
    if (V.mustInclude != null) cands = cands.filter((c) => c.cards.includes(V.mustInclude));
    const le = lastEv();
    const str = (c) => (c.ev.kind === 'five' ? c.ev.type * 1e7 : 0) + c.ev.key;
    if (le) cands = cands.filter((c) => R.beats(c.ev, le)).sort((a, b) => str(a) - str(b));
    else if (R.isDragon(V.hand)) {
      return [{ cards: [...V.hand], ev: R.evaluate(V.hand), sig: 'dragon' }];
    } else {
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
    let ok = !!ev && (!lastEv() || R.beats(ev, lastEv()));
    if (V.mustInclude != null && !sel.includes(V.mustInclude)) ok = false;
    $('#playBtn').disabled = !ok;
    $('#passBtn').disabled = !lastEv();
    const sug = suggestions();
    hints.innerHTML = sug.map((s, i) => '<button class="hint' + (i === hintIdx ? ' on' : '') + '" data-h="' + i + '">' + miniHTML(s.cards) + '<span>' + (s.ev.kind === 'five' || s.ev.kind === 'dragon' ? s.ev.name : HINT_NAME[s.ev.kind]) + '</span></button>').join('');
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
    if (voice.on && V) updateSpeaking();
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
    const winName = V.seats[r.winner] ? V.seats[r.winner].name : 'Pemenang';
    el.classList.remove('hidden');
    el.innerHTML = '<div class="result-box"><div class="result-head"><div class="crown">' + (r.dragon ? '🐉' : '👑') + '</div><div class="title">' +
      (iWon ? 'KAMU MENANG!' : esc(winName) + ' Menang') + '</div><div class="rsub">Pengali x' + num(r.mult) + ' · semakin rendah poin semakin bagus</div></div>' +
      '<div class="result-rows"><div class="rrow rhead"><span></span><span>Pemain</span><span>Sisa kartu</span><span>Game ini</span><span>Total</span></div>' +
      r.rows.map((row) =>
        '<div class="rrow' + (row.winner ? ' win' : '') + '"><div class="avatar">' + esc(row.avatar) + '</div>' +
        '<div><div class="rn">' + esc(row.name) + (row.seat === V.you ? ' (kamu)' : '') + (row.winner ? ' 🏆' : '') + '</div><div class="rl">' +
        row.items.map((i) => esc(i.label) + ' ' + pts(i.points)).join(' · ') + '</div></div>' +
        '<div>' + (row.cards.length ? miniHTML(row.cards) : '') + '</div>' +
        '<div class="delta ' + (row.points <= 0 ? 'pos' : 'neg') + '">' + pts(row.points) + '<small>' + num(row.points * r.mult) + '</small></div>' +
        '<div class="delta tot ' + (row.total <= 0 ? 'pos' : 'neg') + '">' + pts(row.total) + '<small>' + num(row.total * r.mult) + '</small></div></div>').join('') + '</div>' +
      '<div class="result-foot">' + (meReady ? '<span class="wait">Sudah konfirmasi. Menunggu: ' + esc(waiting.join(', ')) + '</span>' : '<button class="btn green" id="readyBtn">✔ Konfirmasi &amp; Lanjut</button>') +
      (V.host === V.you ? '<button class="btn red small" id="endBtn">🏁 Akhiri Permainan</button>' : '') +
      '<button class="btn ghost small dark" id="resHist">📜 Riwayat</button></div></div>';
    const rb = $('#readyBtn'); if (rb) rb.onclick = () => socket.emit('ready');
    const eb = $('#endBtn'); if (eb) eb.onclick = proposeEnd;
    $('#resHist').onclick = openHistory;
  }

  // ---------- end of session: vote, settlement, history ----------
  async function proposeEnd() {
    const ok = await ask({ title: '🏁 Akhiri Permainan?', text: 'Hitung pembayaran akhir dengan pengali x' + num(V.mult) + '. Semua pemain harus setuju.', ok: 'Akhiri', cancel: 'Batal' });
    if (ok) socket.emit('proposeEnd');
  }
  function renderVote() {
    const el = $('#vote');
    const v = V.endVote;
    if (!v || V.state === 'final') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '<div class="dialog vote-box"><div class="dlg-title">🏁 Akhiri Permainan?</div>' +
      '<p><b>' + esc(v.by) + '</b> mengusulkan mengakhiri keseluruhan permainan dan menghitung pembayaran (pengali x' + num(V.mult) + ').</p>' +
      '<p class="muted">Setuju: ' + esc(v.agreed.join(', ') || '-') + '<br>Menunggu: ' + esc(v.waiting.join(', ') || '-') + '</p>' +
      (v.myVote == null ? '<div class="row"><button class="btn green" id="voteYes">Setuju</button><button class="btn red" id="voteNo">Tolak</button></div>'
        : '<p class="muted">Kamu sudah memilih ' + (v.myVote ? 'Setuju' : 'Tolak') + '.</p>') + '</div>';
    const y = $('#voteYes'); if (y) y.onclick = () => socket.emit('voteEnd', { agree: true });
    const n = $('#voteNo'); if (n) n.onclick = () => socket.emit('voteEnd', { agree: false });
  }
  function historyTable(hist) {
    if (!hist.length) return '<p class="muted">Belum ada game.</p>';
    const names = [];
    hist.forEach((g) => g.rows.forEach((r) => { if (!names.includes(r.name)) names.push(r.name); }));
    const totals = names.map(() => 0);
    const body = hist.map((g) => '<tr><td>#' + g.no + '</td><td>' + esc(g.winner) + '</td>' + names.map((n, i) => {
      const r = g.rows.find((x) => x.name === n);
      if (!r) return '<td>-</td>';
      totals[i] += r.points;
      return '<td class="' + (r.points <= 0 ? 'good' : 'bad') + '" title="' + esc(r.detail) + '">' + pts(r.points) + '</td>';
    }).join('') + '</tr>').join('');
    return '<div class="tbl-wrap"><table class="hist"><tr><th>Game</th><th>Menang</th>' + names.map((n) => '<th>' + esc(n) + '</th>').join('') + '</tr>' + body +
      '<tr class="tot"><td colspan="2">Total poin</td>' + totals.map((t) => '<td class="' + (t <= 0 ? 'good' : 'bad') + '">' + pts(t) + '</td>').join('') + '</tr></table></div>';
  }
  function renderHistory() {
    $('#history').innerHTML = '<div class="rules-box"><div class="rules-head">📜 Riwayat Game<button id="histClose">✕</button></div><div class="rules-body">' +
      '<p class="muted">Pengali x' + num(V.mult) + ' · semakin rendah poin semakin bagus</p>' + historyTable(V.gameLog || []) + '</div></div>';
    $('#histClose').onclick = () => $('#history').classList.add('hidden');
  }
  function openHistory() { if (!V) return; renderHistory(); $('#history').classList.remove('hidden'); }
  function renderFinal() {
    const el = $('#final');
    if (V.state !== 'final' || !V.final) { el.classList.add('hidden'); return; }
    const f = V.final;
    const P = f.players; // sorted: #1 = highest points
    const score = (name) => P.find((p) => p.name === name).score;
    const money = (n) => (n > 0 ? '+' : '') + num(n);
    el.classList.remove('hidden');

    // 1) ranking
    const ranking = '<h4>Peringkat (' + f.games + ' game) · semakin rendah poin semakin bagus</h4><div class="tbl-wrap"><table class="hist"><tr><th>#</th><th>Pemain</th><th>Total poin</th><th>Menang</th><th>Bersih</th></tr>' +
      P.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(p.avatar) + ' ' + esc(p.name) + '</td><td class="' + (p.score <= 0 ? 'good' : 'bad') + '">' + pts(p.score) + '</td><td>' + p.wins + '</td><td class="' + (p.net >= 0 ? 'good' : 'bad') + '"><b>' + money(p.net) + '</b></td></tr>').join('') + '</table></div>';

    // 2) every pair: points difference x multiplier
    const pairs = '<h4>Selisih Poin per Pasangan</h4><div class="pays">' + f.pays.map((x) =>
      '<div class="pay"><div class="pay-calc">#' + x.fromRank + ' <b>' + esc(x.from) + '</b> (' + pts(score(x.from)) + ') − #' + x.toRank + ' <b>' + esc(x.to) + '</b> (' + pts(score(x.to)) + ')' +
      ' = <b>' + x.diff + ' poin</b> × ' + num(f.mult) + ' = <b class="amt">' + num(x.amount) + '</b></div>' +
      '<div class="pay-who">' + (x.amount > 0 ? '💸 ' + esc(x.from) + ' bayar ke ' + esc(x.to) + ' <b>' + num(x.amount) + '</b>' : 'Poin sama, tidak ada pembayaran') + '</div></div>').join('') + '</div>';

    // 3) per player: pays to / receives from each other player
    const perPlayer = '<h4>Rincian per Pemain</h4><div class="per-player">' + P.map((p) => {
      const out = f.pays.filter((x) => x.from === p.name && x.amount > 0);
      const inc = f.pays.filter((x) => x.to === p.name && x.amount > 0);
      return '<div class="pp"><div class="pp-name">' + esc(p.avatar) + ' ' + esc(p.name) + ' <span class="muted">(' + pts(p.score) + ' poin)</span></div>' +
        (out.length ? out.map((x) => '<div class="pp-line bad">Bayar ke ' + esc(x.to) + ': ' + x.diff + ' × ' + num(f.mult) + ' = −' + num(x.amount) + '</div>').join('') : '') +
        (inc.length ? inc.map((x) => '<div class="pp-line good">Terima dari ' + esc(x.from) + ': ' + x.diff + ' × ' + num(f.mult) + ' = +' + num(x.amount) + '</div>').join('') : '') +
        (!out.length && !inc.length ? '<div class="pp-line muted">Tidak ada pembayaran</div>' : '') +
        '<div class="pp-net ' + (p.net >= 0 ? 'good' : 'bad') + '">Bersih: ' + money(p.net) + '</div></div>';
    }).join('') + '</div>';

    // 4) matrix: row pays column
    const matrix = '<h4>Tabel Pembayaran (baris bayar ke kolom)</h4><div class="tbl-wrap"><table class="hist"><tr><th>Bayar \\ Terima</th>' + P.map((p) => '<th>' + esc(p.name) + '</th>').join('') + '</tr>' +
      P.map((r) => '<tr><th>' + esc(r.name) + '</th>' + P.map((c) => {
        if (r.name === c.name) return '<td class="muted">—</td>';
        const x = f.pays.find((y) => y.from === r.name && y.to === c.name);
        return x && x.amount ? '<td class="bad">' + num(x.amount) + '<br><small>' + x.diff + ' × ' + num(f.mult) + '</small></td>' : '<td class="muted">0</td>';
      }).join('') + '</tr>').join('') + '</table></div>';

    el.innerHTML = '<div class="rules-box"><div class="rules-head">🏁 Hasil Akhir · x' + num(f.mult) + '</div><div class="rules-body">' +
      ranking + pairs + perPlayer + matrix + '<h4>Riwayat per Game</h4>' + historyTable(V.gameLog || []) +
      '<div class="row final-acts">' + (V.host === V.you ? '<button class="btn green" id="newSess">Main Lagi (poin direset)</button>' : '<span class="muted">Menunggu host memulai sesi baru…</span>') +
      '<button class="btn ghost small dark" id="finLeave">Keluar</button></div></div></div>';
    const ns = $('#newSess'); if (ns) ns.onclick = async () => (await ask({ title: 'Main Lagi?', text: 'Sesi baru dimulai, poin & riwayat direset.', ok: 'Main Lagi' })) && socket.emit('newSession');
    $('#finLeave').onclick = leave;
  }
  $('#histBtn').onclick = openHistory;

  // ---------- my account history (saved in the database) ----------
  const panel = (title, body) => '<div class="rules-box"><div class="rules-head">' + title + '<button class="x">✕</button></div><div class="rules-body">' + body + '</div></div>';
  function matchCard(m) {
    const d = new Date(m.started_at);
    return '<div class="mcard"><div class="mhead"><b>' + d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) + '</b> · Meja ' + esc(m.room_code) +
      ' · x' + num(m.mult) + ' · ' + m.games + ' game · <span class="' + (m.ended_at ? 'good' : 'muted') + '">' + (m.ended_at ? 'Selesai' : 'Belum diakhiri') + '</span></div>' +
      '<div class="mplayers">' + (m.players || []).map((p) => '<span class="mp' + (me.user && p.user_id === me.user.id ? ' me' : '') + '">' +
        esc(p.avatar || '') + ' ' + esc(p.name) + (p.is_bot ? ' 🤖' : '') + ' <b class="' + (p.total_points <= 0 ? 'good' : 'bad') + '">' + pts(p.total_points) + '</b>' +
        (p.final_rank ? ' #' + p.final_rank : '') + (p.net != null ? ' · ' + (p.net > 0 ? '+' : '') + num(p.net) : '') + '</span>').join('') + '</div>' +
      '<button class="btn ghost small dark" data-match="' + m.id + '">Detail per game</button><div class="mdetail hidden"></div></div>';
  }
  // Pairwise settlement: higher points pay lower points (difference x multiplier).
  function computePays(list, mult) {
    const P = list.map((p) => ({ ...p, net: 0 })).sort((a, b) => b.score - a.score);
    const pays = [];
    for (let i = 0; i < P.length; i++) {
      for (let j = P.length - 1; j > i; j--) {
        const diff = P[i].score - P[j].score;
        const amount = diff * mult;
        pays.push({ from: P[i].name, to: P[j].name, fromRank: i + 1, toRank: j + 1, fromScore: P[i].score, toScore: P[j].score, diff, amount });
        P[i].net -= amount; P[j].net += amount;
      }
    }
    return { players: P, pays };
  }
  function paysHTML(s, mult) {
    return '<div class="pays">' + s.pays.map((x) =>
      '<div class="pay"><div class="pay-calc">#' + x.fromRank + ' <b>' + esc(x.from) + '</b> (' + pts(x.fromScore) + ') − #' + x.toRank + ' <b>' + esc(x.to) + '</b> (' + pts(x.toScore) + ')' +
      ' = <b>' + x.diff + ' poin</b> × ' + num(mult) + ' = <b class="amt">' + num(x.amount) + '</b></div>' +
      '<div class="pay-who">' + (x.amount > 0 ? '💸 ' + esc(x.from) + ' bayar ke ' + esc(x.to) + ' <b>' + num(x.amount) + '</b>' : 'Poin sama, tidak ada pembayaran') + '</div></div>').join('') + '</div>' +
      '<div class="nets">' + s.players.map((p) => '<span class="net ' + (p.net >= 0 ? 'good' : 'bad') + '">' + esc(p.name) + ': ' + (p.net > 0 ? '+' : '') + num(p.net) + '</span>').join('') + '</div>';
  }
  function matchDetailHTML(d) {
    const mult = d.match.mult;
    const total = computePays(d.players.map((p) => ({ name: p.name, score: p.total_points })), mult);
    const games = d.games.map((g) => ({ no: g.game_no, winner: g.winner_name, rows: g.rows.map((r) => ({ name: r.name, points: r.points, detail: r.detail })) }));
    return '<h5>Poin per Game</h5>' + historyTable(games) +
      '<h5>Pembayaran Akhir (total ' + d.games.length + ' game · x' + num(mult) + ')</h5>' + paysHTML(total, mult) +
      d.games.map((g) => {
        const rows = [...g.rows].sort((a, b) => a.points - b.points);
        const gs = computePays(rows.map((r) => ({ name: r.name, score: r.points })), mult);
        return '<div class="gcard"><div class="ghead">Game #' + g.game_no + ' · Menang <b>' + esc(g.winner_name) + '</b> 🏆</div>' +
          '<div class="tbl-wrap"><table class="hist"><tr><th>Pemain</th><th>Rincian</th><th>Poin</th><th>Nilai</th></tr>' +
          rows.map((r) => '<tr><td>' + esc(r.name) + (r.is_winner ? ' 🏆' : '') + '</td><td class="det">' + esc(r.detail || '') + '</td>' +
            '<td class="' + (r.points <= 0 ? 'good' : 'bad') + '">' + pts(r.points) + '</td><td>' + num(r.points * mult) + '</td></tr>').join('') + '</table></div>' +
          '<div class="gpays-title">Siapa bayar ke siapa di game ini</div>' + paysHTML(gs, mult) + '</div>';
      }).join('') +
      '<p class="muted">Pembayaran semua game dijumlahkan = pembayaran akhir.</p>';
  }
  async function toggleMatch(btn) {
    const det = btn.nextElementSibling;
    if (!det.classList.contains('hidden')) { det.classList.add('hidden'); return; }
    det.classList.remove('hidden');
    det.innerHTML = '<p class="muted">Memuat…</p>';
    try {
      const d = await api('/match/' + btn.dataset.match);
      det.innerHTML = matchDetailHTML(d);
    } catch (e) { det.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
  }
  async function openMyHistory() {
    if (needLogin()) return;
    const el = $('#myHist');
    el.innerHTML = panel('📊 Riwayat Saya', '<p class="muted">Memuat…</p>');
    el.classList.remove('hidden');
    const body = el.querySelector('.rules-body');
    try {
      const [d, h] = await Promise.all([api('/me'), api('/history')]);
      body.innerHTML = '<div class="me-stats wide">' + statsHTML(d.stats) + '</div>' +
        '<h4>Teman Main</h4>' + (h.friends.length ? '<div class="friends">' + h.friends.map((f) => '<span class="friend">' + esc(f.avatar || '') + ' ' + esc(f.name) + ' <small>' + f.matches + ' sesi · ' + f.games + ' game</small></span>').join('') + '</div>' : '<p class="muted">Belum ada teman main.</p>') +
        '<h4>Sesi Bermain</h4>' + (h.matches.length ? h.matches.map(matchCard).join('') : '<p class="muted">Belum ada sesi. Ayo main!</p>');
      body.querySelectorAll('[data-match]').forEach((b) => (b.onclick = () => toggleMatch(b)));
    } catch (e) { body.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
  }
  $('#myHistBtn').onclick = openMyHistory;
  $('#myHist').addEventListener('click', (e) => { if (e.target.classList.contains('x') || e.target.id === 'myHist') $('#myHist').classList.add('hidden'); });

  // ---------- chat ----------
  $('#chatMenu').innerHTML = '<form class="chat-input" onsubmit="return false"><input id="chatText" maxlength="80" placeholder="Ketik pesan…" autocomplete="off" enterkeyhint="send">' +
    '<button id="chatSend" type="submit" class="btn green small">Kirim</button></form><div class="chat-presets">' + CHATS.map((t) => '<button type="button" class="preset">' + t + '</button>').join('') + '</div>';
  const sendReaction = (text) => {
    text = String(text || '').trim();
    if (!text) return;
    socket.emit('chat', { text });
    $('#chatText').value = '';
    $('#chatMenu').classList.add('hidden');
  };
  $('#chatBtn').onclick = () => { $('#chatMenu').classList.toggle('hidden'); if (!$('#chatMenu').classList.contains('hidden')) setTimeout(() => $('#chatText').focus(), 50); };
  $('#chatSend').onclick = () => sendReaction($('#chatText').value);
  $('#chatMenu').addEventListener('click', (e) => { const b = e.target.closest('.preset'); if (b) sendReaction(b.textContent); });
  function bubble(seat, text, cls) {
    const el = seatEl(seat); if (!el) return;
    const b = document.createElement('div'); b.className = 'bubble' + (cls ? ' ' + cls : ''); b.textContent = text;
    el.appendChild(b); setTimeout(() => b.remove(), cls === 'ceki' ? 4000 : 3000);
  }

  // ---------- menu / share / rules ----------
  function share() {
    if (!V) return;
    const url = location.origin + location.pathname + '?room=' + V.code;
    const text = 'Ayo main Capsa Banting bareng! Kode meja: ' + V.code;
    if (navigator.share) navigator.share({ title: 'Capsa Banting', text, url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link meja disalin!'), () => showLink(url));
    else showLink(url);
  }
  const showLink = (url) => ask({ title: 'Link Meja', text: 'Salin link ini dan kirim ke teman', input: url, numeric: false, ok: 'Tutup', cancel: 'Batal' });
  function leave() {
    leftCode = V ? V.code : null;
    voiceStop();
    socket.emit('leave', null, () => {});
    V = null; setRoomUrl(null);
    ['#menu', '#result', '#final', '#history', '#vote'].forEach((s) => $(s).classList.add('hidden'));
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
    '<p><b>2♠ main lagi</b>: pemain yang mengeluarkan 2♠ (tunggal, atau pair/three 2 yang berisi 2♠) langsung main lagi tanpa menunggu pemain lain lewat.</p>' +
    '<p><b>Ronde baru</b>: saat semua pemain lain lewat, pemain terakhir yang membuang kartu memulai ronde baru dengan kombinasi apa pun. Pemenang permainan sebelumnya membuka permainan berikutnya.</p>' +
    '<h4>Kombinasi</h4><div class="combos">' +
    combo('Tunggal', '4♠', '1 kartu') + combo('Sepasang', '4♥ 4♠', '2 kartu nilai sama') + combo('Tiga Kembar', '9♦ 9♠ 9♥', '3 kartu nilai sama') +
    combo('Urutan', '10♠ J♥ Q♣ K♦ A♠', '5 kartu berurutan (tanpa 2)') + combo('Flush', '3♠ 5♠ 7♠ 8♠ A♠', '5 kartu jenis sama') + combo('Full House', '4♥ 4♠ 9♦ 9♠ 9♥', 'tiga kembar + sepasang') +
    combo('Empat Kembar', '4♥ 9♣ 9♦ 9♠ 9♥', '4 kartu sama + 1 kartu') + combo('Straight Flush', '5♥ 6♥ 7♥ 8♥ 9♥', 'urutan jenis sama (tanpa 2)') + combo('Royal Flush', '10♠ J♠ Q♠ K♠ A♠', '10-J-Q-K-A jenis sama') +
    '</div><p>Urutan 5 kartu (rendah ke tinggi): Urutan &lt; Flush &lt; Full House &lt; Empat Kembar &lt; Straight Flush &lt; Royal Flush.</p>' +
    '<h4>Perbandingan</h4><p>Tunggal &amp; pasangan: bandingkan nilai, lalu jenis kartu tertinggi. Tiga kembar, full house, empat kembar: bandingkan nilai kartu kembarnya. Urutan &amp; straight flush: bandingkan kartu tertinggi (nilai lalu jenis). Flush: bandingkan jenis dulu, lalu kartu tertinggi. Royal flush: bandingkan jenis.</p>' +
    '<h4>Poin Akhir Permainan (semakin rendah semakin bagus)</h4>' +
    '<table><tr><th>Keadaan</th><th>Poin</th></tr>' +
    '<tr><td>Menang (kartu habis)</td><td>-10</td></tr>' +
    '<tr><td>Menang dengan menutup kartu 2 tunggal</td><td>-20</td></tr>' +
    '<tr><td>Menang dengan menutup pair 2</td><td>-10</td></tr>' +
    '<tr><td>Sisa 1 - 6 kartu</td><td>+jumlah kartu ×1</td></tr>' +
    '<tr><td>Sisa 7 - 9 kartu</td><td>+jumlah kartu ×2</td></tr>' +
    '<tr><td>Sisa 10 - 12 kartu</td><td>+jumlah kartu ×3</td></tr>' +
    '<tr><td>Sisa 13 kartu (full deck)</td><td>+13 ×4 = +52</td></tr>' +
    '<tr><td>Masih memegang kartu 2 saat game selesai</td><td>+10 per kartu 2</td></tr></table>' +
    '<h4>Bonus Paket (pengurangan tambahan)</h4>' +
    '<table><tr><th>Paket yang dikeluarkan</th><th>Poin</th></tr>' +
    '<tr><td>Empat Kembar (four of a kind)</td><td>-20</td></tr><tr><td>Straight Flush</td><td>-30</td></tr>' +
    '<tr><td>Royal Flush</td><td>-50</td></tr><tr><td>Dragon (13 kartu berurutan 3 - 2 saat dibagikan)</td><td>-70</td></tr></table>' +
    '<p>Bonus berlaku untuk siapa pun yang mengeluarkan paket, dan dijumlahkan. Contoh: menang tutup 2 (-20) dan sempat keluar empat kembar (-20) = -40.</p>' +
    '<p>Dragon dibuang sekaligus saat membuka ronde dan langsung menang dengan -70 saja (tanpa -10). Pemain lain dihitung sisa kartunya.</p>' +
    '<p>Contoh kalah: sisa 8 kartu termasuk dua kartu 2 = 8 ×2 + 2 ×10 = +36.</p>' +
    '<p><b>Ceki</b>: pemain yang tinggal 1 kartu otomatis mengumumkan "CEKI!".</p>' +
    '<p>Bermain bertiga: tetap 13 kartu per orang, 13 kartu sisanya disimpan di deck bandar dan tidak dimainkan. Aturan poin sama.</p>' +
    '<p>Nilai = poin × pengali meja (x250, x500, x1000, x2000 atau custom).</p>' +
    '<h4>Mengakhiri Permainan</h4><p>Setelah tiap game semua pemain mengonfirmasi hasil sebelum lanjut. Host bisa mengusulkan mengakhiri permainan, dan semua pemain harus setuju. ' +
    'Pemain diurutkan dari total poin tertinggi (#1) ke terendah (#4). Setiap pasangan dibayar: (poin pemain atas - poin pemain bawah) × pengali, dari pemain berpoin lebih tinggi ke yang lebih rendah: 1→4, 1→3, 1→2, 2→4, 2→3, 3→4.</p></div></div>';
  const openRules = () => $('#rules').classList.remove('hidden');
  $('#rulesBtn').onclick = openRules; $('#rulesBtnHome').onclick = openRules;
  $('#rules').addEventListener('click', (e) => { if (e.target.id === 'rulesClose' || e.target.id === 'rules') $('#rules').classList.add('hidden'); });

  // ---------- voice chat (WebRTC mesh between the players at the table) ----------
  const voice = { on: false, muted: false, stream: null, peers: new Map(), ice: null, ctx: null, meters: new Map() };
  const nameOf = (seat) => (V && V.seats[seat] ? V.seats[seat].name : 'pemain');
  async function iceServers() {
    if (!voice.ice) { try { voice.ice = (await api('/ice')).iceServers; } catch { voice.ice = [{ urls: 'stun:stun.l.google.com:19302' }]; } }
    return voice.ice;
  }
  function renderVoiceBtn() {
    const b = $('#voiceBtn');
    b.className = 'voice-btn ' + (!voice.on ? 'off' : voice.muted ? 'muted' : 'on');
    b.querySelector('.vi').textContent = !voice.on ? '🎤' : voice.muted ? '🔇' : '🎙️';
    b.querySelector('.vl').textContent = !voice.on ? 'Voice' : voice.muted ? 'Mute' : 'Aktif';
    $('#voiceOffBtn').classList.toggle('hidden', !voice.on);
  }
  async function voiceJoin() {
    if (!V) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) return toast('Browser ini tidak mendukung voice chat', true);
    try {
      voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch { return toast('Izin mikrofon ditolak. Izinkan mikrofon di pengaturan browser.', true); }
    await iceServers();
    try { voice.ctx = voice.ctx || new (window.AudioContext || window.webkitAudioContext)(); voice.ctx.resume(); } catch {}
    voice.on = true; voice.muted = false;
    meter('me', voice.stream);
    renderVoiceBtn();
    socket.emit('voice:join', null, async (res) => {
      if (!res || res.error) { toast(res ? res.error : 'Voice gagal', true); voiceStop(); return; }
      for (const seat of res.peers) { try { await callPeer(seat); } catch (e) { console.warn('voice call', e); } }
      toast('🎙️ Voice chat aktif' + (res.peers.length ? '' : ', menunggu pemain lain menyalakan voice'));
    });
  }
  function voiceStop(silent) {
    if (!voice.on) return;
    for (const seat of [...voice.peers.keys()]) closePeer(seat);
    if (voice.stream) voice.stream.getTracks().forEach((t) => t.stop());
    voice.stream = null; voice.on = false; voice.muted = false;
    voice.meters.clear();
    if (!silent) socket.emit('voice:leave');
    renderVoiceBtn();
  }
  function setMuted(m) {
    voice.muted = m;
    if (voice.stream) voice.stream.getAudioTracks().forEach((t) => (t.enabled = !m));
    socket.emit('voice:mute', { muted: m });
    renderVoiceBtn();
  }
  function closePeer(seat) {
    const pc = voice.peers.get(seat);
    if (pc) { try { pc.close(); } catch {} voice.peers.delete(seat); }
    const a = document.getElementById('va' + seat);
    if (a) a.remove();
    voice.meters.delete(seat);
  }
  function makePeer(seat) {
    closePeer(seat);
    const pc = new RTCPeerConnection({ iceServers: voice.ice });
    pc.pending = [];
    voice.stream.getTracks().forEach((t) => pc.addTrack(t, voice.stream));
    pc.onicecandidate = (e) => e.candidate && socket.emit('voice:signal', { to: seat, data: { candidate: e.candidate } });
    pc.ontrack = (e) => {
      let a = document.getElementById('va' + seat);
      if (!a) { a = document.createElement('audio'); a.id = 'va' + seat; a.autoplay = true; a.setAttribute('playsinline', ''); document.body.appendChild(a); }
      a.srcObject = e.streams[0];
      a.play().catch(() => toast('Ketuk layar untuk mendengar voice', true));
      meter(seat, e.streams[0]);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') toast('Voice ke ' + nameOf(seat) + ' gagal tersambung (jaringan)', true); };
    voice.peers.set(seat, pc);
    return pc;
  }
  async function flushCandidates(pc) { for (const c of pc.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {}); }
  async function callPeer(seat) {
    const pc = makePeer(seat);
    await pc.setLocalDescription(await pc.createOffer());
    socket.emit('voice:signal', { to: seat, data: { sdp: pc.localDescription } });
  }
  socket.on('voice:signal', async ({ from, data }) => {
    if (!voice.on) return;
    try {
      if (data.sdp && data.sdp.type === 'offer') {
        const pc = makePeer(from);
        await pc.setRemoteDescription(data.sdp);
        await flushCandidates(pc);
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('voice:signal', { to: from, data: { sdp: pc.localDescription } });
      } else if (data.sdp) {
        const pc = voice.peers.get(from);
        if (pc) { await pc.setRemoteDescription(data.sdp); await flushCandidates(pc); }
      } else if (data.candidate) {
        const pc = voice.peers.get(from);
        if (!pc) return;
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else pc.pending.push(data.candidate);
      }
    } catch (e) { console.warn('voice signal', e); }
  });
  socket.on('voice:joined', ({ seat }) => { if (voice.on) closePeer(seat); }); // they will call us
  socket.on('voice:left', ({ seat }) => closePeer(seat));
  // audio level meters for the "speaking" glow
  function meter(key, stream) {
    if (!voice.ctx) return;
    try {
      const src = voice.ctx.createMediaStreamSource(stream);
      const an = voice.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      voice.meters.set(key, { an, buf: new Uint8Array(an.fftSize) });
    } catch {}
  }
  function level(m) {
    m.an.getByteTimeDomainData(m.buf);
    let sum = 0;
    for (const v of m.buf) sum += (v - 128) * (v - 128);
    return Math.sqrt(sum / m.buf.length);
  }
  function updateSpeaking() {
    for (let s = 0; s < 4; s++) {
      const el = seatEl(s);
      const wrap = el && el.querySelector('.ava-wrap');
      if (!wrap) continue;
      const m = voice.meters.get(s === V.you ? 'me' : s);
      const talking = !!m && !(s === V.you && voice.muted) && level(m) > 6;
      wrap.classList.toggle('speaking', talking);
    }
  }
  $('#voiceBtn').onclick = () => { if (!voice.on) voiceJoin(); else setMuted(!voice.muted); };
  $('#voiceOffBtn').onclick = () => { voiceStop(); $('#menu').classList.add('hidden'); };

  // ---------- friends, presence and invites ----------
  let F = { friends: [], incoming: [], outgoing: [] };
  async function refreshFriends() {
    if (!me.user) return;
    try { F = await api('/friends'); } catch { return; }
    renderFriendBadges();
    if (!$('#friends').classList.contains('hidden')) renderFriends();
    if (dmWith) renderDmHeader();
  }
  function renderFriendBadges() {
    const n = F.incoming.length + F.friends.reduce((a, f) => a + (f.unread || 0), 0);
    document.querySelectorAll('#friendsBtn .badge, #friendsBtnTable .badge').forEach((b) => { b.textContent = n; b.classList.toggle('hidden', !n); });
  }
  function statusText(pr) {
    if (!pr || !pr.online) return '<span class="st-off">⚫ Offline</span>';
    if (pr.room && pr.state === 'playing') return '<span class="st-play">🟡 Sedang main · meja ' + esc(pr.room) + '</span>';
    if (pr.room) return '<span class="st-on">🟢 Online · di meja ' + esc(pr.room) + ' (' + pr.players + '/4)</span>';
    return '<span class="st-on">🟢 Online</span>';
  }
  function friendRow(f, actions) {
    return '<div class="frow"><div class="avatar fav">' + esc(f.avatar) + '</div><div class="finfo"><div class="fname">' + esc(f.name) + ' <small>@' + esc(f.username) + '</small></div>' +
      (f.presence ? '<div class="fstatus">' + statusText(f.presence) + '</div>' : '') + '</div><div class="facts">' + actions + '</div></div>';
  }
  function renderFriends() {
    const inRoom = !!(V && V.code);
    const body =
      '<form class="add-friend" onsubmit="return false"><input id="addFriendInput" placeholder="Username teman" autocapitalize="off" spellcheck="false" maxlength="21">' +
      '<button id="addFriendBtn" type="submit" class="btn green small">＋ Tambah</button></form>' +
      (F.incoming.length ? '<h4>Permintaan Pertemanan</h4>' + F.incoming.map((f) => friendRow(f,
        '<button class="btn green small" data-accept="' + f.id + '">Terima</button><button class="btn ghost small dark" data-remove="' + f.id + '" data-kind="decline">Tolak</button>')).join('') : '') +
      '<h4>Teman (' + F.friends.length + ')</h4>' +
      (F.friends.length ? F.friends.map((f) => {
        const canInvite = inRoom && f.presence.online && f.presence.room !== V.code;
        return friendRow(f,
          '<button class="btn blue small" data-chat="' + f.id + '">💬' + (f.unread ? ' <span class="badge">' + f.unread + '</span>' : '') + '</button>' +
          '<button class="btn green small" data-invite="' + f.id + '"' + (canInvite ? '' : ' disabled') + ' title="' + (inRoom ? 'Undang ke meja ' + V.code : 'Masuk meja dulu untuk mengundang') + '">✉️ Undang</button>' +
          '<button class="btn ghost small dark" data-remove="' + f.id + '" data-kind="remove" aria-label="Hapus teman">✕</button>');
      }).join('') : '<p class="muted">Belum ada teman. Tambahkan dengan username di atas.</p>') +
      (inRoom ? '' : '<p class="muted">Tips: buat atau masuk meja dulu, lalu undang teman yang online.</p>') +
      (F.outgoing.length ? '<h4>Menunggu Konfirmasi</h4>' + F.outgoing.map((f) => friendRow(f, '<button class="btn ghost small dark" data-remove="' + f.id + '" data-kind="cancel">Batalkan</button>')).join('') : '');
    const el = $('#friends');
    const keep = el.querySelector('#addFriendInput') ? el.querySelector('#addFriendInput').value : '';
    el.innerHTML = panel('👥 Teman', body);
    $('#addFriendInput').value = keep;
  }
  function openFriends() {
    if (needLogin()) return;
    renderFriends();
    $('#friends').classList.remove('hidden');
    refreshFriends();
  }
  $('#friendsBtn').onclick = openFriends;
  $('#friendsBtnTable').onclick = openFriends;
  $('#friends').addEventListener('click', async (e) => {
    if (e.target.classList.contains('x') || e.target.id === 'friends') return $('#friends').classList.add('hidden');
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.id === 'addFriendBtn') {
        const username = $('#addFriendInput').value.trim();
        if (!username) return toast('Ketik username teman', true);
        const r = await api('/friends', { method: 'POST', body: { username } });
        $('#addFriendInput').value = '';
        toast(r.message);
      } else if (b.dataset.accept) {
        await api('/friends/' + b.dataset.accept + '/accept', { method: 'POST' });
        toast('Pertemanan diterima');
      } else if (b.dataset.remove) {
        const f = [...F.friends, ...F.incoming, ...F.outgoing].find((x) => x.id === +b.dataset.remove);
        if (b.dataset.kind === 'remove' && !(await ask({ title: 'Hapus teman?', text: 'Hapus ' + (f ? f.name : '') + ' dari daftar teman?', ok: 'Hapus' }))) return;
        await api('/friends/' + b.dataset.remove, { method: 'DELETE' });
      } else if (b.dataset.chat) {
        openDm(+b.dataset.chat);
      } else if (b.dataset.invite) {
        socket.emit('invite', { friendId: +b.dataset.invite }, (r) => toast(r && r.error ? r.error : 'Undangan terkirim ✉️', !!(r && r.error)));
      }
      refreshFriends();
    } catch (err) { toast(err.message, true); }
  });
  socket.on('friends:update', refreshFriends);
  socket.on('friends:request', ({ from }) => { toast('📩 ' + from.name + ' (@' + from.username + ') ingin berteman'); sfx.turn(); });
  socket.on('presence', (pr) => {
    const f = F.friends.find((x) => x.id === pr.userId);
    if (!f) return;
    const wasOnline = f.presence && f.presence.online;
    f.presence = pr;
    if (pr.online && !wasOnline) toast('🟢 ' + f.name + ' sekarang online');
    if (!$('#friends').classList.contains('hidden')) renderFriends();
    if (dmWith === f.id) renderDmHeader();
  });
  socket.on('invite', async (inv) => {
    sfx.turn();
    const playing = V && V.state === 'playing';
    const ok = await ask({
      title: '✉️ Undangan Main',
      text: inv.from.name + ' mengundangmu ke meja ' + inv.room + ' (x' + num(inv.mult) + ', ' + inv.players + '/4 pemain).' + (playing ? ' Kamu sedang main, kartumu akan dimainkan bot jika pindah.' : ''),
      ok: 'Gabung', cancel: 'Nanti',
    });
    if (!ok) return;
    if (V && V.code === inv.room) return;
    voiceStop();
    joinRoom(inv.room);
  });

  // ---------- direct messages between friends ----------
  let dmWith = null, dmMsgs = [];
  const fmtTime = (t) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (t) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  function renderDmHeader() {
    const f = F.friends.find((x) => x.id === dmWith);
    const h = $('#dm .dm-head');
    if (h && f) h.innerHTML = '<button class="dm-back" aria-label="Kembali">‹</button><div class="avatar fav">' + esc(f.avatar) + '</div><div><div class="fname">' + esc(f.name) + '</div><div class="fstatus">' + statusText(f.presence) + '</div></div>';
  }
  function renderDmList() {
    const list = $('#dmList'); if (!list) return;
    let lastDay = '';
    list.innerHTML = dmMsgs.length ? dmMsgs.map((m) => {
      const day = fmtDay(m.created_at);
      const sep = day !== lastDay ? '<div class="dm-day">' + day + '</div>' : '';
      lastDay = day;
      return sep + '<div class="dm-msg ' + (m.from_id === me.user.id ? 'mine' : 'theirs') + '"><span>' + esc(m.body) + '</span><time>' + fmtTime(m.created_at) + '</time></div>';
    }).join('') : '<p class="muted center">Belum ada pesan. Sapa temanmu! 👋</p>';
    list.scrollTop = list.scrollHeight;
  }
  async function openDm(friendId) {
    const f = F.friends.find((x) => x.id === friendId);
    if (!f) return;
    dmWith = friendId; dmMsgs = [];
    const el = $('#dm');
    el.innerHTML = '<div class="rules-box dm-box"><div class="dm-head"></div><div id="dmList" class="dm-list"><p class="muted center">Memuat…</p></div>' +
      '<form class="dm-form" onsubmit="return false"><input id="dmText" maxlength="500" placeholder="Tulis pesan…" autocomplete="off" enterkeyhint="send"><button id="dmSend" type="submit" class="btn green small">Kirim</button></form></div>';
    el.classList.remove('hidden');
    renderDmHeader();
    try { dmMsgs = (await api('/messages/' + friendId)).messages; } catch (e) { toast(e.message, true); }
    f.unread = 0; renderFriendBadges();
    renderDmList();
    $('#dmText').focus();
  }
  function closeDm() { dmWith = null; $('#dm').classList.add('hidden'); $('#dm').innerHTML = ''; if (!$('#friends').classList.contains('hidden')) renderFriends(); }
  $('#dm').addEventListener('click', async (e) => {
    if (e.target.id === 'dm' || e.target.closest('.dm-back')) return closeDm();
    if (e.target.id === 'dmSend') {
      const input = $('#dmText');
      const body = input.value.trim();
      if (!body || !dmWith) return;
      input.value = '';
      try { await api('/messages/' + dmWith, { method: 'POST', body: { body } }); }
      catch (err) { toast(err.message, true); input.value = body; }
    }
  });
  socket.on('dm', (m) => {
    const other = m.from_id === me.user.id ? m.to_id : m.from_id;
    if (dmWith === other) {
      if (!dmMsgs.some((x) => x.id === m.id)) { dmMsgs.push(m); renderDmList(); }
      if (m.from_id !== me.user.id) api('/messages/' + other + '/read', { method: 'POST' }).catch(() => {});
      return;
    }
    if (m.from_id !== me.user.id) {
      const f = F.friends.find((x) => x.id === other);
      if (f) { f.unread = (f.unread || 0) + 1; renderFriendBadges(); if (!$('#friends').classList.contains('hidden')) renderFriends(); }
      toast('💬 ' + m.from.name + ': ' + m.body.slice(0, 60));
      sfx.tick();
    }
  });

  layout();
  showHome();
})();