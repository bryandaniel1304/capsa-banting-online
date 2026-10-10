// Capsa Banting rules engine — shared by server (authoritative) and client (hints / button state).
// Card id = rank * 4 + suit. Ranks 0..12 => 3 4 5 6 7 8 9 10 J Q K A 2. Suits 0..3 => ♦ ♣ ♥ ♠.
// Every table has its own rules (see DEFAULT_RULES); make(rules) returns the game logic for those rules.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CapsaRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const SUITS = ['♦', '♣', '♥', '♠'];
  const RANK_TWO = 12;
  const RANK_ACE = 11;
  const TWO_SPADE = RANK_TWO * 4 + 3;

  // 5-card types, weakest to strongest (Perbandingan 5 Kartu)
  const FIVE = { STRAIGHT: 1, FLUSH: 2, FULL_HOUSE: 3, FOUR: 4, STRAIGHT_FLUSH: 5, ROYAL: 6 };
  const FIVE_NAMES = { 1: 'Urutan', 2: 'Flush', 3: 'Full House', 4: 'Empat Kembar', 5: 'Straight Flush', 6: 'Royal Flush' };

  // App default rules. Scoring: lower is better.
  const DEFAULT_RULES = Object.freeze({
    turnSec: 20,
    suitOrder: 'DCHS', // ♦ < ♣ < ♥ < ♠  (alternative 'CDHS': ♣ < ♦ < ♥ < ♠)
    firstLowest: true, // first game: holder of the lowest card leads and must play it
    winnerLeads: true, // the previous winner opens the next game
    passLock: true, // after passing you sit out until the round ends
    twoSpadeFree: true, // 2♠ (single, or pair/triple of 2s with 2♠) plays again right away
    dragon: true, // 13 different ranks may be played at once and win immediately
    flushTwoHigh: false, // variant: a flush that contains a 2 beats any flush without a 2
    winPoints: -10,
    winTwoOn: true, // closing the game with a single 2 scores winTwoPoints instead
    winTwoPoints: -20,
    tiers: Object.freeze([{ upTo: 6, x: 1 }, { upTo: 9, x: 2 }, { upTo: 12, x: 3 }, { upTo: 13, x: 4 }]),
    twoLeftPoints: 10, // per 2 still in hand at the end
    bonusFour: -20,
    bonusStraightFlush: -30,
    bonusRoyal: -50,
    bonusDragon: -70, // a dragon win scores only this (no win points)
  });

  const int = (v, min, max, def) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);

  // Validate / clamp rules coming from a client or the database.
  function normalizeRules(input) {
    const r = input && typeof input === 'object' ? input : {};
    const d = DEFAULT_RULES;
    const out = {
      turnSec: int(r.turnSec, 10, 90, d.turnSec),
      suitOrder: r.suitOrder === 'CDHS' ? 'CDHS' : 'DCHS',
      firstLowest: bool(r.firstLowest, d.firstLowest),
      winnerLeads: bool(r.winnerLeads, d.winnerLeads),
      passLock: bool(r.passLock, d.passLock),
      twoSpadeFree: bool(r.twoSpadeFree, d.twoSpadeFree),
      dragon: bool(r.dragon, d.dragon),
      flushTwoHigh: bool(r.flushTwoHigh, d.flushTwoHigh),
      winPoints: int(r.winPoints, -200, 0, d.winPoints),
      winTwoOn: bool(r.winTwoOn, d.winTwoOn),
      winTwoPoints: int(r.winTwoPoints, -300, 0, d.winTwoPoints),
      twoLeftPoints: int(r.twoLeftPoints, 0, 200, d.twoLeftPoints),
      bonusFour: int(r.bonusFour, -300, 0, d.bonusFour),
      bonusStraightFlush: int(r.bonusStraightFlush, -300, 0, d.bonusStraightFlush),
      bonusRoyal: int(r.bonusRoyal, -500, 0, d.bonusRoyal),
      bonusDragon: int(r.bonusDragon, -500, 0, d.bonusDragon),
    };
    // remaining-card tiers: ascending "up to N cards -> xM", the last one always covers 13
    let tiers = Array.isArray(r.tiers) ? r.tiers.slice(0, 6).map((t) => ({ upTo: int(t && t.upTo, 1, 13, 13), x: int(t && t.x, 0, 20, 1) })) : null;
    if (tiers && tiers.length) {
      tiers.sort((a, b) => a.upTo - b.upTo);
      tiers = tiers.filter((t, i) => i === 0 || t.upTo > tiers[i - 1].upTo);
      tiers[tiers.length - 1].upTo = 13;
    } else tiers = d.tiers.map((t) => ({ ...t }));
    out.tiers = tiers;
    return out;
  }
  const sameRules = (a, b) => JSON.stringify(normalizeRules(a)) === JSON.stringify(normalizeRules(b));

  const rankOf = (c) => c >> 2;
  const suitOf = (c) => c & 3;
  const isRed = (c) => suitOf(c) === 0 || suitOf(c) === 2;
  const label = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];
  const twosLeft = (hand) => hand.filter((c) => rankOf(c) === RANK_TWO).length;

  function newDeck() {
    const d = [];
    for (let i = 0; i < 52; i++) d.push(i);
    return d;
  }
  function shuffle(a, rnd = Math.random) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function combinations(arr, k, start = 0, cur = [], out = []) {
    if (cur.length === k) { out.push(cur.slice()); return out; }
    for (let i = start; i <= arr.length - (k - cur.length); i++) {
      cur.push(arr[i]);
      combinations(arr, k, i + 1, cur, out);
      cur.pop();
    }
    return out;
  }

  // Game logic bound to one table's rules.
  function make(input) {
    const rules = normalizeRules(input);
    const suitRank = rules.suitOrder === 'CDHS' ? [1, 0, 2, 3] : [0, 1, 2, 3]; // indexed by suit id ♦ ♣ ♥ ♠
    const pw = (c) => rankOf(c) * 4 + suitRank[suitOf(c)]; // single-card strength
    const byPw = (a, b) => pw(a) - pw(b);
    const lowestCard = (cards) => cards.reduce((m, c) => (m == null || pw(c) < pw(m) ? c : m), null);
    const isDragon = (cards) => cards.length === 13 && new Set(cards.map(rankOf)).size === 13;

    // Returns { kind, count, type, key, name } or null when the cards are not a legal combination.
    function evaluate(cards) {
      if (!Array.isArray(cards)) return null;
      const cs = [...cards].sort(byPw);
      const n = cs.length;
      if (new Set(cs).size !== n) return null;
      const ranks = cs.map(rankOf);
      if (n === 13) return rules.dragon && isDragon(cs) ? { kind: 'dragon', count: 13, type: 0, key: 0, name: 'Dragon' } : null;
      if (n === 1) return { kind: 'single', count: 1, type: 0, key: pw(cs[0]), name: 'Tunggal' };
      if (n === 2) {
        if (ranks[0] !== ranks[1]) return null;
        return { kind: 'pair', count: 2, type: 0, key: pw(cs[1]), name: 'Sepasang' };
      }
      if (n === 3) {
        if (ranks[0] !== ranks[2]) return null;
        return { kind: 'triple', count: 3, type: 0, key: ranks[0], name: 'Tiga Kembar' };
      }
      if (n !== 5) return null;
      const suits = cs.map(suitOf);
      const flush = suits.every((s) => s === suits[0]);
      let straight = true;
      for (let i = 1; i < 5; i++) if (ranks[i] !== ranks[0] + i) straight = false;
      if (ranks[4] === RANK_TWO) straight = false; // no 2 in a straight
      const top = cs[4];
      const counts = {};
      ranks.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
      const groups = Object.entries(counts).map(([r, c]) => ({ r: +r, c })).sort((a, b) => b.c - a.c || b.r - a.r);
      let type = 0;
      let key = 0;
      if (straight && flush) {
        if (ranks[4] === RANK_ACE) { type = FIVE.ROYAL; key = suitRank[suits[0]]; }
        else { type = FIVE.STRAIGHT_FLUSH; key = pw(top); }
      } else if (groups[0].c === 4) {
        type = FIVE.FOUR; key = groups[0].r;
      } else if (groups[0].c === 3 && groups[1].c === 2) {
        type = FIVE.FULL_HOUSE; key = groups[0].r;
      } else if (flush) {
        type = FIVE.FLUSH; // compare suit first, then highest ranks
        key = suitRank[suits[0]];
        if (rules.flushTwoHigh && ranks.includes(RANK_TWO)) key += 4; // variant: flushes holding a 2 rank above all others
        for (let i = 4; i >= 0; i--) key = key * 13 + ranks[i];
      } else if (straight) {
        type = FIVE.STRAIGHT; key = pw(top);
      } else return null;
      return { kind: 'five', count: 5, type, key, name: FIVE_NAMES[type] };
    }

    function beats(a, b) {
      if (!a) return false;
      if (!b) return true;
      if (a.count !== b.count) return false;
      if (a.kind === 'five' && a.type !== b.type) return a.type > b.type;
      return a.key > b.key;
    }

    function bonusFor(ev) {
      if (!ev) return 0;
      if (ev.kind === 'dragon') return rules.bonusDragon;
      if (ev.kind !== 'five') return 0;
      return { 4: rules.bonusFour, 5: rules.bonusStraightFlush, 6: rules.bonusRoyal }[ev.type] || 0;
    }
    function penaltyPerCard(left) {
      if (left <= 0) return 0;
      const t = rules.tiers.find((x) => left <= x.upTo);
      return t ? t.x : rules.tiers[rules.tiers.length - 1].x;
    }
    const penaltyPoints = (left) => left * penaltyPerCard(left);
    // Winner's base points; a pair of 2s is not "closing with a 2"; a dragon win scores only its bonus.
    function winPoints(finalEv, finalCards) {
      if (finalEv && finalEv.kind === 'dragon') return 0;
      if (rules.winTwoOn && finalEv && finalEv.kind === 'single' && rankOf(finalCards[0]) === RANK_TWO) return rules.winTwoPoints;
      return rules.winPoints;
    }
    const twoLeftPenalty = (hand) => twosLeft(hand) * rules.twoLeftPoints;
    // 2♠ alone (or a pair/triple of 2s holding 2♠) can't be beaten: that player plays again.
    const freeTurnAfter = (ev, cards) => rules.twoSpadeFree && !!ev && cards.includes(TWO_SPADE) && (ev.kind === 'single' || ev.kind === 'pair' || ev.kind === 'triple');

    function allCombos(hand) {
      const h = [...hand].sort(byPw);
      const out = [];
      for (const k of [1, 2, 3, 5]) {
        if (h.length < k) continue;
        for (const cs of combinations(h, k)) {
          const ev = evaluate(cs);
          if (ev) out.push({ cards: cs, ev });
        }
      }
      return out;
    }
    const strength = (c) => (c.ev.kind === 'five' ? c.ev.type * 1e7 : 0) + c.ev.key;
    const topPw = (cards) => Math.max(...cards.map(pw));

    // Suggest a play (array of card ids) or null (pass).
    function suggest(hand, lastEv, mustInclude) {
      if (!lastEv && rules.dragon && isDragon(hand)) return [...hand].sort(byPw);
      let cands = allCombos(hand);
      if (mustInclude != null) cands = cands.filter((c) => c.cards.includes(mustInclude));
      if (lastEv) {
        cands = cands.filter((c) => beats(c.ev, lastEv));
        if (!cands.length) return null;
        cands.sort((a, b) => strength(a) - strength(b));
        return cands[0].cards;
      }
      if (!cands.length) return null;
      const lowest = lowestCard(hand);
      let lead = cands.filter((c) => c.cards.includes(lowest));
      const noTwo = lead.filter((c) => !c.cards.some((x) => rankOf(x) === RANK_TWO));
      if (noTwo.length) lead = noTwo;
      lead.sort((a, b) => b.cards.length - a.cards.length || topPw(a.cards) - topPw(b.cards));
      return lead[0].cards;
    }

    function sortHand(hand, mode) {
      const h = [...hand];
      if (mode === 'suit') h.sort((a, b) => suitRank[suitOf(a)] - suitRank[suitOf(b)] || rankOf(a) - rankOf(b));
      else h.sort(byPw);
      return h;
    }

    return {
      rules, pw, lowestCard, evaluate, beats, isDragon, bonusFor, penaltyPerCard, penaltyPoints, winPoints,
      twoLeftPenalty, freeTurnAfter, allCombos, suggest, sortHand,
      suitsAscending: [0, 1, 2, 3].sort((a, b) => suitRank[a] - suitRank[b]).map((s) => SUITS[s]),
    };
  }

  const base = make(DEFAULT_RULES);
  return {
    RANKS, SUITS, FIVE, FIVE_NAMES, RANK_TWO, TWO_SPADE, DEFAULT_RULES,
    normalizeRules, sameRules, make,
    rankOf, suitOf, isRed, label, newDeck, shuffle, twosLeft,
    // default-rules logic (kept for convenience and tests)
    evaluate: base.evaluate, beats: base.beats, isDragon: base.isDragon, bonusFor: base.bonusFor,
    penaltyPerCard: base.penaltyPerCard, penaltyPoints: base.penaltyPoints, winPoints: base.winPoints,
    freeTurnAfter: base.freeTurnAfter, allCombos: base.allCombos, suggest: base.suggest, sortHand: base.sortHand,
    TWO_LEFT_POINTS: DEFAULT_RULES.twoLeftPoints, WIN_WITH_TWO_POINTS: DEFAULT_RULES.winTwoPoints,
  };
});