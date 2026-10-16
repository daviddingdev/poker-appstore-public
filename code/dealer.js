// Live-deal table simulator: every seat gets real cards and acts according to
// the calibrated ranges plus a LIVE-FIELD overlay; the drill spot is whatever
// legally reaches the hero's seat. Spot-type frequencies therefore EMERGE from
// simulation instead of a hand-tuned roll.
//
// Live overlay calibration targets (published low/mid-stakes anchors):
//   - recreational live fields play loose-passive: lots of limping, VPIP well
//     above the 15-25% reg baseline -> per-seat LIMP bands on top of open ranges
//   - live 3-bet frequencies ~3-6% (online TAG 6-9%) -> 3-bet widths x0.7
//   - calling > raising live -> cold-call widths x1.3
// Pure module: needs window.Poker (init'd) + window.NASH.
(function (g) {
  'use strict';
  var ORDER = ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'];
  var RANKS = '23456789TJQKA', SUITS = 'shdc';
  var LIMP_EXTRA = { EP: 0.12, MP: 0.14, CO: 0.16, BTN: 0.20, SB: 0.25, BB: 0 };
  var LIVE_3B = 0.7, LIVE_COLD = 1.3, LIVE_SQ = 0.6, LIVE_OVERLIMP = 1.2;
  var DEPTHS = [[100, 0.10], [50, 0.14], [30, 0.28], [20, 0.28], [15, 0.08], [12, 0.07], [10, 0.05]];   // reassigned by focus in simulateSpot

  function P() { return g.Poker; }
  function rnd(n) { return (Math.random() * n) | 0; }
  function sampleDepth() {
    var r = Math.random(), c = 0;
    for (var i = 0; i < DEPTHS.length; i++) { c += DEPTHS[i][1]; if (r <= c) return DEPTHS[i][0]; }
    return 20;
  }
  function band(depth) { return depth <= 12 ? 10 : depth <= 24 ? 20 : depth <= 39 ? 30 : depth <= 74 ? 50 : 100; }
  function isEarly(s) { return s === 'EP' || s === 'MP'; }

  function makeDeck() {
    var d = [];
    for (var r = 0; r < 13; r++) for (var s = 0; s < 4; s++) d.push(RANKS[r] + SUITS[s]);
    for (var i = d.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = d[i]; d[i] = d[j]; d[j] = t; }
    return d;
  }

  // one table walk; returns a spot object or null (no decision reached hero)
  function walk() {
    var depth = sampleDepth(), bd = band(depth);
    var hero = ORDER[rnd(6)];
    var deck = makeDeck(), di = 0;
    var openerSeat = null, threeBettor = null, jammer = null;
    var callers = 0, limpers = 0, viaLimp = false;

    for (var idx = 0; idx < ORDER.length; idx++) {
      var seat = ORDER[idx];
      var c1 = deck[di++], c2 = deck[di++];
      if (seat === hero) {
        return classify(hero, depth, bd, openerSeat, threeBettor, jammer, callers, limpers, viaLimp, c1, c2);
      }
      var p = P().pct(P().handLabel(c1, c2));
      if (p == null) continue;
      if (jammer) {                                          // facing a jam: tight calls only
        var cw = seat === 'BB' && g.NASH ? (g.NASH.jamPct[Math.min(depth, 15)] ? 0.10 : 0.06) : 0.045;
        if (p <= cw) callers++;
      } else if (threeBettor) {                              // open + 3-bet already: nutted cold-continues
        if (p <= 0.025) callers++;
      } else if (openerSeat && callers > 0) {                // squeeze opportunity
        var sq = P().squeezeThresholds(bd, isEarly(openerSeat) ? 'early' : 'late', seat, callers);
        if (p <= sq.tb * LIVE_SQ) threeBettor = seat;
        else if (p <= sq.tb * LIVE_SQ + (sq.call - sq.tb) * LIVE_COLD) callers++;
      } else if (openerSeat) {                               // facing a single open
        var th = (seat === 'SB' || seat === 'BB') ? P().blindVsThresholds(seat, bd, openerSeat) : P().vsThresholds(bd, openerSeat);
        if (p <= th.tb * LIVE_3B) threeBettor = seat;
        else if (p <= th.tb * LIVE_3B + (th.call - th.tb) * LIVE_COLD) callers++;
      } else if (limpers > 0) {                              // limped pot so far
        if (p <= P().isoThreshold(seat, bd)) { openerSeat = seat; callers = limpers; limpers = 0; viaLimp = true; }
        else if (p <= P().isoThreshold(seat, bd) + LIMP_EXTRA[seat] * LIVE_OVERLIMP) limpers++;
      } else {                                               // unopened
        if (depth <= 12 && g.NASH && g.NASH.jamPct[depth === 12 ? 12 : 10]) {
          if (p <= (g.NASH.jamPct[depth === 12 ? 12 : 10][seat] || 0) / 100) jammer = seat;
        } else if (p <= P().openThreshold(seat, bd)) {
          openerSeat = seat;
        } else if (depth > 12 && p <= P().openThreshold(seat, bd) + LIMP_EXTRA[seat]) {
          limpers++;
        }
      }
    }
    return null;
  }

  function classify(hero, depth, bd, openerSeat, threeBettor, jammer, callers, limpers, viaLimp, c1, c2) {
    if (jammer) {
      if (hero !== 'BB') return null;                       // only BB jam-calls are solved
      return { kind: 'calljam', pos: jammer, depth: Math.min(depth, 15), c1: c1, c2: c2 };
    }
    if (threeBettor && openerSeat)
      return { kind: 'cold3b', opener: openerSeat, raiser: threeBettor, vseat: hero, depth: bd >= 20 ? bd : 20, c1: c1, c2: c2 };
    if (openerSeat && callers > 0)
      return { kind: 'squeeze', opener: openerSeat, vseat: hero, callers: Math.min(callers, 2), limped: viaLimp || undefined, depth: bd, c1: c1, c2: c2 };
    if (openerSeat)
      return { kind: 'vs', opener: openerSeat, vseat: hero, blind: (hero === 'SB' || hero === 'BB') ? hero : null, depth: bd, c1: c1, c2: c2 };
    if (limpers > 0) {
      if (hero === 'BB') return null;                       // BB can check — not a drillable raise/fold
      return { kind: 'iso', pos: hero, limpers: Math.min(limpers, 2), depth: bd, c1: c1, c2: c2 };
    }
    if (hero === 'BB') return null;                         // walk — no decision
    var spot = { kind: 'open', pos: hero, depth: depth <= 12 ? (depth === 12 ? 12 : 10) : bd, c1: c1, c2: c2 };
    var cr = chainRaiser(hero, spot.depth);
    if (cr) spot.chainRaiser = cr;
    return spot;
  }
  // Chance the open gets 3-bet behind (the chained second decision): a seat behind the
  // opener, or null. Its own function so the free tier's 100bb opens (study.js) roll the
  // chain exactly the way the live deal does, instead of keeping a second copy of the rate.
  function chainRaiser(hero, depth) {
    if (depth < 20) return null;                             // short: first-in is jam-or-fold
    var bd = band(depth);
    var after = ORDER.slice(ORDER.indexOf(hero) + 1);
    var pr = Math.min(0.14, P().vsThresholds(bd, hero).tb * LIVE_3B * after.length * 0.45);
    if (bd >= 50) pr = Math.min(0.25, pr * 2);   // deep: re-raise reps matter
    return Math.random() < pr ? after[rnd(after.length)] : null;
  }

  // FREE TIER (LAUNCH_PLAN §2): a free player gets 10 chained "they 3-bet you" spots a local
  // day. Counted from the drill log the app already keeps (each answer's mode, kind and time),
  // so nothing new is stored and a restored backup carries the count with it. Sample answers
  // never count. A player who moves the phone's clock gets more; accepted. It lives here,
  // beside the chain it caps, because this file loads before both of its readers: the drill
  // (study.js) and the app shell (§3's "hit today's 10 on 3 different days").
  var FREE_3BET_DAY = 10;
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // Local calendar day, the same YYYY-MM-DD the app's dateOf() writes.
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function threeBetsByDay(drills) {
    var out = {};
    (drills || []).forEach(function (e) {
      if (!e || e.sample || e.m !== 'pf' || e.k !== 'vs3bet' || !e.t) return;
      var k = dayKey(e.t); out[k] = (out[k] || 0) + 1;
    });
    return out;
  }
  function threeBetsOn(drills, ts) { return threeBetsByDay(drills)[dayKey(ts == null ? Date.now() : ts)] || 0; }
  function daysAtThreeBetCap(drills) {
    var by = threeBetsByDay(drills), n = 0;
    for (var k in by) if (by[k] >= FREE_3BET_DAY) n++;
    return n;
  }

  var DEPTHS_DEEP = [[100, 0.45], [50, 0.55]];
  var DEPTHS_SHORT = [[30, 0.34], [20, 0.34], [15, 0.12], [12, 0.11], [10, 0.09]];
  function simulateSpot(opts) {
    var save = DEPTHS;
    if (opts && opts.focus === 'deep') DEPTHS = DEPTHS_DEEP;
    else if (opts && opts.focus === 'short') DEPTHS = DEPTHS_SHORT;
    try {
      for (var t = 0; t < 60; t++) {
        var s = walk();
        if (s) return s;
      }
      return null;                                           // caller falls back to the roll
    } finally { DEPTHS = save; }
  }

  // allDepths()/band exported so the coverage test can assert that every depth this
  // dealer can EMIT has a grading path in poker.js — the 12bb hole was exactly a depth
  // the dealer produced and no table graded. Function, not the array: DEPTHS is
  // reassigned by focus modes, and the union across all three lists is the contract.
  function allDepths() {
    var seen = {};
    [DEPTHS, DEPTHS_DEEP, DEPTHS_SHORT].forEach(function (L) { L.forEach(function (p) { seen[p[0]] = 1; }); });
    return Object.keys(seen).map(Number);
  }
  var Dealer = { simulateSpot: simulateSpot, walk: walk, ORDER: ORDER, LIMP_EXTRA: LIMP_EXTRA, allDepths: allDepths, band: band,
    chainRaiser: chainRaiser, FREE_3BET_DAY: FREE_3BET_DAY, dayKey: dayKey,
    threeBetsByDay: threeBetsByDay, threeBetsOn: threeBetsOn, daysAtThreeBetCap: daysAtThreeBetCap };
  g.Dealer = Dealer;
  if (typeof module !== 'undefined' && module.exports) module.exports = Dealer;
})(typeof window !== 'undefined' ? window : globalThis);
