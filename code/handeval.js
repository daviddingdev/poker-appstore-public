// 7-card hand evaluator + Monte-Carlo equity vs a RANGE. Pure, no DOM, testable.
// This is what makes the flop drill principled: hero's hand is rolled out against
// the villain's actual (modeled) range, optionally conditioned on their action.
// Validated against the Python-computed matchups in charts.js.
(function (g) {
  'use strict';
  var RANKS = '23456789TJQKA';
  var SUITS = 'shdc';

  function cardId(str) { return RANKS.indexOf(str[0].toUpperCase()) * 4 + SUITS.indexOf(str[1].toLowerCase()); }
  function rankOf(id) { return (id >> 2) + 2; }     // 2..14
  function suitOf(id) { return id & 3; }

  // Comparable score array for the best 5-card hand out of 7 card-ids.
  function eval7(ids) {
    var i, r, s;
    var cnt = new Array(15).fill(0), suitCnt = [0, 0, 0, 0];
    for (i = 0; i < 7; i++) { cnt[rankOf(ids[i])]++; suitCnt[suitOf(ids[i])]++; }

    var flushSuit = -1;
    for (s = 0; s < 4; s++) if (suitCnt[s] >= 5) flushSuit = s;

    function bestStraight(present) {            // present: bool[15] with wheel ace at 1
      for (var hi = 14; hi >= 5; hi--) {
        var ok = true;
        for (var k = 0; k < 5; k++) if (!present[hi - k]) { ok = false; break; }
        if (ok) return hi;
      }
      return 0;
    }

    if (flushSuit >= 0) {
      var fpresent = new Array(15).fill(false), franks = [];
      for (i = 0; i < 7; i++) if (suitOf(ids[i]) === flushSuit) { fpresent[rankOf(ids[i])] = true; franks.push(rankOf(ids[i])); }
      if (fpresent[14]) fpresent[1] = true;
      var sf = bestStraight(fpresent);
      if (sf) return [8, sf];
      franks.sort(function (a, b) { return b - a; });
      return [5, franks[0], franks[1], franks[2], franks[3], franks[4]];
    }

    var quads = 0, trips = [], pairs = [];
    for (r = 14; r >= 2; r--) {
      if (cnt[r] === 4) quads = r;
      else if (cnt[r] === 3) trips.push(r);
      else if (cnt[r] === 2) pairs.push(r);
    }
    var kick = [];
    function kickers(n, excl) {
      kick.length = 0;
      for (var rr = 14; rr >= 2 && kick.length < n; rr--) if (cnt[rr] && excl.indexOf(rr) < 0) kick.push(rr);
      return kick.slice();
    }
    if (quads) return [7, quads, kickers(1, [quads])[0]];
    if (trips.length && (pairs.length || trips.length > 1)) {
      var t = trips[0], p = trips.length > 1 ? trips[1] : pairs[0];
      return [6, t, p];
    }
    var present = new Array(15).fill(false);
    for (r = 2; r <= 14; r++) if (cnt[r]) present[r] = true;
    if (present[14]) present[1] = true;
    var st = bestStraight(present);
    if (st) return [4, st];
    if (trips.length) { var k3 = kickers(2, [trips[0]]); return [3, trips[0], k3[0], k3[1]]; }
    if (pairs.length >= 2) return [2, pairs[0], pairs[1], kickers(1, [pairs[0], pairs[1]])[0]];
    if (pairs.length === 1) { var k1 = kickers(3, [pairs[0]]); return [1, pairs[0], k1[0], k1[1], k1[2]]; }
    var k0 = kickers(5, []);
    return [0, k0[0], k0[1], k0[2], k0[3], k0[4]];
  }

  function cmp(a, b) {
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  // Hero equity vs a range. hole/board: card strings. comboPool: array of [c1,c2]
  // strings (e.g. from Poker.bandCombos). opts:
  //   n          — iterations (default 600)
  //   condition  — fn(villCard1, villCard2, boardStrs) -> acceptance prob 0..1,
  //                models "they bet/checked" by re-weighting their range.
  function equityVsRange(hole, board, comboPool, opts) {
    opts = opts || {};
    var n = opts.n || 600, condition = opts.condition || null;
    var heroIds = hole.map(cardId), boardIds = board.map(cardId);
    var blocked = {};
    heroIds.concat(boardIds).forEach(function (id) { blocked[id] = 1; });
    var deck = [];
    for (var d = 0; d < 52; d++) if (!blocked[d]) deck.push(d);
    var need = 5 - boardIds.length;

    var wins = 0, ties = 0, done = 0, guard = 0;
    while (done < n && guard < n * 60) {
      guard++;
      var combo = comboPool[(Math.random() * comboPool.length) | 0];
      var v1 = cardId(combo[0]), v2 = cardId(combo[1]);
      if (blocked[v1] || blocked[v2] || v1 === v2) continue;
      if (condition && Math.random() > condition(combo[0], combo[1], board)) continue;
      // runout: sample `need` distinct cards from deck excluding villain's
      var run = [], used = {}; used[v1] = 1; used[v2] = 1;
      while (run.length < need) {
        var c = deck[(Math.random() * deck.length) | 0];
        if (!used[c]) { used[c] = 1; run.push(c); }
      }
      var full = boardIds.concat(run);
      var h = eval7(heroIds.concat(full));
      var v = eval7([v1, v2].concat(full));
      var r = cmp(h, v);
      if (r > 0) wins++; else if (r === 0) ties++;
      done++;
    }
    return done ? (wins + ties / 2) / done : 0.5;
  }

  // Hero equity vs a FIELD of villains (multiway). pools: array of comboPools,
  // one per opponent. Hero wins a trial ONLY if their hand beats EVERY villain —
  // so multiway equity is much lower than heads-up (the whole point: you must get
  // through the field). opts.conditions: optional array of per-villain accept fns.
  function equityVsField(hole, board, pools, opts) {
    opts = opts || {};
    var n = opts.n || 600, conditions = opts.conditions || null;
    var heroIds = hole.map(cardId), boardIds = board.map(cardId);
    var blocked0 = {};
    heroIds.concat(boardIds).forEach(function (id) { blocked0[id] = 1; });
    var deck = [];
    for (var d = 0; d < 52; d++) if (!blocked0[d]) deck.push(d);
    var need = 5 - boardIds.length, V = pools.length;
    var wins = 0, ties = 0, done = 0, guard = 0;
    while (done < n && guard < n * 200) {
      guard++;
      var used = {};
      heroIds.forEach(function (id) { used[id] = 1; });
      boardIds.forEach(function (id) { used[id] = 1; });
      var vills = [], okk = true;
      for (var k = 0; k < V; k++) {
        var combo = pools[k][(Math.random() * pools[k].length) | 0];
        var v1 = cardId(combo[0]), v2 = cardId(combo[1]);
        if (used[v1] || used[v2] || v1 === v2) { okk = false; break; }
        if (conditions && conditions[k] && Math.random() > conditions[k](combo[0], combo[1], board)) { okk = false; break; }
        used[v1] = 1; used[v2] = 1; vills.push([v1, v2]);
      }
      if (!okk) continue;
      var run = [];
      while (run.length < need) { var c = deck[(Math.random() * deck.length) | 0]; if (!used[c]) { used[c] = 1; run.push(c); } }
      var full = boardIds.concat(run);
      var h = eval7(heroIds.concat(full));
      var beatsAll = true, tieAny = false;
      for (var j = 0; j < V; j++) {
        var r = cmp(h, eval7(vills[j].concat(full)));
        if (r < 0) { beatsAll = false; break; }
        if (r === 0) tieAny = true;
      }
      if (beatsAll) { if (tieAny) ties++; else wins++; }
      done++;
    }
    return done ? (wins + ties * 0.5) / done : 0;
  }

  var HandEval = { cardId: cardId, eval7: eval7, cmp: cmp, equityVsRange: equityVsRange, equityVsField: equityVsField };
  g.HandEval = HandEval;
  if (typeof module !== 'undefined' && module.exports) module.exports = HandEval;
})(typeof window !== 'undefined' ? window : globalThis);
