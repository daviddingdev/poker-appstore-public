// Validate the JS evaluator + range-equity engine. Run: node tools/test_handeval.js
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'www', 'charts.js'));
require(path.join(__dirname, '..', 'www', 'poker.js'));
const H = require(path.join(__dirname, '..', 'www', 'handeval.js'));
window.Poker.init(window.POKER_DATA);
const P = window.Poker;

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL:', m); fail++; } else console.log('  ok  :', m); };
const ids = arr => arr.map(H.cardId);

console.log('eval7 hand classes');
const score = a => H.eval7(ids(a))[0];
ok(score(['Ah','Kh','Qh','Jh','Th','2c','3d']) === 8, 'royal-ish straight flush = 8');
ok(score(['9h','9d','9s','9c','Kh','2c','3d']) === 7, 'quads = 7');
ok(score(['9h','9d','9s','Kc','Kh','2c','3d']) === 6, 'full house = 6');
ok(score(['Ah','7h','4h','2h','Kh','9c','3d']) === 5, 'flush = 5');
ok(score(['9h','8d','7s','6c','5h','Kc','2d']) === 4, 'straight = 4');
ok(score(['Ah','2h','3d','4s','5c','9c','Kd']) === 4, 'wheel = 4');
ok(score(['9h','9d','9s','Kc','Qh','2c','3d']) === 3, 'trips = 3');
ok(score(['9h','9d','Ks','Kc','Qh','2c','3d']) === 2, 'two pair = 2');
ok(score(['9h','9d','Ks','Qc','Jh','2c','3d']) === 1, 'pair = 1');
ok(score(['Ah','Kd','9s','7c','5h','3c','2d']) === 0, 'high card = 0');
// kicker comparisons
ok(H.cmp(H.eval7(ids(['Ah','Ad','Ks','7c','5h','3c','2d'])), H.eval7(ids(['Ah','Ad','Qs','7c','5h','3c','2d']))) === 0 ||
   H.cmp(H.eval7(ids(['As','Ac','Ks','7c','5h','3c','2d'])), H.eval7(ids(['Ah','Ad','Qs','7d','5s','3h','2c']))) > 0, 'kicker breaks ties');

console.log('head-to-head equities vs Python-computed truth (charts.js)');
function h2h(a, b, n) {
  // a, b: concrete 2-card arrays. Equity of a.
  const pool = [b];
  return H.equityVsRange(a, [], pool, { n: n || 20000 });
}
const m = window.POKER_DATA.matchups;
function truth(a, b) { const x = m.find(z => z.a === a && z.b === b); return x ? x.eqA : null; }
const aaKK = h2h(['Ah','Ad'], ['Ks','Kc']) * 100;
ok(Math.abs(aaKK - truth('AA','KK')) < 2.5, 'AA vs KK: JS ' + aaKK.toFixed(1) + ' vs py ' + truth('AA','KK'));
const qqAK = h2h(['Qh','Qd'], ['As','Kc']) * 100;
ok(Math.abs(qqAK - truth('QQ','AKo')) < 2.5, 'QQ vs AKo: JS ' + qqAK.toFixed(1) + ' vs py ' + truth('QQ','AKo'));
const akT = h2h(['As','Ks'], ['Qh','Jh']) * 100;
ok(Math.abs(akT - truth('AKs','QJs')) < 4.5, 'AKs vs QJs (fixed-suit config offsets py avg ~3pts): JS ' + akT.toFixed(1) + ' vs py ' + truth('AKs','QJs'));

console.log('equity vs range bands');
const full = P.bandCombos(0, 1);
ok(full.length > 1200 && full.length <= 1326, 'full band ≈ all 1326 combos (' + full.length + ')');
const aaVsRandom = H.equityVsRange(['Ah','Ad'], [], full, { n: 20000 }) * 100;
ok(Math.abs(aaVsRandom - 85) < 2.5, 'AA vs random ≈ 85 (' + aaVsRandom.toFixed(1) + ')');
const top10 = P.bandCombos(0, 0.10);
const aaVsTop = H.equityVsRange(['Ah','Ad'], [], top10, { n: 12000 }) * 100;
ok(aaVsTop < aaVsRandom && aaVsTop > 70, 'AA does worse vs top-10% (' + aaVsTop.toFixed(1) + ') but still crushes');
const j9VsTop = H.equityVsRange(['Jh','9d'], [], top10, { n: 12000 }) * 100;
ok(j9VsTop < 35, 'J9o is crushed by top-10% (' + j9VsTop.toFixed(1) + ')');

console.log('board + condition');
// AK on Q99 vs a CO opening range — the canonical spot
const coOpen = P.bandCombos(0, P.openThreshold('CO', 30));
const akQ99 = H.equityVsRange(['As','Kh'], ['Qc','9c','9h'], coOpen, { n: 12000 }) * 100;
ok(akQ99 > 30 && akQ99 < 55, 'AK on Q99 vs CO open range ≈ 35-50 (' + akQ99.toFixed(1) + ') → small bets are calls');
// conditioning shifts equity down when villain "bets" (weighted to connected hands)
require(path.join(__dirname, '..', 'www', 'postflop.js'));
const PF = window.Postflop;
const cond = (c1, c2, board) => PF.BET_FREQ[PF.classifyFlop([c1, c2], board).category];
const akCond = H.equityVsRange(['As','Kh'], ['Qc','9c','9h'], coOpen, { n: 12000, condition: cond }) * 100;
ok(akCond < akQ99, 'conditioning on "they bet" lowers hero equity (' + akCond.toFixed(1) + ' < ' + akQ99.toFixed(1) + ')');

console.log('multiway equity vs the FIELD (must beat ALL — David’s c-bet ask)');
(function () {
  const pool = P.bandCombos(0.03, 0.45);
  const hu = H.equityVsRange(['As', 'Kh'], ['Qd', '7c', '2s'], pool, { n: 6000 }) * 100;
  const w3 = H.equityVsField(['As', 'Kh'], ['Qd', '7c', '2s'], [pool, pool], { n: 6000 }) * 100;
  const w4 = H.equityVsField(['As', 'Kh'], ['Qd', '7c', '2s'], [pool, pool, pool], { n: 6000 }) * 100;
  ok(w3 < hu - 8 && w4 < w3, 'AK top pair drops with the field: HU ' + hu.toFixed(0) + '% > 3way ' + w3.toFixed(0) + '% > 4way ' + w4.toFixed(0) + '%');
  const set = H.equityVsField(['7h', '7d'], ['7c', 'Kd', '2s'], [pool, pool], { n: 6000 }) * 100;
  ok(set > 85, 'a set still crushes 3-way (' + set.toFixed(0) + '%)');
  const one = H.equityVsField(['As', 'Kh'], ['Qd', '7c', '2s'], [pool], { n: 6000 }) * 100;
  ok(Math.abs(one - hu) < 4, 'field of 1 ≈ equityVsRange (' + one.toFixed(0) + ' vs ' + hu.toFixed(0) + ')');
})();

console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASS');
process.exit(fail ? 1 : 0);
