// Study tab: jam/fold Drill + Pocket Card. Depends on window.Poker + window.POKER_DATA.
// Grading lives in poker.js; this is UI. Loaded after the main app script.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SU = { s: '♠', h: '♥', d: '♦', c: '♣' };
  var RANKS = '23456789TJQKA';
  var RORD = 'AKQJT98765432';
  var LS = 'pokerlog.train';
  var P = window.Poker, DATA = window.POKER_DATA, PF = window.Postflop, H = window.HandEval;
  var sorted = [];   // [{label, pct}] ascending by percentile (strongest first)

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }
  function cardHtml(c) {
    if (!c) return '';
    var r = c[0].toUpperCase(), s = c[1].toLowerCase();
    if (r === 'T') r = '10';   // a ten reads "10" on a card face, as in Odds; the shorthand keeps T
    return '<span class="pc"><b>' + esc(r) + '</b><span class="suit-' + s + '">' + SU[s] + '</span></span>';
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- persisted drill stats ---------- */
  function freshStats() { return { v: 2, att: 0, cor: 0, mix: 0, streak: 0, best: 0, byMode: {}, byDepth: {}, misses: [], mode: 'pf' }; }
  var stats;
  var Store = (typeof window !== 'undefined' && window.Store) || null;
  function readStats() { return Store ? Store.get(LS) : localStorage.getItem(LS); }
  function writeStats(v) { if (Store) Store.set(LS, v); else localStorage.setItem(LS, v); }
  function hydrateStats() {
    try { stats = Object.assign(freshStats(), JSON.parse(readStats() || '{}')); }
    catch (e) { stats = freshStats(); }
    if (!stats.byMode) stats.byMode = {};
    if (!stats.byDepth) stats.byDepth = {};
    if (!stats.misses) stats.misses = [];
    if (stats.v !== 2) { stats.byDepth = {}; stats.misses = []; stats.v = 2; }  // depth/miss schema changed
  }
  hydrateStats();
  // Eviction recovery for THIS key. app-boot's Store.recover() resolves asynchronously,
  // long after the line above hydrated `stats` from an evicted (empty) working copy.
  // The boot recovery path calls this once the mirror copy is back — without it, a
  // recovered player kept every hand but silently lost streaks, accuracy and filters.
  // Found by the 2026-08-18 on-device eviction drill, not by the mocks.
  window.StudyReloadStats = function () {
    hydrateStats();
    mode = stats.mode || mode;
    if (mode === 'odds') mode = 'hands';
    oddsHard = stats.oddsHard !== false;
    if (typeof renderModeSel === 'function') { renderModeSel(); renderStats(); }
  };
  function saveStats() { writeStats(JSON.stringify(stats)); }

  /* ---------- cards ---------- */
  function cardsFor(label) {        // label -> two concrete cards with random legal suits
    var r1 = label[0], r2 = label[1], s = 'shdc';
    if (label.length === 2) {       // pair
      var a = (Math.random() * 4) | 0, b; do { b = (Math.random() * 4) | 0; } while (b === a);
      return [r1 + s[a], r1 + s[b]];
    }
    if (label[2] === 's') { var q = (Math.random() * 4) | 0; return [r1 + s[q], r2 + s[q]]; }
    var x = (Math.random() * 4) | 0, y; do { y = (Math.random() * 4) | 0; } while (y === x);
    return [r1 + s[x], r2 + s[y]];
  }
  function nearestHand(target) {     // pick one of the hands closest to a target percentile
    var arr = sorted.map(function (h) { return { h: h.label, d: Math.abs(h.pct - target) }; });
    arr.sort(function (a, b) { return a.d - b.d; });
    var k = arr.slice(0, 6);
    return k[(Math.random() * k.length) | 0].h;
  }

  /* ====================== DRILL ====================== */
  var cur = null, mode = stats.mode || 'pf', oddsHard = stats.oddsHard !== false;  // hide draw name by default
  if (mode === 'odds') mode = 'hands';   // Pot odds retired → Full hands; migrate an old saved mode
  var MODES = [{ v: 'pf', t: 'Preflop' }, { v: 'flop', t: 'Flop' }, { v: 'turn', t: 'Turn' }, { v: 'river', t: 'River' }, { v: 'hands', t: 'Full hands' }];
  function spotKey(s) { return [s.kind, (s.blind || '') + (s.pos || s.opener || s.pos3 || ''), s.vseat || '', s.raiser || '', s.depth].join('|'); }
  function rnd(n) { return (Math.random() * n) | 0; }

  // seats: preflop action order EP→BB; postflop order SB→BTN (later = in position)
  var PRE_ORDER = ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'];
  var POST_ORDER = ['SB', 'BB', 'EP', 'MP', 'CO', 'BTN'];
  // The drill log's seat names (logAnswer). Kept as they were so old and new entries agree;
  // nothing on screen reads them any more — the screen uses SEAT_CODE.
  var SEAT_NAME = { EP: 'UTG', MP: 'MP', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB' };
  // One seat, one name (LAUNCH_PLAN Appendix A, fix 1). The engine plays six-handed; its first
  // seat is shown as UTG–LJ (it plays like UTG at a six-player game and like the lojack at a full
  // nine-player table) and its second as the Log's HJ. Display only: EP/MP stay the engine's keys.
  var SEAT_CODE = { EP: 'UTG–LJ', MP: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB' };
  function sc(seat) { return SEAT_CODE[seat] || seat; }
  // Free spots name a seat in words, with the code beside it.
  var SEAT_PLAIN = { EP: 'an early seat (UTG–LJ)', MP: 'the hijack (HJ)', CO: 'the cutoff (CO)', BTN: 'the button (BTN)', SB: 'the small blind (SB)', BB: 'the big blind (BB)' };
  var SEAT_TERM = { EP: 'early', MP: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB' };   // its GLOSSARY entry
  // The app shell's glossary term (app-core term()): a tap shows the meaning inline. Standalone
  // (test_ui_smoke, no shell) it is the plain words.
  function T(key, label) { return typeof window.term === 'function' ? window.term(key, label) : esc(label == null ? key : label); }
  function seatTerm(seat) { return T(SEAT_TERM[seat], SEAT_PLAIN[seat]); }
  function seatAt(seat) { return (seat === 'BTN' ? 'on ' : 'in ') + seatTerm(seat); }   // "you're on the button (BTN)"
  // A seat as written in the drill pools and real hands ('UTG', 'MP'): the same names as the engine's.
  // A preflop-only range in the real-hand data ends in a dangling "→" ("BTN flat → "), the
  // postflop half it would lead to being empty: 429 of the spots and 1,200 of the hand steps.
  // And a seat the generator wrote twice ("BB BB check → flop:bet", 329 of the 7,857 ranges) is
  // printed once. Both fixed here, in the printer; the pools are left as generated.
  // The baked size tail ("flop bet small 0.3×pot") is dropped: the prompt above gives the exact
  // size ("0.25×pot"), and the range string's one-decimal copy disagreed with it (COPY-6).
  // Where the size was all the tail said, what is left ("CO flat → flop:bet · flop bet") only
  // repeats the line, so it goes too; "bet small (merged)" and "bet big (polar)" stay (NEW-3).
  function rangeTxt(r) { return seatTxt(String(r == null ? '' : r).replace(/\s*→\s*$/, '').replace(/\b(UTG|MP|CO|BTN|SB|BB)(\s+\1)+\b/g, '$1').replace(/ \d*\.?\d+×pot/g, '').replace(/ · (?:flop|turn|river) bet$/, '')); }
  function seatTxt(t) { return String(t == null ? '' : t).replace(/\bUTG\b(?![–+])/g, 'UTG–LJ').replace(/\bMP\b/g, 'HJ'); }
  // A locked postflop spot on the free tier is a preview, read by a beginner (§4b): in or out of
  // position in words, with the term to tap; the seat a tap away from its meaning. Pro keeps
  // the regulars' letters.
  function posW(ip) { return cardPro() ? (ip ? 'IP' : 'OOP') : T(ip ? 'IP' : 'OOP', ip ? 'in position' : 'out of position'); }
  function seatW(code) { var t = seatTxt(code); return cardPro() ? esc(t) : T(t === 'UTG–LJ' ? 'early' : t, t); }
  function aName(t) { return (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + t; }   // "an early (UTG–LJ)", "a cutoff"
  // 'AJo' → 'AJo (offsuit)': the s/o suffix is the one part of a hand name nobody explains.
  function handWords(label) {
    var l = String(label || '');
    return esc(l) + (l.length === 3 ? (l[2] === 's' ? ' (suited)' : ' (offsuit)') : '');
  }
  function seatsAfter(seat) { return PRE_ORDER.slice(PRE_ORDER.indexOf(seat) + 1); }
  function ipVs(hero, other) { return POST_ORDER.indexOf(hero) > POST_ORDER.indexOf(other) ? 'ip' : 'oop'; }
  function isEarly(pos) { return pos === 'EP' || pos === 'MP'; }
  // aggressive-action label + colour by scenario/depth
  function aggrInfo(s) {
    // ≤12bb first-in is graded as a Nash jam (poker.js openEval) — the button must say so.
    if (s.kind === 'open' || s.kind === 'iso') return s.depth <= 12 ? { w: 'Jam', c: 'jam' } : { w: 'Raise', c: 'raise' };
    if (s.kind === 'bbopt') return { w: 'Raise', c: 'raise' };
    if (s.kind === 'limpRR') return s.depth >= 30 ? { w: '4-bet', c: 'threebet' } : { w: 'Jam', c: 'jam' };
    if (s.kind === 'squeeze') return s.depth >= 30 ? { w: 'Squeeze', c: 'threebet' } : { w: 'Jam', c: 'jam' };
    if (s.kind === 'vs3bet' || s.kind === 'cold3b') return s.depth >= 30 ? { w: '4-bet', c: 'threebet' } : { w: 'Jam', c: 'jam' };
    if (s.kind === 'vs4bet') return { w: '5-bet jam', c: 'jam' };
    return s.depth >= 30 ? { w: '3-bet', c: 'threebet' } : { w: 'Jam', c: 'jam' };  // vs
  }
  function aggrBtn(ai, action) { return '<button class="act ' + ai.c + '" data-a="' + action + '">' + ai.w + '</button>'; }

  // The filters are Pro and hidden on the free tier, so there they never apply: a filter set
  // before a refund (or restored from a Pro backup) would otherwise narrow spots invisibly.
  function pfStyle() { return cardPro() ? stats.pfStyle || 'live' : 'live'; }
  // Preflop and flop/turn filters are separate settings: they share names ('leak') that
  // mean different things, and one used to silently rewrite the other.
  function pfDepthFocus() {
    if (!cardPro()) return 'all';
    if (mode === 'flop' || mode === 'turn') return stats.postDepth || 'all';
    return stats.pfDepth && stats.pfDepth !== 'raises' ? stats.pfDepth : 'all';
  }
  function renderModeSel() {
    // Mode tabs get a row to themselves. The focus/style toggles used to sit in the SAME
    // wrapping flex container — twelve controls of two different sizes, most of them under
    // the 44px tap minimum, wrapping unpredictably. They now live behind one button that
    // opens a proper options panel below.
    // Free tier (LAUNCH_PLAN §2): Preflop is live; the other modes still deal, as a preview
    // whose answers are Pro, so each carries the lock and says so to VoiceOver.
    var free = !cardPro();
    // Under 360pt the five tabs ran 352px in 296 and "Full hands" showed as a clipped "Full",
    // so there it reads "Hands" (index.html .mw/.mn); VoiceOver always hears the full name.
    $('drillMode').innerHTML = MODES.map(function (m) {
      var lk = free && m.v !== 'pf';
      var t = m.v === 'hands' ? '<span class="mw">' + m.t + '</span><span class="mn">Hands</span>' : m.t;
      return '<button data-m="' + m.v + '"' + (m.v === mode ? ' class="on"' : '') +
        (lk || m.v === 'hands' ? ' aria-label="' + m.t + (lk ? ', Pro' : '') + '"' : '') + '>' + t + (lk ? LOCK_IC : '') + '</button>';
    }).join('');
    // The control is a drill filter, not settings — the owner himself asked "what is this
    // Options tab?", which is the whole argument for the name. It appears only when it does
    // something, and always says what it is currently doing. Hidden on the free tier.
    var body = free ? '' : optionsHtml();
    if (!body) { $('drillOptsBtn').innerHTML = ''; $('drillOpts').hidden = true; $('drillOpts').innerHTML = ''; wireDrillMode(); return; }
    var optsOpen = stats.optsOpen === true;
    var sum = optSummary();
    $('drillOptsBtn').innerHTML = '<button class="optbtn' + (optsOpen || sum ? ' on' : '') + '" data-opts="1">' +
      'Filter spots' + (sum ? ' <span class="dim">· ' + sum + '</span>' : '') +
      '<span class="chev">' + (optsOpen ? '▾' : '▸') + '</span></button>';
    $('drillOpts').hidden = !optsOpen;
    $('drillOpts').innerHTML = !optsOpen ? '' : body;
    wireDrillMode();
  }
  // A filter the user cannot see is one they discover a week later while wondering why the
  // spots feel repetitive — and it persists across launches in `stats`. So every mode that
  // HAS a filter reports it, not just preflop.
  function optSummary() {
    var d = pfDepthFocus();
    if (mode === 'pf') {
      var f = {all: '', short: '≤30bb', deep: 'deep 50+', leak: 'pressure', jam: 'vs jam'}[d] || '';
      return [pfStyle() === 'hard' ? 'hard spots' : '', f].filter(Boolean).join(' · ');
    }
    if (mode === 'flop' || mode === 'turn') {
      return {leak: 'facing aggression', raises: 'raise or fold'}[d] || '';
    }
    return '';
  }
  // iOS never shows title= tooltips, so what each filter does is said on screen.
  function optCaption() {
    var d = pfDepthFocus(), t;
    if (mode === 'pf') {
      t = (pfStyle() === 'hard' ? 'Hard spots: hands chosen near the line. ' : 'Live deal: spots arrive the way a real table deals them. ') +
        ({ short: '≤30bb: short and medium stacks only.', deep: 'Deep 50+: 50 and 100bb stacks.',
           leak: 'Pressure: 30–50bb, facing 3-bets and 4-bets.', jam: 'Vs jam: you are the big blind facing an all-in, 8–15bb.' }[d] || '');
    } else {
      t = { leak: 'Facing aggression: donk bets, check-raises and second barrels.', raises: 'Raises: facing small bets, where raising is on the table.' }[d] || 'All spots from the real-hand pool.';
    }
    return '<p class="mini" style="margin:6px 2px 0">' + t + '</p>';
  }
  function optionsHtml() {
    return (mode === 'pf'
      ? '<span class="styletog">' +
        '<button data-s="live" class="minitog' + (pfStyle() === 'live' ? ' on' : '') + '">Live deal</button>' +
        '<button data-s="hard" class="minitog' + (pfStyle() === 'hard' ? ' on' : '') + '">Hard spots</button>' +
        '</span><span class="styletog">' +
        '<button data-w="all" class="minitog' + (pfDepthFocus() === 'all' ? ' on' : '') + '">All depths</button>' +
        '<button data-w="short" class="minitog' + (pfDepthFocus() === 'short' ? ' on' : '') + '">≤30bb</button>' +
        '<button data-w="deep" class="minitog' + (pfDepthFocus() === 'deep' ? ' on' : '') + '">Deep 50+</button>' +
        '<button data-w="leak" class="minitog' + (pfDepthFocus() === 'leak' ? ' on' : '') + '" title="30–50bb + facing re-raises — the awkward-depth spots most players handle worst">Pressure</button>' +
        '<button data-w="jam" class="minitog' + (pfDepthFocus() === 'jam' ? ' on' : '') + '" title="BB facing an open-jam — call or fold, every seat at 8–15bb">Vs jam</button>' +
        '</span>' + optCaption()
      : (mode === 'flop' || mode === 'turn')
        ? '<span class="styletog">' +
          '<button data-w="all" class="minitog' + (pfDepthFocus() !== 'leak' && pfDepthFocus() !== 'raises' ? ' on' : '') + '">All spots</button>' +
          '<button data-w="leak" class="minitog' + (pfDepthFocus() === 'leak' ? ' on' : '') + '" title="facing aggression — donk bets, check-raises, 2nd barrels, OOP">Facing aggression</button>' +
          '<button data-w="raises" class="minitog' + (pfDepthFocus() === 'raises' ? ' on' : '') + '" title="raise-or-fold reps — facing small bets, the fold/call/RAISE decision">Raises</button>' +
          '</span>' + optCaption()
        : '');
  }
  // One handler for the mode row, the Options button and the options panel. Kept together
  // because they all end in the same place: persist, re-render the selector, next spot.
  function wireDrillMode() {
    var onSel = function (e) {
      // Each branch lifts the new spot's answers clear of the tab bar, as Next does: on an SE a
      // mode chip left Turn's Check/Bet under it (DRILL-1).
      // Switching mode or filter abandons any queued follow-up spot ("they 4-bet you →").
      // Without this the chain hijacked the new mode's first spot and its answer was
      // credited to the wrong mode's accuracy.
      var tg = e.target.closest('[data-s]');
      if (tg) {
        if (tg.dataset.s !== pfStyle()) { stats.pfStyle = tg.dataset.s; saveStats(); pendingChain = null; renderModeSel(); nextSpot(); }
        return;
      }
      var tw = e.target.closest('[data-w]');
      if (tw) {
        if (tw.dataset.w !== pfDepthFocus()) {
          if (mode === 'flop' || mode === 'turn') stats.postDepth = tw.dataset.w; else stats.pfDepth = tw.dataset.w;
          saveStats(); pendingChain = null; renderModeSel(); nextSpot();
        }
        return;
      }
      if (e.target.closest('[data-opts]')) { stats.optsOpen = !stats.optsOpen; saveStats(); renderModeSel(); return; }
      var b = e.target.closest('[data-m]'); if (!b) return;
      mode = b.dataset.m; stats.mode = mode; saveStats();
      pendingChain = null;
      renderModeSel(); newScenario(); renderStats(); keepSpotInView();
    };
    $('drillMode').onclick = onSel;
    $('drillOptsBtn').onclick = onSel;
    $('drillOpts').onclick = onSel;
  }

  function dealCards(n) {           // n distinct cards
    var used = {}, out = [];
    while (out.length < n) {
      var c = RANKS[(Math.random() * 13) | 0] + 'shdc'[(Math.random() * 4) | 0];
      if (!used[c]) { used[c] = 1; out.push(c); }
    }
    return out;
  }
  function pickHandForThreshold(t) {
    if (Math.random() < 0.8) {                          // aim near the boundary (hard, decidable)
      var off = (Math.random() * 0.30) - 0.15;
      if (Math.abs(off) < 0.02) off += (off < 0 ? -0.02 : 0.02);
      return nearestHand(clamp(t + off, 0.01, 0.99));
    }
    return sorted[(Math.random() * sorted.length) | 0].label;
  }
  function handInBand(lo, hi) {                          // a hand whose strength percentile is in [lo,hi]
    var pool = sorted.filter(function (h) { return h.pct > lo && h.pct <= hi; });
    if (!pool.length) pool = sorted;
    return pool[rnd(pool.length)].label;
  }
  function dealAvoiding(n, used) {                       // n distinct cards not in `used`
    var u = {}; used.forEach(function (c) { u[c] = 1; });
    var out = [];
    while (out.length < n) { var c = RANKS[rnd(13)] + 'shdc'[rnd(4)]; if (!u[c]) { u[c] = 1; out.push(c); } }
    return out;
  }

  /* ---- preflop scenario builders ---- */
  function attachHand(s, t) { var h = cardsFor(s.label = pickHandForThreshold(t)); s.c1 = h[0]; s.c2 = h[1]; }
  function bandRow(s) {
    if (s.kind === 'vs') return s.blind ? P.blindVsThresholds(s.blind, s.depth, s.opener) : P.vsThresholds(s.depth, s.opener);
    if (s.kind === 'squeeze') {
      if (s.limped) return (s.vseat === 'SB' || s.vseat === 'BB')
        ? P.blindVsThresholds(s.vseat, s.depth, s.opener) : P.vsThresholds(s.depth, s.opener);
      return P.squeezeThresholds(s.depth, isEarly(s.opener) ? 'early' : 'late', s.vseat, s.callers);
    }
    if (s.kind === 'cold3b' || s.kind === 'limpRR') return P.VSCOLD3B[s.depth] || P.VSCOLD3B[30];
    if (s.kind === 'vs4bet') return P.VS4BET[s.depth] || P.VS4BET[100];
    return (P.VS3BET[s.depth] || P.VS3BET[30])[s.pos3];               // vs3bet
  }
  // The share of hands a BB calls a jam with from this seat (Nash, combo-weighted) — the
  // boundary the vs-jam drill should deal around. The two-bucket fallback table aimed some
  // seats so far off that ~90% of spots had the same answer.
  function callJamWidth(seat, depth) {
    var N = window.NASH, t = N && N.callBBSeat && N.callBBSeat[depth] && N.callBBSeat[depth][seat];
    if (!t) return P.callThreshold(isEarly(seat) ? 'early' : 'late', depth);
    var c = 0; for (var k in t) if (t[k] > 0) c += k.length === 2 ? 6 : k.charAt(2) === 's' ? 4 : 12;
    return c / 1326;
  }
  function pfThreshold(s) {
    if (s.kind === 'open' && s.depth <= 12 && window.NASH && window.NASH.jamPct[s.depth]) return window.NASH.jamPct[s.depth][s.pos] / 100;
    if (s.kind === 'open') return P.openThreshold(s.pos, s.depth);
    if (s.kind === 'iso') return P.isoThreshold(s.pos, s.depth);
    if (s.kind === 'bbopt') return P.isoThreshold('CO', s.depth);   // BB iso-over-limpers, value-weighted
    if (s.kind === 'calljam') return callJamWidth(s.pos, s.depth);
    var r = bandRow(s); return Math.random() < 0.5 ? r.tb : r.call;
  }
  var COPY = ['kind', 'pos', 'opener', 'raiser', 'vseat', 'pos3', 'callers', 'limpers', 'limped', 'blind', 'depth'];
  // 🩹 LEAK MODE — David's weak spots: 30-50bb mid-stack + FACING re-raises
  // (you opened/3-bet and someone came back over the top). These are the
  // continue-or-fold-under-pressure decisions he's least comfortable with;
  // the postflop half (facing c-bets / barrels / check-raises) is handled in
  // scenarioCbet's leak branch. Depth forced mid-stack; kinds are the
  // facing-aggression set only.
  function leakPF() {
    var depth = [30, 30, 50][rnd(3)], roll = Math.random();
    if (roll < 0.46) {                                   // you open, they 3-bet you
      var ho = ['EP', 'MP', 'CO', 'BTN'][rnd(4)], tp = seatsAfter(ho), tb3 = tp[rnd(tp.length)];
      return { mode: 'pf', kind: 'vs3bet', pos: ho, raiser: tb3, pos3: ipVs(ho, tb3), depth: depth };
    }
    if (roll < 0.76) {                                   // open + 3-bet in front, you cold-decide
      var op = ['EP', 'MP', 'CO'][rnd(3)], rs = seatsAfter(op).filter(function (x) { return x !== 'BB'; }), raiser = rs[rnd(rs.length)], hp = seatsAfter(raiser);
      return { mode: 'pf', kind: 'cold3b', opener: op, raiser: raiser, vseat: hp[rnd(hp.length)], depth: depth };
    }
    var h4 = ['MP', 'CO', 'BTN', 'SB', 'BB'][rnd(5)], before = PRE_ORDER.slice(0, PRE_ORDER.indexOf(h4)), op4 = before.length ? before[rnd(before.length)] : 'EP';
    return { mode: 'pf', kind: 'vs4bet', vseat: h4, raiser: op4, pos3: ipVs(h4, op4), depth: 50 };   // you 3-bet, they 4-bet
  }
  function scenarioPF() {
    var s;
    var focusF = pfDepthFocus();
    var pool = stats.misses.filter(function (m) {
      return focusF === 'deep' ? (m.depth || 0) >= 50 : focusF === 'short' ? (m.depth || 99) <= 30 : true;
    });
    if (pool.length && pfDepthFocus() !== 'leak' && pfDepthFocus() !== 'jam' && Math.random() < 0.3) {
      var m = pool[rnd(pool.length)];
      s = { mode: 'pf', replay: true };
      COPY.forEach(function (k) { s[k] = m[k]; });
      // legacy misses predate the seat-explicit fields — backfill so a replayed
      // spot can never show "you're the ?"
      if (s.kind === 'vs' && !s.vseat) {
        var la = seatsAfter(s.opener || 'EP');
        s.vseat = s.blind || la[rnd(la.length)];
        s.blind = (s.vseat === 'SB' || s.vseat === 'BB') ? s.vseat : null;
      }
      if (s.kind === 'squeeze') {
        s.opener = s.opener || 'MP'; s.callers = s.callers || 1;
        if (!s.vseat) s.vseat = 'BB';
        var sgap = PRE_ORDER.indexOf(s.vseat) - PRE_ORDER.indexOf(s.opener) - 1;
        if (!s.limped && (sgap < 1 || s.callers > sgap)) { s.vseat = 'BB'; sgap = PRE_ORDER.indexOf('BB') - PRE_ORDER.indexOf(s.opener) - 1; s.callers = Math.min(s.callers, Math.max(1, sgap)); }
      }
      if (s.kind === 'cold3b' && (!s.raiser || !s.vseat)) {
        s.opener = s.opener || 'MP';
        var rs2 = seatsAfter(s.opener).filter(function (x) { return x !== 'BB'; });
        s.raiser = s.raiser || rs2[rnd(rs2.length)];
        var hp2 = seatsAfter(s.raiser);
        s.vseat = s.vseat || hp2[rnd(hp2.length)];
      }
      if (s.kind === 'vs3bet' && !s.raiser) {
        s.pos = s.pos || 'CO';
        var tp = seatsAfter(s.pos);
        s.raiser = tp[rnd(tp.length)];
        s.pos3 = ipVs(s.pos, s.raiser);
      }
    } else if (pfStyle() === 'live' && window.Dealer && pfDepthFocus() !== 'leak' && pfDepthFocus() !== 'jam') {
      // LIVE DEAL: simulate the whole table; the spot is whatever reaches you.
      // Honest random cards — frequencies emerge from the table model.
      var live = window.Dealer.simulateSpot({ focus: pfDepthFocus() });
      if (live) {
        s = Object.assign({ mode: 'pf' }, live);
        s.label = P.handLabel(s.c1, s.c2);
        return s;
      }
      s = null;                                  // sim failed; fall through to the roll
    }
    if (!s && pfDepthFocus() === 'leak') { s = leakPF(); }   // 🩹 weak-spot focus: 30-50bb facing re-raises
    if (!s && pfDepthFocus() === 'jam') s = { mode: 'pf', kind: 'calljam', pos: P.POS[rnd(P.POS.length)], depth: [8, 10, 12, 15][rnd(4)] };   // 🅱️ vs-jam focus: every spot is a BB call-or-fold
    if (!s) {
      var focus = pfDepthFocus();
      var dpool = focus === 'deep' ? [50, 100] : focus === 'short' ? [10, 20, 30] : [10, 20, 30, 50, 100];
      var depth = dpool[rnd(dpool.length)], roll = Math.random();
      if (focus === 'deep') roll = roll < 0.45 ? roll * 0.78 : 0.74 + (roll - 0.45) * 0.473;   // ~32% raise-war spots
      if (roll < 0.20) s = { mode: 'pf', kind: 'open', pos: P.POS[rnd(P.POS.length)], depth: depth };
      else if (roll < 0.40) {
        // facing an open: hero is a NAMED seat acting after the opener
        var opener = ['EP', 'MP', 'CO', 'BTN', 'SB'][rnd(5)];
        var later = seatsAfter(opener);
        var vseat = later[rnd(later.length)];
        s = { mode: 'pf', kind: 'vs', opener: opener, vseat: vseat,
          blind: (vseat === 'SB' || vseat === 'BB') ? vseat : null, depth: depth };
      }
      else if (roll < 0.54) {
        // squeeze spot with a NAMED hero seat — callers must FIT between opener and hero
        var sqOpener = ['EP', 'MP', 'CO'][rnd(3)];
        var sqRoll = Math.random();
        var sqSeat = sqRoll < 0.5 ? 'BB' : sqRoll < 0.65 ? 'SB'
          : (function () { var f = seatsAfter(sqOpener).filter(function (x) { return x !== 'SB' && x !== 'BB' && PRE_ORDER.indexOf(x) - PRE_ORDER.indexOf(sqOpener) >= 2; }); return f[rnd(f.length)] || 'BB'; })();
        var sqGap = PRE_ORDER.indexOf(sqSeat) - PRE_ORDER.indexOf(sqOpener) - 1;
        s = { mode: 'pf', kind: 'squeeze', opener: sqOpener, vseat: sqSeat, callers: 1 + rnd(Math.max(1, Math.min(2, sqGap))) - (sqGap >= 1 ? 0 : 0), depth: depth };
        if (s.callers > sqGap) s.callers = Math.max(1, sqGap);
      }
      else if (roll < 0.60) { var ip0 = ['MP', 'CO', 'BTN', 'SB'][rnd(4)]; s = { mode: 'pf', kind: 'iso', pos: ip0, limpers: Math.min(1 + rnd(2), PRE_ORDER.indexOf(ip0)), depth: depth }; }
      else if (roll < 0.63) s = { mode: 'pf', kind: 'bbopt', limpers: 1 + rnd(2), depth: depth };   // BB option in a limped pot: check or raise
      else if (roll < 0.66) { var lp0 = ['MP', 'CO', 'BTN', 'SB'][rnd(4)]; s = { mode: 'pf', kind: 'limpRR', pos: lp0, limpers: Math.min(1 + rnd(2), PRE_ORDER.indexOf(lp0)), depth: Math.max(depth, 30) }; }   // you iso'd, a limper limp-reraises
      else if (roll < 0.76 && pfDepthFocus() !== 'deep') s = { mode: 'pf', kind: 'calljam', pos: P.POS[rnd(P.POS.length)], depth: [8, 10, 12, 15][rnd(4)] };
      else if (roll < 0.85) {
        // cold 3-bet: open + 3-bet in front, action on a NAMED hero seat
        var op2 = ['EP', 'MP', 'CO'][rnd(3)];
        var rs = seatsAfter(op2).filter(function (x) { return x !== 'BB'; });
        var raiser = rs[rnd(rs.length)];
        var heroPool = seatsAfter(raiser);
        var c3d = pfDepthFocus() === 'deep' ? [50, 100] : pfDepthFocus() === 'short' ? [20, 30] : [20, 30, 50, 100];
        s = { mode: 'pf', kind: 'cold3b', opener: op2, raiser: raiser,
          vseat: heroPool[rnd(heroPool.length)], depth: c3d[rnd(c3d.length)] };
      }
      else if (roll < 0.94) {
        // you opened, got 3-bet — both seats named, position derived
        var heroOpen = ['EP', 'MP', 'CO', 'BTN'][rnd(4)];
        var tbPool = seatsAfter(heroOpen);
        var tb3 = tbPool[rnd(tbPool.length)];
        s = { mode: 'pf', kind: 'vs3bet', pos: heroOpen, raiser: tb3,
          pos3: ipVs(heroOpen, tb3), depth: (pfDepthFocus() === 'deep' ? [50, 100] : pfDepthFocus() === 'short' ? [20, 30] : [20, 30, 50, 100])[rnd(pfDepthFocus() === 'all' ? 4 : 2)] };
      }
      else {
        // DEEP: you 3-bet, they 4-bet — premium dilemmas (QQ/JJ call at 100bb, AQs folds)
        var h4 = ['MP', 'CO', 'BTN', 'SB', 'BB'][rnd(5)];
        var before4 = PRE_ORDER.slice(0, PRE_ORDER.indexOf(h4));
        var op4 = before4.length ? before4[rnd(before4.length)] : 'EP';
        s = { mode: 'pf', kind: 'vs4bet', vseat: h4, raiser: op4,
          pos3: ipVs(h4, op4), depth: Math.random() < 0.5 ? 50 : 100 };
        if (pfDepthFocus() === 'short') s.depth = 50;   // vs4bet only exists deep
      }
    }
    attachHand(s, pfThreshold(s)); return s;
  }

  /* ---- FREE TIER: first-in at 100bb (LAUNCH_PLAN §2) ----
     A free player drills the one decision the free 100bb chart answers: everyone has folded
     to you, raise or fold. Every seat that chart covers, the small blind included; honest
     random cards, the way a live table deals them. The open can still get 3-bet behind,
     rolled exactly like the live deal (Dealer.chainRaiser), and that chained "they re-raise
     you" spot is free 10 times a local day (Dealer.threeBetsOn counts the drill log). Every
     other spot, depth and street is Pro. */
  var FREE_3BET_DAY = (window.Dealer && window.Dealer.FREE_3BET_DAY) || 10;
  function myDrills() { var db = window.pokerDB && window.pokerDB(); return (db && db.drills) || []; }
  function threeBetsToday() { return window.Dealer && window.Dealer.threeBetsOn ? window.Dealer.threeBetsOn(myDrills()) : 0; }
  // Misses a free player can be dealt again: first-in at 100bb only, since that is all the
  // free deal deals. A 3-bet spot comes only by the chain; a Pro-era miss waits for Pro.
  function freeMiss(m) { return !!m && m.kind === 'open' && m.depth === 100 && P.POS.indexOf(m.pos) >= 0; }
  function scenarioFree() {
    var pool = stats.misses.filter(freeMiss);
    var s;
    if (pool.length && Math.random() < 0.3) {
      var m = pool[rnd(pool.length)];
      s = { mode: 'pf', replay: true };
      COPY.forEach(function (k) { s[k] = m[k]; });
      attachHand(s, pfThreshold(s));
    } else {
      var hand = dealCards(2);
      s = { mode: 'pf', kind: 'open', pos: P.POS[rnd(P.POS.length)], depth: 100, c1: hand[0], c2: hand[1] };
      s.label = P.handLabel(s.c1, s.c2);
    }
    s.free = true;
    if (s.kind === 'open' && window.Dealer && window.Dealer.chainRaiser) {
      var cr = window.Dealer.chainRaiser(s.pos, s.depth);
      if (cr) s.chainRaiser = cr;
    }
    return s;
  }
  function scenarioOdds() {
    var variant = Math.random() < 0.5 ? 'turn' : 'flop';
    var key = ['flush', 'oesd', 'gut', 'overs', 'fgut', 'foesd'][rnd(6)], d = PF.DRAWS[key];
    var boardCount = variant === 'turn' ? 4 : 3, deal = PF.genDraw(key, boardCount);
    var pot = [200, 300, 400, 500, 600][rnd(5)];
    var bet = Math.max(20, Math.round(pot * [0.33, 0.5, 0.66, 0.75, 1][rnd(5)] / 10) * 10);
    return { mode: 'odds', variant: variant, key: key, name: d.name, outs: d.outs, hole: deal.hole, board: deal.board,
      pot: pot, bet: bet, required: PF.requiredEquity(bet, pot), equity: variant === 'turn' ? d.one : d.two };
  }
  var FRACS = [{ f: 1 / 3, t: '⅓ pot' }, { f: 1 / 3, t: '⅓ pot' }, { f: 0.5, t: '½ pot' }, { f: 0.5, t: '½ pot' }, { f: 0.75, t: '¾ pot' }, { f: 1, t: 'pot' }];
  // Villain range assumptions (percentile bands on the 169-hand ranking).
  // Shown in feedback so the model is never a black box.
  var RANGES = {
    blindDefend: { band: [0.03, 0.45], desc: 'blind-defend ~top 45%' },
    coldCall: { band: [0.03, 0.12], desc: 'cold-call ~top 12%' },
    openerVs3bet: { band: [0.02, 0.15], desc: 'opener flats 3-bet ~top 15%' }
  };
  function openerRange(seat) {
    var t = P.openThreshold(seat, 30);
    return { band: [0, t], desc: sc(seat) + ' open ~top ' + Math.round(t * 100) + '%' };
  }
  // MULTIWAY c-bet (David's ask): you opened, TWO players called, 3-way flop,
  // you're first to act. The lesson: bluffing collapses (you need BOTH to fold),
  // so c-bet value-heavy and check your air. Equity is vs the FIELD (beat both).
  function scenarioCbetMW() {
    var heroSeat = ['EP', 'MP', 'CO'][rnd(3)];
    var after = seatsAfter(heroSeat);                       // 2 distinct callers behind
    var pickN = function (arr, k) { var c = arr.slice(), o = []; while (o.length < k && c.length) o.push(c.splice(rnd(c.length), 1)[0]); return o; };
    var callers = pickN(after.length >= 2 ? after : ['CO', 'BTN', 'SB', 'BB'], 2);
    var hole = cardsFor(handInBand(0, P.openThreshold(heroSeat, 30)));
    var board = dealAvoiding(3, hole);
    var cls = PF.classifyFlop(hole, board), tex = PF.textureOf(board);
    var edge = PF.preflopEdge({ potType: 'srp', callerBlind: false, openerEarly: isEarly(heroSeat) }, tex);
    var pool = P.bandCombos(RANGES.coldCall.band[0], RANGES.coldCall.band[1]);
    var cond = function (c1, c2, b) { return PF.CONT_FREQ[PF.classifyFlop([c1, c2], b).category]; };  // they called the flop (we condition the field on continuing)
    var eq = H.equityVsField(hole, board, [pool, pool], { n: 500, conditions: [cond, cond] });
    var tier = PF.handTier(cls, eq);
    var ctx = { eq: eq, price: null, frac: null, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush, edge: edge, wet: tex.wet, pos: 'oop', potType: 'srp', tier: tier, multiway: 2 };
    var fn = PF.flopDecide('oopFirst', ctx);
    var mix = PF.flopMix('oopFirst', ctx);
    // pot: 3 players × 2.2 (open) + dead money from folded blinds + BB ante
    var pot = 3 * 2.2 + (callers.indexOf('SB') < 0 ? 0.5 : 0) + (callers.indexOf('BB') < 0 ? 1 : 0) + 1;
    pot = Math.round(pot * 2) / 2;
    return { mode: 'cbet', multiway: 2, hole: hole, board: board, role: 'aggressor', pos: 'oop', potType: 'srp',
      heroSeat: heroSeat, callers: callers, node: 'oopFirst', cls: cls, tex: tex, edge: edge,
      pot: pot, bet: null, frac: null, price: null, eq: eq, villDesc: '2 cold-callers ~top 12% each', fn: fn, mix: mix, tier: tier, ctx: ctx };
  }
  function scenarioCbet() {
    var leak = pfDepthFocus() === 'leak';                  // curated facing-aggression set (fixed, NOT
    // derived from this user's misses — the button says "facing agg" so it never claims to be)
    var raises = pfDepthFocus() === 'raises';              // 🔼 raise-or-fold reps: face small bets, decide fold/call/RAISE
    var facingFocus = leak || raises;
    if (!facingFocus && Math.random() < 0.18) return scenarioCbetMW();     // multiway c-bet (3-way), David's ask
    var role = facingFocus ? 'defender' : (Math.random() < 0.5 ? 'aggressor' : 'defender');   // facing focus = you’re the one facing the bet
    var heroSeat, villSeat, pos, node, potType = 'srp', band, villRange;
    if (role === 'aggressor') {
      potType = Math.random() < 0.25 ? '3bet' : 'srp';
      if (potType === '3bet') {
        // villain OPENS first; hero 3-bets from a seat that acts AFTER them preflop
        villSeat = ['EP', 'MP', 'CO', 'BTN'][rnd(4)];
        var later = seatsAfter(villSeat);
        heroSeat = later[rnd(later.length)];
        pos = ipVs(heroSeat, villSeat);
        node = pos === 'ip' ? (Math.random() < 0.85 ? 'ipCheck' : 'ipBet') : 'oopFirst';
        band = [0, P.vsThresholds(30, villSeat).tb];                      // hero's 3-bet range
        villRange = RANGES.openerVs3bet;
      } else if (Math.random() < 0.5) {                 // SRP, hero IP, villain in the blinds
        heroSeat = ['MP', 'CO', 'BTN'][rnd(3)]; villSeat = ['SB', 'BB'][rnd(2)]; pos = 'ip';
        node = Math.random() < 0.82 ? 'ipCheck' : 'ipBet';   // caller mostly checks; sometimes donks
        band = [0, P.openThreshold(heroSeat, 30)];
        villRange = RANGES.blindDefend;
      } else {                                          // SRP, hero OOP opener, villain flats behind
        heroSeat = ['EP', 'MP'][rnd(2)]; villSeat = ['CO', 'BTN'][rnd(2)]; pos = 'oop';
        node = 'oopFirst';
        band = [0, P.openThreshold(heroSeat, 30)];
        villRange = RANGES.coldCall;
      }
    } else {                                            // hero is the caller / defender
      if (Math.random() < 0.5) {                        // hero IP defender (flatted on the button)
        villSeat = ['EP', 'MP', 'CO'][rnd(3)]; heroSeat = 'BTN'; pos = 'ip';
        node = facingFocus ? 'ipBet' : (Math.random() < 0.5 ? 'ipCheck' : 'ipBet');   // leak/raises: face the c-bet, don't get a free check
        band = [0.04, 0.26];
      } else {                                          // hero OOP defender (defended a blind)
        villSeat = ['CO', 'BTN'][rnd(2)]; heroSeat = ['SB', 'BB'][rnd(2)]; pos = 'oop';
        node = 'oopBet';
        band = [0.04, 0.52];
      }
      villRange = openerRange(villSeat);                // villain = the opener
    }
    // deal hero a hand actually in their preflop range for this spot
    var hole = cardsFor(handInBand(band[0], band[1]));
    var board = dealAvoiding(3, hole);
    var cls = PF.classifyFlop(hole, board), tex = PF.textureOf(board);
    var edge = role === 'aggressor'
      ? PF.preflopEdge({ potType: potType, callerBlind: villSeat === 'SB' || villSeat === 'BB', openerEarly: isEarly(heroSeat) }, tex)
      : PF.defenderEdge(tex);
    // pot + (maybe) a bet to face — price computed from the actual numbers shown
    var pot = potType === '3bet' ? 18 : 6;
    var facing = node === 'ipBet' || node === 'oopBet';
    var frac = facing ? (raises ? FRACS[rnd(4)] : FRACS[rnd(FRACS.length)]) : null;   // raises: small bets (⅓–½) → raising is live
    var bet = facing ? Math.round(pot * frac.f * 2) / 2 : null;
    var price = facing ? PF.requiredEquity(bet, pot) : null;
    // hero equity vs villain's range, conditioned on what they did
    var combos = P.bandCombos(villRange.band[0], villRange.band[1]);
    var condition = null;
    if (facing) condition = function (c1, c2, b) { return PF.BET_FREQ[PF.classifyFlop([c1, c2], b).category]; };
    else if (node === 'ipCheck') condition = function (c1, c2, b) { return PF.CHECK_FREQ[PF.classifyFlop([c1, c2], b).category]; };
    var eq = H.equityVsRange(hole, board, combos, { n: 650, condition: condition });
    var tier = PF.handTier(cls, eq);
    var ctx = { eq: eq, price: price, frac: frac ? frac.f : null, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush, edge: edge, wet: tex.wet, pos: pos, potType: potType, tier: tier };
    var fn = PF.flopDecide(node, ctx);
    var mix = PF.flopMix(node, ctx);
    return { mode: 'cbet', hole: hole, board: board, role: role, pos: pos, potType: potType,
      heroSeat: heroSeat, villSeat: villSeat, node: node, cls: cls, tex: tex, edge: edge,
      pot: pot, bet: bet, frac: frac, price: price, eq: eq, villDesc: villRange.desc, fn: fn, mix: mix, tier: tier, ctx: ctx };
  }
  // ---- TURN spots: the flop story already happened; plan meets reality ----
  // SIX sub-stories. Aggressor side: barrel (c-bet called → you continue), lead
  // (c-bet called → they donk), delayed (flop checked through → they bet), probe
  // (flop checked through → they check again, YOU decide bet/check), probeRaised
  // (flop checked through → you stab → they check-raise). Caller side: barreled
  // (you called the flop c-bet → they fire again). The three checked-through
  // lines (delayed/probe/probeRaised) were under-represented — David's catch.
  function scenarioTurn(facingOnly) {
    var raises = pfDepthFocus() === 'raises';              // 🔼 raises: face small bets you can RAISE (no facing-a-check-raise)
    facingOnly = facingOnly || pfDepthFocus() === 'leak' || raises;
    var r0 = Math.random();
    // 🩹 leak = FACING-aggression turns; 🔼 raises = small-bet facing only (donk lead / 2nd barrel / turn bet), no probeRaised
    var sub = facingOnly
      ? (raises ? (r0 < 0.4 ? 'barreled' : r0 < 0.7 ? 'lead' : 'delayed')
        : (r0 < 0.30 ? 'barreled' : r0 < 0.52 ? 'lead' : r0 < 0.78 ? 'delayed' : 'probeRaised'))
      : r0 < 0.26 ? 'barrel' : r0 < 0.38 ? 'lead' : r0 < 0.54 ? 'delayed' : r0 < 0.67 ? 'probe' : r0 < 0.78 ? 'probeRaised' : 'barreled';
    var heroSeat, villSeat, pos, node, potType = 'srp', band, villRange;
    if (sub !== 'barreled') {                              // hero is the preflop aggressor
      potType = Math.random() < 0.22 ? '3bet' : 'srp';
      var needIp = sub !== 'barrel';    // lead/delayed/probe/probeRaised all need hero IP
      if (potType === '3bet') {
        villSeat = ['EP', 'MP', 'CO'][rnd(3)];
        var later = seatsAfter(villSeat).filter(function (x) { return !needIp || ipVs(x, villSeat) === 'ip'; });
        heroSeat = later[rnd(later.length)];
        pos = ipVs(heroSeat, villSeat);
        band = [0, P.vsThresholds(30, villSeat).tb];
        villRange = RANGES.openerVs3bet;
      } else if (needIp || Math.random() < 0.5) {          // SRP, hero IP vs a blind
        heroSeat = ['MP', 'CO', 'BTN'][rnd(3)]; villSeat = ['SB', 'BB'][rnd(2)]; pos = 'ip';
        band = [0, P.openThreshold(heroSeat, 30)];
        villRange = RANGES.blindDefend;
      } else {                                             // SRP, hero OOP opener vs cold-caller
        heroSeat = ['EP', 'MP'][rnd(2)]; villSeat = ['CO', 'BTN'][rnd(2)]; pos = 'oop';
        band = [0, P.openThreshold(heroSeat, 30)];
        villRange = RANGES.coldCall;
      }
      node = sub === 'barrel' ? (pos === 'ip' ? 'ipCheck' : 'oopFirst')
        : sub === 'probe' ? 'ipCheck'        // checked through twice — YOU decide bet/check
        : 'ipBet';                           // lead / delayed / probeRaised — you face a bet/raise
    } else {                                               // hero called a c-bet, faces the 2nd barrel
      if (Math.random() < 0.5) { villSeat = ['EP', 'MP', 'CO'][rnd(3)]; heroSeat = 'BTN'; pos = 'ip'; node = 'ipBet'; band = [0.04, 0.26]; }
      else { villSeat = ['CO', 'BTN'][rnd(2)]; heroSeat = ['SB', 'BB'][rnd(2)]; pos = 'oop'; node = 'oopBet'; band = [0.04, 0.52]; }
      villRange = openerRange(villSeat);
    }
    var hole = cardsFor(handInBand(band[0], band[1]));
    var board = dealAvoiding(4, hole);
    var cls = PF.classifyFlop(hole, board), texF = PF.textureOf(board.slice(0, 3)), tex4 = PF.textureOf(board);
    var edge = sub !== 'barreled'
      ? PF.preflopEdge({ potType: potType, callerBlind: villSeat === 'SB' || villSeat === 'BB', openerEarly: isEarly(heroSeat) }, texF)
      : PF.defenderEdge(texF);
    // pot through the flop story
    var pot0 = potType === '3bet' ? 18 : 6;
    var f1 = [1 / 3, 1 / 3, 0.5][rnd(3)];
    var b1 = Math.round(pot0 * f1 * 2) / 2;
    var potT = (sub === 'delayed' || sub === 'probe') ? pot0   // flop checked through: no flop bet in the pot
      : pot0 + 2 * b1;                                          // a flop bet (or your turn stab) is in
    var facing = node === 'ipBet' || node === 'oopBet';
    var frac = facing ? (sub === 'probeRaised' ? FRACS[4] : raises ? FRACS[rnd(4)] : FRACS[rnd(FRACS.length)]) : null;   // check-raise big; raises-focus small
    var bet = facing ? Math.round(potT * frac.f * 2) / 2 : null;
    var price = facing ? PF.requiredEquity(bet, potT) : null;
    // villain range conditioned on the WHOLE story: flop action × turn action
    var combos = P.bandCombos(villRange.band[0], villRange.band[1]);
    var FC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b.slice(0, 3)).category; };
    var TC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b).category; };
    // a turn check-raise (after checking the flop) is POLARIZED — nutted value +
    // a few semibluffs/bluffs, almost no medium hands (those just call)
    var XR = { value: 0.85, draw: 0.55, airdraw: 0.30, air: 0.18, overs: 0.05, medium: 0.08 };
    var condition =
      sub === 'barrel' ? (node === 'ipCheck'
        ? function (c1, c2, b) { return PF.CONT_FREQ[FC(c1, c2, b)] * PF.CHECK_FREQ[TC(c1, c2, b)]; }
        : function (c1, c2, b) { return PF.CONT_FREQ[FC(c1, c2, b)]; })
        : sub === 'lead' ? function (c1, c2, b) { return PF.CONT_FREQ[FC(c1, c2, b)] * PF.BET_FREQ[TC(c1, c2, b)]; }
          : sub === 'delayed' ? function (c1, c2, b) { return PF.CHECK_FREQ[FC(c1, c2, b)] * PF.BET_FREQ[TC(c1, c2, b)]; }
            : sub === 'probe' ? function (c1, c2, b) { return PF.CHECK_FREQ[FC(c1, c2, b)] * PF.CHECK_FREQ[TC(c1, c2, b)]; }
              : sub === 'probeRaised' ? function (c1, c2, b) { return PF.CHECK_FREQ[FC(c1, c2, b)] * (XR[TC(c1, c2, b)] || 0.1); }
                : function (c1, c2, b) { return PF.BET_FREQ[FC(c1, c2, b)] * PF.BET_FREQ[TC(c1, c2, b)]; };
    var eq = H.equityVsRange(hole, board, combos, { n: 550, condition: condition });
    var tier = PF.handTier(cls, eq);
    var tcard = PF.classifyTurnCard(hole, board.slice(0, 3), board[3]);
    var ctx = { eq: eq, price: price, frac: frac ? frac.f : null, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush,
      edge: edge, wet: tex4.wet, pos: pos, potType: potType, street: 'turn', tier: tier, tcard: tcard };
    var fn = PF.flopDecide(node, ctx);
    var mix = PF.flopMix(node, ctx);
    return { mode: 'cbet', street: 'turn', sub: sub, hole: hole, board: board,
      role: sub === 'barreled' ? 'defender' : 'aggressor', pos: pos, potType: potType,
      heroSeat: heroSeat, villSeat: villSeat, node: node, cls: cls, tex: tex4, edge: edge,
      pot: potT, f1txt: f1 === 0.5 ? '½' : '⅓', bet: bet, frac: frac, price: price, eq: eq,
      villDesc: villRange.desc, fn: fn, mix: mix, tier: tier, tcard: tcard, ctx: ctx };
  }
  // ---- RIVER spots: the board is complete — no draws, pure showdown value. The
  // villain range is conditioned on the WHOLE LINE (called/bet flop, barrel or
  // check turn, then the river) — so calling two streets actually NARROWS them to
  // made hands + busted draws. Two equities matter:
  //   eqShow = vs that whole range → the bluff-CATCH / showdown decision.
  //   eqCall = vs the hands that would CALL a river bet (made hands, not air) →
  //            the VALUE decision. High showdown equity built on busted draws is
  //            NOT value: betting folds those out and only better calls (David's
  //            99-on-KTT catch — "what worse calls after calling two streets?").
  var RIVER_BET = { value: 0.90, medium: 0.22, overs: 0.42, airdraw: 0.45, air: 0.45, draw: 0.60 };   // their river BET (polar)
  var RIVER_CHK = { value: 0.30, medium: 0.80, overs: 0.70, airdraw: 0.70, air: 0.70, draw: 0.50 };   // their CHECKED range (capped)
  var RIVER_CALL = { value: 0.92, medium: 0.55, overs: 0.12, airdraw: 0.12, air: 0.05, draw: 0.40 };  // what CALLS your river bet (made hands)
  function scenarioRiver() {
    var role = Math.random() < 0.5 ? 'aggressor' : 'defender';
    var heroSeat, villSeat, pos, potType = 'srp', band, villRange;
    if (role === 'aggressor') {
      potType = Math.random() < 0.2 ? '3bet' : 'srp';
      if (potType === '3bet') {
        villSeat = ['EP', 'MP', 'CO'][rnd(3)]; var later = seatsAfter(villSeat); heroSeat = later[rnd(later.length)]; pos = ipVs(heroSeat, villSeat);
        band = [0, P.vsThresholds(30, villSeat).tb]; villRange = RANGES.openerVs3bet;
      } else { heroSeat = ['MP', 'CO', 'BTN'][rnd(3)]; villSeat = ['SB', 'BB'][rnd(2)]; pos = 'ip'; band = [0, P.openThreshold(heroSeat, 30)]; villRange = RANGES.blindDefend; }
    } else {
      if (Math.random() < 0.5) { villSeat = ['EP', 'MP', 'CO'][rnd(3)]; heroSeat = 'BTN'; pos = 'ip'; band = [0.04, 0.26]; }
      else { villSeat = ['CO', 'BTN'][rnd(2)]; heroSeat = ['SB', 'BB'][rnd(2)]; pos = 'oop'; band = [0.04, 0.52]; }
      villRange = openerRange(villSeat);
    }
    // Build the pot through a COHERENT betting line — the aggressor barrels 1-2
    // streets, called (so the river pot actually matches the action, instead of
    // the old "checks through to an 18bb pot" incoherence). Then the river plays:
    // a defender mostly faces another bet (bluff-catch); the aggressor mostly gets
    // to decide (3rd barrel / value / check-to-induce), sometimes faces a donk.
    var barrels = Math.random() < 0.6 ? 2 : 1;
    var pot = potType === '3bet' ? 14 : 5;
    for (var k = 0; k < barrels; k++) { var bk = Math.round(pot * 0.6); pot += 2 * bk; }
    pot = Math.round(pot);
    var faceBet = role === 'defender' ? Math.random() < 0.68 : Math.random() < 0.38;
    // COHERENT hero line: a defender who CALLED the flop c-bet (and a turn barrel,
    // if any) can't have been holding stone air — re-deal until hero's flop (and
    // barreled-turn) hand is a plausible continue. The aggressor may have barreled
    // air (a realistic river bluff/give-up), so only gate the defender's calls.
    var heroDef = role === 'defender';
    var hole, board, tries = 0, coherent = false;
    while (!coherent && tries++ < 60) {
      hole = cardsFor(handInBand(band[0], band[1]));
      board = dealAvoiding(5, hole);
      coherent = !heroDef || (PF.classifyFlop(hole, board.slice(0, 3)).category !== 'air'
        && (barrels < 2 || PF.classifyFlop(hole, board.slice(0, 4)).category !== 'air'));
    }
    var cls = PF.classifyFlop(hole, board), texF = PF.textureOf(board.slice(0, 3));
    var edge = role === 'aggressor'
      ? PF.preflopEdge({ potType: potType, callerBlind: villSeat === 'SB' || villSeat === 'BB', openerEarly: isEarly(heroSeat) }, texF)
      : PF.defenderEdge(texF);
    var frac = faceBet ? FRACS[rnd(FRACS.length)] : null;
    var bet = faceBet ? Math.round(pot * frac.f * 2) / 2 : null;
    var price = faceBet ? PF.requiredEquity(bet, pot) : null;
    var combos = P.bandCombos(villRange.band[0], villRange.band[1]);
    var FC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b.slice(0, 3)).category; };
    var TC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b.slice(0, 4)).category; };
    var RC = function (c1, c2, b) { return PF.classifyFlop([c1, c2], b).category; };
    var villBet = role === 'defender';                     // villain was the bettor; aggressor = villain called
    var sw = function (cls2, betting) { return betting ? PF.BET_FREQ[cls2] : PF.CONT_FREQ[cls2]; };
    var lineW = function (c1, c2, b) {                     // called/bet flop, then (barrel or checked) turn
      var pf = sw(FC(c1, c2, b), villBet);
      var pt = barrels >= 2 ? sw(TC(c1, c2, b), villBet) : PF.CHECK_FREQ[TC(c1, c2, b)];
      return pf * pt;
    };
    var showCond = function (c1, c2, b) { return lineW(c1, c2, b) * (faceBet ? RIVER_BET[RC(c1, c2, b)] : RIVER_CHK[RC(c1, c2, b)]); };
    var eq = H.equityVsRange(hole, board, combos, { n: 700, condition: showCond });
    var eqCall = eq;
    if (!faceBet) {                                        // value decision: equity vs the CALLING range, not the whole range
      var callCond = function (c1, c2, b) { return lineW(c1, c2, b) * RIVER_CALL[RC(c1, c2, b)]; };
      eqCall = H.equityVsRange(hole, board, combos, { n: 700, condition: callCond });
    }
    var tier = PF.handTier(cls, eq);
    var node = faceBet ? (pos === 'ip' ? 'ipBet' : 'oopBet') : (pos === 'ip' ? 'ipCheck' : 'oopFirst');
    var ctx = { eq: eq, eqCall: eqCall, price: price, frac: frac ? frac.f : null, cat: cls.category, made: cls.made, nutFlush: cls.nutFlush, edge: edge, wet: texF.wet, pos: pos, potType: potType, street: 'river', tier: tier };
    var fn = PF.flopDecide(node, ctx), mix = PF.flopMix(node, ctx);
    return { mode: 'river', street: 'river', sub: faceBet ? 'riverFace' : 'riverBet', barrels: barrels, hole: hole, board: board, role: role, pos: pos, potType: potType,
      heroSeat: heroSeat, villSeat: villSeat, node: node, cls: cls, tex: texF, edge: edge, pot: pot, bet: bet, frac: frac, price: price, eq: eq,
      villDesc: villRange.desc, fn: fn, mix: mix, tier: tier, ctx: ctx };
  }
  var ACT_CLS = { check: 'fold', bet: 'go', fold: 'fold', call: 'call', raise: 'threebet' };
  var pendingChain = null;

  // ---- REAL SPOTS: real turn/river hands (PHH/Pluribus) with the action-aware
  // engine take + the ACTUAL outcome baked in (tools/phh_build_pool.js → realspots.json).
  // These REPLACE the synthetic turn/river generators (kept only as offline fallback).
  var REAL_POOL = null, REAL_ERR = false;
  function loadRealPool() {
    if (REAL_POOL || REAL_ERR) return;
    if (typeof fetch === 'undefined') { REAL_ERR = true; return; }     // no fetch (node/tests) → synthetic fallback
    fetch('./realspots.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (p) { if (Array.isArray(p) && p.length) REAL_POOL = p; else REAL_ERR = true; if (cur && cur.loading) nextSpot(); })
      .catch(function () { REAL_ERR = true; if (cur && cur.loading) nextSpot(); });
  }
  // Facing an all-in there is nothing to raise. The pools offered Raise against an opponent
  // already all-in (or where a call is all the hero has left) in 93 of their 1,939 face-a-bet
  // decisions, and in 42 the engine's answer was raise: an impossible move graded best. The
  // chips in play are rebuilt from the line, as the pool writes it ('BTN bets 2.5', the total
  // bet on that street; 'calls' matches the biggest bet), up to the decision's street.
  var REAL_STREETS = ['preflop', 'flop', 'turn', 'river'];
  function realAllIn(e) {
    if (!e || e.decision !== 'fcr' || !e.line) return false;
    var tot = {}, stack = e.bb || 100;
    for (var i = 0; i < REAL_STREETS.length; i++) {
      var st = REAL_STREETS[i], now = st === 'preflop' ? { SB: 0.5, BB: 1 } : {};
      String(e.line[st] || '').split(' · ').forEach(function (a) {
        var m = /^(\w+) (bets|calls|checks|folds)\s*([\d.]+)?/.exec(a.trim());
        if (!m) return;
        if (m[2] === 'bets') now[m[1]] = +m[3] || 0;
        else if (m[2] === 'calls') now[m[1]] = Math.max.apply(null, [0].concat(Object.keys(now).map(function (k) { return now[k]; })));
      });
      Object.keys(now).forEach(function (k) { tot[k] = (tot[k] || 0) + now[k]; });
      if (st === e.street) break;
    }
    var vill = tot[e.villPos] || 0, hero = tot[e.heroPos] || 0;
    return vill >= stack - 0.1 || e.toCall >= stack - hero - 0.11;
  }
  function realOptions(e) {
    if (e.decision !== 'fcr') return [{ label: 'Check', act: 'check' }, { label: 'Bet', act: 'bet' }];
    return realAllIn(e) ? [{ label: 'Fold', act: 'fold' }, { label: 'Call', act: 'call' }]
      : [{ label: 'Fold', act: 'fold' }, { label: 'Call', act: 'call' }, { label: 'Raise', act: 'raise' }];
  }
  function realScenario(street) {
    // River mode has no Filter-spots UI, so a focus set in flop/turn mode must not
    // silently narrow it — that's exactly the invisible filter optSummary() exists to avoid.
    var foc = pfDepthFocus(), facingOnly = street !== 'river' && (foc === 'leak' || foc === 'raises');
    var pool = REAL_POOL.filter(function (e) { return e.street === street && (!facingOnly || e.decision === 'fcr'); });
    if (!pool.length) pool = REAL_POOL.filter(function (e) { return e.street === street; });
    if (!pool.length) pool = REAL_POOL;
    var e = pool[rnd(pool.length)];
    return { mode: street, street: street, real: true, e: e, hole: e.heroCards.match(/../g), board: e.board, options: realOptions(e) };
  }
  // The pool's lines call every raise "bets" ("MP bets 2.8 · SB bets 7.5"). Preflop every
  // voluntary bet is a raise (the blinds are posted); later streets, the second bet on a
  // street is a raise. Rewritten for display so the line reads like poker.
  // Seat names are lowercase ('button', 'small blind'); at the start of a line they lead.
  function cap1(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }
  function raiseWords(t, preflop) {
    var n = 0;
    return String(t || '').replace(/\b(\w+) bets ([\d.]+)/g, function (m, who, amt) {
      n++;
      return (preflop || n > 1) ? who + ' raises to ' + amt : m;
    });
  }
  // The bet you face, read off the street's line the way raiseWords reads it: a raise when another
  // bet came before it on the street. The header said "BB bets 28.9bb" (the call) under a row that
  // says "BB raises to 39.0" in 170 of the 1,939 facing decisions (Mac review 11).
  function facedBet(e) {
    var n = 0, out = null;
    String((e.line || {})[e.street] || '').split(' · ').forEach(function (a) {
      var m = /^(\w+) bets ([\d.]+)/.exec(a.trim());
      if (!m) return;
      n++;
      if (m[1] === e.villPos) out = { raise: e.street === 'preflop' || n > 1, to: +m[2] };
    });
    return out;
  }
  // The rows say only the folds of players who were in the hand: a fold from someone who had called,
  // bet, raised or checked earlier. "HJ folds · CO folds · BTN folds · SB folds" before the action
  // came round said nothing and took two lines (the owner, 2026-10-16). Display only: facedBet and
  // realAllIn read the pool's whole line.
  function quietFolds(L) {
    var inHand = {}, out = {};
    REAL_STREETS.forEach(function (st) {
      if (L[st] == null) return;
      out[st] = String(L[st]).split(' · ').filter(function (a) {
        var m = /^(\w+) (\w+)/.exec(a.trim());
        if (!m) return true;
        if (m[2] === 'folds') return !!inHand[m[1]];
        inHand[m[1]] = true;
        return true;
      }).join(' · ');
    });
    return out;
  }
  function realSpotHtml(s, prog) {
    var e = s.e, L = quietFolds(e.line || {}), fb = e.decision === 'fcr' ? facedBet(e) : null;
    function row(n, t) { return t ? '<div style="font-size:12.5px;line-height:1.5"><span style="color:var(--dim);display:inline-block;min-width:54px">' + n + '</span> ' + esc(seatTxt(raiseWords(t, n === 'Preflop'))) + '</div>' : ''; }
    var vp = seatW(e.villPos), hp = seatW(e.heroPos);
    // The pool's pot already holds the bet you face, while "×pot" is the pot before it. A bet
    // says the pot it went into, so the course's price, bet ÷ (pot + 2 × bet), works off the
    // header: "bets 15bb (1.08×pot) … pot 28.9bb" gave 25% where the feedback said 34% (STUDY-2).
    // A raise keeps the total and says what it holds.
    var face = e.decision === 'fcr'
      ? (fb && fb.raise
          ? '<b>' + vp + '</b> raises to <b>' + fb.to + 'bb</b>' + (e.frac ? ' (' + e.frac + '×pot)' : '') + ', <b>' + e.toCall + 'bb</b> to call' +
            ' — you’re the <b>' + hp + '</b> (' + posW(e.heroIP) + '), pot ' + e.pot + 'bb with the raise in.'
          : '<b>' + vp + '</b> bets <b>' + e.toCall + 'bb</b> into <b>' + Math.round((e.pot - e.toCall) * 10) / 10 + 'bb</b>' + (e.frac ? ' (' + e.frac + '×pot)' : '') +
            ' — you’re the <b>' + hp + '</b> (' + posW(e.heroIP) + ').')
      : (e.heroIP
          ? '<b>' + vp + '</b> checks — you’re the <b>' + hp + '</b> (' + posW(true) + '), pot ' + e.pot + 'bb.'
          : 'you’re <b>first to act</b> — <b>' + hp + '</b> (' + posW(false) + '), pot ' + e.pot + 'bb.');
    var dflt = cardPro() ? 'Real hand · 100bb 6-max' : 'Real hand · ' + T('bb', '100 big blinds') + ' deep, six players';
    // The decision street's row is left out when it is the one clause the bold line restates
    // ("Flop  HJ checks" over "Flop: HJ checks — …"); with more on it (your own check before
    // the bet) it stays (COPY-7), less the faced bet that ends it, which the bold line gives:
    // "River  BB checks · HJ bets 4.5" over "River: HJ bets 4.5bb into 9bb" said the bet twice
    // (NEW-4). A row whose bet is followed by a fold (31 spots) stays whole: the fold came after
    // the bet and reads wrong without it.
    var now = L[e.street] || '', cut = now.lastIndexOf(' · '), fm = /^(\w+) bets [\d.]+$/.exec(now.slice(cut + 3).trim());
    var rest = cut < 0 ? '' : e.decision === 'fcr' && fm && fm[1] === e.villPos ? now.slice(0, cut) : now;
    function srow(n, k) { return row(n, k === e.street ? rest : L[k]); }
    return '<div style="font-size:12.5px;font-weight:500;color:var(--dim);margin-bottom:6px">' + (prog || dflt) + '</div>' +
      srow('Preflop', 'preflop') + srow('Flop', 'flop') + srow('Turn', 'turn') + (e.street === 'river' ? srow('River', 'river') : '') +
      '<div style="margin-top:6px"><b>' + e.street.charAt(0).toUpperCase() + e.street.slice(1) + ':</b> ' + face + '</div>';
  }

  // ---- FULL HANDS: play one real hand decision-by-decision. Each decision is shaped
  // like a real-spot entry (so renderScenario/realSpotHtml reuse cleanly), but the hand
  // carries the constant hero/villain cards + the full run-out tail, and the line GROWS
  // across decisions — so the villain's action between your turns shows up as the next
  // decision's framing, and the hand always follows what actually happened.
  var REAL_HANDS = null, REAL_HANDS_ERR = false;
  function loadRealHands() {
    if (REAL_HANDS || REAL_HANDS_ERR) return;
    if (typeof fetch === 'undefined') { REAL_HANDS_ERR = true; return; }
    fetch('./realhands.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (p) { if (Array.isArray(p) && p.length) REAL_HANDS = p; else REAL_HANDS_ERR = true; if (cur && cur.loading) nextSpot(); })
      .catch(function () { REAL_HANDS_ERR = true; if (cur && cur.loading) nextSpot(); });
  }
  function handAt(hand, di) {                  // build the cur object for decision di of a hand
    var d = hand.decisions[di];
    var e = { street: d.street, bb: hand.bb, heroPos: hand.heroPos, villPos: hand.villPos, heroIP: d.heroIP,
      heroCards: hand.heroCards, villCards: hand.villCards, board: d.board, pot: d.pot, toCall: d.toCall,
      frac: d.frac, decision: d.decision, line: d.line, label: d.label, engine: d.engine, actual: { action: d.actual } };
    return { mode: 'hands', street: d.street, real: true, hands: true, hand: hand, di: di, e: e,
      hole: hand.heroCards.match(/../g), board: d.board, options: realOptions(e) };
  }
  function handScenario() { return handAt(REAL_HANDS[rnd(REAL_HANDS.length)], 0); }

  /* ---- YOUR HANDS ----
     The thing no tracker and no trainer does: replay a hand the player actually flagged and
     make them commit to a line again before showing what they did at the table. There is no
     solver verdict here and there shouldn't be — the value is the gap between what you'd do
     now, cold, and what you did then, tilted, with the note you wrote at the time.
     Fires ~1 spot in 6 so it seasons the rotation instead of taking it over. */
  var MINE_RATE = 0.17;
  function myReviewHands() {
    var db = (typeof window !== 'undefined' && window.pokerDB && window.pokerDB()) || null;
    if (!db || !db.hands) return [];
    // Cards and position are optional: a lazy line ("KK < AA, std") flagged at the table
    // is exactly the kind of hand worth replaying, and renderMine draws it without them.
    return db.hands.filter(function (h) {
      return !h.sample && (h.flag || (h.review && !h.reviewed)) && h.action;
    });
  }
  function mineScenario() {
    var pool = myReviewHands();
    if (!pool.length) return null;
    return { mine: true, mode: 'mine', hand: pool[rnd(pool.length)], revealed: false };
  }
  // The shorthand splits on "/" per street, with a "(board)" opening each postflop street.
  // Rendering it as a hand rather than a line of text is the point: your own hand should sit
  // in the same furniture as a solver spot, or the two feel like different products.
  // Same reading rules as the log (app-core): a slash between digits is a bet size or stakes
  // ('b 2/3 pot', '1/2/5'), not a street break; cards may be '10s', 'KS', 'K♠' or 'K♤'; a board may
  // be written without its parentheses. Duplicated here on purpose: this file also runs standalone
  // under test_ui_smoke, without the app scripts. test_app checks the copies agree.
  var GLY = { '♠': 's', '♤': 's', '♥': 'h', '♡': 'h', '♦': 'd', '♢': 'd', '♣': 'c', '♧': 'c' };
  function cardsOf(str) {
    var out = [];
    String(str || '').replace(/(10|[2-9TJQKA])([shdc♠♤♥♡♦♢♣♧])/gi, function (m, r, su) {
      out.push((r === '10' ? 'T' : r.toUpperCase()) + (GLY[su] || su.toLowerCase())); return m;
    });
    return out;
  }
  // A slash glued between two action letters ('x/c', 'b/f', 'x/r') is one move, not a street break,
  // a call's or raise's size glued on included ('x/r20', 'x/c60') (app-core splitStreetText).
  var GLUE = /^(?:f|[cr](?:\$?\.?\d[\d.,]*(?:bb|x|k)?)?)(?![^\s,;.!?])/i;
  function splitText(action) {
    var out = [];
    String(action || '').split(/(?<!\d)\/|\/(?!\d)/).forEach(function (p, i) {
      if (i && /(?:^|\s)[xb]$/i.test(out[out.length - 1]) && GLUE.test(p)) out[out.length - 1] += '/' + p;
      else out.push(p);
    });
    return out.map(function (x) { return x.trim(); });
  }
  var STREET_LAB = /^(pre|preflop|flop|turn|river)\b:?\s*/i;
  var BARE = /^((?:(?:10|[2-9TJQKA])[shdc♠♥♦♣]\s*){3,5})(?=\s|$)\s*/i;
  // After 'turn' or 'river' a bare card is that street's board ('turn 4h x'); after 'turn', two are
  // the turn and the river together ('turn 4h9c'). As the log reads it (app-core labBoard).
  var LAB_CARD = /^((?:10|[2-9TJQKA])[shdc♠♥♦♣](?:\s*(?:10|[2-9TJQKA])[shdc♠♥♦♣])?)(?=\s|$)\s*/i;
  // 'as', 'ah' and 'ad' are words too ('turn as expected he bet'): the card only when actions or
  // nothing follow it (app-core LAB_WORD).
  var LAB_WORD = /^a[shd]$/i;
  function labMatch(name, rest) {
    var m = rest.match(/^\(([^)]*)\)\s*/) || (!/^pre/i.test(name) && rest.match(BARE));
    if (m || !/^(turn|river)$/i.test(name)) return m;
    m = rest.match(LAB_CARD);
    if (m && LAB_WORD.test(m[1]) && roParse(rest.slice(m[0].length)).bad) return null;
    return m && !(/^river$/i.test(name) && cardsOf(m[1]).length > 1) ? m : null;
  }
  function splitStreets(action) {
    // Label streets by ORIGINAL segment index: filtering empties first shifted every
    // later street's name ("limp//x b40" called the turn line "Flop"). An interior empty
    // segment is skipped as a row but still advances the street. Board is capped at 5, each
    // card once: extra "(..)" groups in a freeform note must not deal a 6-card board, and a
    // board written again ('(Ks7d2c) x x / (Ks7d2c4h)') adds only its new card.
    var parts = splitText(action);
    var names = ['Preflop', 'Flop', 'Turn', 'River'], out = [], board = [], ranBy = [];
    // A line that opens on a board starts on that board's street, as the log reads it (app-core
    // boardSkip): '(Ks7d2c) x b25 c' is a flop, not preflop. Three cards flop, four turn, five river.
    var m0 = /^\(([^)]*)\)/.exec(parts[0] || ''), n0 = m0 ? cardsOf(m0[1]).length : 0;
    var skip = n0 >= 3 ? Math.min(n0, 5) - 2 : 0;
    // And a board that comes all at once after an all-in is the run-out ('jam c / (7s7d2hKh5c)'),
    // by the log's rule (app-core runOuts): more new cards than its street deals, and an all-in and
    // a call before it, or nothing played after it on any street. A street written by name ('flop …')
    // keeps its name; its cards are on the board and count as seen, as the log reads them.
    var seen = {};
    var segs = parts.map(function (seg, i) {
      var m = seg.match(/^\(([^)]*)\)\s*/) || (i > 0 && seg.match(BARE));
      var lab = !m && STREET_LAB.exec(seg), fresh = 0, rest = seg, cards = [];
      if (m) { cards = cardsOf(m[1]); rest = seg.slice(m[0].length); }
      else if (lab) {
        rest = seg.slice(lab[0].length);
        var lm = labMatch(lab[1], rest);
        if (lm) { cards = cardsOf(lm[1]); rest = rest.slice(lm[0].length); }
      }
      cards.forEach(function (c) { if (!seen[c]) { seen[c] = 1; fresh++; if (board.length < 5) board.push(c); } });
      return { seg: m ? rest : seg, act: rest, m: m, lab: !!lab, fresh: fresh, acts: roActs(rest), bn: board.length };
    });
    segs.forEach(function (s, i) {
      var ran = false;
      if (i > 0 && !s.lab && s.fresh > ([0, 3, 1, 1][i + skip] || 1)) {
        var before = segs[i - 1].acts, k = before.lastIndexOf('allin');
        var called = k >= 0 && k < before.length - 1 && before.slice(k + 1).every(function (v) { return v === 'call'; });
        ran = called || segs.slice(i).every(function (t) { return !t.acts.length; });
      }
      ranBy.push(ran);
      if (!s.seg && !s.m) return;
      // ix: the '/' part it came from; bn: how many board cards are out once it has been dealt;
      // act: what was played on it, its board and a street's name lifted off the front.
      out.push({ name: ran ? 'Run-out' : names[i + skip] || 'Street ' + (i + skip + 1), line: s.seg, act: s.act, ix: i, bn: s.bn });
    });
    return { streets: out, board: board, parts: parts, ran: ranBy, text: String(action == null ? '' : action) };
  }
  /* ---- who did what: a copy of the log's readback model ----
     app-core rbStreets, rbParse, rbAttr and rbWho, for this file's standalone tests. In the app the
     replay asks the app's own (window.rbWho); test_app checks this copy gives the same answers.
     An action is a verb, maybe glued to a seat ('btn3b45'), maybe followed by its size ('b 25');
     a seat written apart ('BTN f') belongs to the next action; anything else is a word. */
  var RO_AMT = '(\\$?\\.?\\d[\\d.,]*(?:bb|x|k)?)?';
  var RO_VERBS = [[/^(?:x|check|checks|chk)$/, 'check'], [/^(?:f|fold|folds)$/, 'fold'],
    [new RegExp('^(?:c|call|calls)' + RO_AMT + '$'), 'call'], [new RegExp('^(?:b|bet|bets)' + RO_AMT + '$'), 'bet'],
    [new RegExp('^(?:r|raise|raises|iso|open|opens)' + RO_AMT + '$'), 'raise'], [new RegExp('^3b(?:et)?' + RO_AMT + '$'), '3b'],
    [new RegExp('^[45]b(?:et)?' + RO_AMT + '$'), '4b'], [new RegExp('^(?:jam|jams|shove|shoves|allin|all-in)' + RO_AMT + '$'), 'allin'],
    [/^(?:limp|limps)$/, 'limp']];
  var RO_SEAT = /^(utg\+?1|utg|mp|lj|hj|co|btn|sb|bb)(?=[a-z0-9$])/, RO_SEAT_ALONE = /^(utg\+?1|utg|mp|lj|hj|co|btn|sb|bb)$/;
  function roVerb(t) {
    for (var i = 0; i < RO_VERBS.length; i++) { var m = RO_VERBS[i][0].exec(t); if (m) return { v: RO_VERBS[i][1], amt: m[1] || '' }; }
    return null;
  }
  function roAct(t) {
    var g = RO_SEAT.exec(t), a = g && roVerb(t.slice(g[0].length));
    if (a) { a.seat = g[1].replace('+', ''); return a; }
    return roVerb(t);
  }
  function roIsAmt(t) { return /^\$?\.?\d[\d.,]*(?:bb|x|k|%)?$/.test(t) || /^\d+\/\d+$/.test(t) || t === 'pot'; }
  function roParse(act) {
    var src = String(act || ''), ev = [], tok = /\S+/g, known = 0, unknown = 0, seat = null, seatAt = 0, m;
    while ((m = tok.exec(src))) {
      var raw = m[0], t = raw.toLowerCase().replace(/[,;:!?.]+$/, ''), end = m.index + raw.length;
      if (!t) continue;
      var sm = RO_SEAT_ALONE.exec(t);
      if (sm && !seat) { seat = sm[1].replace('+', ''); seatAt = m.index; known++; continue; }
      // 'x/c', 'b/f', 'x/r': two actions of one player, the bet or raise between them nobody's (app-core rbParse).
      var gl = /^([xb])\/(f|[cr](?:\$?\.?\d[\d.,]*(?:bb|x|k)?)?)$/.exec(t);
      if (gl) {
        var first = roVerb(gl[1]), mid = { v: gl[1] === 'x' ? 'bet' : 'raise', amt: '', implied: true }, then = roVerb(gl[2]);
        first.at = seat ? seatAt : m.index; first.end = m.index + 1; if (seat) first.seat = seat;
        mid.at = m.index + 1; mid.end = m.index + 2; then.at = m.index + 2; then.end = end; then.glued = true;
        seat = null; ev.push(first, mid, then); known++; continue;
      }
      var a = roAct(t);
      if (a) { a.at = seat ? seatAt : m.index; a.end = end; if (seat && !a.seat) a.seat = seat; seat = null; ev.push(a); known++; continue; }
      var last = ev[ev.length - 1];
      if (last && !seat && roIsAmt(t) && !/^(check|fold|limp)$/.test(last.v)) {
        if (!last.amt) { last.amt = t; last.end = end; known++; continue; }
        if (t === 'pot' && /^\d+\/\d+$/.test(last.amt)) { last.amt += ' pot'; last.end = end; known++; continue; }
      }
      unknown++;
    }
    return { ev: ev, known: known, unknown: unknown, bad: unknown > 0 || !!seat };
  }
  // The actions in a street, for the run-out rule above.
  function roActs(line) { return roParse(line).ev.map(function (e) { return e.v; }); }
  function streetBoardOf(seg) {
    var m = /^\(([^)]*)\)\s*(.*)$/.exec(seg);
    if (m) return { board: cardsOf(m[1]), act: m[2] };
    var bare = /^((?:(?:10|[2-9TJQKA])[shdc♠♥♦♣]\s*){3,5})(\s.*|)$/i.exec(seg);
    if (bare) return { board: cardsOf(bare[1]), act: bare[2].trim() };
    return { board: [], act: seg };
  }
  function labBoardOf(name, rest) {
    var sb = streetBoardOf(rest);
    var m = !sb.board.length && /^(turn|river)$/i.test(name) && /^((?:10|[2-9TJQKA])[shdc♠♥♦♣](?:\s*(?:10|[2-9TJQKA])[shdc♠♥♦♣])?)(?=\s|$)\s*(.*)$/i.exec(rest);
    if (!m || (LAB_WORD.test(m[1]) && roParse(m[2]).bad)) return sb;
    var cards = cardsOf(m[1]);
    return /^river$/i.test(name) && cards.length > 1 ? sb : { board: cards, act: m[2].trim() };
  }
  var MW_SEATS = { utg: 1, utg1: 1, mp: 1, lj: 1, hj: 1, co: 1, btn: 1, sb: 1, bb: 1 };
  var MW_POST = ['sb', 'bb', 'utg', 'utg1', 'mp', 'lj', 'hj', 'co', 'btn'];
  var MW_AGGR = { bet: 1, raise: 1, '3b': 1, '4b': 1, allin: 1 };
  function mwNew(S) { var id = 'p' + (S.opps.length + 1); S.opps.push(id); S.live.push(id); return id; }
  function mwMeet(S, seat) {
    if (S.opps.indexOf(seat) >= 0) return seat;
    if (S.live.length === 1 && !MW_SEATS[S.live[0]]) { S.opps[S.opps.indexOf(S.live[0])] = seat; S.live = [seat]; }
    else { S.opps.push(seat); S.live.push(seat); }
    return seat;
  }
  function mwFirst(S) {
    if (S.out || S.live.length !== 1) return '?';
    var o = S.live[0], seat = MW_SEATS[o] ? o : null, h = S.hero;
    if (h && seat) return MW_POST.indexOf(h) < MW_POST.indexOf(seat) ? 'you' : o;
    if (h === 'sb' || seat === 'btn') return 'you';
    if (h === 'btn' || seat === 'sb') return o;
    return '?';
  }
  function mwAttr(ev, pre, S) {
    var out = [], prev = null, aggr = pre ? 'blinds' : null, aggrAt = -1, last = {};
    // Nobody acts twice on a street without a bet or raise after their last action, but for your
    // option in the big blind (app-core rbAttr).
    var may = function (x, e) {
      return !(x in last) || aggrAt > last[x] || (pre && x === 'you' && S.hero === 'bb' && aggr === 'blinds' && (e.v === 'check' || !!MW_AGGR[e.v]));
    };
    ev.forEach(function (e, k) {
      var who;
      if (e.implied) who = '?';
      else if (e.glued) who = out[k - 2];
      else if (e.seat) who = e.seat === S.hero ? 'you' : mwMeet(S, e.seat);
      else if (prev === null) who = pre ? 'you' : mwFirst(S);
      else if (prev === '?') who = '?';
      else if (prev === 'you') who = S.live.length === 1 ? S.live[0] : !S.live.length && pre ? mwNew(S) : '?';
      else who = 'you';
      if (!e.seat && !e.glued && who !== '?' && !may(who, e)) who = pre ? mwNew(S) : '?';
      // The big blind never limps, and calls with nothing raised only as the street's last action
      // (a raise left unwritten): with more after it, that limp or call is another player's (RV-LOG-1).
      if (pre && who === 'you' && !e.seat && S.hero === 'bb' && aggr === 'blinds' && (e.v === 'limp' || (e.v === 'call' && k < ev.length - 1))) who = mwNew(S);
      if (who === 'you' && S.out) who = '?';
      // An unnamed re-raise of your own raise is a third player's squeeze ('r15 c 3b60'), as the log reads it.
      if ((e.v === 'call' || e.v === 'fold' || (MW_AGGR[e.v] && !e.seat)) && who === aggr && who !== '?') who = who === 'you' && pre ? mwNew(S) : '?';
      if (e.v === 'fold' && who === 'you') S.out = true;
      else if (e.v === 'fold' && who !== '?') S.live = S.live.filter(function (x) { return x !== who; });
      if (MW_AGGR[e.v]) { aggr = who; aggrAt = k; }
      if (who !== '?') last[who] = k;
      prev = who;
      out.push(who);
    });
    return out;
  }
  function mineWho(action, ctx) {
    try {
      var text = String(action == null ? '' : action).trim();
      if (!text) return null;
      var streets = splitText(text).map(function (seg, i) {
        var lab = STREET_LAB.exec(seg), at = lab ? { pre: 0, preflop: 0, flop: 1, turn: 2, river: 3 }[lab[1].toLowerCase()] : i;
        if (lab) seg = seg.slice(lab[0].length);
        var sb = lab ? labBoardOf(lab[1], seg) : streetBoardOf(seg);
        if (at === 0 && sb.board.length && !/^\(/.test(seg)) sb = { board: [], act: seg };
        return { i: at, lab: !!lab, board: sb.board, act: sb.act, p: roParse(sb.act) };
      });
      var n0 = streets[0] && !streets[0].lab ? streets[0].board.length : 0, skip = n0 >= 3 ? Math.min(n0, 5) - 2 : 0;
      if (skip) streets.forEach(function (s) { if (!s.lab) s.i += skip; });
      var known = 0, unknown = 0, boards = 0;
      streets.forEach(function (s) { known += s.p.known; unknown += s.p.unknown; if (s.board.length) boards++; });
      if (!boards && unknown && known <= unknown) return null;
      var hero = String((ctx && ctx.pos) || '').toLowerCase().replace('+', '');
      var S = { hero: MW_SEATS[hero] ? hero : null, opps: [], live: [], out: false }, ran = splitStreets(text).ran;
      return streets.map(function (s, n) {
        var who = !s.p.bad && s.p.ev.length ? mwAttr(s.p.ev, s.i === 0, S) : [];
        return { i: s.i, lab: s.lab, ran: !!ran[n] && !s.lab, board: s.board, act: s.act, bad: s.p.bad,
          ev: s.p.ev.map(function (e, k) { return { v: e.v, amt: e.amt, seat: e.seat || null, at: e.at, end: e.end, who: s.p.bad ? '?' : who[k] }; }) };
      });
    } catch (e) { return null; }
  }
  // What you did at the table, in words: "you played c" read as a typo. Free says a 3-bet in
  // words first, as everywhere else on the free tier (§4b): Guided's "re-raise" button writes 3b
  // on any street, so a flagged flop re-raise is a beginner's hand too.
  function playedWords(e, tok, plain) {
    var amt = e.amt || '';
    if (e.v === '3b' || e.v === '4b') {
      var n = (/([345])b/i.exec(tok || '') || [])[1] || (e.v === '3b' ? '3' : '4');
      return (plain ? (n === '3' ? 're-raised' : 'raised again') + ' (' + n + '-bet)' : n + '-bet') + (amt ? ' to ' + amt : '');
    }
    if (e.v === 'allin') return 'went all in';
    return { fold: 'folded', call: 'called', check: 'checked', limp: 'limped', bet: 'bet' + (amt ? ' ' + amt : ''),
      raise: 'raised' + (amt ? ' to ' + amt : '') }[e.v] || tok;
  }
  // Cut the line at your last decision: you decide cold, THEN see what you did. Showing the whole
  // line first (with the marker after your own fold) gave the answer away. Whose action is whose
  // comes from the log's readback model (app-core rbWho): your seat, the order of acting and the
  // seats written on the line. Where it can't say (an opponent nobody named whose seat doesn't
  // settle who acts first, a multiway pot, a street told in words), there is no cut: the hand asks
  // "Same line / Play it differently" instead. A guessed cut hid an opponent's call after your
  // river bet and asked you to answer it.
  function mineCut(parsed, hero) {
    if (!parsed || !parsed.streets.length) return null;
    var W = typeof window.rbWho === 'function' ? window.rbWho : mineWho;
    var st = W(parsed.text, { pos: hero });
    if (!st) return null;
    // The street of the decision: the last one with actions on it. A board that comes after it
    // (the run-out, or a street with nothing played) stays hidden until the reveal.
    var n = -1, i;
    for (i = st.length - 1; i >= 0 && n < 0; i--) if (st[i].ev.length && !st[i].ran) n = i;
    if (n < 0) return null;
    var s = st[n];
    if (s.bad || s.ev.some(function (x) { return x.who === '?'; })) return null;
    var k = -1;
    for (i = s.ev.length - 1; i >= 0 && k < 0; i--) if (s.ev[i].who === 'you') k = i;
    if (k < 0) return null;
    // Facing: a bet, raise or all-in by someone else that you haven't answered on this street, or
    // before the flop the blinds (the big blind with nothing raised has an option instead).
    var e = s.ev[k], pre = s.i === 0, aggr = pre ? 'blinds' : null, aggrV = null;
    for (i = 0; i < k; i++) if (MW_AGGR[s.ev[i].v]) { aggr = s.ev[i].who; aggrV = s.ev[i].v; }
    if (aggr === 'you') return null;                     // you'd be answering your own bet: the line doesn't add up
    var option = pre && aggr === 'blinds' && String(hero || '').toLowerCase() === 'bb';
    var facing = !!aggr && !option, raised = !!MW_AGGR[e.v], did, opts;
    if (facing) {
      did = e.v === 'fold' ? 'fold' : e.v === 'call' || e.v === 'limp' ? 'call' : raised ? 'raise' : null;
      // Facing an all-in there is nothing to raise.
      opts = aggrV === 'allin' ? ['fold', 'call'] : ['fold', 'call', 'raise'];
    } else {
      // Nothing to answer: an all-in or a raise there is your bet (or the big blind's raise).
      did = e.v === 'check' ? 'check' : raised ? (pre ? 'raise' : 'bet') : null;
      opts = pre ? ['check', 'raise'] : ['check', 'bet'];
    }
    if (!did || opts.indexOf(did) < 0) return null;
    var row = null;
    parsed.streets.forEach(function (r, j) { if (r.ix === n) row = j; });
    var line = row === null ? '' : parsed.streets[row].line, off = line.length - s.act.length;
    var part = parsed.parts[n] || '', poff = part.length - s.act.length;
    if (row === null || off < 0 || line.slice(off) !== s.act || poff < 0 || part.slice(poff) !== s.act) return null;
    return {
      streetIx: row, shown: line.slice(0, off + e.at).trim(), hidden: s.act.slice(e.at, e.end), rest: s.act.slice(e.at).trim(),
      did: did, opts: opts, ev: e, bn: parsed.streets[row].bn,
      // The line up to the cut, as the readback reads it, and the run-out flags of the whole line:
      // read alone, the cut text could make a flop and turn written together look like a run-out.
      text: parsed.parts.slice(0, n).concat([part.slice(0, poff + e.at).trim()]).join(' / ').trim(),
      ran: st.map(function (x) { return x.ran; })
    };
  }
  // No cut (whose action is whose isn't settled, or the street is told in words): the street the
  // hand ended on is still held back. Its board is dealt, what was played on it is not, until the
  // answer (CLAUDE.md: "the final street's recorded action stays hidden until you answer"). This
  // needs no attribution: it is the last street with something played on it, never a run-out. A
  // line with no street structure (one street, no board: 'KK < AA, std') can't be split and is
  // shown whole. Same shape as a cut where the rendering reads it (streetIx, shown, bn, text, ran).
  var STREET_NAME = { pre: 'Preflop', preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };
  function mineHold(parsed) {
    if (!parsed || !parsed.streets.length || (parsed.streets.length === 1 && !parsed.board.length)) return null;
    var row = -1, i;
    for (i = parsed.streets.length - 1; i >= 0 && row < 0; i--) {
      if (parsed.streets[i].act && !parsed.ran[parsed.streets[i].ix]) row = i;
    }
    if (row < 0) return null;
    var r = parsed.streets[row], part = parsed.parts[r.ix] || '';
    // What was played sits at the end of the row's line and of its '/' part; what comes before it
    // (the street's name, its board) stays.
    var off = r.line.length - r.act.length, poff = part.length - r.act.length;
    if (off < 0 || r.line.slice(off) !== r.act || poff < 0 || part.slice(poff) !== r.act) return null;
    var lab = STREET_LAB.exec(part);
    return {
      hold: true, streetIx: row, shown: r.line.slice(0, off).trim(), rest: r.act, bn: r.bn,
      // The readback names a street written by name by its name, as the log does.
      name: r.name !== 'Run-out' && lab ? STREET_NAME[lab[1].toLowerCase()] : r.name,
      text: parsed.parts.slice(0, r.ix).concat([part.slice(0, poff).trim()]).join(' / ').trim(),
      ran: parsed.ran
    };
  }
  // The Log's eight seats, as the replay says them on the free tier: [before, glossary key, words].
  var MINE_SEAT = { utg: ['', 'UTG', 'under the gun (UTG)'], utg1: ['in ', 'UTG1', 'UTG+1'], lj: ['in ', 'LJ', 'the lojack (LJ)'],
    hj: ['in ', 'HJ', 'the hijack (HJ)'], mp: ['in ', 'MP', 'middle position (MP)'], co: ['in ', 'CO', 'the cutoff (CO)'],
    btn: ['on ', 'BTN', 'the button (BTN)'], sb: ['in ', 'SB', 'the small blind (SB)'], bb: ['in ', 'BB', 'the big blind (BB)'] };
  // The line the replay reads: a result written in the wrong unit ('| -100bb' in a cash game) isn't
  // lifted on save (LOG-1), so it would stay on the last street and cost the replay its cut; Log
  // strips it for reading (missedResult, NEW-1), and so does Study (the final skeptic, round 2).
  function mineAction(h) {
    var m = h && !h.amount && typeof window.missedResult === 'function' ? window.missedResult(h.action, h.game, h.stakes) : null;
    return m && m.action ? m.action : String((h && h.action) || '');
  }
  // The flagged line read back in words, up to the decision the player is asked to make (the cut),
  // never past it: the hidden action and everything after it stay out of the text that is read.
  // '' when there is nothing to read in words (a story typed as words is shown as written).
  function mineReadback(h, cut, curSym) {
    var text = cut ? cut.text : mineAction(h);
    var lines;
    try { lines = window.readback(text, { pos: h.pos, game: h.game, cur: curSym, ran: cut ? cut.ran : undefined }); } catch (e) { lines = null; }
    if (!lines || !lines.length || (lines.length === 1 && lines[0] === 'Saved as you wrote it.')) return '';
    // A held street with no board written has no line of its own yet: name it, so "you're here"
    // sits on the street you're asked about, not the one before it.
    if (cut && cut.hold && lines[lines.length - 1].indexOf(cut.name + ':') !== 0) lines = lines.concat([cut.name + ':']);
    return '<div class="readback minerb">' + lines.map(function (l, i) {
      return '<div>' + esc(l) + (i === lines.length - 1 && cut ? ' <b class="gld">← you’re here</b>' : '') + '</div>';
    }).join('') + '<div class="mono minesh">' + esc(text) + (cut ? ' …' : '') + '</div></div>';
  }
  // Seat, stack, hole cards and the board dealt so far. Before the answer, the board stops at the
  // street of the decision: a run-out after an all-in is part of what happened, not of the question.
  function mineHandHtml(h, board, plainRb, curSym) {
    var stack = h.eff ? (h.game === 'mtt' ? h.eff + 'bb' : curSym + h.eff) : '';
    var seat = MINE_SEAT[String(h.pos || '').toLowerCase().replace('+', '')];
    // A seat the Log doesn't name (an old or imported hand) still gets the plain stack words.
    return (h.pos ? '<div class="minepos">' + (plainRb && seat
      ? 'You’re ' + seat[0] + '<b>' + T(seat[1], seat[2]) + '</b>'
      : 'You’re the <b>' + esc(String(h.pos).toUpperCase()) + '</b>') +
      (stack ? ' · ' + (plainRb ? T('eff', stack + ' stacks') : esc(stack) + ' effective') : '') + '</div>' : '') +
      (h.c1 && h.c2 ? holeHtml(h.c1, h.c2) : '') +
      (board.length ? '<div class="bdlab">Board</div><div class="board">' + board.map(cardHtml).join('') + '</div>' : '');
  }
  function renderMine(spot) {
    if (spot) cur = spot;                 // tests drive this directly; newScenario sets cur first
    var h = cur.hand;
    resetFb();
    // The hand's day is its session's start date, as History and the Hand window give it (app-history
    // handDay): a hand at 01:30 in a Friday game is Friday's (RV-LOG-4). Its own date in standalone tests.
    var day = h.ts && typeof window.handDay === 'function' && typeof window.shortDate === 'function' ? window.handDay(h) : '';
    var when = day ? window.shortDate(day) : h.ts ? new Date(h.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    var parsed = cur.parsed = splitStreets(mineAction(h));
    var cut = cur.cut = mineCut(parsed, h.pos);
    // With no cut, the street the hand ended on is still held back (its board shown, its play not).
    var hold = cur.hold = cut ? null : mineHold(parsed), stop = cut || hold;
    // "Your line" is for a line the replay can't read by street. One it cut or held back is a
    // preflop line, so it keeps "Preflop" and the "← you're here" the free view gives (STUDY-8).
    var freeform = !stop && parsed.streets.length === 1 && !parsed.board.length;
    $('drillSpot').innerHTML = '<span class="tag">Your hand' + (when ? ' · ' + when : '') +
      (h.stakes ? ' · ' + esc(h.stakes) : '') + '</span>';
    // Free (LAUNCH_PLAN §4b, Appendix A study.js:862-872): the seat and the stack in words, and the
    // line read back in sentences (the Log's readback), with the shorthand kept small under it for
    // whoever wrote it that way. Pro keeps the shorthand rows.
    var plainRb = !cardPro() && typeof window.readback === 'function';
    var curSym = typeof window.cur === 'function' ? window.cur() : '$';
    $('drillHand').innerHTML = mineHandHtml(h, stop ? parsed.board.slice(0, stop.bn) : parsed.board, plainRb, curSym);
    var rbHtml = plainRb ? mineReadback(h, stop, curSym) : '';
    // The rows stop at the street of the decision; nothing after it is shown before the answer.
    var rows = stop ? parsed.streets.slice(0, stop.streetIx + 1) : parsed.streets;
    $('drillQ').innerHTML = (rbHtml ||
      '<div class="streets">' + rows.map(function (st, i) {
        var last = i === rows.length - 1;
        var line = stop && i === stop.streetIx ? stop.shown : st.line;
        return '<div class="street"><span class="st">' + (freeform ? 'Your line' : st.name) + '</span><span class="ln">' +
          esc(line) + (last && !freeform ? ' <b class="gld">← you’re here</b>' : '') + '</span></div>';
      }).join('') + '</div>') +
      '<div class="dim" style="margin-top:10px">' + (cut
        ? 'You flagged this one. What do you do here? Then see what you did at the table.'
        : 'You flagged this one. Would you play it the same way today?' + (hold ? ' Then see what you did at the table.' : '')) + '</div>';
    var W = { fold: 'Fold', call: 'Call', raise: 'Raise', check: 'Check', bet: 'Bet' };
    var C = { fold: 'fold', call: 'call', raise: 'raise', check: 'fold', bet: 'go' };
    $('drillBtns').innerHTML = cut
      ? cut.opts.map(function (o) { return '<button class="act ' + C[o] + '" data-mine="' + o + '">' + W[o] + '</button>'; }).join('')
      : '<button class="act go" data-mine="same">Same line</button>' +
        '<button class="act fold" data-mine="diff">Play it differently</button>';
    $('drillBtns').className = cut && cut.opts.length === 3 ? 'three' : '';
  }
  // The street a no-cut replay held back, now shown: on the free tier in the readback's sentences
  // (the whole line's, from that street on), with the shorthand beside it; Pro, the shorthand.
  function mineHeld(h, hold, parsed, curSym) {
    var said = '';
    if (!cardPro() && typeof window.readback === 'function') {
      try {
        var ctx = { pos: h.pos, game: h.game, cur: curSym, ran: hold.ran };
        var all = window.readback(mineAction(h), ctx), upTo = window.readback(hold.text, ctx);
        var words = function (x) { return !x || !x.length || (x.length === 1 && x[0] === 'Saved as you wrote it.'); };
        // The lines before the held street read the same either way; the held street's own line
        // (its board, if one was written) is replaced by the whole of it.
        if (!words(all) && !words(upTo)) {
          var k = upTo.length - (upTo[upTo.length - 1].indexOf(hold.name + ':') === 0 ? 1 : 0);
          said = all.slice(k).join(' ');
        }
      } catch (e) { said = ''; }
    }
    return '<div class="dim" style="margin-bottom:6px">How it went at the table: ' + (said
      ? '<b>' + esc(said) + '</b> <span class="mono">(' + esc(hold.rest) + ')</span>'
      : '<b class="mono">' + esc(hold.rest) + '</b>') + '</div>';
  }
  function revealMine(answer) {
    var h = cur.hand, cut = cur.cut, hold = cut ? null : cur.hold, stop = cut || hold, chose = null;
    // An action answer (cut line) becomes same/diff by comparing with what was actually done.
    if (answer !== 'same' && answer !== 'diff') { chose = answer; answer = cut && cut.did === chose ? 'same' : 'diff'; }
    $('drillBtns').hidden = true;
    // Now the rest of the board: the run-out (or a street with nothing played) the question held back.
    var parsed = cur.parsed || splitStreets(mineAction(h));
    var curSym = typeof window.cur === 'function' ? window.cur() : '$';
    if (stop && stop.bn < parsed.board.length) {
      $('drillHand').innerHTML = mineHandHtml(h, parsed.board, !cardPro() && typeof window.readback === 'function', curSym);
    }
    var res = h.sign && h.amount ? (h.sign === '-' ? 'lost ' : 'won ') + (h.game === 'mtt' ? h.amount + 'bb' : (window.money ? window.money(+h.amount || 0) : h.amount)) : '';
    $('drillFb').hidden = false;
    var W2 = { fold: 'fold', call: 'call', raise: 'raise', check: 'check', bet: 'bet' };
    $('drillFb').innerHTML =
      (cut ? '<div class="dim" style="margin-bottom:6px">At the table you <b>' + esc(playedWords(cut.ev, cut.hidden, !cardPro())) + '</b> <span class="mono">(' + esc(cut.rest || cut.hidden) + ')</span>' +
        (chose ? ' — today you chose to ' + W2[chose] : '') + '.</div>' : '') +
      (hold ? mineHeld(h, hold, parsed, curSym) : '') +
      '<div><b>' + (answer === 'same' ? (chose ? 'Same as at the table.' : 'Standing by it.') : (chose ? 'Different from the table.' : 'You’d change it.')) + '</b></div>' +
      (res ? '<div class="dim" style="margin-top:6px">At the table you ' + esc(res) + '.</div>' : '') +
      (h.note ? '<div style="margin-top:8px">“' + esc(h.note) + '”</div>' : '') +
      '<div class="dim" style="margin-top:8px">' +
      (answer === 'same'
        ? 'Worth un-flagging if you’re settled on it.'
        : 'That gap is the mistake to fix: write what you’d do instead while it’s fresh. It goes in the hand’s note, which comes back with the hand.') + '</div>' +
      // The step the copy asks for needs somewhere to happen: the hand's own edit view (the
      // History › Edit path), where the note is. The hand stays flagged.
      (answer !== 'same' && typeof window.editHand === 'function'
        ? '<div class="minerow"><button class="minibtn" data-done="note">' + (h.note ? 'Add to its note' : 'Write it in its note') + '</button></div>' : '') +
      '<div class="minerow"><button class="minibtn" data-done="keep">Keep it flagged</button>' +
      '<button class="minibtn" data-done="clear">Mark reviewed</button></div>';
    $('drillFb').onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-done]');
      if (!b) return;
      if (b.dataset.done === 'note') {
        newScenario(); window.editHand(h.id);
        var nt = document.getElementById('note');            // the form opens at its top; the note is near the end
        if (nt && nt.scrollIntoView) nt.scrollIntoView({ block: 'center' });
        return;
      }
      if (b.dataset.done === 'clear' && window.clearHandFlag) window.clearHandFlag(h.id);
      newScenario();
    };
    if (window.recordDrill) {
      // r: null — reviewing your own hand has no right answer, so it must never touch
      // accuracy. "Same line" is not correct and "differently" is not wrong; the value is
      // the gap between cold judgement now and tilted judgement then.
      window.recordDrill({ t: Date.now(), m: 'mine', k: h.id, a: answer, chose: chose || undefined, ideal: '', r: null, review: 1 });
    }
  }

  var RANKS_HI = 'AKQJT98765432';
  // Hole cards higher rank first, the way the hand is named: 'A6s' read with the 6 on the left.
  function holeHtml(a, b) {
    var hi = RANKS_HI.indexOf(String(a)[0]) <= RANKS_HI.indexOf(String(b)[0]);
    return '<div class="hole">' + cardHtml(hi ? a : b) + cardHtml(hi ? b : a) + '</div>';
  }
  // Next is tapped at the bottom of a long feedback block; on a short phone the new spot's
  // opening lines were left scrolled up under the header. Bring the panel back to its top.
  // The other way round too: on a 320pt phone, with the free strip and the flagged-hands card
  // above the drill, the answer buttons started under the tab bar, so every new spot needed a
  // scroll. Lift them clear, never so far that the spot's first line goes under the header.
  // A mode chip or a filter deals through here too, and so does a pool that finishes loading under
  // the first Flop or Full hands spot (DRILL-1). A drill that isn't on screen (another tab, Cards)
  // has no layout box, and is left alone.
  function keepSpotInView() {
    var sp = $('drillSpot'), p = sp && sp.closest ? sp.closest('.panel') : null;
    if (!p || !p.getBoundingClientRect || !p.scrollIntoView || p.offsetParent === null) return;
    var hd = typeof document.querySelector === 'function' ? document.querySelector('header') : null;
    var top = hd && hd.getBoundingClientRect ? hd.getBoundingClientRect().bottom : 0;
    var pt = p.getBoundingClientRect().top;
    if (pt < top) { p.scrollIntoView({ block: 'start' }); return; }
    var nav = typeof document.querySelector === 'function' ? document.querySelector('nav') : null, bt = $('drillBtns');
    if (!nav || !nav.getBoundingClientRect || !bt || bt.hidden || !bt.getBoundingClientRect || typeof window.scrollBy !== 'function') return;
    var navTop = nav.getBoundingClientRect().top;
    if (!navTop) return;                                  // tab bar hidden (keyboard up)
    var d = Math.min(bt.getBoundingClientRect().bottom - (navTop - 8), pt - top - 8);
    if (d > 0) window.scrollBy(0, Math.ceil(d));
  }
  function nextSpot() { newScenario(); keepSpotInView(); }
  function newScenario() {
    if (pendingChain) { cur = pendingChain; pendingChain = null; renderScenario(); return; }
    if (Math.random() < MINE_RATE) {
      var mineSpot = mineScenario();
      if (mineSpot) { cur = mineSpot; renderMine(); return; }
    }
    if (mode === 'hands') {                                 // Full end-to-end hands: walk a real hand decision-by-decision
      if (!REAL_HANDS && !REAL_HANDS_ERR) loadRealHands();
      if (REAL_HANDS) { cur = handScenario(); renderScenario(); return; }
      if (!REAL_HANDS_ERR) { cur = { real: true, hands: true, loading: true, mode: 'hands', street: 'flop' }; renderScenario(); return; }
      cur = scenarioCbet(); renderScenario(); return;       // offline / load failed → a synthetic flop spot so the tab isn't dead
    }
    if (mode === 'flop' || mode === 'turn' || mode === 'river') {   // Real Spots replace the synthetic flop/turn/river drill
      if (!REAL_POOL && !REAL_ERR) loadRealPool();         // kicks the fetch (or sets REAL_ERR synchronously when no fetch)
      if (REAL_POOL) { cur = realScenario(mode); renderScenario(); return; }
      if (!REAL_ERR) { cur = { real: true, loading: true, mode: mode, street: mode }; renderScenario(); return; }   // browser: awaiting fetch
      // REAL_ERR (offline / no fetch / load failed) → synthetic fallback below
    }
    cur = mode === 'pf' ? (cardPro() ? scenarioPF() : scenarioFree())
      : mode === 'odds' ? scenarioOdds()
        : mode === 'turn' ? scenarioTurn()
          : mode === 'river' ? scenarioRiver()
            : scenarioCbet();                              // 'flop' (and legacy 'cbet') → flop spots
    renderScenario();
  }

  /* ---- render per mode ---- */
  // Every render path passes through here, so it also says whether this spot's answers are
  // Pro: on the free tier they dim (and a tap opens the Pro screen) unless the spot is a free
  // one or the player's own hand. Painted on the Drill segment, which no render rewrites.
  function resetFb() { $('drillBtns').hidden = false; $('drillFb').hidden = true; $('drillFb').innerHTML = ''; paintLock(); }
  function spotLocked() { return !cardPro() && !(cur && (cur.free || cur.mine)); }
  function paintLock() { var sd = $('studyDrill'); if (sd && sd.classList) sd.classList.toggle('lockspot', spotLocked()); }
  // The free chained spot carries its place in today's allowance ("4 of 10"): the moment the
  // limit matters is the moment it is spent.
  // Two different counts, so two different sentences: the spot header says which spot this
  // is ("spot 1 of today's 10"), the stats line what has been answered ("0 of 10 used today").
  // Both read "N of 10" before, so one screen showed "1 of 10" over "0 of 10".
  function freeSpotNo(n) { return 'Free re-raise (3-bet) spot ' + n + ' of today’s ' + FREE_3BET_DAY; }
  function freeCount(n) { return n + ' of ' + FREE_3BET_DAY + ' free re-raise (3-bet) spots used today'; }
  // Free spots speak plain (LAUNCH_PLAN §2, §4b); Pro keeps the terse header below.
  // A replay repeats the SPOT (seat, depth, situation) a miss was stored for, with a new hand
  // dealt near the line (addMiss keeps no cards), so it never claims the hand is a repeat.
  function pfSpotFree(s) {
    var rep = s.replay ? ' &nbsp;<span class="rep">↻ a spot you missed before (same seat, new cards)</span>' : '';
    if (s.kind === 'open') {
      // The first seat plays like UTG or like the lojack (SEAT_CODE), so "first to act" would be
      // true at one table and not the other; "nobody has raised yet" is true at both.
      // The small blind's raise / limp / fold band is built for a big-blind ante (poker.js sbEval),
      // so the spot says so before the answer, not only in the feedback (owner's call 9, 2026-10-09).
      return (s.pos === 'EP' ? 'Nobody has raised yet' : 'Everyone folds to you') + ' · you’re <b>' + seatAt(s.pos) + '</b> · <b>' +
        T('bb', s.depth + ' big blinds') + '</b>' + (s.pos === 'SB' && s.depth >= 20 ? ', with a big-blind ante (one extra big blind in the pot)' : '') + rep;
    }
    // vs3bet: you opened, a seat behind re-raised. At 100bb this is a 4-bet decision. The seat
    // that re-raised is new on this screen, so it carries its meaning; yours was named a spot ago.
    return 'You raised from <b>' + SEAT_PLAIN[s.pos] + '</b>; <b>' + seatTerm(s.raiser) + '</b> re-raised (3-bet). ' +
      (s.pos3 === 'ip' ? 'You act last after the flop (in position).' : 'You act first after the flop (out of position).') +
      (s.chained ? ' <span class="rep">↪ same hand, next decision</span>' : '') +
      // Only a free player has an allowance: one who bought Pro with this chain already queued
      // must not see "10 of 10 free" on a spot that no longer counts against anything.
      // Home's daily hand (s.daily) is not one of the ten, so it carries no counter.
      (cardPro() || s.daily ? '' : '<div class="fctr">' + freeSpotNo(Math.min(threeBetsToday() + 1, FREE_3BET_DAY)) + '</div>');
  }
  // The seat names (poker.js POS_NAME) are nouns without an article, so a sentence needs one:
  // "you’re in the hijack (HJ)", "from an early (UTG–LJ)" read wrong (review SB-5).
  function inSeat(p) { return p === 'BTN' ? 'on the <b>button</b>' : p === 'EP' ? 'in an <b>early seat (UTG–LJ)</b>' : 'in the <b>' + P.POS_NAME[p] + '</b>'; }
  function fromSeat(p) { return p === 'EP' ? 'from an <b>early seat (UTG–LJ)</b>' : 'from the <b>' + P.POS_NAME[p] + '</b>'; }
  function pfSpot(s) {
    if (s.free) return pfSpotFree(s);
    var rep = s.replay ? ' &nbsp;<span class="rep">↻ missed spot, new cards</span>' : '';
    if (s.kind === 'open') return 'Folded to you · <b>' + P.POS_NAME[s.pos] + '</b> · <b>' + s.depth + 'bb</b>' + (s.pos === 'SB' && s.depth >= 20 ? ' · big-blind ante' : '') + rep;
    if (s.kind === 'iso') return '<b>' + s.limpers + ' limper' + (s.limpers > 1 ? 's' : '') + '</b> · you’re ' + inSeat(s.pos) + ' · <b>' + s.depth + 'bb</b>' + rep;
    if (s.kind === 'bbopt') return '<b>' + s.limpers + ' limper' + (s.limpers > 1 ? 's' : '') + '</b>, then it folds to you in the <b>BB</b> · <b>' + s.depth + 'bb</b>' + rep;
    if (s.kind === 'limpRR') return 'You iso’d <b>' + s.limpers + ' limper' + (s.limpers > 1 ? 's' : '') + '</b> ' + fromSeat(s.pos) + ', a limper <b>limp-reraises</b> · <b>' + s.depth + 'bb</b>' + rep;
    if (s.kind === 'vs') return '<b>' + cap1(P.POS_NAME[s.opener]) + '</b> opens · <b>' + s.depth + 'bb</b> · you’re the <b>' + sc(s.vseat || s.blind || '?') + '</b>' + rep;
    if (s.kind === 'calljam') return '<b>' + cap1(P.POS_NAME[s.pos]) + '</b> jams <b>' + s.depth + 'bb</b> · you’re the <b>BB</b>' + rep;
    if (s.kind === 'squeeze'){
      if (s.limped) return '<b>' + s.callers + '</b> limp' + (s.callers > 1 ? 's' : '') + ', <b>' + P.POS_NAME[s.opener] + '</b> raises · <b>' + s.depth + 'bb</b> · you’re the <b>' + sc(s.vseat || '?') + '</b>' + rep;
      return '<b>' + cap1(P.POS_NAME[s.opener]) + '</b> opens, <b>' + s.callers + '</b> call' + (s.callers > 1 ? 's' : '') + ' · <b>' + s.depth + 'bb</b> · you’re the <b>' + sc(s.vseat || '?') + '</b>' + (s.vseat === 'BB' ? ' (closing)' : '') + rep;
    }
    if (s.kind === 'cold3b') return '<b>' + cap1(P.POS_NAME[s.opener]) + '</b> opens, <b>' + sc(s.raiser || '?') + '</b> 3-bets · <b>' + s.depth + 'bb</b> · you’re the <b>' + sc(s.vseat || '?') + '</b>' + rep;
    if (s.kind === 'vs4bet') return 'You 3-bet from the <b>' + sc(s.vseat || '?') + '</b>, <b>' + P.POS_NAME[s.raiser] + '</b> 4-bets (you’re ' + (s.pos3 === 'ip' ? 'IP' : 'OOP') + ') · <b>' + s.depth + 'bb</b>' + (s.chained ? ' <span class="rep">↪ same hand, next decision</span>' : '') + rep;
    return 'You open ' + fromSeat(s.pos) + ', <b>' + sc(s.raiser || '?') + '</b> 3-bets (you’re ' + (s.pos3 === 'ip' ? 'IP' : 'OOP') + ') · <b>' + s.depth + 'bb</b>' + (s.chained ? ' <span class="rep">↪ same hand, next decision</span>' : '') + rep;  // vs3bet
  }
  // The question and the answer buttons for a preflop spot. The drill writes them into #drillQ and
  // #drillBtns; Home's daily hand into its own card. One copy of the words.
  function pfAsk(s) {
    if (s.kind === 'calljam') return { q: 'Call the jam or fold?', cls: '',
      btns: '<button class="act fold" data-a="fold">Fold</button><button class="act call" data-a="call">Call</button>' };
    if (s.kind === 'bbopt') return { q: 'Check or raise?', cls: '',                 // BB option: free check or raise (never fold)
      btns: '<button class="act fold" data-a="check">Check</button><button class="act raise" data-a="raise">Raise</button>' };
    if (s.kind === 'open' && s.pos === 'SB' && s.depth >= 20) return {             // SB folded-to: raise / limp / fold
      q: s.free ? 'Raise, limp (just call the big blind), or fold?' : 'Raise, limp, or fold?', cls: 'three',
      btns: '<button class="act fold" data-a="fold">Fold</button><button class="act call" data-a="limp">Limp</button><button class="act raise" data-a="open">Raise</button>' };
    var ai = aggrInfo(s), single = s.kind === 'open' || s.kind === 'iso';
    // The free chained spot is a 4-bet decision, and "4-bet" needs its meaning beside it.
    return { q: single ? ai.w + ' or fold?' : s.free && ai.w === '4-bet' ? '4-bet (raise again), call, or fold?' : ai.w + ', call, or fold?',
      cls: single ? '' : 'three',
      btns: '<button class="act fold" data-a="fold">Fold</button>' +
        (single ? aggrBtn(ai, 'open') : '<button class="act call" data-a="call">Call</button>' + aggrBtn(ai, 'threebet')) };
  }
  // A postflop spot's answer buttons, in the drill's colours. Home's daily hand draws the same ones.
  function optBtns(opts) {
    return opts.map(function (o) { return '<button class="act ' + (ACT_CLS[o.act] || 'go') + '" data-a="' + o.act + '">' + o.label + '</button>'; }).join('');
  }
  function renderScenario() {
    var s = cur;
    if (s.real) {
      resetFb();
      if (s.loading) {
        var le = s.hands ? REAL_HANDS_ERR : REAL_ERR;
        $('drillSpot').innerHTML = le ? '<span class="bad">Couldn’t load real hands.</span> <span class="dim">Reopen the app to try again.</span>' : '<span class="dim">Loading real hands…</span>';
        $('drillHand').innerHTML = ''; $('drillQ').textContent = ''; $('drillBtns').innerHTML = ''; return;
      }
      $('drillSpot').innerHTML = s.hands
        ? realSpotHtml(s, 'Play-through · decision ' + (s.di + 1) + '/' + s.hand.decisions.length + ' · ' + s.e.street)
        : realSpotHtml(s);
      var bl = s.e.board;
      var bdR = bl.length === 5
        ? '<div class="bdlab">flop · turn · river</div><div class="board">' + bl.map(cardHtml).join('') + '</div>'
        : bl.length === 4
          ? '<div class="bdlab">flop · turn</div><div class="board">' + bl.slice(0, 3).map(cardHtml).join('') + '<span class="tsep">→</span>' + cardHtml(bl[3]) + '</div>'
          : '<div class="bdlab">flop</div><div class="board">' + bl.map(cardHtml).join('') + '</div>';
      $('drillHand').innerHTML = holeHtml(s.hole[0], s.hole[1]) + bdR;
      $('drillQ').textContent = s.options.map(function (o) { return o.label; }).join(' / ') + '?';
      $('drillBtns').className = s.options.length === 3 ? 'three' : '';
      $('drillBtns').innerHTML = optBtns(s.options);
      return;
    }
    if (s.mode === 'pf') {
      $('drillSpot').innerHTML = pfSpot(s);
      // Wrapped like every other mode's hole cards — bare, the two cards stacked one
      // above the other in the column layout.
      $('drillHand').innerHTML = holeHtml(s.c1, s.c2);
      // The question and the buttons are pfAsk's, shared with Home's daily hand.
      var ask = pfAsk(s);
      $('drillQ').textContent = ask.q; $('drillBtns').className = ask.cls; $('drillBtns').innerHTML = ask.btns;
    } else if (s.mode === 'odds') {
      var street = s.variant === 'turn' ? 'Turn — one card to come' : 'Flop — villain is all-in, two cards come';
      $('drillSpot').innerHTML = '<b>' + street + '</b> · pot <b>$' + s.pot + '</b> · bets <b>$' + s.bet + '</b>' +
        '<button id="oddsTog" class="minitog">' + (oddsHard ? '🔍 spot-it-yourself' : 'name shown') + '</button>';
      $('drillHand').innerHTML = holeHtml(s.hole[0], s.hole[1]) +
        '<div class="bdlab">board</div><div class="board">' + s.board.map(cardHtml).join('') + '</div>' +
        '<div class="drawname' + (oddsHard ? ' dim' : '') + '">' + (oddsHard ? 'what’s your draw &amp; equity?' : 'you have a ' + esc(s.name)) + '</div>';
      $('drillQ').textContent = 'Call or fold?';
      $('drillBtns').className = '';
      $('drillBtns').innerHTML = '<button class="act fold" data-a="fold">Fold</button><button class="act call" data-a="call">Call</button>';
      $('oddsTog').onclick = function () { oddsHard = !oddsHard; stats.oddsHard = oddsHard; saveStats(); renderScenario(); };
    } else {
      $('drillSpot').innerHTML = cbetSpot(s);
      var bd = s.board.length === 5
        ? '<div class="bdlab">flop · turn · river</div><div class="board">' + s.board.map(cardHtml).join('') + '</div>'   // complete board — no arrows, the label tells the streets
        : s.board.length === 4
          ? '<div class="bdlab">flop · turn</div><div class="board">' + s.board.slice(0, 3).map(cardHtml).join('') + '<span class="tsep">→</span>' + cardHtml(s.board[3]) + '</div>'
          : '<div class="bdlab">flop</div><div class="board">' + s.board.map(cardHtml).join('') + '</div>';
      $('drillHand').innerHTML = holeHtml(s.hole[0], s.hole[1]) + bd;
      var opts = s.fn.options;
      $('drillQ').textContent = opts.map(function (o) { return o.label; }).join(' / ') + '?';
      $('drillBtns').className = opts.length === 3 ? 'three' : '';
      $('drillBtns').innerHTML = optBtns(opts);
    }
    resetFb();
  }
  function cbetSpot(s) {
    var hero = sc(s.heroSeat), vill = sc(s.villSeat), pot3 = s.potType === '3bet';
    if (s.multiway) {
      var cs = (s.callers || []).map(function (c) { return sc(c); }).join(' + ');
      // postflop order is SB→BB→EP→…→BTN: players earlier than hero act FIRST and
      // check to the PFR; players later are still behind. (Hero is "first to act"
      // only when no caller is earlier — i.e. no blind in the pot.)
      var ord = function (x) { return POST_ORDER.indexOf(x); };
      var before = (s.callers || []).filter(function (c) { return ord(c) < ord(s.heroSeat); });
      var behind = (s.callers || []).filter(function (c) { return ord(c) > ord(s.heroSeat); });
      var flow = before.length
        ? '<b>' + before.map(function (c) { return sc(c); }).join(' + ') + '</b> check' + (before.length > 1 ? '' : 's') + ', action on you' +
            (behind.length ? ' (<b>' + behind.map(function (c) { return sc(c); }).join(' + ') + '</b> behind)' : '')
        : 'you’re first to act' + (behind.length ? ' (<b>' + behind.length + '</b> behind)' : '');
      return 'You open <b>' + hero + '</b>, <b>' + cs + '</b> call (<b>3-way</b>). <b>Flop:</b> ' + flow + ' (pot ' + s.pot + 'bb).';
    }
    var story = s.role === 'aggressor'
      ? (pot3 ? '<b>' + vill + '</b> opens, you ' + (cardPro() ? '3-bet' : '3-bet (re-raise)') + ' <b>' + hero + '</b>, they call.' : 'You open <b>' + hero + '</b>, <b>' + vill + '</b> calls.')
      : '<b>' + vill + '</b> opens, you call <b>' + hero + '</b>.';
    var betTxt = s.bet != null ? ' <b>' + s.bet + 'bb</b> into <b>' + s.pot + 'bb</b> (' + s.frac.t + ')' : '';
    if (s.street === 'river') {
      var rpos = 'you’re ' + posW(s.pos === 'ip');
      // spell out EVERY street so the turn is never omitted (David's catch)
      var flopL = s.role === 'aggressor' ? 'You c-bet flop, <b>' + vill + '</b> calls' : '<b>' + vill + '</b> c-bets flop, you call';
      var turnL = s.barrels >= 2
        ? (s.role === 'aggressor' ? 'you barrel turn, <b>' + vill + '</b> calls' : '<b>' + vill + '</b> barrels turn, you call')
        : 'turn checks through';
      turnL = turnL.charAt(0).toUpperCase() + turnL.slice(1);
      var act = s.sub === 'riverFace'
        ? (s.pos === 'oop'
            ? 'you check, <b>' + vill + '</b> bets' + betTxt + ' — ' + rpos + '.'
            : '<b>' + vill + '</b> ' + (s.role === 'aggressor' ? 'leads' : 'bets') + betTxt + ' — ' + rpos + '.')
        : (s.pos === 'ip' ? '<b>' + vill + '</b> checks — ' + rpos + ', action on you (pot ' + s.pot + 'bb).' : 'you’re first to act (' + rpos + ', pot ' + s.pot + 'bb).');
      return story + ' ' + flopL + '. ' + turnL + '. <b>River:</b> ' + act;
    }
    if (s.street === 'turn') {
      var checkedThrough = s.sub === 'delayed' || s.sub === 'probe' || s.sub === 'probeRaised';
      var fs = checkedThrough ? 'they check, you check back'
        : s.sub === 'barreled' ? 'they c-bet ' + s.f1txt + ', you call'
          : (s.pos === 'ip' ? 'they check, you bet ' + s.f1txt + ', they call' : 'you bet ' + s.f1txt + ', they call');
      var ta = s.sub === 'barrel'
        ? (s.pos === 'ip' ? '<b>' + vill + '</b> checks again (pot ' + s.pot + 'bb) — you’re ' + posW(true) + '.' : 'you’re first to act (pot ' + s.pot + 'bb).')
        : s.sub === 'lead' ? '<b>' + vill + '</b> now <b>leads</b>' + betTxt + ' — you’re ' + posW(true) + '.'
          : s.sub === 'delayed' ? '<b>' + vill + '</b> bets' + betTxt + '.'
            : s.sub === 'probe' ? '<b>' + vill + '</b> checks again (pot ' + s.pot + 'bb) — you’re ' + posW(true) + ', action on you.'
              : s.sub === 'probeRaised' ? 'you stab, <b>' + vill + '</b> <b>check-raises</b>' + betTxt + ' — you’re ' + posW(true) + ', facing it.'
                : '<b>' + vill + '</b> <b>barrels</b>' + betTxt + (s.pos === 'ip' ? ' — you’re ' + posW(true) + '.' : '.');
      return story + ' <b>Flop:</b> ' + fs + '. <b>Turn:</b> ' + ta;
    }
    var act = s.node === 'ipCheck' ? '<b>' + vill + '</b> checks (pot ' + s.pot + 'bb) — you’re ' + posW(true) + '.'
      : s.node === 'ipBet' ? '<b>' + vill + '</b> ' + (s.role === 'aggressor' ? 'leads' : 'c-bets') + betTxt + ' — you’re ' + posW(true) + '.'
        : s.node === 'oopFirst' ? 'You’re <b>' + posW(false) + '</b>, first to act (pot ' + s.pot + 'bb).'
          : 'You check, <b>' + vill + '</b> c-bets' + betTxt + '.';
    return story + ' <b>Flop:</b> ' + act;
  }

  /* ---- grade per mode (each returns {right, marginal, idealWord, why}) ---- */
  function gradePF(s, a) {
    if (s.kind === 'calljam') {
      var cv = P.callEval(s.pos, s.depth, s.label);     // graded vs the NAMED seat's jam range
      var cAct = cv.in ? 'call' : 'fold';
      var evTxt = cv.ev != null ? 'Nash call EV ' + (cv.ev > 0 ? '+' : '') + cv.ev.toFixed(2) + 'bb' : esc(s.label) + ' vs ~top ' + (cv.t * 100).toFixed(0) + '%';
      return {
        right: cv.marginal || a === cAct, marginal: cv.marginal, idealAct: cAct, idealWord: cAct === 'call' ? 'Call' : 'Fold', verb: 'Nash',
        why: evTxt + ' vs ' + aName(P.POS_NAME[s.pos]) + ' ' + s.depth + 'bb jamming range <span class="dim">(approximate Nash, ante-adjusted; their range ~top ' +
          Math.round((window.NASH && window.NASH.jamPct[s.depth] ? window.NASH.jamPct[s.depth][s.pos] : 0)) + '%)</span>'
      };
    }
    var ai = aggrInfo(s);
    if (s.kind === 'bbopt') {                          // BB option in a limped pot: raise (iso) or check — never fold
      var tB = P.isoThreshold('CO', s.depth), pB = P.openPct(s.label, s.depth);
      var closeB = pB != null && Math.abs(pB - tB) <= 0.035;
      var corrB = pB != null && pB <= tB ? 'raise' : 'check';
      return {
        right: closeB || a === corrB, marginal: closeB, idealAct: corrB, idealWord: corrB === 'raise' ? 'Raise' : 'Check',
        why: esc(s.label) + ' at ' + ((pB || 1) * 100).toFixed(0) + '% vs a ~' + (tB * 100).toFixed(0) + '% BB iso-over-limpers range.' +
          ' <span class="dim">In the BB you have a <b>free check</b> — raise your value + a few bluffs to attack the capped limpers and deny the free flop, check the rest. The only mistake is raising too wide (you don’t need fold equity when checking is free) or never raising at all.</span>'
      };
    }
    if (s.kind === 'open' && s.pos === 'SB' && s.depth >= 20) {   // SB folded-to: raise / limp / fold (ante VPIP)
      var sb = P.sbEval(s.depth, s.label);
      var sbIdeal = sb.action === 'raise' ? 'open' : sb.action;   // map to button action
      var sbAcc = [sbIdeal];
      if (sb.nearRaise) { if (sbAcc.indexOf('open') < 0) sbAcc.push('open'); if (sbAcc.indexOf('limp') < 0) sbAcc.push('limp'); }
      if (sb.nearLimp) { if (sbAcc.indexOf('limp') < 0) sbAcc.push('limp'); if (sbAcc.indexOf('fold') < 0) sbAcc.push('fold'); }
      var sbRight = sbAcc.indexOf(a) >= 0;
      var sbWord = { open: 'Raise', limp: 'Limp', fold: 'Fold' };
      // Free view (Appendix A fix 5): the most jargon-heavy free spot — VPIP, the big-blind
      // ante, "complete", OOP, value + bluffs. Same claims and numbers, in words.
      if (s.free) return {
        right: sbRight, marginal: sbRight && a !== sbIdeal, idealAct: sbIdeal, idealWord: sbWord[sbIdeal],
        // The numbers are in the why, which lays out all three bands; the head just answers.
        plainHead: sbIdeal === 'open' ? 'The chart raises this hand from the small blind.'
          : sbIdeal === 'limp' ? 'The chart limps with this hand: it just calls the big blind.'
            : 'The chart folds this hand from the small blind.',
        why: handWords(s.label) + ': from the small blind the chart raises the ' + T('top', 'top ~' + Math.round(sb.raiseT * 100) + '%') + ' of hands, limps (just calls the big blind) with the next hands down to the top ~' +
          Math.round(sb.limpT * 100) + '%, and folds the rest. ' +
          '<span class="dim">The chart counts a big-blind ante (an extra big blind in the pot), so calling is cheap: the small blind plays about ' + Math.round(sb.limpT * 100) +
          '% or more of its hands when only the big blind is left. The raises are every pair, most aces and the other strong hands, plus some weaker suited ones as bluffs; <b>limp</b> the next hands down, mostly weaker suited hands and offsuit hands with a king, a queen or a small ace, ' +
          'even though you act first after the flop (out of position); fold the weakest ~' + (100 - Math.round(sb.limpT * 100)) + '%, mostly low offsuit hands. ' +
          (sb.action === 'limp' ? 'This one is a limp: just call and see a flop, rather than raising or folding it.'
            : sb.action === 'raise' ? 'This one is a raise: strong enough to put in the first raise.'
              : 'This one is a fold: too weak even at this price.') + '</span>'
      };
      return {
        right: sbRight, marginal: sbRight && a !== sbIdeal, idealAct: sbIdeal, idealWord: sbWord[sbIdeal],
        why: esc(s.label) + ': SB raises ~top ' + Math.round(sb.raiseT * 100) + '%, limps the playable band to ~' + Math.round(sb.limpT * 100) + '%, folds the rest. ' +
          '<span class="dim">With the big-blind ante the SB plays ~' + Math.round((sb.limpT) * 100) + '%+ of hands (vs only the BB). Raise every pair, most aces and the rest of your value + bluffs; <b>limp</b> the next band (mostly weaker suited hands and offsuit hands with a king, a queen or a small ace), too weak to raise but too cheap to fold OOP; fold the weakest ~' + (100 - Math.round(sb.limpT * 100)) + '%, mostly low offsuit hands. ' +
          (sb.action === 'limp' ? 'This one limps — complete and see a flop, don’t raise-or-fold it.' : sb.action === 'raise' ? 'This one’s a raise — strong enough to be the aggressor.' : 'This one folds — too weak even at the great price OOP.') + '</span>'
      };
    }
    if (s.kind === 'open' || s.kind === 'iso') {
      var ev = s.kind === 'open' ? P.openEval(s.pos, s.depth, s.label) : P.isoEval(s.pos, s.depth, s.label);
      var correct = ev.in ? 'open' : 'fold';
      var what = s.kind === 'iso' ? 'iso-raising vs limpers' : P.POS_NAME[s.pos] + ' opening';
      if (ev.ev != null) return {                              // 10bb first-in: Nash-solved jam
        right: ev.marginal || a === correct, marginal: ev.marginal, idealAct: correct, idealWord: correct === 'open' ? ai.w : 'Fold', verb: 'Nash',
        why: 'Nash jam EV ' + (ev.ev > 0 ? '+' : '') + ev.ev.toFixed(2) + 'bb from ' + (s.pos === 'EP' ? 'an early seat (UTG–LJ)' : 'the ' + P.POS_NAME[s.pos]) +
          ' at ' + s.depth + 'bb <span class="dim">(approximate Nash, ante-adjusted; jam range ~top ' + (ev.t * 100).toFixed(0) + '%)</span>'
      };
      // Free view: "AJo at 23% vs a ~27% button opening range" says it in numbers only a
      // regular reads. Same comparison, in words (Appendix A, study.js:1163): the head gives
      // the seat's range, the why places this hand against it.
      if (s.free) {
        var tPct = (ev.t * 100).toFixed(0);
        return {
          right: ev.marginal || a === correct, marginal: ev.marginal, idealAct: correct, idealWord: correct === 'open' ? ai.w : 'Fold',
          plainHead: correct === 'open' ? 'The chart raises this hand from here (about ' + tPct + '% of hands).'
            : 'The chart folds this hand from here (it raises about ' + tPct + '% of hands).',
          why: handWords(s.label) + ' is in the ' + T('top', 'top ' + (ev.p * 100).toFixed(0) + '%') + ' of starting hands, ' +
            (ev.marginal ? 'right on the edge of that ' + tPct + '%. <span class="dim">The chart is a good default, not an exact answer.</span>'
              : (correct === 'open' ? 'inside' : 'outside') + ' that ' + tPct + '%.')
        };
      }
      var isoNote = s.kind === 'iso'
        ? ' <span class="dim">This wide iso assumes a <b>capped</b> limper (no premiums — the usual weak limp). It’s the right default vs the field. <b>Adjust vs good limpers</b> who limp a <b>polarized</b> range: they limp-reraise (limp-3-bet) their monsters to trap your wide iso, and flat their speculative hands to outplay you postflop. The counter: iso a touch tighter / more for value vs a known limp-reraiser, and <b>respect the limp-reraise</b> — it’s badly underbluffed even by decent players. Mix in over-limping yourself to stop being so readable.</span>'
        : '';
      return {
        right: ev.marginal || a === correct, marginal: ev.marginal, idealAct: correct, idealWord: correct === 'open' ? ai.w : 'Fold',
        why: esc(s.label) + ' at ' + (ev.p * 100).toFixed(0) + '% vs a ~' + (ev.t * 100).toFixed(0) + '% ' + what + ' range' + (ev.marginal ? ' — right on the line.' : '.') + isoNote
      };
    }
    var v = s.kind === 'vs' ? (s.blind ? P.blindVsEval(s.blind, s.depth, s.opener, s.label) : P.vsEval(s.depth, s.opener, s.label))
      : s.kind === 'squeeze' ? (s.limped
          ? ((s.vseat === 'SB' || s.vseat === 'BB') ? P.blindVsEval(s.vseat, s.depth, s.opener, s.label) : P.vsEval(s.depth, s.opener, s.label))
          : P.squeezeEval(s.depth, isEarly(s.opener) ? 'early' : 'late', s.label, s.vseat, s.callers))
        : (s.kind === 'cold3b' || s.kind === 'limpRR') ? P.cold3bEval(s.depth, s.label, s.kind)
          : s.kind === 'vs4bet' ? P.vs4betEval(s.depth, s.pos3, s.label)
            : P.vs3betEval(s.depth, s.pos3, s.label);
    // "Close" means the OTHER side of the boundary this hand sits next to — never two tiers
    // away. Both bands used to add their pair of actions, so where the 3-bet and call lines
    // sit close together (vs 4-bets, cold 3-bets) folding AA was graded "your answer's fine".
    var callTier = v.call > v.tb;
    var acc = [v.action];
    if (v.action === 'threebet' && v.nearTb) acc.push(callTier ? 'call' : 'fold');
    else if (v.action === 'call') { if (v.nearTb) acc.push('threebet'); if (v.nearCall) acc.push('fold'); }
    else if (v.action === 'fold') { if (callTier ? v.nearCall : v.nearTb) acc.push(callTier ? 'call' : 'threebet'); }
    var right = acc.indexOf(a) >= 0, word = { threebet: ai.w, call: 'Call', fold: 'Fold' };
    var verb = s.kind === 'squeeze' ? 'squeeze' : s.kind === 'vs3bet' ? (s.depth >= 30 ? '4-bet' : 'jam') : s.kind === 'vs4bet' ? '5-bet jam' : ai.w.toLowerCase();
    var seatTag = (s.kind === 'vs' || s.kind === 'cold3b' || s.kind === 'squeeze') && (s.vseat || s.blind) ? 'as the ' + sc(s.vseat || s.blind) + ': ' : '';
    // Free view of the chained 3-bet spot (Appendix A, study.js:1210): the same tiers in
    // words, and the overrides' own plain twins (poker.js `plain`).
    // A fold the chart grades close for a live reason (poker.js VS3BET_LIVEFOLD_IP) says why.
    var liveFold = v.liveFold ? ' <span class="dim">' + v.liveFold + '</span>' : '';
    // Whole percents put "A7s is at 10%" under "3-bet ~top 10%" with Call the answer (review
    // L10). Within a point of a line, every figure gets a decimal, and a tie at one decimal
    // says which side of the line the hand fell. Two lines that round to the same whole percent
    // get a decimal as well: "4-bet ~top 2%, call to ~2%" read as an empty call band (the cold
    // 3-bet at 100bb, 1.5% and 1.9%; COPY-5).
    var lines = [v.tb].concat(v.call > v.tb ? [v.call] : []);
    var dp = lines.some(function (t) { return Math.abs(v.p - t) < 0.01; }) ? 1 : 0;
    var dpL = dp || (lines.length > 1 && Math.round(lines[0] * 100) === Math.round(lines[1] * 100)) ? 1 : 0;
    var pc = function (x) { return (x * 100).toFixed(dp); }, pcL = function (x) { return (x * 100).toFixed(dpL); };
    var edge = '';
    if (dp) lines.forEach(function (t, i) {
      if (!edge && pc(v.p) === pc(t)) edge = ' (just ' + (v.p <= t ? 'inside' : 'outside') + ' the ' + (i ? 'call' : verb) + ' line)';
    });
    if (s.free) {
      // This ranking is all-in strength (poker.js pct), not the raising-first rank the open's
      // feedback used a tap earlier, so the same hand reads "top 14%" there and "top 10%" here.
      // Say which, as learn-hands does. P.pct, not v.p: in position a pair or suited hand is
      // graded on how it plays after the flop (defendPct), so v.p printed T9s as top 9% where
      // Cards and chapter 1 say 29% (Mac review 10).
      // That after-the-flop rank is what a suited hand or pair is folded on in position, against
      // a call line set on it (poker.js VS3BET_FLAT), so the fold says so: A2s read "call with up
      // to the top 20% … A2s is in the top 19%" over a Fold (STUDY-1). The lines and the rank
      // take the Pro view's decimals near a line: KJo read "call up to the top 16% … top 16%".
      var allIn = P.pct(s.label) || 1, bands = !(v.plain || v.note), flopRank = bands && v.p !== allIn;
      var heldP = 'Ranked by all-in strength, ' + handWords(s.label) + ' is in the ' + T('top', 'top ' + (bands ? pc(allIn) : (allIn * 100).toFixed(0)) + '%') + ' of hands' +
        (flopRank ? '. In position, a suited hand or a pair is called on how it plays after the flop, and there ' + esc(s.label) + ' ranks in the top ' + pc(v.p) + '%, ' +
          (Math.abs(v.p - v.call) < 0.01 ? 'just ' : '') + 'outside the top ' + pcL(v.call) + '% the chart calls with.' : (bands ? edge : '') + '.');
      return {
        right: right, marginal: right && a !== v.action, idealAct: v.action, idealWord: word[v.action],
        plainHead: v.action === 'threebet' ? 'The chart raises again (4-bets) with this hand.'
          : v.action === 'call' ? 'The chart calls the 3-bet with this hand.' : 'The chart folds this hand to the 3-bet.',
        why: (!bands
          ? (v.plain || v.note) + ' <span class="dim">' + heldP + '</span>'
          : 'Raise again (4-bet) with the top ' + pcL(v.tb) + '% of hands, ' + (v.call > v.tb ? 'call with up to the top ' + pcL(v.call) + '%, ' : '') +
            'fold the rest. ' + heldP) + liveFold
      };
    }
    // overrides (AK promotion, war demotions) explain themselves — never print a
    // band sentence the verdict contradicts
    if (v.note) return {
      right: right, marginal: right && a !== v.action, idealAct: v.action, idealWord: word[v.action],
      why: seatTag + v.note + ' <span class="dim">(' + esc(s.label) + ' ranks top ' + (v.p * 100).toFixed(0) + '%.)</span>' + liveFold
    };
    // The raise wars' notes name the pairs the engine calls and jams at this depth (review 4): a
    // fixed "QQ/JJ" sat under a grade that called QQ–88 at 100bb.
    var warPairs = function (act) {
      if (s.kind !== 'vs4bet' && s.kind !== 'cold3b' && s.kind !== 'limpRR') return [];
      return ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22'].filter(function (pr) {
        return (s.kind === 'vs4bet' ? P.vs4betEval(s.depth, s.pos3, pr) : P.cold3bEval(s.depth, pr, s.kind)).action === act;
      });
    };
    var pairWords = function (ps) { return ps.length < 3 ? ps.join(' and ') : ps[0] + '–' + ps[ps.length - 1]; };
    var warCall = pairWords(warPairs('call')), warJ = warPairs('threebet'), warJam = warJ.length ? warJ[warJ.length - 1] + '+' : 'AA';
    var blindNote = s.blind === 'BB' ? ' BB defends wide — you close the action with a discount.'
      // Not under a Call verdict: "flatting is thin" read as the answer being wrong (review L10).
      : s.blind === 'SB' ? (v.action === 'call' ? '' : ' SB leans 3-bet-or-fold — OOP all hand, flatting is thin.')
        : s.kind === 'vs' && s.vseat ? ' In the field (no discount, players behind) you continue tighter than the blinds.'
          : s.kind === 'cold3b' ? ' An open AND a 3-bet in front of you = two shown ranges — only the nutted tier continues cold' + (warCall ? ': the pairs that call are ' + warCall + '.' : '.')
          : s.kind === 'vs4bet' ? ' Facing a 4-bet at ' + s.depth + 'bb: jam ' + warJam + ' (and AK), ' + (warCall ? 'call ' + warCall + ' (the set-mine tier)' : 'no flatting this short') + ', release AQs and prettier-than-they-look hands.'
          : s.kind === 'limpRR' ? ' A limper who limp-reraises shows up with a NUTTED range (AA/KK/AK mostly) — limp-3-bet bluffs barely exist, even from decent players. 4-bet only your premiums, ' + (warCall ? 'call ' + warCall + ' (the set-mine tier), ' : '') + 'fold the rest — and never hero-call light here.' : '';
    if (s.kind === 'squeeze' && s.limped){
      blindNote = ' A raise OVER limpers — treat it like facing an open: the limps are dead money, but iso ranges run stronger than normal opens.';
    } else if (s.kind === 'squeeze' && s.vseat === 'BB'){
      // show the actual price: open 2.2x + N callers, BB has 1bb in + ante pot
      var potB = 2.2 * (s.callers + 1) + 0.5 + 1 + 1, callAmt = 1.2;
      blindNote = ' Closing the BB multiway: ~' + callAmt.toFixed(1) + 'bb into ~' + potB.toFixed(1) + 'bb ≈ ' +
        Math.round(100 * callAmt / (potB + callAmt)) + '% price — overcall wide, squeeze only your value tier.';
    } else if (s.kind === 'squeeze' && s.vseat === 'SB'){
      blindNote = ' SB multiway: good price but no closure and OOP — overcall medium-wide, squeeze the value tier.';
    } else if (s.kind === 'squeeze'){
      blindNote = ' In the field with players still behind — continue tight; the squeeze does more work than the flat.';
    }
    return {
      right: right, marginal: right && a !== v.action, idealAct: v.action, idealWord: word[v.action],
      // "Overcall" means calling after someone else already called the raise — only a squeeze
      // has that caller in front of you; everywhere else it is just a call (Appendix A fix 3).
      why: seatTag + verb + ' ~top ' + pcL(v.tb) + '%, ' + (v.call > v.tb ? (s.kind === 'squeeze' && !s.limped ? 'call/overcall' : 'call') + ' to ~' + pcL(v.call) + '%, ' : '') + 'else fold. ' + esc(s.label) + ' is at ' + pc(v.p) + '%' + edge + '.' + blindNote + liveFold
    };
  }
  function gradeOdds(s, a) {
    var marginal = Math.abs(s.equity - s.required) <= 0.025;
    var correct = s.equity >= s.required ? 'call' : 'fold';
    return {
      right: marginal || a === correct, marginal: marginal, idealAct: correct, idealWord: correct === 'call' ? 'Call' : 'Fold',
      why: 'It was a <b>' + s.name + '</b> = <b>' + s.outs + ' outs</b> ≈ <b>' + Math.round(s.equity * 100) + '%</b> exact <span class="dim">(rule of thumb: outs × ' + (s.variant === 'turn' ? '2 = ~' + (s.outs * 2) : '4 = ~' + (s.outs * 4)) + '%)</span>. ' +
        'You needed <b>' + Math.round(s.required * 100) + '%</b> = $' + s.bet + ' ÷ ($' + s.pot + ' pot + $' + s.bet + ' bet + $' + s.bet + ' your call = $' + (s.pot + 2 * s.bet) + '). ' +
        '<span class="dim">' + (s.equity >= s.required ? 'Price is right.' : 'Short — unless implied odds bail you out.') + ' Don’t forget your own call sits in the final pot.</span>'
    };
  }
  function mixBars(mix, labelOf, picked) {
    if (!mix || !mix.length) return '';
    var shown = mix.filter(function (e) { return e.f >= 0.05; });
    if (shown.length < 2) return '';
    var top = shown[0].f || 1;
    return '<div class="mixbars">' + shown.map(function (e) {
      var szTag = e.act === 'bet' ? (e.size === 'big' ? ' \u2154' : ' \u2153')
        : e.act === 'raise' ? (e.size === 'big' ? ' pot' : ' 3×') : '';
      var nm = (labelOf[e.act] || e.act) + szTag;
      var pct = Math.round(e.f * 100);
      var mine = e.act === picked;
      return '<div class="mixrow' + (mine ? ' mine' : '') + '">' +
        '<span class="nm">' + esc(nm) + '</span>' +
        '<span class="br"><i style="width:' + Math.round(e.f / top * 100) + '%"></i></span>' +
        '<span class="pc">' + pct + '%</span></div>';
    }).join('') + '<div class="mixnote">Your answer is highlighted. These are frequencies from a calibrated model, not a solve.</div></div>';
  }

  function gradeCbet(s, a) {
    var mix = s.mix, fn = s.fn;
    var labelOf = {};
    fn.options.forEach(function (o) { labelOf[o.act] = o.label; });
    var pick = mix.filter(function (e) { return e.act === a; })[0] || { f: 0 };
    var top = mix[0];
    var f = pick.f, fTop = top.f;
    var right = f >= 0.12, marginal = right && a !== top.act;
    var mixTxt = mix.filter(function (e) { return e.f >= 0.05; }).map(function (e) {
      var szTag = e.act === 'bet' ? (e.size === 'big' ? '⅔' : '⅓')
        : e.act === 'raise' ? (e.size === 'big' ? 'pot-ish' : '≈3×') : null;   // raises size off THEIR bet, not the pot
      var nm = (labelOf[e.act] || e.act) + (e.size && szTag ? ' (' + szTag + ')' : '');
      var pctF = Math.round(e.f * 100) + '%';
      return e.act === a ? '<b>' + nm + ' ' + pctF + '</b>' : nm + ' ' + pctF;
    }).join(' · ');
    var head = a === top.act ? (labelOf[a] || a) + ' — the main line (' + Math.round(fTop * 100) + '%)'
      : right ? 'Part of the mix — you took the ' + Math.round(f * 100) + '% line'
        : 'Not in the mix (<12%) — main line ' + (labelOf[top.act] || top.act) + ' ' + Math.round(fTop * 100) + '%';
    var plan = '';
    if (s.multiway) {                            // multiway: heads-up turn-plan tree doesn't apply
      plan = '<div class="fbtree">' +
        '<span class="tw">Bet, called →</span> still likely multiway — keep barreling only strong value; check/give up the rest.<br>' +
        '<span class="tw">Bet, raised →</span> fold far more than heads-up: a raise into a multiway field is nutted, and a player may still be behind. Continue only with strong value / big draws.<br>' +
        '<span class="tw">Why so tight →</span> you must beat BOTH callers, and a bluff needs them BOTH to fold — fold equity is multiplicative. C-bet value-heavy, check your air.</div>';
    } else if (s.ctx && s.street !== 'river') {  // heads-up: the decision tree, framed by hand strength (no next street on the river)
      var tree = PF.planTree(s.node, s.ctx, s.hole, s.board);
      plan = '<div class="fbtree">' + tree.map(function (l) {
        return '<span class="tw">' + esc(l.when) + '</span> ' + l.what;
      }).join('<br>') + '</div>';
    }
    var mdf = '';
    if (s.price != null) {
      var mdfPct = Math.round(100 * s.pot / (s.pot + s.bet));
      mdf = ' MDF vs this size ≈ <b>' + mdfPct + '%</b> of your range continues.';
    }
    var actTag = s.multiway ? ', equity vs the FIELD (beat both)'
      : s.street === 'turn' ? ', story-weighted (flop + turn actions)'
      : (s.node === 'ipBet' || s.node === 'oopBet') ? ', bet-weighted' : s.node === 'ipCheck' ? ', check-weighted' : '';
    // Sizing rationale — reinforce the mental model (range advantage + texture)
    // on every betting rep without grading exact bb. Shown whenever a bet/raise
    // carries weight in the mix.
    var betE = mix.filter(function (e) { return (e.act === 'bet' || e.act === 'raise') && e.f >= 0.12; })[0];
    var sizeWhy = '';
    if (betE) {
      var wet = s.ctx && s.ctx.wet;
      var isRaise = betE.act === 'raise';
      // RIVER monster: finished board, no draws to protect → the most polarized spot
      // in poker. Size BIG for max value regardless of texture — the board heuristic
      // is for range-betting, never for a specific monster. (A♥7♥ nut-flush catch.)
      var riverMonster = s.street === 'river' && (s.tier === 'monster' || (s.eq != null && s.eq >= 0.90));
      var sz, rationale;
      if (riverMonster) {
        sz = isRaise ? 'raise big (≈ a pot-sized raise / 3×+ their bet)' : 'bet big (≈ pot or overbet)';
        rationale = 'finished board, nothing to protect and you hold a monster → ' + (isRaise ? 'raising' : 'betting') +
          ' BIG is pure max value: charge their whole bluff-and-second-best range. The most polarized spot in poker — don’t shrink it to stay balanced (slow-playing some is fine, but the value is in sizing up)';
      } else {
        sz = isRaise ? (betE.size === 'big' ? 'raise pot-ish (≈3× their bet)' : 'raise small (≈2.5×)')
                     : (betE.size === 'big' ? 'lean bigger (≈⅔–pot)' : 'small (≈⅓)');
        rationale = s.multiway ? 'multiway you size UP with value (more players = more equity to deny) and check your bluffs — fold equity is multiplicative'
          : (s.edge === 'big' && !wet) ? 'your range owns a dry board → bet small and often; nothing draws, so a big bet only folds out what you already beat'
            : wet ? 'wet board → size up to charge draws + protect, or check the hands that don’t want a bloated pot'
              : 'shared/neutral board → keep it medium and check more; equities run close, so don’t over-polarize';
      }
      sizeWhy = ' <span class="szwhy"><b>Sizing:</b> ' + sz + ' — ' + rationale + '.</span>';
    }
    // Bet TYPE — teach "bet with a reason," not a bluff frequency. Driven by the
    // objective tier (shapes prose, never the verdict). Pure bluffs get the
    // exploit reminder: vs a recreational field, balance is wasted and his leak
    // is over-bluffing → default to giving up unless he has a read.
    var betNature = '';
    if (betE) {
      var t = s.tier;
      betNature = (t === 'monster' || t === 'strong')
        ? ' <span class="natw"><b>Bet type:</b> value — you’re betting to get called by worse.</span>'
        : t === 'marginal'
          ? ' <span class="natw"><b>Bet type:</b> thin value / protection — deny equity and get called by worse; don’t pile in if raised.</span>'
          : (t === 'draw' || t === 'semibluff')
            ? ' <span class="natw"><b>Bet type:</b> semi-bluff — you have equity (a draw + outs) AND fold equity. This is +EV aggression — keep it.</span>'
            : ' <span class="natw"><b>Bet type:</b> pure bluff (no equity) — only profits if they fold. Vs this field that needs a <b>read</b>: bluff the nits, never the stations, and default to giving up when unsure. Over-bluffing here is the most common live leak.</span>';
    }
    var baseWhy = '<b>' + esc(s.cls.label) + '</b> · ' + (s.edge === 'big' ? 'board favors YOUR range' : s.edge === 'low' ? 'board favors them' : 'neutral board') +
      (s.tcard ? ' · turn card: ' + (s.tcard === 'brake' ? '<b>brake</b> (helps their range)' : s.tcard === 'barrel' ? '<b>scare/improve</b> (your card)' : 'brick') : '') +
      ' · mix: ' + mixTxt + '. ' + fn.why + mdf + sizeWhy + betNature +
      ' <span class="dim">(range: ' + esc(s.villDesc) + actTag + ' · frequencies are a calibrated model — not a solve)</span>' + plan;
    return { right: right, marginal: marginal, idealAct: top.act, idealWord: head, verb: 'Mix', why: baseWhy,
      mix: mix, labelOf: labelOf, picked: a };
  }

  // The pools bake one ideal per spot, but the engine's own reasoning often blesses a
  // second line ("checking back is also fine", "calling to trap is fine", "right at the
  // price: close either way"). Those were scored as misses under a "≈" that read as fine.
  // Each hedge names exactly one alternative — never any answer at all. Three hedges the
  // feedback printed were not read here, so the move the text had just approved was graded
  // ✗ (LAUNCH follow-up, owner review D10): "Raising as a semi-bluff also works with this
  // much equity" (call → raise), "call-dominant, raise sparingly for protection" (call →
  // raise) and "(Trapping a dry board occasionally is fine.)" (bet → check, the trap).
  // test_ui_smoke holds every pool decision to its text: what it endorses is close, and
  // nothing else is.
  function realAlts(en) {
    var w = (en && en.why) || '', i = en && en.ideal, out = [];
    if (i === 'bet' && /checking[^.]*also fine/i.test(w)) out.push('check');
    if (i === 'bet' && /trapping a dry board occasionally is fine/i.test(w)) out.push('check');
    if (i === 'raise' && /(calling|flatting) to trap is fine/i.test(w)) out.push('call');
    if (i === 'call' && /raising as a semi-bluff also works/i.test(w)) out.push('raise');
    // A made hand on a wet board says protection, not semi-bluff (STUDY-6).
    if (i === 'call' && /a raise for protection also works/i.test(w)) out.push('raise');
    if (i === 'call' && /raise sparingly/i.test(w)) out.push('raise');
    if (/thin value[^.]*it[’']s close/i.test(w)) out.push(i === 'check' ? 'bet' : i === 'bet' ? 'check' : '');
    if (/right at the price/i.test(w)) out.push(i === 'call' ? 'fold' : i === 'fold' ? 'call' : '');
    if (i === 'check' && /margin is too thin[^.]*it[’']s close/i.test(w)) out.push('bet');
    return out.filter(function (a, k) { return a && out.indexOf(a) === k; });
  }
  // The engine's sentence opens with its own numbers ("Showdown equity ≈ 90% · price 25% — …"), so
  // each prints once: that opening clause dim with its numbers bold, then the rest. A check-or-bet
  // decision adds the calling-range equity to it when the sentence doesn't already say it. The
  // feedback used to lead with a short "eq 90% · …" copy of the same clause (the Mac's a5dab85, 1).
  function engWhy(e) {
    var en = e.engine || {}, w = String(en.why || ''), i = w.indexOf(' — ');
    var head = i > 0 ? w.slice(0, i) : '', rest = i > 0 ? w.slice(i + 3) : w;
    if (en.eqCall != null && e.decision === 'cb' && !/calling range/.test(w)) head += (head ? ' · ' : '') + 'vs the calling range ' + en.eqCall + '%';
    return (head ? '<span class="dim">' + esc(head).replace(/(\d+%)/g, '<b>$1</b>') + '</span> — ' : '') + esc(rest);
  }
  // The pools write a street's cards as codes ("Flop (2cJsKc): …"); they print as cards, the way
  // "villain had K♦A♠" beside them does (the Mac's a5dab85, 2).
  function tailHtml(t) {
    return esc(seatTxt(t)).replace(/\(((?:[2-9TJQKA][cdhs])+)\)/g, function (m, cs) { return cs.match(/../g).map(cardHtml).join(''); });
  }
  // The engine's answer as the spot can be played: facing an all-in its raise is a call, and
  // nothing endorses a raise.
  function realIdeal(e) { return realAllIn(e) && e.engine.ideal === 'raise' ? 'call' : e.engine.ideal; }
  // The grade of a real-spot answer, with no side effects: realScore adds it to the drill's stats,
  // and Home's daily hand reads it as is. One copy of the words.
  function realVerdict(e, a) {
    var allin = realAllIn(e), ideal = realIdeal(e), match = a === ideal;
    var close = !match && realAlts(e.engine).filter(function (x) { return !allin || x !== 'raise'; }).indexOf(a) >= 0;
    return { match: match, close: close, r: match ? 'right' : close ? 'mix' : 'wrong',
      cls: match ? 'good' : close ? 'mix' : 'bad',
      head: match ? '✓ You matched the engine — <b>' + esc(ideal) + '</b>'
        : close ? '≈ Close — the engine leans <b>' + esc(ideal) + '</b>, your ' + esc(a) + ' is fine'
        : '✗ Engine’s take: <b>' + esc(ideal) + '</b> <span class="dim">(you chose ' + esc(a) + ')</span>',
      // Said once, beside the engine's own words, when they name a raise the spot doesn't allow.
      allinNote: allin && e.engine.ideal === 'raise' ? '<div class="dim" style="margin-bottom:3px">No raise is possible here: an all-in is in front of you, or a call is all you have left. The engine’s raise counts as a call.</div>' : '' };
  }
  function realScore(e, a, byMode) {
    var v = realVerdict(e, a);
    stats.att++;
    var mr = stats.byMode[byMode] || (stats.byMode[byMode] = { a: 0, c: 0 }); mr.a++;
    if (v.match) { stats.cor++; mr.c++; stats.streak++; if (stats.streak > stats.best) stats.best = stats.streak; }
    else if (v.close) { stats.cor++; stats.mix++; mr.c++; }
    else stats.streak = 0;
    saveStats();
    return v;
  }
  // Real spot: compare your action to the engine's baked take, then REVEAL what
  // actually happened (the result is context, not the answer key).
  function answerReal(s, a) {
    var e = s.e, ideal = realIdeal(e), sc = realScore(e, a, mode), match = sc.match;
    if (window.recordDrill) { try { window.recordDrill({ t: Date.now(), m: s.street, k: 'real:' + e.decision, r: sc.r, ans: a, ideal: ideal, hand: e.label, board: e.board.join(''), eq: e.engine.eq, real: 1 }); } catch (err) { } }
    var net = e.actual.net, H = window.HandEval, villC = e.villCards.match(/../g).map(cardHtml).join(''), heroBest = null;
    if (H && H.eval7) { var c = H.cmp(H.eval7(e.heroCards.match(/../g).concat(e.board).map(H.cardId)), H.eval7(e.villCards.match(/../g).concat(e.board).map(H.cardId))); heroBest = c > 0 ? 1 : c < 0 ? -1 : 0; }
    var aggro = e.actual.action === 'bet' || e.actual.action === 'raise';
    var res = net > 0 ? 'hero <b>won +' + net + 'bb</b>' : net < 0 ? 'hero <b>lost ' + Math.abs(net) + 'bb</b>' : 'hero <b>chopped</b>';
    var note = (aggro && net > 0 && heroBest === -1) ? ' — a <b>bluff that worked</b> (villain folded a better hand)'
      : (e.actual.action === 'check' && e.actual.tail && /raises to/.test(e.actual.tail)) ? ' — a <b>check-raise</b>'
        : '';
    // show the COMPLETE action from the decision onward, so the net always makes sense (e.g. a "check"
    // that became a check-raise all-in). Falls back to a one-liner for older pools without the tail.
    var story = (e.actual.tail ? tailHtml(e.actual.tail) + ' → ' : '') + res + ' · villain had ' + villC + note;
    var cls = sc.cls, head = sc.head;
    $('drillBtns').hidden = true;
    var fb = $('drillFb'); fb.hidden = false;
    fb.innerHTML = '<div class="fbhead ' + cls + '">' + head + '</div>' +
      '<div class="fbwhy">' + sc.allinNote + engWhy(e) +
      '<div class="dim" style="margin-top:3px">villain range: ' + esc(rangeTxt(e.engine.range)) + '</div>' +
      '<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(128,128,128,.25)"><b>What actually happened:</b> ' + story +
      '. <span class="dim">The result isn’t the answer — just the real spot.</span></div></div>' +
      '<button class="btn next" id="drillNext">Next hand</button>';
    $('drillNext').onclick = nextSpot;
    renderStats();
  }

  // Full-hand decision: grade your action vs the engine's baked take, reveal what the
  // real player did at THIS point, then advance along the real line (or, on the last
  // decision, show the whole run-out + showdown).
  function answerHand(s, a) {
    var hand = s.hand, di = s.di, d = hand.decisions[di], e = s.e;
    var ideal = realIdeal(e), last = di >= hand.decisions.length - 1, sc = realScore(e, a, 'hands');
    if (window.recordDrill) { try { window.recordDrill({ t: Date.now(), m: 'hands', k: 'hand:' + e.decision, r: sc.r, ans: a, ideal: ideal, hand: e.label, board: e.board.join(''), eq: e.engine.eq, real: 1, hid: hand.id, di: di }); } catch (err) { } }
    var cls = sc.cls, head = sc.head;
    var actW = { check: 'checked', bet: 'bet', fold: 'folded', call: 'called', raise: 'raised' }[d.actual] || d.actual;
    $('drillBtns').hidden = true;
    var fb = $('drillFb'); fb.hidden = false;
    var body = '<div class="fbhead ' + cls + '">' + head + '</div>' +
      '<div class="fbwhy">' + sc.allinNote + engWhy(e) +
      '<div class="dim" style="margin-top:3px">villain range: ' + esc(rangeTxt(e.engine.range)) + '</div>' +
      '<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(128,128,128,.25)"><b>Actual line:</b> hero <b>' + actW + '</b>.';
    if (last) {
      var net = hand.net, villC = hand.villCards.match(/../g).map(cardHtml).join('');
      var res = net > 0 ? 'won <b>+' + net + 'bb</b>' : net < 0 ? 'lost <b>' + Math.abs(net) + 'bb</b>' : '<b>chopped</b>';
      body += '</div>' +
        '<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(128,128,128,.25)"><b>How it played out:</b> ' +
        (hand.tail ? tailHtml(hand.tail) + ' → ' : '') + 'hero ' + res + ' · villain had ' + villC +
        '. <span class="dim">You walked the real hand — the engine take was the lesson, the result is just how it went.</span></div></div>' +
        '<button class="btn next" id="drillNext">Next hand</button>';
      fb.innerHTML = body;
      $('drillNext').onclick = nextSpot;
    } else {
      var nd = hand.decisions[di + 1], nextLabel = nd.street !== d.street ? 'See the ' + nd.street + ' →' : 'Continue →';
      body += ' <span class="dim">The hand follows reality — next decision uses what actually happened.</span></div></div>' +
        '<button class="btn next" id="drillNext">' + nextLabel + '</button>';
      fb.innerHTML = body;
      $('drillNext').onclick = function () { cur = handAt(hand, di + 1); renderScenario(); keepSpotInView(); };
    }
    renderStats();
  }

  // The verdict on an answer: {cls, head, sub}. The drill puts sub under the head (fbsub); Home's
  // daily hand beside its small cards. One copy of the words.
  function verdict(g, a) {
    // close spot where you picked the strictly-ideal action = a clean correct,
    // not a "mix" (mix = you took the OTHER acceptable line)
    var pickedIdeal = g.idealAct != null && a === g.idealAct;
    var head, cls, sub = '', verb = g.verb || 'Ideal';
    if (g.plainHead) {
      // Free spots (§4b): the verdict, then what the chart does, in a sentence. "The app's
      // answer" rather than "Engine's take" or "ideal": it is the app's default, not the truth.
      cls = g.marginal && !pickedIdeal ? 'mix' : g.right ? 'good' : 'bad';
      head = cls === 'mix' ? '≈ Close. The app’s answer: ' + g.idealWord
        : cls === 'good' ? '✓ ' + g.idealWord : '✗ The app’s answer: ' + g.idealWord;
      sub = (cls === 'mix' ? 'Yours is fine too. ' : '') + g.plainHead +
        (cls === 'good' && g.marginal ? ' Close: the other answer is fine too.' : '');
    }
    else if (verb === 'Mix') {                             // c-bet: frequency-phrased heads
      cls = g.marginal ? 'mix' : g.right ? 'good' : 'bad';
      head = (cls === 'good' ? '✓ ' : cls === 'mix' ? '≈ ' : '✗ ') + g.idealWord;
    }
    else if (g.marginal && pickedIdeal) {
      // close spot AND you picked the ideal action — acknowledge it, don't imply you deviated
      cls = 'good'; head = '✓ ' + g.idealWord + ' <span class="dim">(close — the other line’s fine too)</span>';
    }
    else if (g.marginal) { cls = 'mix'; head = '≈ Close — ' + (verb === 'Nash' ? 'Nash' : verb.toLowerCase()) + ' is <b>' + g.idealWord + '</b>, your answer’s fine'; }
    else if (g.right) { cls = 'good'; head = '✓ ' + g.idealWord; }
    // "Ideal" oversold heuristic spots; the How-to promises "the engine's take", never "the truth".
    else { cls = 'bad'; head = '✗ ' + (verb === 'Ideal' ? 'Engine’s take' : verb) + ': ' + g.idealWord; }
    return { cls: cls, head: head, sub: sub };
  }
  function answer(a) {
    var s = cur;
    if (s.real) { if (s.hands) { if (s.e) answerHand(s, a); } else if (s.e) answerReal(s, a); return; }   // ignore clicks while pool still loading
    var g = s.mode === 'pf' ? gradePF(s, a) : s.mode === 'odds' ? gradeOdds(s, a) : gradeCbet(s, a);
    // close spot where you picked the strictly-ideal action = a clean correct,
    // not a "mix" (mix = you took the OTHER acceptable line)
    var pickedIdeal = g.idealAct != null && a === g.idealAct;

    stats.att++;
    var mr = stats.byMode[mode] || (stats.byMode[mode] = { a: 0, c: 0 }); mr.a++;
    var dep = s.mode === 'pf' ? (stats.byDepth[s.depth] || (stats.byDepth[s.depth] = { a: 0, c: 0 })) : null;
    if (dep) dep.a++;
    if (g.marginal && !pickedIdeal) { stats.mix++; stats.cor++; mr.c++; if (dep) dep.c++; }   // took the other fine line
    else if (g.right) { stats.cor++; mr.c++; if (dep) dep.c++; stats.streak++; if (stats.streak > stats.best) stats.best = stats.streak; if (s.mode === 'pf' && s.replay) removeMiss(s); }
    else { stats.streak = 0; if (s.mode === 'pf') addMiss(s); }
    saveStats();

    logAnswer(s, a, g);

    // deep chain: you 3-bet a deep open and the opener 4-bets — same hand
    if (s.mode === 'pf' && s.kind === 'vs' && a === 'threebet' && s.depth >= 50 && Math.random() < (pfDepthFocus() === 'deep' ? 0.22 : 0.10)) {
      pendingChain = { mode: 'pf', kind: 'vs4bet', vseat: s.vseat, raiser: s.opener,
        pos3: ipVs(s.vseat, s.opener), depth: s.depth, c1: s.c1, c2: s.c2, label: s.label, chained: true };
    }
    // live-deal chain: you opened and a seat behind 3-bets — same hand, new decision. On the
    // free tier only while today's 10 are not used up; past that the open is graded on its own
    // and the hand ends there, with a line saying why rather than a button that goes nowhere.
    var capped = false;
    if (s.mode === 'pf' && s.kind === 'open' && s.chainRaiser && a === 'open') {
      // The allowance is a free-tier rule, so it is checked against the tier now, not the one
      // the open was dealt under: a player who buys Pro with a free open on screen must not be
      // told today's free ten are used, nor be dealt the 3-bet as a counted free spot.
      var freeNow = s.free && !cardPro();
      if (freeNow && threeBetsToday() >= FREE_3BET_DAY) capped = true;
      else pendingChain = { mode: 'pf', kind: 'vs3bet', pos: s.pos, raiser: s.chainRaiser,
        pos3: ipVs(s.pos, s.chainRaiser), depth: s.depth >= 20 ? s.depth : 20,
        c1: s.c1, c2: s.c2, label: s.label, chained: true, free: freeNow || undefined };
    }

    var vd = verdict(g, a), cls = vd.cls, head = vd.head + (g.plainHead ? '<span class="fbsub">' + vd.sub + '</span>' : '');

    // The chain announces itself on the Next button. Free spots name the seat in words and
    // say what a 3-bet is the first time it can appear (§4b: "Button 3-bets (re-raises) you →").
    var nextTxt = !pendingChain ? 'Next hand'
      : pendingChain.free ? cap1(SEAT_PLAIN[pendingChain.raiser]) + ' 3-bets (re-raises) you →'
        : cap1(P.POS_NAME[pendingChain.raiser]) + (pendingChain.kind === 'vs4bet' ? ' 4-bets you →' : ' 3-bets you →');
    $('drillBtns').hidden = true;
    var fb = $('drillFb'); fb.hidden = false;
    fb.innerHTML = '<div class="fbhead ' + cls + '">' + head + '</div>' +
      mixBars(g.mix, g.labelOf, g.picked) +
      '<div class="fbwhy">' + cap1(g.why) + '</div>' +
      (capped ? '<p class="mini fbcap">' + cap1(SEAT_PLAIN[s.chainRaiser]) + ' re-raised (3-bet) here. You’ve used today’s ' + FREE_3BET_DAY +
        ' free re-raise spots, so the hand stops at your raise. More tomorrow, or unlimited with Pro. <button class="linkish" data-pro="1">See what Pro adds</button></p>' : '') +
      // A missed free open points at the free guide that explains the chart (§8): the drill was
      // the only way a beginner met the chart, and nothing on it led to the reading.
      (g.plainHead && cls === 'bad' && s.kind === 'open' && typeof window.openGuide === 'function'
        ? '<p class="mini fbguide">Why: <button class="linkish" data-guide="learn-hands.html">Which hands to play →</button></p>' : '') +
      '<button class="btn next" id="drillNext">' + nextTxt + '</button>';
    $('drillNext').onclick = nextSpot;
    fb.onclick = function (ev) {
      if (!ev.target.closest) return;
      var gd = ev.target.closest('[data-guide]');
      if (gd) return window.openGuide(gd.dataset.guide, 'Which hands to play');
      if (ev.target.closest('[data-pro]') && window.showTab) window.showTab('Pro');
    };
    renderStats();
  }

  // Record each answer to the synced db (db.drills) for later pattern analysis.
  function logAnswer(s, a, g) {
    if (!window.recordDrill) return;
    var e = { t: Date.now(), m: s.mode, r: (g.marginal && a !== g.idealAct) ? 'mix' : (g.right ? 'right' : 'wrong'), ans: a, ideal: g.idealWord };
    if (pfDepthFocus() === 'leak') e.focus = 'leak';     // tag weak-spot reps for leak-trend analysis
    if (s.mode === 'pf') { e.k = s.kind; e.depth = s.depth; e.spot = [s.opener, s.raiser, s.vseat || s.pos || s.pos3].filter(Boolean).join('>'); e.hand = s.label; e.style = pfStyle(); if (s.chained) e.chained = 1; }
    else if (s.mode === 'odds') { e.k = 'odds:' + s.key; e.eq = Math.round(s.equity * 100); e.req = Math.round(s.required * 100); e.street = s.variant; }
    else { e.k = (s.street === 'river' ? 'river:' : 'cbet:') + s.node; e.spot = SEAT_NAME[s.heroSeat] + (s.pos === 'ip' ? '/IP' : '/OOP'); e.pot = s.potType; e.edge = s.edge; e.hand = s.cls.label; e.board = s.board.join(''); e.eq = Math.round(s.eq * 100); if (s.price != null) { e.price = Math.round(s.price * 100); e.bet = s.bet; } if (s.street === 'turn' || s.street === 'river') { e.street = s.street; e.sub = s.sub; e.tier = s.tier; } }
    try { window.recordDrill(e); } catch (err) { /* logging must never break the drill */ }
  }

  function addMiss(s) {
    var k = spotKey(s);
    stats.misses = stats.misses.filter(function (m) { return spotKey(m) !== k; });
    stats.misses.unshift({ kind: s.kind, pos: s.pos, opener: s.opener, raiser: s.raiser, vseat: s.vseat, pos3: s.pos3, callers: s.callers, limpers: s.limpers, blind: s.blind, depth: s.depth });
    if (stats.misses.length > 40) stats.misses.length = 40;
  }
  function removeMiss(s) {
    var k = spotKey(s);
    stats.misses = stats.misses.filter(function (m) { return spotKey(m) !== k; });
    saveStats();
  }

  function renderStats() {
    var acc = stats.att ? Math.round(stats.cor / stats.att * 100) : 0;
    var modeChips = MODES.filter(function (m) { return stats.byMode[m.v]; }).map(function (m) {
      var r = stats.byMode[m.v]; return '<span class="chip">' + m.t + ' <b>' + Math.round(r.c / r.a * 100) + '%</b> · ' + r.a + '</span>';
    }).join('');
    var depths = Object.keys(stats.byDepth).sort(function (a, b) { return a - b; });
    var dh = mode === 'pf' ? depths.map(function (k) {
      var r = stats.byDepth[k]; return '<span class="chip">' + k + 'bb <b>' + (r.a ? Math.round(r.c / r.a * 100) : 0) + '%</b> · ' + r.a + '</span>';
    }).join('') : '';
    // On the free tier only the misses it can deal again count as "coming back": a Pro-era
    // miss at 30bb stays queued for later, but promising it now would be untrue.
    var free = !cardPro();
    var nMiss = free ? stats.misses.filter(freeMiss).length : stats.misses.length;
    // One line, as designed ("14 right of 19 · streak 5"); the per-street and per-depth
    // splits fold away, each with its sample size — "Flop 0%" off one answer means nothing.
    $('drillStats').innerHTML =
      '<div class="statline"><b>' + stats.cor + '</b> right of <b>' + stats.att + '</b>' + (stats.att ? ' · ' + acc + '%' : '') +
      ' · streak <b>' + stats.streak + '</b> · best <b>' + stats.best + '</b>' +
      (nMiss ? ' · <b>' + nMiss + '</b> missed ' + (nMiss === 1 ? 'spot' : 'spots') + ' coming back' : '') + '</div>' +
      (free ? '<div class="statline">' + freeCount(Math.min(threeBetsToday(), FREE_3BET_DAY)) + '</div>' : '') +
      (modeChips || dh ? '<details class="statdet"><summary>By street' + (dh ? ' and stack size' : '') + '</summary>' +
        (modeChips ? '<div class="stats" style="margin-top:8px">' + modeChips + '</div>' : '') +
        (dh ? '<div class="stats" style="margin-top:6px">' + dh + '</div>' : '') + '</details>' : '') +
      '<button class="reset" id="drillReset">Reset stats</button>';
    $('drillReset').onclick = function () {
      var go = function () {
        // Filters are preferences, not stats — resetting accuracy must not silently change
        // which spots get dealt (and must re-render the options UI so it can't go stale).
        var mo = stats.mode, st = stats.pfStyle, dp = stats.pfDepth, pd = stats.postDepth, oo = stats.optsOpen;
        stats = freshStats(); stats.mode = mo; stats.pfStyle = st; stats.pfDepth = dp; stats.postDepth = pd; stats.optsOpen = oo;
        saveStats(); renderStats(); renderModeSel();
      };
      // The app's own dialog: a system confirm() is titled with the web view's host.
      if (window.ask) window.ask('Reset drill stats?', 'Clears the counters and the misses queued to come back. Your answers stay in Your game.', 'Reset', true).then(function (y) { if (y) go(); });
      else go();
    };
  }

  /* ====================== POCKET CARD ====================== */
  var cDepth = 20, cSit = 'open', cPos = 'BTN', cOpener = 'BTN', cYou = 'field', cIpo = 'ip';
  // Free/Pro line (owner, 2026-10-07): the 100bb first-in chart is free, for every seat; every
  // other depth and situation is Pro. A locked chip still works: it shows the Pro pitch in the
  // chart's place, never a dead control. Standalone (test_ui_smoke) there is no app shell and
  // no isPro, so every chart is open.
  var cTouched = false;   // until the user picks a depth or situation, a free user opens on the free chart
  function cardPro() { return typeof window.isPro !== 'function' || window.isPro(); }
  function cardFree(depth, sit) { return depth === 100 && sit === 'open'; }
  var LOCK_IC = '<svg class="lkic" viewBox="0 0 12 14" aria-hidden="true"><rect x="1.5" y="6" width="9" height="7" rx="1.6" fill="currentColor"/>' +
    '<path d="M3.6 6V4.3a2.4 2.4 0 0 1 4.8 0V6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

  function selRow(items, attr, val, locked) {
    return items.map(function (it) {
      var lk = locked && locked(it.v);
      return '<button data-' + attr + '="' + it.v + '"' + (it.v == val ? ' class="on"' : '') +
        (lk ? ' aria-label="' + it.t + ', Pro"' : '') + '>' + it.t + (lk ? LOCK_IC : '') + '</button>';
    }).join('');
  }

  function renderSelectors() {
    var dlist = cSit === 'vs3' ? [20, 30, 50, 100] : P.CARD_DEPTHS;
    if (dlist.indexOf(cDepth) < 0) cDepth = dlist[0];
    var depths = dlist.map(function (d) { return { v: d, t: d + 'bb' }; });
    var free = !cardPro();
    // Free shows the third chart's name in words (it is a locked headline there); Pro keeps "Vs 3-bet".
    var sits = [{ v: 'open', t: 'First in' }, { v: 'vs', t: 'Facing a raise' }, { v: 'vs3', t: free ? 'Vs re-raise' : 'Vs 3-bet' }];
    var html = '<div class="sel" id="selDepth">' + selRow(depths, 'd', cDepth, free && function (v) { return v !== 100; }) + '</div>' +
      '<div class="sel" id="selSit">' + selRow(sits, 'x', cSit, free && function (v) { return v !== 'open'; }) + '</div>';
    if (cSit === 'open') {
      var pos = P.POS.map(function (p) { return { v: p, t: sc(p) }; });   // UTG–LJ · HJ · CO · BTN · SB (the engine keys stay EP/MP)
      html += '<div class="sel sub seats"><span class="sl">You:</span>' + selRow(pos, 'p', cPos) + '</div>';
    } else if (cSit === 'vs3') {
      var ipo = free ? [{ v: 'ip', t: 'In position' }, { v: 'oop', t: 'Out of position' }] : [{ v: 'ip', t: 'You’re IP' }, { v: 'oop', t: 'You’re OOP' }];
      html += '<div class="sel sub"><span class="sl">Position:</span>' + selRow(ipo, 'i', cIpo) + '</div>';
    } else {
      var yous = [{ v: 'field', t: 'In field' }, { v: 'SB', t: 'SB' }, { v: 'BB', t: 'BB' }];
      html += '<div class="sel sub"><span class="sl">You:</span>' + selRow(yous, 'u', cYou) + '</div>';
      var ops = cYou === 'BB' ? ['EP', 'MP', 'CO', 'BTN', 'SB'] : P.OPENERS;   // BB can face an SB open
      if (ops.indexOf(cOpener) < 0) cOpener = ops[ops.length - 1];
      var op = ops.map(function (p) { return { v: p, t: sc(p) }; });
      html += '<div class="sel sub seats"><span class="sl">Opener:</span>' + selRow(op, 'o', cOpener) + '</div>';
    }
    $('cardSel').innerHTML = html;
    // single idempotent delegate (renderSelectors re-runs on every change)
    $('cardSel').onclick = function (e) {
      var b;
      if ((b = e.target.closest('[data-d]'))) { cTouched = true; cDepth = +b.dataset.d; return renderCard(); }
      if ((b = e.target.closest('[data-x]'))) { cTouched = true; cSit = b.dataset.x; return renderCard(); }
      if ((b = e.target.closest('[data-p]'))) { cPos = b.dataset.p; return renderCard(); }
      if ((b = e.target.closest('[data-u]'))) { cYou = b.dataset.u; return renderCard(); }
      if ((b = e.target.closest('[data-i]'))) { cIpo = b.dataset.i; return renderCard(); }
      if ((b = e.target.closest('[data-o]'))) { cOpener = b.dataset.o; return renderCard(); }
    };
  }
  function vsRow() { return cYou === 'field' ? P.vsThresholds(cDepth, cOpener) : P.blindVsThresholds(cYou, cDepth, cOpener); }

  function cellAction(label) {
    if (cSit === 'open') {
      if (cDepth === 10 && window.NASH && window.NASH.jam[10])      // Nash set, not a percentile prefix
        return window.NASH.jam[10][cPos][label] > 0 ? 'in' : 'fold';
      if (cPos === 'SB' && cDepth >= 20) {                          // SB: raise / limp / fold (ante VPIP)
        var sa = P.sbAction(cDepth, label); return sa === 'raise' ? 'in' : sa === 'limp' ? 'call' : 'fold';
      }
      return P.openIn(cPos, cDepth, label) ? 'in' : 'fold';
    }
    if (cSit === 'vs3') return P.vs3betEval(cDepth, cIpo, label).action;   // includes AK promotion
    var row = vsRow();
    var p = P.defendPct(label, cDepth);               // defend rank (SC + set-mine), matches bandEval
    if (p == null) return 'fold';
    return p <= row.tb ? 'threebet' : p <= row.call ? 'call' : 'fold';
  }

  function renderGrid() {
    var html = '<div class="grid13' + (sbLimpChart() ? ' sbl' : '') + '">';
    for (var r = 0; r < 13; r++) {
      for (var c = 0; c < 13; c++) {
        var label = r === c ? RORD[r] + RORD[r] : r < c ? RORD[r] + RORD[c] + 's' : RORD[c] + RORD[r] + 'o';
        var a = cellAction(label);
        var cls = a === 'in' ? 'in' : a === 'threebet' ? 'tb' : a === 'call' ? 'cl' : '';
        // Spoken as 'AKs, 3-bet': the action was carried by colour alone.
        var say = a === 'in' ? legendWord('in') : a === 'threebet' ? legendWord('tb') : a === 'call' ? legendWord('cl') : 'fold';
        html += '<div class="g13 ' + cls + '" role="img" aria-label="' + label + ', ' + say + '">' + label + '</div>';
      }
    }
    $('cardGrid').innerHTML = html + '</div>' + legend();
  }

  // The legend's own words, so a cell reads the same as the key under the chart.
  function legendWord(k) {
    if (cSit === 'open') return k === 'in' ? (cPos === 'SB' && cDepth >= 20 ? 'raise' : cDepth === 10 ? 'jam' : 'raise') : k === 'cl' ? 'limp' : 'fold';
    if (k === 'tb') return cSit === 'vs3' ? (cDepth >= 30 ? '4-bet' : '4-bet jam') : (cDepth >= 30 ? '3-bet' : '3-bet jam');
    return 'call';
  }
  // The small blind's first-in chart is the one with limps: teal raise and green limp sit at
  // about 1.05:1 luminance, so its limp cells (and their swatch) carry a dark ring as well.
  function sbLimpChart() { return cSit === 'open' && cPos === 'SB' && cDepth >= 20; }
  function legend() {
    if (cSit === 'open') {
      if (sbLimpChart())                                            // SB: 3-color raise/limp/fold
        return '<div class="lg sbl"><span class="k in"></span>raise<span class="k cl"></span>' + (cardPro() ? 'limp' : 'limp (just call)') + '<span class="k"></span>fold' +
          ' <span class="dim">· s = suited, o = offsuit</span></div>';
      var verb = cDepth === 10 ? 'jam' : 'raise';
      return '<div class="lg"><span class="k in"></span>' + verb + '<span class="k"></span>fold' +
        ' <span class="dim">· s = suited, o = offsuit</span></div>';
    }
    var tb = cSit === 'vs3' ? (cDepth >= 30 ? '4-bet' : '4-bet jam') : (cDepth >= 30 ? '3-bet' : '3-bet jam');
    return '<div class="lg"><span class="k tb"></span>' + tb + '<span class="k cl"></span>call' +
      '<span class="k"></span>fold <span class="dim">· s = suited, o = offsuit</span></div>';
  }

  function combosFor(test) {
    var n = 0;
    for (var i = 0; i < DATA.ranking.length; i++) if (test(DATA.ranking[i].h)) n += DATA.ranking[i].w;
    return n;
  }

  // The free chart's line under the grid (LAUNCH_PLAN §4b, Appendix A study.js:1554-1659): the
  // seat in words, what "first in" and "100bb" mean, and the range as "the best ~X% of hands".
  // Same numbers and claims as the Pro line below it; the small blind keeps its own three bands.
  function renderMetaFree(pctH) {
    var lead = 'First in (everyone before you has folded) from <b>' + seatTerm(cPos) + '</b>, ' + T('bb', cDepth + 'bb') + ' deep: ';
    if (cPos === 'SB') {
      var lc = Math.round(P.sbLimpCutoff(cDepth) * 100);
      $('cardMeta').innerHTML = lead + 'only the big blind is left. Raise with the best <b>~' + pctH + '%</b> of hands, ' +
        T('limp', 'limp') + ' (just call the big blind) with the next hands down to the best <b>~' + lc + '%</b>, and fold the rest.' +
        ' <span class="dim">The chart counts a big-blind ante (an extra big blind in the pot), so calling is cheap: the small blind plays about ' + lc +
        '% of its hands here, far more than it raises. The raises are every pair, most aces and the other strong hands. Limp the next hands down, mostly weaker suited hands and offsuit hands with a king, a queen or a small ace, ' +
        'even though you act first after the flop (out of position); the green cells are your limps. Fold the weakest ~' + (100 - lc) + '%, mostly low offsuit hands, even at this price.</span>';
      return;
    }
    $('cardMeta').innerHTML = lead + 'raise with the best <b>~' + pctH + '%</b> of hands and fold the rest.';
  }
  function renderMeta() {
    if (cSit === 'open') {
      var thr = P.openThreshold(cPos, cDepth);
      var pctH = Math.round(thr * 100);
      if (!cardPro()) return renderMetaFree(pctH);                // only 100bb first-in renders on free
      if (cPos === 'SB' && cDepth >= 20) {                          // SB with a limp range
        var lc = Math.round(P.sbLimpCutoff(cDepth) * 100);
        $('cardMeta').innerHTML = '<b>Small blind</b>, ' + cDepth + 'bb — folded to you, heads-up vs the BB. ' +
          'Raise <b>~' + pctH + '%</b>, <b>limp</b> the playable band out to <b>~' + lc + '%</b>, fold the rest.' +
          ' <span class="dim">The big-blind ante makes completing cheap, so the SB plays a huge total VPIP (~' + lc + '%) — far more than the raise range alone. Raise every pair and most aces; limp the next band (mostly weaker suited hands and offsuit hands with a king, a queen or a small ace), too weak to raise but too good to fold OOP; the green cells are your limps. Fold the weakest ~' + (100 - lc) + '%, mostly low offsuit hands, even at the great price.</span>';
        return;
      }
      var verb = cDepth === 10 ? 'open-jam' : 'open-raise';
      var src = cDepth === 10 && window.NASH ? ' <span class="dim">Approximate Nash (BB-ante pot). Note the suited hands hanging below the offsuit line.</span>'
        : ' <span class="dim">Folded to you, first in.</span>';
      $('cardMeta').innerHTML = '<b>' + cap1(P.POS_NAME[cPos]) + '</b>, ' + cDepth + 'bb — ' + verb +
        ' <b>~' + pctH + '%</b> of hands.' + src;
    } else if (cSit === 'vs3') {
      var t3 = (P.VS3BET[cDepth] || P.VS3BET[30])[cIpo];
      var v3 = cDepth >= 30 ? '4-bet' : '4-bet jam';
      $('cardMeta').innerHTML =
        'You opened, someone <b>3-bet</b>, you’re <b>' + (cIpo === 'ip' ? 'in position' : 'out of position') + '</b> at ' + cDepth + 'bb. ' +
        v3 + ' ~<b>' + Math.round(t3.tb * 100) + '%</b>' + (t3.call > t3.tb ? ', call up to ~<b>' + Math.round(t3.call * 100) + '%</b>' : '') + ', fold the rest. ' +
        '<span class="dim">' + (cDepth === 20 ? 'At ≤20bb this is really jam-or-fold — flatting creates an SPR≈1 guessing game.' :
          cIpo === 'ip' ? 'IP you can flat the middle of your range; the 4-bets are value-weighted.' :
            'OOP, lean 4-bet-or-fold — calling to play a 3-bet pot out of position bleeds.') +
        ' Note AK is promoted into the 4-bet zone at every depth (blockers + domination beat its raw rank) — see “Playing AK” in the Library.</span>' +
        '<div class="refnote"><b>4-bet bluffs — default vs adjust.</b> Theory says polarize: value (AA/KK/AK) + a few bluffs, ideally <b>suited wheel aces (A5s/A4s/A3s)</b> — they block AA/AKs and keep a wheel/flush backup when called. <b>Default in typical live games: stay value-heavy, flat the wheel aces.</b> The field 3-bets value-heavy and doesn’t fold to 4-bets, so bluff-4-betting folds out hands that aren’t there. <b>Adjust UP vs aggressive regs / online-style 3-bettors</b> (they 3-bet light → A5s 4-bet bluffs print). Same logic for <b>flat-calling 4-bets light</b> (suited broadway/Ax, IP, deep): a reg-game move, not a default vs a range that 4-bets only the nuts.</div>';
    } else {
      var th = vsRow();
      var tbVerb = cDepth >= 30 ? '3-bet' : '3-bet jam';
      var who = cYou === 'field' ? 'folded to you (in the field)' : 'you’re in the <b>' + cYou + '</b>';
      var note = cYou === 'BB'
        ? 'BB defends widest — you close the action and already have 1bb in. Vs the SB it’s the widest spot in poker.'
        : cYou === 'SB'
          ? 'SB leans 3-bet-or-fold — out of position all hand with no closing discount, so flatting is thin.'
          : 'You play wider vs a later opener (button) than vs an early seat (UTG–LJ) — that’s the whole idea.';
      $('cardMeta').innerHTML =
        '<b>' + cap1(P.POS_NAME[cOpener]) + '</b> open-raises, ' + who + '. ' +
        tbVerb + ' ~<b>' + Math.round(th.tb * 100) + '%</b>, ' + (cYou === 'BB' ? 'defend' : 'flat-call') + ' up to ~<b>' + Math.round(th.call * 100) + '%</b>, fold the rest. ' +
        '<span class="dim">' + note + '</span>';
    }
  }

  /* ---------- reference blocks ---------- */
  function maxCall(e) {                              // direct-odds max bet for equity e, as a share of the pot
    if (e >= 0.5) return 'any size';
    var x = e / (1 - 2 * e);
    // '≤ 31% pot' reads where '≤ .31× pot' needed decoding; same number (Appendix A, study.js:1707-1724).
    return x >= 1 ? '≤ ' + x.toFixed(1) + '× pot' : '≤ ' + Math.round(x * 100) + '% pot';
  }
  function mEq(a, b) { var m = (DATA.matchups || []).find(function (z) { return z.a === a && z.b === b; }); return m ? m.eqA : null; }

  function refHtml(which) {
    // pot odds
    // The four blocks below are free and read by someone who knows the rules but not the slang
    // (LAUNCH_PLAN §4b, Appendix A study.js:1698-1735): each term is said in words or drawn with T().
    var pot = '<table class="ref"><tr><th>they bet</th><th class="r">you need to win</th></tr>' +
      '<tr><td>pot-size</td><td class="r">33%</td></tr>' +
      '<tr><td>¾ pot</td><td class="r">30%</td></tr>' +
      '<tr><td>½ pot</td><td class="r">25%</td></tr>' +
      '<tr><td>⅓ pot</td><td class="r">20%</td></tr>' +
      '<tr><td>¼ pot</td><td class="r">17%</td></tr></table>' +
      '<div class="dim" style="margin-top:6px">The chance of winning you need to call = bet ÷ (pot + 2 × bet). If your chance is higher, call.</div>';

    // outs -> equity -> max callable bet
    var draws = [
      [T('gutshot', 'Gutshot'), 4, 9, 16],
      [T('overcards', 'Two overcards'), 6, 13, 24],
      [T('open-ender', 'Open-ender'), 8, 17, 31],
      ['Flush draw', 9, 19, 35],
      [T('FD', 'FD') + ' + gutshot', 12, 26, 45],
      ['FD + open-ender', 15, 32, 54]
    ];
    var outs = '<table class="ref"><tr><th>draw (' + T('outs', 'outs') + ')</th><th class="r">turn</th><th class="r">river</th><th class="r">biggest call*</th></tr>';
    draws.forEach(function (d) {
      outs += '<tr><td>' + d[0] + ' <span class="dim">(' + d[1] + ')</span></td>' +
        '<td class="r">' + d[2] + '%</td><td class="r">' + d[3] + '%</td>' +
        '<td class="r">' + maxCall(d[2] / 100) + '</td></tr>';
    });
    outs += '</table>' +
      '<div class="dim" style="margin-top:6px">turn / river = the exact chance to hit with 1 / 2 cards to come (outs × 2 / outs × 4 gets you close; it runs high on big draws). ' +
      '<b>biggest call*</b> = the biggest bet you can call on the <b>turn</b> (1 card to come) on the pot odds alone, as a share of the pot. ' +
      'A flush draw hits ~35% of the time by the river, but that pays for a call of up to ~1.2 times the pot only if no more betting will happen; facing a bet on the turn (~19% to hit), call ≤ ~⅓ of the pot. ' +
      'Money you expect to win later when you hit (implied odds) lets you call a bit more; money you can lose when you hit and are still beaten (reverse implied odds), a bit less.</div>';

    // all-in rules of thumb (model-backed, rounded)
    function pctTxt(v) { return v == null ? '' : Math.round(v) + ' / ' + (100 - Math.round(v)); }
    // Appendix A fix 2: the last row read "Big pair vs two unders" over AA/KK, a pair against a
    // smaller pair. It is relabelled to what it is (aces against kings); the numbers are unchanged.
    var rules = '<table class="ref"><tr><th>all-in, before the flop</th><th class="r" style="white-space:nowrap">wins ≈ %</th></tr>' +
      '<tr><td>Bigger pair vs smaller pair <span class="dim">QQ/99</span></td><td class="r"><b>' + pctTxt(mEq('QQ', '99')) + '</b></td></tr>' +
      '<tr><td>Pair vs two lower cards <span class="dim">99/87s</span></td><td class="r"><b>' + pctTxt(mEq('99', '87s')) + '</b></td></tr>' +
      '<tr><td>Pair vs one higher, one lower card <span class="dim">TT/A8</span></td><td class="r"><b>' + pctTxt(mEq('TT', 'A8o')) + '</b></td></tr>' +
      '<tr><td>Pair vs two higher cards <span class="dim">TT/AK</span></td><td class="r"><b>' + pctTxt(mEq('TT', 'AKo')) + '</b></td></tr>' +
      '<tr><td>' + T('dominated', 'Dominated') + ': same ace, worse second card <span class="dim">AQ/AJ</span></td><td class="r"><b>' + pctTxt(mEq('AQo', 'AJo')) + '</b></td></tr>' +
      '<tr><td>Aces vs kings <span class="dim">AA/KK</span></td><td class="r"><b>' + pctTxt(mEq('AA', 'KK')) + '</b></td></tr>' +
      '</table><div class="dim" style="margin-top:6px">Rules of thumb: a pair beats two lower cards about 4 to 1 and one higher, one lower card about 2 to 1; ' +
      'against two higher cards it’s close to a coin flip, the pair slightly ahead. A dominated hand (the same high card with a worse second card) is behind about 7 to 3.</div>';

    var vs3 = '<ul class="reads">' +
      '<li><b>Depth decides everything.</b> ≤20bb after you open: <b>jam or fold</b> — your continues go all-in (calling leaves SPR≈1, a guessing game with no fold equity left). 25–40bb: three buckets — 4-bet your value, call the playable middle <i>in position</i>, fold the rest. OOP: lean <b>4-bet-or-fold</b>; flatting a 3-bet OOP is where chips quietly die.</li>' +
      '<li><b>Read the 3-bet size.</b> Small (≈3× your open IP): defend wider, call more. Big (4×+ or jam-sized): tighten hard and shift to jam-or-fold — their sizing did the range-reading for you.</li>' +
      '<li><b>Facing a 4-bet</b> (you 3-bet, they 4-bet): at 30–40bb a 4-bet commits them — treat it as a jam decision. Continue <b>KK+ always</b>; <b>QQ/AK depth-dependent</b> (jam ≤35bb, closer deeper); everything else — including most of your 3-bet bluffs — <b>folds without regret</b>. Never flat a 4-bet under ~60bb.</li>' +
      '<li><b>The live overlay: 3-bets and especially 4-bets are value-heavy.</b> The pool under-bluffs both. A live 4-bet is QQ+/AK so often that folding AQ and TT is standard (at 100bb the drill calls QQ and JJ, and grades a JJ fold close, never wrong) and even AK can be a fold vs the oldest, tightest player at the table. Your default vs a 4-bet: believe it.</li>' +
      '<li><b>Your own 4-bet bluffs:</b> A5s/A4s are the textbook candidates (the ace blocks AA/AK) — but only vs players who actually 3-bet bluff. In most live games that’s rare, so mostly just 4-bet value.</li>' +
      '</ul><div class="dim" style="margin-top:6px">The “Vs 3-bet” grid above shows the baseline ranges (calibrated, not solved); these reads tell you when to deviate.</div>';

    // percentile anchors — computed from the live ranking so they always match the grids
    function anchorsHtml() {
      function nearest(target) {
        var best = [], arr = sorted.map(function (h) { return { h: h.label, d: Math.abs(h.pct - target) }; })
          .sort(function (a, b) { return a.d - b.d; });
        for (var i = 0; i < arr.length && best.length < 3; i++) best.push(arr[i].h);
        return best.join(' · ');
      }
      var rows = [0.01, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50].map(function (t) {
        return '<tr><td>top ' + Math.round(t * 100) + '%</td><td class="r">' + nearest(t) + '</td></tr>';
      }).join('');
      function pc(label) { return Math.round(P.pct(label) * 100); }
      var classes = '<ul class="reads">' +
        '<li><b>Pairs:</b> TT+ (tens or better) ≈ top ' + pc('TT') + '%, 66 ≈ top ' + pc('66') + '%, 22 ≈ top ' + pc('22') + '% — small pairs rank far lower than they feel.</li>' +
        '<li><b>Suited aces</b> (an ace and a card of the same suit): ATs ≈ top ' + pc('ATs') + '%, A5s ≈ top ' + pc('A5s') + '%, A2s ≈ top ' + pc('A2s') + '%.</li>' +
        '<li><b>Offsuit broadways</b> (two cards from 10 to ace, different suits): AQo ≈ top ' + pc('AQo') + '%, KJo ≈ top ' + pc('KJo') + '%, QJo ≈ top ' + pc('QJo') + '%, KTo ≈ top ' + pc('KTo') + '%.</li>' +
        '<li><b>Suited connectors</b> (two cards in a row, same suit): T9s ≈ top ' + pc('T9s') + '%, 87s ≈ top ' + pc('87s') + '%, 65s ≈ top ' + pc('65s') + '% — playable, not premium.</li>' +
        '<li><b>Trash line:</b> J8o ≈ top ' + pc('J8o') + '%, Q5o ≈ top ' + pc('Q5o') + '% — below ~55% it’s fold-vs-everything territory.</li>' +
        '</ul>';
      // Tied to the free chart (100bb, tables.js OPEN[100] and VS[100]), the one a free player can
      // open, not to the 30bb row it used to quote. The charts rank hands for opening (all-in
      // strength plus how well a hand plays after the flop: poker.js openMap), so the same
      // percentage is not the same set of hands here and there; the line says so.
      var ties = '<div class="dim" style="margin-top:6px">Tie it to the free 100bb chart: early seats (UTG–LJ) raise first in with ~top ' + Math.round(P.openThreshold('EP', 100) * 100) +
        '%, the cutoff (CO) ~' + Math.round(P.openThreshold('CO', 100) * 100) + '%, the button (BTN) ~' + Math.round(P.openThreshold('BTN', 100) * 100) +
        // The cold-call figure is the chart's own (Cards › Facing a raise), not the postflop
        // engine's villain-range band (RANGES.coldCall, a hard-coded 12%) it used to quote.
        '%; a re-raise (3-bet) against a cutoff raise is ~top ' + Math.round(P.vsThresholds(100, 'CO').tb * 100) + '%; a ' + T('cold-call', 'cold-call') + ' of it goes down to ~top ' + Math.round(P.vsThresholds(100, 'CO').call * 100) + '%. ' +
        'The charts rank hands for raising first, not for all-in, so suited and connected hands sit higher there and weak offsuit aces lower: ' +
        'a button raise reaches roughly down to the trash line, and a 3-bet is roughly the top-5% row plus the best suited aces.</div>';
      // charts.js's order is not the raw chance alone: "equity-vs-random + documented pair/suited/ace
      // bonuses" (its header). Saying only "how often it wins all-in against one random hand" put 22
      // at ~47% beside the 27% printed below (Mac review 12). The raw figure is worked out from the
      // same data, so the sentence can't drift from it.
      var rawTop = function (label) {
        var byEq = DATA.ranking.slice().sort(function (a, b) { return b.eq - a.eq; }), c = 0, tot = 0, at = 0;
        byEq.forEach(function (r) { tot += r.w; });
        for (var i = 0; i < byEq.length; i++) { c += byEq[i].w; if (byEq[i].h === label) { at = c; break; } }
        return Math.round(at / tot * 100);
      };
      return '<p class="dim" style="margin:0 0 6px">Every starting hand ranked by all-in strength: how often it wins all-in against one random hand, ' +
        'with a bonus for pairs, suited hands and aces. Pairs and suited hands come out higher than that raw chance alone puts them, offsuit hands lower: ' +
        '22 is ≈ top ' + pc('22') + '% here, about top ' + rawTop('22') + '% on the raw chance. “Top 10%” is the best tenth of all starting hands.</p>' +
        '<table class="ref"><tr><th>strength</th><th class="r">anchor hands</th></tr>' + rows + '</table>' + classes + ties;
    }

    // BB calling vs an open-jam — computed live from the solved push/fold tables, so it never drifts from the drill.
    function bbJamHtml() {
      var NA = (typeof window !== 'undefined' ? window.NASH : g.NASH);
      if (!NA || !NA.callBBSeat) return '<p class="dim">Solved ranges unavailable — reopen the app to try again.</p>';
      var seats = ['EP', 'MP', 'CO', 'BTN', 'SB'], depths = NA.depths || [8, 10, 12, 15, 20], R = 'AKQJT98765432';
      function combos(l) { return l.length === 2 ? 6 : (l[2] === 's' ? 4 : 12); }
      function pctOf(t) { var n = 0, d = 0; for (var l in t) { var c = combos(l); d += c; if (t[l] > 0) n += c; } return d ? Math.round(100 * n / d) : 0; }
      function need(S) { return Math.round(100 * (S - 1) / (2 * S + 1.5)); }   // BB-ante pot odds, BB closes the action
      function notate(t) {                                                     // solved EV table -> standard range notation
        var ri = function (c) { return R.indexOf(c); }, ev = function (l) { return t[l] || 0; }, out = [];
        var low = null; for (var i = 0; i < R.length; i++) { var pp = R[i] + R[i]; if (ev(pp) > 0) low = R[i]; else break; }
        if (low) out.push(low === R[R.length - 1] ? '22+' : low + low + '+');
        ['A', 'K', 'Q', 'J', 'T'].forEach(function (hi) {
          ['s', 'o'].forEach(function (su) {
            var lk = null; for (var j = ri(hi) + 1; j < R.length; j++) if (ev(hi + R[j] + su) > 0) lk = R[j];
            if (lk) { var top = R[ri(hi) + 1]; out.push(lk === top ? hi + lk + su : hi + lk + su + '+'); }
          });
        });
        ['98s', '97s', '87s', '86s', '76s', '75s', '65s', '54s'].forEach(function (c) { if (ev(c) > 0) out.push(c); });
        return out.join(' · ');
      }
      var price = '<div class="dim">Price you need (pot odds, big-blind ante, you close the action): ' +
        '<b>5–10bb</b> shove ≈ ' + need(5) + '–' + need(10) + '% · <b>10–15bb</b> ≈ ' + need(10) + '–' + need(15) +
        '% · <b>15–20bb</b> ≈ ' + need(15) + '–' + need(20) + '%. Bigger shove = worse price = call <b>tighter</b>.</div>';
      var mtx = '<table class="ref"><tr><th>jammer</th>' + depths.map(function (d) { return '<th class="r">' + d + 'bb</th>'; }).join('') + '</tr>';
      seats.forEach(function (s) {
        mtx += '<tr><td><b>' + sc(s) + '</b></td>' + depths.map(function (d) { return '<td class="r">' + pctOf(NA.callBBSeat[d][s]) + '%</td>'; }).join('') + '</tr>';
      });
      mtx += '</table><div class="dim" style="margin-top:4px">% of all hands you call vs a first-in jam from that seat. Later seat → wider jam → you call wider.</div>';
      function bandBlock(title, dep) {
        var rows = seats.map(function (s) {
          return '<li><b>' + sc(s) + '</b> <span class="dim">(' + pctOf(NA.callBBSeat[dep][s]) + '%)</span>: ' + notate(NA.callBBSeat[dep][s]) + '</li>';
        }).join('');
        return '<div class="dim" style="margin-top:6px">' + title + '</div><ul class="reads" style="margin:2px 0 0 0">' + rows + '</ul>';
      }
      var ranges = bandBlock('5–10bb band — ranges at 8bb (tighten ~1 tier toward 10bb):', 8) +
        bandBlock('10–15bb band — ranges at 12bb:', 12) +
        bandBlock('15–20bb band — ranges at 15bb (tighten toward the 20bb column):', 15);
      var princ = '<ul class="reads" style="margin-top:8px">' +
        '<li><b>Two dials.</b> The <b>price</b> (shove size — bigger = tighter) and the <b>jammer’s seat</b> (later = they jam wider, so you call wider). UTG–LJ ≈ a tier tighter than HJ; CO sits between HJ and BTN.</li>' +
        '<li><b>SB vs BB is the widest spot in poker</b> — you close with 1bb already in vs a steal-wide range. Call any pair, any ace, most kings, the suited stuff.</li>' +
        '<li><b>Cover or bounty → widen ~5–8%.</b> These are pure chip-EV ranges. When you can’t bust (you cover the jammer) or there’s a bounty, the threshold drops and you call meaningfully wider.</li>' +
        '<li><b>Example — Q9s vs an HJ 15bb jam:</b> the chip-EV call is ~top ' + pctOf(NA.callBBSeat[15].MP) + '% (' + notate(NA.callBBSeat[15].MP) +
        ') — Q9s sits <i>outside</i> it, a fold on chips. When you cover the jammer (no bust risk) or there’s a bounty, it becomes a call: that’s the “widen” rule, not an exception to it.</li>' +
        '<li><b>Jam-or-fold math, so it’s exact</b> — no flatting, and equity is fully realized (you see all five cards). Equity ≥ the price = call.</li>' +
        '</ul>';
      return price + mtx + ranges + princ;
    }
    var bbjam = bbJamHtml();

    // Library concepts: the rule in one bold line, then the detail. A number no engine table
    // backs (a live size, an ICM margin) says "general guidance" where it appears.
    var kRaise = '<p><b>Raise for a reason: value that beats what continues, or a bluff with fold equity plus a draw or blockers and a plan for the next street. Otherwise call or fold.</b></p>' +
      '<p>Two leaks bracket this: <b>never raising</b> (capped, face-up, bullied) and <b>raising to find out</b> (spew). Only ever call, and a thinking player barrels you risk-free, value-bets thin unpunished, and never pays your monsters. The <i>threat</i> of a raise makes them check back, size down, slow down.</p>' +
      '<p><b>Polarize.</b> Raise your best (you beat what <i>continues</i> against the raise) and your worst-with-blockers. <b>Call</b> the middle: bluff-catchers that beat bluffs, lose to value, <i>and can realize their equity</i>. <b>Fold</b> pure trash: no blockers, no equity, no fold equity.</p>' +
      '<div class="dim">The four checks. A raise passes all four, or it’s spew:</div>' +
      '<ol style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Fold equity:</b> will they fold? Never bluff-raise a station.</li>' +
      '<li><b>Equity when called, or blockers</b> to their value.</li>' +
      '<li><b>A plan for the next street.</b></li>' +
      '<li><b>Board fit:</b> your range credibly hits it.</li></ol>' +
      '<div class="dim">Raise-or-fold, when the calling middle shrinks:</div>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Out of position:</b> flatting is a trap (you face barrels, can’t realize).</li>' +
      '<li><b>Against small bets:</b> raising is cheap and fold equity high, so raise more hands than you would against a big bet.</li>' +
      '<li><b>On boards that fit your range:</b> raises are credible, so bluff-raises print.</li></ul>' +
      '<div class="dim" style="margin-top:10px"><b>Check-raising</b></div>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Why:</b> value from strong hands, fold equity with draws, and no more auto-bets into your checks.</li>' +
      '<li><b>About half value, half draws:</b> real-equity semi-bluffs (flush and straight draws, overcards with backdoors), not air.</li>' +
      '<li><b>Size ~3× their bet</b> (general guidance), bigger when wet. On dry boards check-raise less: no protection needed.</li>' +
      '<li><b>Live:</b> against players who c-bet (bet the flop after raising) too often, check-raise more, for value: they barrel off. Against nits, less, and believe their bets.</li></ul>' +
      '<div class="dim" style="margin-top:10px"><b>Leading</b> (betting into the preflop raiser)</div>' +
      '<ul style="margin:2px 0 0 16px;padding:0">' +
      '<li><b>Default: don’t.</b> The raiser has the range and nut advantage on most boards.</li>' +
      '<li><b>Lead when the board hits <i>your</i> range harder:</b> low, connected flops you defended in the BB (765, 986, 654). An early (UTG–LJ) opener has fewer of them.</li>' +
      '<li><b>Small blocker leads</b> on the turn or river (25–33% pot, general guidance) set your price and deny a free check-back: best against passives who raise only the nuts.</li>' +
      '<li><b>Never lead to “see where you’re at.”</b> Lead for value, to deny equity, or to set your price.</li></ul>';

    var kSizing = '<p><b>Size every bet by three questions, in order: whose board is it, how many draws are there, and what does this hand want?</b></p>' +
      '<ol style="margin:0 0 8px 16px;padding:0">' +
      '<li><b>Whose range does the board favor?</b> Yours → bet often. Shared → bet less, check more.</li>' +
      '<li><b>How drawy is it</b> (how much equity needs denying)? Dry and static → <b>small</b> (nothing to protect). Wet → <b>big</b> to charge draws, <i>or</i> check. Don’t half-commit.</li>' +
      '<li><b>What does this hand want?</b> Value → big where worse still calls. Bluff → match your value size. Thin → small or check. Draw → semi-bluff big <i>where fold equity is real</i>.</li></ol>' +
      '<div class="dim">Texture → size:</div>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Dry, you raised preflop</b> (K72 rainbow): ⅓ pot, often. A big bet only folds out what you beat.</li>' +
      '<li><b>Wet</b> (986 two-tone): ⅔ pot or more with value and draws; check the in-between hands rather than bloat a marginal made hand.</li>' +
      '<li><b>Low and disconnected, you’re the BB</b> (752): small or check. Neither range is strong; deny equity cheaply.</li>' +
      '<li><b>Middling and connected, in position</b> (T98): medium, and check back more. Equities run close; you get floated or raised.</li></ul>' +
      '<div class="dim">Check-raising a big draw:</div> on a <b>wet</b> board raise <b>big</b> (real equity plus real fold equity: build it). On a <b>dry</b> board big draws barely exist and your raise represents less, so raise less often and lean toward calling or floating.' +
      '<div class="dim" style="margin-top:6px">Multiway:</div> size <b>up</b> with value (more players, more equity to deny) and check your bluffs. Everyone has to fold, so fold chances multiply and shrink fast.' +
      '<div class="dim" style="margin-top:6px">The drill grades bet or check, never the size. The app’s flop model bets ⅓ pot on dry flops in single-raised pots and ⅔ on wet flops or in 3-bet pots; it counts T98 as wet.</div>';

    var kPlayers = '<p><b>Watch first, type each player, then change one thing: value-bet the callers, bluff the folders, believe the passive player’s raise.</b></p>' +
      '<p>For the first orbit or two, just <b>watch</b>. The best read is <b>what they show down</b>: note it.</p>' +
      '<table class="ref"><tr><th>type</th><th>tells</th><th class="r">how you beat them</th></tr>' +
      '<tr><td><b>Nit</b><br><span class="dim">tight-passive</span></td><td>folds a ton, rarely 3-bets, only bets or raises with the goods, shows down strong, often older &amp; quiet, “sighs and calls.”</td><td class="r">steal relentlessly; <b>fold when they wake up</b>; never pay the river. Bluff them: they over-fold.</td></tr>' +
      '<tr><td><b>Station</b><br><span class="dim">loose-passive</span></td><td>sees every flop, calls-calls-calls, rarely raises, calls down ace-high or bottom pair, “I had to look you up.”</td><td class="r"><b>value-bet relentlessly &amp; bigger; never bluff.</b> Your most profitable seat. Thin value prints.</td></tr>' +
      '<tr><td><b>TAG</b><br><span class="dim">solid reg</span></td><td>selective but aggressive, position-aware, 3-bets &amp; c-bets, sane sizing, watching the table.</td><td class="r">respect it; avoid marginal spots out of position; don’t bluff-raise; lean on position, give them few free reads.</td></tr>' +
      '<tr><td><b>LAG / maniac</b><br><span class="dim">loose-aggressive</span></td><td>raises constantly, big or erratic sizing, lots of bluffs, hard to put on a hand, in every pot.</td><td class="r">let them hang themselves: <b>trap, call down lighter</b>, don’t get blown off hands. Stop bluffing: they don’t fold.</td></tr></table>' +
      '<ul class="reads" style="margin-top:8px">' +
      '<li><b>Nit:</b> barrel A or K turns. Fold one pair to their raise and bluff-catchers to their river bet. Skip thin value: they call only with better.</li>' +
      '<li><b>Station:</b> no bluffs, so a bet is value. Fold pure bluff-catchers; call or raise what beats their thin value bets. A station who <b>raises</b> has it: fold unless you’re very strong.</li>' +
      '<li><b>TAG:</b> play the straight baseline; they punish imbalance. Facing bets, defend your MDF (minimum defense frequency: continue with at least pot ÷ (pot + bet) of your range) and fold the rest.</li>' +
      '<li><b>LAG:</b> their range is full of air, so let them barrel into your made hands. Don’t bluff a bluffer; check and bluff-catch. Value-bet thinner; check-call or check-raise your strong hands.</li>' +
      '<li><b>Any read, multiway:</b> bluffs collapse (<b>everyone</b> must fold) and value tightens (someone connects). Value-target the stations. Fear whoever keeps coming: a nit who does is near the nuts (fold even more); a LAG firing into a field more often has it, so bluff-catch narrower.</li>' +
      '<li><b>Other tells:</b> bet size (small = weak, big = strong is common &amp; exploitable), timing (snap = capped or drawing; long tank = tough decision), VPIP (how many flops they see), short-stack play. No read: solid baseline, lean disciplined.</li></ul>' +
      '<div class="dim" style="margin:8px 0 2px">The live defaults (general guidance):</div>' +
      '<ul class="reads">' +
      '<li><b>Value-bet bigger &amp; thinner:</b> the pool calls too much. Your #1 edge.</li>' +
      '<li><b>Big river raises = the nuts.</b> Fold one pair, feel nothing.</li>' +
      '<li><b>They under-3-bet:</b> when you get 3-bet, believe it.</li>' +
      '<li><b>Iso limpers big</b> (raise over them: ~5–6bb over one, +1bb per extra limper); don’t limp behind into a family pot, except now and then with a small pair or suited connector in position.</li>' +
      '<li><b>Don’t bluff multiway, don’t barrel stations.</b></li>' +
      '<li><b>Defend the BB wide against small raises</b> (tighter against live-size opens), then fit-or-fold honestly out of position.</li></ul>';

    var kAK = '<p><b>AK is a preflop hand: get the money in or end the hand before the flop when the depth allows, and when you miss, call one small bet at most.</b></p>' +
      '<p>The best unpaired hand blocks AA/KK and dominates what continues, but flops a pair only 1 in 3. These defaults beat unknowns; reads and ICM (pay-jump pressure) move you off them.</p>' +
      '<ul class="reads">' +
      '<li><b>You open, get 3-bet:</b> ≤20bb → jam (all-in). 25–40bb → 4-bet (~2.3× their 3-bet, general guidance), call a jam. 50bb+ → 4-bet is still the lean against wider 3-bettors; flatting is fine <i>in position</i> or against tight ones, plan set: call one barrel unimproved, fold to the second.</li>' +
      '<li><b>You 3-bet, face a 4-bet:</b> ≤40bb → jam. Deeper, AKs continues; AKo is genuinely close against tight ranges.</li>' +
      '</ul><div class="dim" style="margin-top:6px">When folding AK is right: the money went in <i>before</i> you acted, from ranges without the hands AK dominates.</div>' +
      '<ul class="reads">' +
      '<li><b>The proven nit:</b> against a true QQ+/AK range AKo has ~40%, much of it chops; at 40bb+, especially out of position, folding it to the oldest, tightest player’s 4-bet is fine.</li>' +
      '<li><b>ICM:</b> on bubbles, ladders and satellites a chip-winning flip loses money; near big jumps even AKs can fold to heavy action.</li>' +
      '<li><b>Multiway nutted action</b> (open, 3-bet, cold 4-bet before you): AKo folds, AKs is close.</li></ul>' +
      '<ul class="reads" style="margin-top:6px">' +
      '<li><b>Facing one open-jam ≤25bb:</b> call, outside those ICM cases. Even a jam as tight as QQ+/AK leaves AK about 40%, and against the ranges people really jam it has 50–60%, more than the price asks (about 40–48%). Only a proven QQ+/AK jammer makes it a fold.</li>' +
      '<li><b>Flopped nothing:</b> ace-high is often still best. Bluff-catch <b>one</b> small bet on dry boards, then let go. Paying two streets unimproved is the classic AK leak.</li>' +
      '<li><b>Bounties (PKO), you’re covered:</b> the big stack 3-bets wider to hunt your bounty, so AK’s value goes <i>up</i> and the 4-bet gets stronger.</li>' +
      '</ul><div class="dim" style="margin-top:6px">In the drill: the chart promotes AK into the 4-bet zone as a default, not a law, and flatting a 3-bet at 30bb+ grades “close.” Facing a 4-bet it 5-bets AK; folding grades close at 50bb and wrong at 100bb. Against one early or hijack open, it flats AKo and marks a 3-bet wrong (close against the cutoff). 3-betting there is the live default: coaching, not graded.</div>';

    var kSuited = '<p><b>Every suited ace makes the nut flush, but they aren’t one hand: A5s–A2s are the bargains, and A8s–A6s are the first to fold out of position, short, or against an early raise.</b></p>' +
      '<p>There’s no “dominated flush,” so they’re great speculative hands.</p>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>A5s–A2s (wheel aces):</b> nut flush, wheel straight, best blockers. The suited aces to see flops with, and your best 3-bet bluffs against openers who fold (a station just calls).</li>' +
      '<li><b>A8s–A6s (middling):</b> the trap hands. No wheel; they flop top pair, weak kicker, which AK and AQ stack. Play them in position and deep.</li></ul>' +
      '<div class="dim">By decision:</div>' +
      '<ul style="margin:2px 0 8px 16px;padding:0">' +
      '<li><b>Open:</b> wide. Every suited ace from the hijack, cutoff and button (A3s and A2s are close from the hijack); from early, the chart opens A5s and up and folds A4s–A2s.</li>' +
      '<li><b>Flat an open in position:</b> good. Nut potential plus position.</li>' +
      '<li><b>Call a 3-bet in position and deep:</b> yes. The deeper you are, the more nut-flush implied odds, position and the ace blocker justify it. Out of position or short: fold or 4-bet, don’t flat.</li></ul>' +
      '<p>The danger isn’t <i>playing</i> them; it’s <b>overplaying the weak top pair</b> they flop. See flops cheap in position, then fold ace-weak-kicker to heavy action instead of paying it off.</p>' +
      '<div class="dim" style="margin-top:6px">The drill ranks them the other way and grades its own answer, so treat the ranking above as live coaching. At 100bb, facing an early open it flats A8s–A5s and folds A4s–A2s; facing a 3-bet out of position it calls AQs down to A7s and folds A6s–A2s; and it never 3-bets a wheel ace.</div>';

    var kTourney = '<p><b>Near a pay jump, chips you lose cost more than chips you win: call off tighter, and tighter again when a player is still behind you.</b></p>' +
      '<ul class="reads">' +
      '<li><b>Near a pay jump (ICM), calls need ~10%+ extra equity</b> (general guidance). Never call off a “slight favorite” bubble flip.</li>' +
      '<li><b>Medium stacks are handcuffed; big stacks attack them.</b> Be the attacker, not the hostage.</li>' +
      '<li><b>Short, and the jump matters → ladder. Short, and it doesn’t → jam first-in</b> (all-in) with anything reasonable.</li></ul>' +
      '<div class="dim" style="margin-top:6px"><b>Depth shapes every raise</b></div>' +
      '<ul class="reads">' +
      '<li><b>≤30bb:</b> a raise ≈ a jam, so raise-or-fold becomes <b>jam-or-fold</b>. Raise only hands you’ll get in.</li>' +
      '<li><b>30–50bb:</b> awkward, little room: raise-fold or raise-commit. Pick committal raises or don’t raise.</li>' +
      '<li><b>75bb+:</b> the full tree. Raises have streets to breathe and real fold equity.</li>' +
      '<li><b>Near a pay jump:</b> bluff-raises gain fold equity (they fear busting); thin value shrinks (they stack off only with the nuts).</li></ul>' +
      '<div class="dim" style="margin-top:6px"><b>The over-call tax: a player behind you</b></div>' +
      '<ul class="reads">' +
      '<li><b>The classic spot:</b> SB facing a button (BTN) jam, BB still to act. You don’t close the action, so call tighter than Cards’ “Big blind vs an all-in” block.</li>' +
      '<li><b>Heads-up, a good ace crushes a late jam.</b> Against a button ~8bb jam (the app’s range there, about the top 48%): ATo ≈ 59%, A9o ≈ 56%, KQo ≈ 55%, 66 ≈ 57%. With the dead money you need ~40%.</li>' +
      '<li><b>Three-way, it collapses:</b> ATo ≈ 25%, A9o ≈ 22%, KQo ≈ 27%, a ~30-point cliff. The BB over-calls rarely (~5–10% here), but with AK/AQ/AJ and pairs 77 or better, hands that dominate or beat your ace. Rare but severe: a tax on exactly your marginal hands.</li>' +
      '<li><b>Subtract ~one tier from your closing range.</b> Keep big pairs, AK/AQ, AJ/ATs, A9s+. Drop the dominated weak aces (A2o–A9o) and weak broadways (KTo, QJo).</li>' +
      '<li><b>Suited earns the call:</b> A5s (≈24% three-way) survives domination far better than A5o (≈20%): its flush and straight draws play on.</li>' +
      '<li><b>Cover or bounty widens, a player behind tightens;</b> they partly cancel. A good suited ace with a bounty and one behind still calls; a weak offsuit ace doesn’t.</li>' +
      '<li><b>More players behind, much tighter.</b> Facing an early or hijack jam with 3–4 to act, tighten toward value only (pairs, AK/AQ/AJs).</li></ul>' +
      '<div class="dim" style="margin-top:6px">More short-stack play: the Playbook’s “The 15–35bb game.”</div>';

    function block(title, body, open) {
      return '<details class="ref-d"' + (open ? ' open' : '') + '><summary>' + title + '</summary>' + body + '</details>';
    }
    // LOCKED CONTENT SHOWS ITS HEADLINES (CLAUDE.md, owner 2026-10-07). Anything behind Pro is
    // listed by its title with a lock, never hidden and never a dead control: opening it shows
    // the one-line pitch and the Pro button, and none of its content reaches the free page.
    // Every Library concept and every Pro reference block goes through proBlock — that is the
    // whole mechanism, and test_ui_smoke checks it for each block, so a new post follows the
    // pattern by being added here, not by remembering it.
    function proBlock(title, body) {
      if (cardPro()) return block(title, body, false);
      // The lock glyph is aria-hidden, so VoiceOver gets the word (Drill tabs and Cards chips say ", Pro" too).
      return '<details class="ref-d lk"><summary>' + title + LOCK_IC + '<span class="visuallyhidden">, Pro</span></summary>' +
        '<p class="prognote" style="margin:4px 0 0">Part of Pro: ' + proPrice() + '.</p>' +
        '<div class="emptycta"><button data-pro="1">See what Pro adds</button></div></details>';
    }
    // The split is by USE, and it is a rule to judge new material against, not a one-time
    // tidy: Cards is what you want in front of you mid-hand — numbers, ranges, a lookup you
    // finish in seconds. Anything you READ goes to the Library. Same instinct as "log the
    // hands that mattered": the test is whether it earns its place at the table.
    if (which === 'library') {
      // The Library is Pro: every concept is a proBlock, so a free user sees the list of titles.
      return proBlock('Raising with a reason', kRaise) +
        proBlock('Bet sizing — the 3 questions', kSizing) +
        proBlock('Reading players and live exploits', kPlayers) +
        proBlock('Playing AK', kAK) +
        proBlock('Suited aces', kSuited) +
        proBlock('Tournament pressure', kTourney);
    }
    return block('Pot odds — what you need to call', pot, true) +
      block('Draws → your chance to hit → the biggest bet you can call', outs, true) +
      block('All-in strength (top X% of hands)', anchorsHtml(), false) +
      block('All-in: who’s ahead, by how much', rules, false) +
      // Their titles are the free tier's headlines too (a locked block shows its title), so they
      // say it in words (§4b); Pro keeps the terms inside.
      proBlock('Big blind vs an all-in: when to call, by stack', bbjam) +
      proBlock('Facing a re-raise (3-bet) or another raise (4-bet)', vs3) +
      // Appendix A study.js:1993: the plain half first, the technical half kept.
      '<p class="dim" style="margin-top:10px">Good default ranges, not perfect answers. Technically: an approximate ' + T('nash', 'Nash') +
      '-style guide built on an ' + T('equity', 'equity') + ' model, not ' + T('solver', 'solver') + ' output. Learn the patterns (seat, stack size, all-in, re-raise, call or fold); check exact spots in a solver.</p>';
  }

  function renderCard() {
    if (!cTouched && !cardPro()) { cDepth = 100; cSit = 'open'; }
    renderSelectors();
    if (!cardPro() && !cardFree(cDepth, cSit)) return renderCardLock();
    renderGrid();
    renderMeta();
  }
  // "$14.99 once, no subscription", in app-ui's localized price (a span it repaints when StoreKit
  // answers); standalone, the web price.
  function proPrice() { return typeof window.proPriceOnce === 'function' ? window.proPriceOnce() : '$14.99 once, no subscription'; }
  function renderCardLock() {
    var price = proPrice();
    $('cardGrid').innerHTML = '<div class="cardlock"><h3>This chart comes with Pro</h3>' +
      '<p class="prognote">All-in-or-fold and short-stack charts (10 to 50 big blinds), and the charts for facing a raise or a re-raise (3-bet), for every seat, are part of Pro: ' +
      price + '. The 100bb chart for raising first in stays free, and so does the preflop drill that quizzes you on it.</p>' +
      '<div class="emptycta"><button id="cardLockGo">See what Pro adds</button></div></div>';
    $('cardMeta').innerHTML = '';
    var go = $('cardLockGo'); if (go) go.onclick = function () { if (window.showTab) window.showTab('Pro'); };
  }

  /* ====================== TODAY'S HAND (Home) ======================
     One hard preflop spot a day, the same on every phone on a local date, picked here with no server,
     no Math.random and no drill state (cur, stats, misses, pendingChain, sorted, filters, db). The
     owner (2026-10-13): a spot whose answer turns on the seat or the stack, most of them from Pro's
     depths, as a tease. Flop, Turn and River spots were tried and cut: the story a turn or river spot
     needs made the card too tall for Home (git keeps them, 9082de6). Nothing here is a drill answer:
     no stats, no db.drills row, no free re-raise spot spent.

     THE FAMILIES, each a deck the calendar deals from:
       first100  everyone folds to you at 100bb, from every seat (the free drill's own spot)
       firstMid  the same at 50, 30 and 20bb: raise or fold (raise, limp or fold from the small blind)
       first10   the same at 10bb: all-in or fold, graded by the approximate-Nash solve
       calljam   the big blind facing an all-in from every seat at 8 to 15bb (the drill's Vs jam)
       vs3bet    you raised and were re-raised (3-bet), in and out of position, at 20 to 100bb
     The multiway kinds (squeezes, limpers, the cold 3-bet) are left out: their story is long.

     A SPOT JOINS (dailyJudge) only when all three hold:
       - Clean (dailyClean): the drill's grader accepts exactly one button on both tiers and calls
         none of them close. Never grade what can't be graded.
       - Near the line (dailyLine): outside the grader's own close band (that is what clean means),
         but within DAILY_HI of its line (12 points of the hand ranking it grades by) or, for the
         Nash-graded all-ins, within DAILY_EV_HI (0.75 big blinds of the all-in's value).
       - Turned by the seat or the stack (dailyTurns): at a seat or a stack depth next to this one
         the same hand is just as clean and its answer differs. That is the lesson the card ends on:
         "From the button it's a raise." "At 10 big blinds it's all-in." The seats are first in
         order (early, hijack, cutoff, button, small blind); the depths are the drill's own.
     A re-raise spot's seat is one the chart raises that hand from, at that depth.

     THE CALENDAR. Weeks run Monday to Sunday: first100, first10 and vs3bet one day each, firstMid
     and calljam two (DAILY_WEEK), five of the seven from Pro's depths, in an order picked by the
     week's number where no family plays two days running (dailyPlan). Each family's deck is its
     whole pool, shuffled once with the answers kept mixed, and dealt round and round (dailyDeck): its
     k-th day takes card k, so a spot comes back only after the whole deck, more than a year later
     (the smallest pool, first10, holds 59 spots: 59 weeks). */
  var DAILY_SALT = 'pocket-tells/daily/3|';
  var DAILY_FAMS = ['first100', 'firstMid', 'first10', 'calljam', 'vs3bet'];
  var DAILY_WEEK = { first100: 1, firstMid: 2, first10: 1, calljam: 2, vs3bet: 1 };
  var DAILY_FIRST = ['EP', 'MP', 'CO', 'BTN', 'SB'];          // first in, and the seats that go all-in, in order
  var DAILY_DEPTHS = { open: [10, 20, 30, 50, 100], calljam: [8, 10, 12, 15], vs3bet: [20, 30, 50, 100] };
  var DAILY_HI = 0.12, DAILY_EV_HI = 0.75;
  // Your seat, and the seats that can re-raise you from it, in position and out of it.
  var DAILY_SEATS = { ip: { EP: ['SB', 'BB'], MP: ['SB', 'BB'], CO: ['SB', 'BB'], BTN: ['SB', 'BB'] },
    oop: { EP: ['MP', 'CO', 'BTN'], MP: ['CO', 'BTN'], CO: ['BTN'] } };
  var DAILY_DID = { fold: 'folded', open: 'raised', limp: 'limped', call: 'called', threebet: 'raised again' };
  var SEAT_FROM = { EP: 'an early seat', MP: 'the hijack', CO: 'the cutoff', BTN: 'the button', SB: 'the small blind' };
  var dailyMemo = {};
  function dailyReady() { return !!dataReady(); }
  function dailyCells(fam) {
    var out = [], ds = fam === 'first100' ? [100] : fam === 'first10' ? [10] : [50, 30, 20];
    if (fam === 'vs3bet') ['ip', 'oop'].forEach(function (p3) { DAILY_DEPTHS.vs3bet.forEach(function (d) { out.push({ kind: 'vs3bet', pos3: p3, depth: d }); }); });
    else if (fam === 'calljam') DAILY_FIRST.forEach(function (p) { DAILY_DEPTHS.calljam.forEach(function (d) { out.push({ kind: 'calljam', pos: p, depth: d }); }); });
    else DAILY_FIRST.forEach(function (p) { ds.forEach(function (d) { out.push({ kind: 'open', pos: p, depth: d }); }); });
    return out;
  }
  function dailyFam(s) { return s.kind === 'calljam' || s.kind === 'vs3bet' ? s.kind : s.depth === 100 ? 'first100' : s.depth <= 12 ? 'first10' : 'firstMid'; }
  // The free drill deals first in and the re-raise at 100bb; every other depth, and the all-ins, are Pro's.
  function dailyIsPro(s) { return s.depth !== 100; }
  function dailyActs(s) { return s.kind === 'calljam' ? ['fold', 'call'] : s.kind === 'vs3bet' ? ['fold', 'call', 'threebet'] : s.pos === 'SB' && s.depth >= 20 ? ['fold', 'limp', 'open'] : ['fold', 'open']; }
  function opensClean(seat, depth, label) { var v = P.openEval(seat, depth, label); return v.in && !v.marginal; }
  function dailyHeroes(pos3, depth, label) { return Object.keys(DAILY_SEATS[pos3]).filter(function (h) { return opensClean(h, depth, label); }); }
  // The one button the drill grades right on both tiers, or null: two right, one close, or the tiers
  // disagree. The re-raise grader reads only the depth, in or out of position, and the hand.
  function dailyClean(s) {
    var k = 'c|' + s.kind + '|' + (s.kind === 'vs3bet' ? s.pos3 : s.pos) + '|' + s.depth + '|' + s.label;
    if (k in dailyMemo) return dailyMemo[k];
    var acts = dailyActs(s), ideal = null;
    for (var t = 0; t < 2; t++) {
      var c = Object.assign({ mode: 'pf' }, s, { free: t === 0 || undefined });
      var gs = acts.map(function (a) { return gradePF(c, a); });
      var right = acts.filter(function (a, i) { return gs[i].right; });
      if (right.length !== 1 || gs.some(function (g) { return g.marginal; }) || gs[0].idealAct !== right[0] || (ideal && ideal !== right[0])) { ideal = null; break; }
      ideal = right[0];
    }
    return (dailyMemo[k] = ideal);
  }
  // How far the hand sits from the line its grader draws, in the grader's own units: the share of
  // hands it ranks by (open, the small blind's two lines, the re-raise's), or the all-in's value in big
  // blinds (the Nash-graded all-ins). {d, hi}, or null where the grader has no number for the hand.
  function dailyLine(s) {
    var L = s.label, v;
    if (s.kind === 'calljam' || (s.kind === 'open' && s.depth <= 12)) {
      v = s.kind === 'calljam' ? P.callEval(s.pos, s.depth, L) : P.openEval(s.pos, s.depth, L);
      return v.ev == null ? null : { d: Math.abs(v.ev), hi: DAILY_EV_HI };
    }
    if (s.kind === 'open' && s.pos !== 'SB') { v = P.openEval(s.pos, s.depth, L); return { d: Math.abs(v.p - v.t), hi: DAILY_HI }; }
    if (s.kind === 'open') {
      v = P.sbEval(s.depth, L);
      if (v.op == null || v.dp == null) return null;
      var dr = Math.abs(v.op - v.raiseT), dl = Math.abs(v.dp - v.limpT);
      return { d: v.action === 'raise' ? dr : v.action === 'fold' ? dl : Math.min(dr, dl), hi: DAILY_HI };
    }
    // In position deep, a pair or a suited hand is ranked on how it plays after the flop, against
    // that ranking's own call line; everything else on all-in strength, against both lines.
    v = P.vs3betEval(s.depth, s.pos3, L);
    var lines = v.p !== P.pct(L) ? [v.call] : [v.tb].concat(v.call > v.tb ? [v.call] : []);
    return { d: Math.min.apply(null, lines.map(function (t) { return Math.abs(v.p - t); })), hi: DAILY_HI };
  }
  // The same hand at the seats and stack depths beside this one where it is just as clean and its
  // answer differs: [{by: 'seat' or 'depth', s: that spot, ideal}]. At 100bb the seat comes first (the
  // free lesson); at Pro's depths, the stack. For the re-raise, "the seat" is the other side of the
  // flop (in or out of position), and a depth counts only where the same seat would raise the hand.
  function dailyTurns(s, ideal) {
    var out = [], L = s.label;
    var add = function (by, o) {
      var t = Object.assign({ kind: s.kind, label: L }, o), i;
      if (t.kind === 'vs3bet') {
        var hs = dailyHeroes(t.pos3, t.depth, L);
        if (by === 'depth') hs = hs.filter(function (h) { return s.pos ? h === s.pos : opensClean(h, s.depth, L); });
        if (!hs.length) return;
      }
      i = dailyClean(t);
      if (i && i !== ideal) out.push({ by: by, s: t, ideal: i });
    };
    var ds;
    if (s.kind === 'vs3bet') {
      ds = DAILY_DEPTHS.vs3bet;
      var j = ds.indexOf(s.depth);
      add('seat', { pos3: s.pos3 === 'ip' ? 'oop' : 'ip', depth: s.depth });
      [j - 1, j + 1].forEach(function (x) { if (j >= 0 && ds[x]) add('depth', { pos3: s.pos3, depth: ds[x] }); });
    } else {
      ds = DAILY_DEPTHS[s.kind === 'calljam' ? 'calljam' : 'open'];
      var k = DAILY_FIRST.indexOf(s.pos), d = ds.indexOf(s.depth);
      [k + 1, k - 1].forEach(function (x) { if (k >= 0 && DAILY_FIRST[x]) add('seat', { pos: DAILY_FIRST[x], depth: s.depth }); });
      [d - 1, d + 1].forEach(function (x) { if (d >= 0 && ds[x]) add('depth', { pos: s.pos, depth: ds[x] }); });
    }
    var first = s.depth === 100 ? 'seat' : 'depth';
    return out.filter(function (x) { return x.by === first; }).concat(out.filter(function (x) { return x.by !== first; }));
  }
  function dailyJudge(s) {             // the answer, or null
    var ln = dailyLine(s), ideal;
    if (!ln || ln.d > ln.hi || !(ideal = dailyClean(s))) return null;
    if (s.kind === 'vs3bet' && !dailyHeroes(s.pos3, s.depth, s.label).length) return null;
    return dailyTurns(s, ideal).length ? ideal : null;
  }
  // A family's spots, [{kind, pos or pos3, depth, label, ideal}], cell by cell in DATA.ranking order.
  // Built the first time a day of that family is drawn, then kept.
  function dailyPool(fam) {
    var key = 'pool|' + fam;
    if (dailyMemo[key]) return dailyMemo[key];
    var out = [];
    dailyCells(fam).forEach(function (c) {
      DATA.ranking.forEach(function (r) {
        var s = Object.assign({}, c, { label: r.h }), ideal = dailyJudge(s);
        if (ideal) { s.ideal = ideal; out.push(s); }
      });
    });
    return (dailyMemo[key] = out);
  }
  // FNV-1a, then mulberry32: swings.js's generator (its copy is private to swings.js).
  function hash32(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  function rng32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function dailyRng(tag) { return rng32(hash32(DAILY_SALT + tag)); }
  function shuffleR(arr, r) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  // Whole days since 1970-01-01 for a LOCAL calendar date: Date.UTC, so DST never moves it.
  function dayNum(key) { var p = String(key).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  // A week's seven families, Monday first, never the same one two days running, Sunday into Monday
  // included. Sunday's family is drawn on its own from the week's number, so Monday is checked against
  // the Sunday before without working out that whole week; the other six take one of their valid
  // orders, picked by the week's number too.
  function dailyBase() { var b = []; DAILY_FAMS.forEach(function (f) { for (var k = 0; k < DAILY_WEEK[f]; k++) b.push(f); }); return b; }
  function dailySunday(week) { var b = dailyBase(); return b[Math.floor(dailyRng('sun|' + week)() * b.length)]; }
  function dailyPlan(week) {
    var key = 'plan|' + week;
    if (dailyMemo[key]) return dailyMemo[key];
    var rest = dailyBase(), sun = dailySunday(week), before = dailySunday(week - 1), ok = [];
    rest.splice(rest.indexOf(sun), 1);
    (function walk(p, left) {
      if (!left.length) { if (p[p.length - 1] !== sun) ok.push(p.concat(sun)); return; }
      left.forEach(function (f, i) {
        if (left.indexOf(f) !== i || f === (p.length ? p[p.length - 1] : before)) return;   // each family once per place, never twice running
        walk(p.concat(f), left.slice(0, i).concat(left.slice(i + 1)));
      });
    })([], rest);
    return (dailyMemo[key] = ok[Math.floor(dailyRng('week|' + week)() * ok.length)]);
  }
  // A day's family, and how many days of that family came before it: DAILY_WEEK a week, and this
  // week's so far.
  function dailyTurn(n) {
    var week = Math.floor((n + 3) / 7), wd = n + 3 - week * 7, plan = dailyPlan(week), fam = plan[wd], t = DAILY_WEEK[fam] * week;
    for (var d = 0; d < wd; d++) if (plan[d] === fam) t++;
    return { fam: fam, t: t, week: week, wd: wd };
  }
  // A family's deck: every spot once, shuffled, then laid out so the answers stay mixed: each card goes
  // to the answer furthest behind its share of the deck so far, with a seeded nudge, so no answer
  // bunches up and the order is no pattern. Dealt round and round, so a spot comes back exactly one
  // whole deck later (a new shuffle per lap could bring a spot back days after itself).
  function dailyDeck(fam) {
    var key = 'deck|' + fam;
    if (dailyMemo[key]) return dailyMemo[key];
    var pool = dailyPool(fam), r = dailyRng('deck|' + fam), by = {}, got = {}, out = [];
    shuffleR(pool, r).forEach(function (x) { (by[x.ideal] = by[x.ideal] || []).push(x); });
    var keys = Object.keys(by).sort();
    keys.forEach(function (k) { got[k] = 0; });
    for (var n = 0; n < pool.length; n++) {
      var best = null, bestD = -Infinity;
      keys.forEach(function (k) {
        if (got[k] >= by[k].length) return;
        var d = (n + 1) * by[k].length / pool.length - got[k] + r() * 0.9;
        if (d > bestD) { bestD = d; best = k; }
      });
      out.push(by[best][got[best]++]);
    }
    return (dailyMemo[key] = out);
  }
  function cardsForR(label, r) {
    var S = 'shdc', x = Math.floor(r() * 4), y;
    if (label.length === 3 && label[2] === 's') return [label[0] + S[x], label[1] + S[x]];
    y = Math.floor(r() * 3); if (y >= x) y++;
    return [label[0] + S[x], label[1] + S[y]];
  }
  // The day's spot: the deck's card, your two cards, and for a re-raise the seats, all from the date.
  // A re-raise whose lesson is the stack gets a seat that raises the hand at both depths.
  function dailySpot(key) {
    if (!dataReady()) return null;
    var c = dailyTurn(dayNum(key)), deck = dailyDeck(c.fam);
    if (!deck.length) return null;
    var x = deck[((c.t % deck.length) + deck.length) % deck.length], r = dailyRng('deal|' + key);
    var s = { mode: 'pf', kind: x.kind, depth: x.depth, label: x.label };
    if (x.kind === 'vs3bet') {
      var heroes = dailyHeroes(x.pos3, x.depth, x.label), tn = dailyTurns(x, x.ideal)[0];
      if (tn && tn.by === 'depth') heroes = heroes.filter(function (h) { return opensClean(h, tn.s.depth, x.label); });
      s.pos = heroes[Math.floor(r() * heroes.length)];
      var rs = DAILY_SEATS[x.pos3][s.pos];
      s.raiser = rs[Math.floor(r() * rs.length)]; s.pos3 = x.pos3;
    } else s.pos = x.pos;
    var cs = cardsForR(x.label, r); s.c1 = cs[0]; s.c2 = cs[1];
    return s;
  }

  // ---- the words ----
  // "re-raise (3-bet)" never splits at its hyphen on Home's narrow lines.
  function nwGloss(h) { return String(h).replace(/re-raised? \(3-bet\)/g, function (m) { return '<span class="nw">' + m + '</span>'; }); }
  function dailyAllIn(s, a) { return (a === 'open' && s.kind === 'open' && s.depth <= 12) || (a === 'threebet' && s.depth < 30); }
  // An answer as a button says it. Free: "All-in" where the drill says Jam, and a 4-bet with its meaning.
  function dailyWord(s, a, pro) {
    if (a === 'open' || a === 'threebet') {
      if (pro) return aggrInfo(s).w;
      return dailyAllIn(s, a) ? 'All-in' : a === 'open' ? 'Raise' : '4-bet (raise again)';
    }
    return { fold: 'Fold', call: 'Call', limp: 'Limp' }[a] || cap1(a);
  }
  // The same, inside a sentence: "it's a raise", "it's all-in".
  function dailyIt(s, a, pro) {
    if (dailyAllIn(s, a)) return pro ? 'a jam' : 'all-in';
    return (a === 'open' ? 'a raise' : a === 'threebet' ? (pro ? 'a 4-bet' : 'a 4-bet (raise again)') : 'a ' + a);
  }
  // The lesson: the seat or the stack that turns the answer. "From the button it's a raise."
  function dailyTurnLine(s, tn, pro) {
    var t = tn.s, w = dailyIt(t, tn.ideal, pro);
    if (tn.by === 'depth') return 'At ' + t.depth + (pro ? 'bb' : ' big blinds') + ' it’s ' + w + '.';
    if (s.kind === 'vs3bet') return (pro ? t.pos3.toUpperCase() : t.pos3 === 'ip' ? 'In position' : 'Out of position') + ' it’s ' + w + '.';
    var at = pro ? (t.pos === 'EP' ? 'UTG–LJ' : 'the ' + sc(t.pos)) : SEAT_FROM[t.pos];
    if (s.kind === 'calljam') return (pro ? 'Vs ' + (t.pos === 'EP' ? 'a UTG–LJ' : 'a ' + sc(t.pos)) + ' jam' : 'Against ' + at) + ' it’s ' + w + '.';
    return 'From ' + at + ' it’s ' + w + '.';
  }
  // Free: the spot in the drill's free words (first in is the drill's own sentence).
  function dailySpotFree(t) {
    if (t.kind === 'open') return pfSpotFree(t);
    var bb = '<b>' + T('bb', t.depth + ' big blinds') + '</b>';
    if (t.kind === 'calljam') return '<b>' + T(SEAT_TERM[t.pos], cap1(SEAT_PLAIN[t.pos])) + '</b> goes all-in for ' + bb + ', everyone else folds · you’re <b>' + seatAt('BB') + '</b>';
    return 'You raised from <b>' + seatTerm(t.pos) + '</b>; <b>' + seatTerm(t.raiser) + '</b> re-raised (3-bet) · ' + bb + '. ' +
      (t.pos3 === 'ip' ? 'You act last after the flop (in position).' : 'You act first after the flop (out of position).');
  }
  // The share of hands the chart plays on with facing a re-raise (calls or raises again; or, with
  // raises, raises again), combo-weighted.
  function dailyOnWidth(depth, pos3, raises) {
    var key = 'on|' + depth + '|' + pos3 + '|' + !!raises;
    if (key in dailyMemo) return dailyMemo[key];
    var c = 0, tot = 0;
    DATA.ranking.forEach(function (r) { var a = P.vs3betEval(depth, pos3, r.h).action; tot += r.w; if (raises ? a === 'threebet' : a !== 'fold') c += r.w; });
    return (dailyMemo[key] = c / tot);
  }
  // Free: one reason, from the engine's own numbers, in the drill's plainHead style. "The chart", "the
  // all-in chart" (a tap says it is an approximate solve): the app's default, never more sure than that.
  function dailyReason(t, ideal) {
    var L = t.label, pc = function (x) { return Math.round(x * 100); }, nash = 'The ' + T('nash', 'all-in chart');
    if (t.kind === 'calljam') return nash + (ideal === 'call' ? ' calls with this hand here' : ' folds this hand here') + ' (it calls with about ' + pc(callJamWidth(t.pos, t.depth)) + '% of hands).';
    if (t.kind === 'open' && t.depth <= 12) {
      var j = pc(P.openEval(t.pos, t.depth, L).t);
      return ideal === 'open' ? nash + ' goes all-in with this hand from here (about ' + j + '% of hands).'
        : nash + ' folds this hand from here (it goes all-in with about ' + j + '% of hands).';
    }
    if (t.kind === 'open' && t.pos === 'SB') {
      var sb = P.sbEval(t.depth, L), rt = pc(sb.raiseT), lt = pc(sb.limpT);
      return ideal === 'open' ? 'The chart raises this hand from the small blind (about ' + rt + '% of hands).'
        : ideal === 'limp' ? 'The chart limps this hand (it raises about ' + rt + '% of hands and plays about ' + lt + '%).'
          : 'The chart folds this hand from the small blind (it plays about ' + lt + '% of hands).';
    }
    if (t.kind === 'open') {
      var o = pc(P.openEval(t.pos, t.depth, L).t);
      return ideal === 'open' ? 'The chart raises this hand from here (about ' + o + '% of hands).'
        : 'The chart folds this hand from here (it raises about ' + o + '% of hands).';
    }
    var on = pc(dailyOnWidth(t.depth, t.pos3)), up = pc(dailyOnWidth(t.depth, t.pos3, true));
    return ideal === 'call' ? 'The chart calls the re-raise with this hand (it plays on with about ' + on + '% of hands).'
      : ideal === 'fold' ? 'The chart folds this hand to the re-raise (it plays on with about ' + on + '% of hands).'
        : (t.depth >= 30 ? 'The chart raises again (4-bets) with this hand' : 'The chart goes all-in over the re-raise with this hand') + ' (about ' + up + '% of hands).';
  }
  // What Home draws for a spot, in the tier's words; with an answer, its grade too. Pure. Free: plain
  // words, the drill's buttons ("All-in" for Jam), "The app's answer", one plain reason, the seat or stack
  // that turns it, and for a spot from Pro's depths where it comes from. Pro: the drill's terse words, its
  // own verdict ("Nash" for the all-ins, "Engine's take" for the rest) and its full why.
  function dailyView(s, a) {
    if (!s || s.mode !== 'pf' || !dataReady()) return null;
    var pro = cardPro(), t = Object.assign({}, s, { free: pro ? undefined : true, daily: true });
    var ask = pfAsk(t);
    if (!pro) ask = { q: ask.q.replace(/^Call the jam/, 'Call the all-in').replace(/^Jam\b/, 'All-in'), cls: ask.cls, btns: ask.btns.replace(/>Jam</g, '>All-in<') };
    var out = { spot: nwGloss(pro ? pfSpot(t) : dailySpotFree(t)), hole: holeHtml(t.c1, t.c2), q: ask.q, cls: ask.cls, btns: ask.btns };
    if (!a) return out;
    var g = gradePF(t, a), ideal = g.idealAct, tn = dailyTurns(s, ideal)[0];
    out.r = g.right ? 'right' : 'wrong';
    out.ideal = ideal;
    out.did = dailyAllIn(s, a) ? 'went all-in' : DAILY_DID[a] || 'answered';
    out.turn = tn ? dailyTurnLine(s, tn, pro) : '';
    out.chose = a === ideal ? '' : dailyWord(s, a, pro);   // Pro's card says it beside Why?; free's ✓ or ✗ says it
    if (pro) {
      var vd = verdict(g, a);
      out.vcls = vd.cls; out.head = vd.head; out.sub = ''; out.why = cap1(g.why); out.tease = '';
      return out;
    }
    // The drill's free verdict (verdict()), with this card's own reason under it.
    var W = dailyWord(s, ideal, false), cls = g.marginal && a !== ideal ? 'mix' : g.right ? 'good' : 'bad';
    out.vcls = cls;
    out.head = cls === 'good' ? '✓ ' + W : (cls === 'mix' ? '≈ Close. The app’s answer: ' : '✗ The app’s answer: ') + W;
    out.sub = dailyReason(s, ideal); out.why = '';
    out.tease = dailyIsPro(s) ? 'From Pro’s preflop drill: ' + (s.kind === 'calljam' ? 'every all-in' : 'every stack size') + ', unlimited.' : '';
    out.guide = cls === 'bad' && dailyFam(s) === 'first100';
    return out;
  }

  /* ====================== wiring ====================== */
  function dataReady() { return P && DATA && P.ready && P.ready(); }

  function buildSorted() {
    sorted = DATA.ranking.map(function (r) { return { label: r.h, pct: P.pct(r.h) }; })
      .sort(function (a, b) { return a.pct - b.pct; });
  }

  function initOnce() {
    if (initOnce.done) return;
    initOnce.done = true;
    if (!dataReady()) {
      $('drillSpot').innerHTML = '<span class="bad">Training data didn’t load.</span> Reopen the app to try again.';
      $('cardMeta').textContent = 'The chart data didn’t load. Close and reopen the app.';
      return;
    }
    buildSorted();
    // ONE handler for both kinds of spot. renderMine used to swap this out for a mine-only
    // handler, which permanently broke every normal drill button after the first replayed
    // hand — dead UI, and it only showed up once you changed a filter.
    $('drillBtns').onclick = function (e) {
      // Free tier (LAUNCH_PLAN §2): first-in opens at 100bb, today's 10 chained 3-bet spots and
      // the player's own flagged hands answer for real. Every other spot deals as a live
      // preview — the spot is real, the answers are Pro — and a tap opens the Pro screen,
      // never a dead control.
      if (spotLocked()) {
        var lockedTap = e.target.closest && (e.target.closest('[data-a]') || e.target.closest('[data-mine]'));
        if (lockedTap && window.showTab) window.showTab('Pro');
        return;
      }
      var m = e.target.closest && e.target.closest('[data-mine]');
      if (m) return revealMine(m.dataset.mine);
      var b = e.target.closest('[data-a]');
      if (b) answer(b.dataset.a);
    };
    renderModeSel();
    renderStats();
    newScenario();
    $('cardRef').innerHTML = refHtml();
    $('cardRef').onclick = function (e) {
      if (e.target.closest && e.target.closest('[data-pro]') && window.showTab) window.showTab('Pro');
    };
    renderCard();
  }

  var seg = $('segStudy');
  if (seg) seg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]'); if (!b) return;
    seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    $('studyDrill').hidden = b.dataset.v !== 'drill';
    $('studyCard').hidden = b.dataset.v !== 'card';
    // Odds is odds.js's (the calculator); it draws itself when its segment opens.
    if ($('studyOdds')) {
      $('studyOdds').hidden = b.dataset.v !== 'odds';
      if (b.dataset.v === 'odds' && window.OddsUI) window.OddsUI.render();
    }
    if ($('studyLib')) {
      $('studyLib').hidden = b.dataset.v !== 'lib';
      if (b.dataset.v === 'lib' && $('libArticles')) $('libArticles').innerHTML = refHtml('library');
    }
    // Free/Pro line: the app shell re-locks Drill and Library after this switch. Guarded so
    // this file still runs standalone under test_ui_smoke, where the shell never loads.
    if (window.applyStudyLock) window.applyStudyLock();
    if (b.dataset.v === 'drill') keepSpotInView();
  });

  // Erase all data resets the drill counters too — they live under their own key.
  window.StudyResetStats = function () { stats = freshStats(); saveStats(); renderStats(); };
  window.StudyUI = {
    render: initOnce,
    // Home's today's hand (app-home renderDaily): the pick and the words; Home keeps the answer.
    daily: { ready: dailyReady, spot: dailySpot, view: dailyView },
    // Home's "Keep going in Study": the Drill segment, and on the free tier a spot that answers.
    openDrill: function () {
      initOnce();
      var d = document.querySelector && document.querySelector('#segStudy [data-v="drill"]');
      if (d && !d.classList.contains('on') && d.click) d.click();
      if (!cardPro() && mode !== 'pf' && dataReady()) {   // exactly what a Preflop mode-chip tap does
        mode = 'pf'; stats.mode = 'pf'; saveStats(); pendingChain = null;
        renderModeSel(); newScenario(); renderStats();
      }
      keepSpotInView();
    },
    // The shell calls this after it opens Study on the Drill, once the page is laid out.
    keepInView: function () { var d = $('studyDrill'); if (d && !d.hidden) keepSpotInView(); },
    // A purchase, restore or refund changes what is locked in Cards and the Library; the shell
    // calls this from applyStudyLock.
    refreshTier: function () {
      if (!initOnce.done || !dataReady()) return;
      $('cardRef').innerHTML = refHtml(); renderCard();
      if ($('libArticles')) $('libArticles').innerHTML = refHtml('library');
      // The Drill's mode locks, its filter, its stats (the free 3-bet counter) and the dimmed
      // answers all follow the tier. A spot already on screen keeps its deal.
      renderModeSel(); renderStats(); paintLock();
      // Except for what the free allowance printed on it: once Pro arrives, an unanswered free
      // re-raise spot's "Free re-raise (3-bet) spot 1 of today’s 10" goes (the same deal, drawn
      // again), and an answered open's "you've used today's 10" line goes from its feedback.
      if (cardPro() && cur && cur.mode === 'pf' && !cur.mine && !cur.real) {
        var fb = $('drillFb');
        if (fb.hidden) { if (cur.free) renderScenario(); }
        else if (/class="mini fbcap"/.test(fb.innerHTML)) {
          fb.innerHTML = fb.innerHTML.replace(/<p class="mini fbcap">[\s\S]*?<\/p>/, '');
          var nx = $('drillNext'); if (nx) nx.onclick = nextSpot;
        }
      }
    },
    // Called when the "your leaks" card is tapped: jump straight to one of them.
    drillMyHands: function () {
      var spot = mineScenario();
      if (!spot) return false;
      var db2 = document.querySelector && document.querySelector('#segStudy [data-v="drill"]');
      if (db2 && !db2.classList.contains('on') && db2.click) db2.click();
      cur = spot; renderMine();
      return true;
    }
  };
  // test/validation hooks (no DOM needed) — used by tools/validate_postflop.js
  window.StudyUI._test = { refHtml: refHtml, mixBars: mixBars, splitStreets: splitStreets, myReviewHands: myReviewHands, mineScenario: mineScenario, renderMine: renderMine, revealMine: revealMine, mineRate: function(){ return MINE_RATE; }, scenarioCbet: scenarioCbet, scenarioTurn: scenarioTurn, scenarioRiver: scenarioRiver, gradeCbet: gradeCbet, cbetSpot: cbetSpot, scenarioPF: scenarioPF, leakPF: leakPF,
    setRealPool: function (p) { REAL_POOL = p; REAL_ERR = false; },
    setRealHands: function (p) { REAL_HANDS = p; REAL_HANDS_ERR = false; }, handAt: handAt, handScenario: handScenario,
    gradePF: gradePF, aggrInfo: aggrInfo, realAlts: realAlts, realScore: realScore, engWhy: engWhy, tailHtml: tailHtml, realAllIn: realAllIn, realIdeal: realIdeal, realScenario: realScenario, mineCut: mineCut, mineHold: mineHold, mineAction: mineAction, realSpotHtml: realSpotHtml, quietFolds: quietFolds, rangeTxt: rangeTxt, mineWho: mineWho,
    scenarioFree: scenarioFree, cur: function () { return cur; }, setCur: function (s) { cur = s; renderScenario(); },
    pfAsk: pfAsk, verdict: verdict, realVerdict: realVerdict, realOptions: realOptions, optBtns: optBtns,
    dailySpot: dailySpot, dayNum: dayNum, dailyPlan: dailyPlan, dailyTurn: dailyTurn, dailyDeck: dailyDeck, dailyPool: dailyPool, dailyJudge: dailyJudge,
    dailyClean: dailyClean, dailyLine: dailyLine, dailyTurns: dailyTurns, dailyActs: dailyActs, dailyHeroes: dailyHeroes, dailyReason: dailyReason, dailyFam: dailyFam,
    opensClean: opensClean, DAILY_FAMS: DAILY_FAMS, DAILY_WEEK: DAILY_WEEK, DAILY_SEATS: DAILY_SEATS, DAILY_DEPTHS: DAILY_DEPTHS, DAILY_HI: DAILY_HI, DAILY_EV_HI: DAILY_EV_HI };
  // Booted straight onto Study (index.html#study, where a standalone guide's "Back to Study"
  // goes): showTab ran in app-boot before this file loaded, so the Drill was never drawn and
  // sat empty, no modes, no spot, no buttons. Web and PWA only; native never boots with a hash.
  // The shell's applyStudyLock is the sign the app is here (test_ui_smoke runs this file alone).
  var tabStudy = document.getElementById('tab-study');
  if (typeof window.applyStudyLock === 'function' && tabStudy && tabStudy.hidden === false) { initOnce(); window.applyStudyLock(); }
  // Home's first paint ran before this file loaded, so today's hand was left out: draw it now.
  if (typeof window.renderDaily === 'function') window.renderDaily();
  var tabHome = document.getElementById('tab-home');
  if (tabHome && tabHome.classList) tabHome.classList.remove('boot');
})();
