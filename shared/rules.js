// Capsa Banting rules engine — shared by server (authoritative) and client (hints / button state).
// Card id = rank * 4 + suit. Ranks 0..12 => 3 4 5 6 7 8 9 10 J Q K A 2. Suits 0..3 => ♦ ♣ ♥ ♠.
// Ordering card ids numerically gives the exact single-card order (rank first, then suit).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CapsaRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const SUITS = ['♦', '♣', '♥', '♠'];
  const RANK_TWO = 12;
  const RANK_ACE = 11;

  // 5-card types, weakest to strongest (Perbandingan 5 Kartu)
  const FIVE = { STRAIGHT: 1, FLUSH: 2, FULL_HOUSE: 3, FOUR: 4, STRAIGHT_FLUSH: 5, ROYAL: 6 };
  const FIVE_NAMES = { 1: 'Urutan', 2: 'Flush', 3: 'Full House', 4: 'Empat Kembar', 5: 'Straight Flush', 6: 'Royal Flush' };

  // Scoring (lower is better)
  const WIN_POINTS = -10;
  const WIN_WITH_TWO_POINTS = -20; // game closed with a single 2
  const DRAGON_POINTS = -70; // dragon win is -70 only (no extra -10)
  const TWO_LEFT_POINTS = 10; // per 2 still in hand when the game ends
  const BONUS = { 4: -20, 5: -30, 6: -50 }; // Empat Kembar, Straight Flush, Royal Flush

  const rankOf = (c) => c >> 2;
  const suitOf = (c) => c & 3;
  const isRed = (c) => suitOf(c) === 0 || suitOf(c) === 2;
  const label = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];

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

  // Returns { kind, count, type, key, name } or null when the cards are not a legal combination.
  function evaluate(cards) {
    if (!Array.isArray(cards)) return null;
    const cs = [...cards].sort((a, b) => a - b);
    const n = cs.length;
    if (new Set(cs).size !== n) return null;
    const ranks = cs.map(rankOf);

    if (n === 13) return isDragon(cs) ? { kind: 'dragon', count: 13, type: 0, key: 0, name: 'Dragon' } : null;

    if (n === 1) return { kind: 'single', count: 1, type: 0, key: cs[0], name: 'Tunggal' };
    if (n === 2) {
      if (ranks[0] !== ranks[1]) return null;
      return { kind: 'pair', count: 2, type: 0, key: cs[1], name: 'Sepasang' };
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
    const groups = Object.entries(counts)
      .map(([r, c]) => ({ r: +r, c }))
      .sort((a, b) => b.c - a.c || b.r - a.r);

    let type = 0;
    let key = 0;
    if (straight && flush) {
      if (ranks[4] === RANK_ACE) { type = FIVE.ROYAL; key = suits[0]; }
      else { type = FIVE.STRAIGHT_FLUSH; key = top; }
    } else if (groups[0].c === 4) {
      type = FIVE.FOUR; key = groups[0].r;
    } else if (groups[0].c === 3 && groups[1].c === 2) {
      type = FIVE.FULL_HOUSE; key = groups[0].r;
    } else if (flush) {
      // compare suit first, then highest ranks
      type = FIVE.FLUSH;
      key = suits[0];
      for (let i = 4; i >= 0; i--) key = key * 13 + ranks[i];
    } else if (straight) {
      type = FIVE.STRAIGHT; key = top;
    } else {
      return null;
    }
    return { kind: 'five', count: 5, type, key, name: FIVE_NAMES[type] };
  }

  // Does combo a beat combo b?
  function beats(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.count !== b.count) return false;
    if (a.kind === 'five' && a.type !== b.type) return a.type > b.type;
    return a.key > b.key;
  }

  // Dragon: 13 cards, one of every rank 3..2
  function isDragon(cards) {
    return cards.length === 13 && new Set(cards.map(rankOf)).size === 13;
  }

  // Bonus (negative) points for playing a special package
  function bonusFor(ev) {
    if (!ev) return 0;
    if (ev.kind === 'dragon') return DRAGON_POINTS;
    if (ev.kind === 'five') return BONUS[ev.type] || 0;
    return 0;
  }

  // Penalty points for cards left in hand
  function penaltyPerCard(left) {
    if (left <= 0) return 0;
    if (left <= 6) return 1;
    if (left <= 9) return 2;
    if (left <= 12) return 3;
    return 4;
  }
  const penaltyPoints = (left) => left * penaltyPerCard(left);

  // Winner's base points: -20 when the final play is a single 2, otherwise -10 (a pair of 2s stays -10).
  // A dragon win scores only its -70 bonus, so the base is 0.
  const winPoints = (finalEv, finalCards) => {
    if (finalEv && finalEv.kind === 'dragon') return 0;
    return finalEv && finalEv.kind === 'single' && rankOf(finalCards[0]) === RANK_TWO ? WIN_WITH_TWO_POINTS : WIN_POINTS;
  };
  // Playing 2♠ as a single (or a pair/triple of 2s that holds 2♠) can't be beaten,
  // so that player immediately starts a new round.
  const TWO_SPADE = RANK_TWO * 4 + 3;
  const freeTurnAfter = (ev, cards) => !!ev && cards.includes(TWO_SPADE) && (ev.kind === 'single' || ev.kind === 'pair' || ev.kind === 'triple');
  const twosLeft = (hand) => hand.filter((c) => rankOf(c) === RANK_TWO).length;

  function combinations(arr, k, start = 0, cur = [], out = []) {
    if (cur.length === k) { out.push(cur.slice()); return out; }
    for (let i = start; i <= arr.length - (k - cur.length); i++) {
      cur.push(arr[i]);
      combinations(arr, k, i + 1, cur, out);
      cur.pop();
    }
    return out;
  }

  // Every legal combination available in a hand.
  function allCombos(hand) {
    const h = [...hand].sort((a, b) => a - b);
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

  // Suggest a play. Returns array of card ids or null (pass).
  // lastEv: combo to beat (null when leading). mustInclude: card id that must be played (first lead).
  function suggest(hand, lastEv, mustInclude) {
    if (!lastEv && isDragon(hand)) return [...hand].sort((a, b) => a - b);
    let cands = allCombos(hand);
    if (mustInclude != null) cands = cands.filter((c) => c.cards.includes(mustInclude));
    if (lastEv) {
      cands = cands.filter((c) => beats(c.ev, lastEv));
      if (!cands.length) return null;
      cands.sort((a, b) => strength(a) - strength(b));
      return cands[0].cards;
    }
    if (!cands.length) return null;
    const lowest = Math.min(...hand);
    let lead = cands.filter((c) => c.cards.includes(lowest));
    const noTwo = lead.filter((c) => !c.cards.some((x) => rankOf(x) === RANK_TWO));
    if (noTwo.length) lead = noTwo;
    // shed as many low cards as possible: more cards first, then the lowest top card
    lead.sort((a, b) => b.cards.length - a.cards.length || Math.max(...a.cards) - Math.max(...b.cards));
    return lead[0].cards;
  }

  function sortHand(hand, mode) {
    const h = [...hand];
    if (mode === 'suit') h.sort((a, b) => suitOf(a) - suitOf(b) || rankOf(a) - rankOf(b));
    else h.sort((a, b) => a - b);
    return h;
  }

  return {
    RANKS, SUITS, FIVE, FIVE_NAMES, RANK_TWO, WIN_POINTS, WIN_WITH_TWO_POINTS, DRAGON_POINTS, TWO_LEFT_POINTS, BONUS,
    rankOf, suitOf, isRed, label, newDeck, shuffle,
    evaluate, beats, isDragon, bonusFor, penaltyPerCard, penaltyPoints, winPoints, twosLeft, TWO_SPADE, freeTurnAfter, allCombos, suggest, sortHand,
  };
});
