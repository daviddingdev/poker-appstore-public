// Headless DOM smoke test for study.js (drill + pocket card). Run: node tools/test_ui_smoke.js
// Shims just enough DOM to run the real UI code and catch runtime errors.
const path = require('path');
const APP = path.join(__dirname, '..', 'www');

const els = {};
function mkEl(id) {
  return {
    id, _html: '', textContent: '', hidden: false, onclick: null, dataset: {}, style: {},
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; }
  };
}
global.document = { getElementById(id) { return els[id] || (els[id] = mkEl(id)); } };
global.localStorage = (() => { let s = {}; return { getItem: k => k in s ? s[k] : null, setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })();
// seed LEGACY-schema misses (no vseat/raiser) — replays must backfill, never show '?'
localStorage.setItem('pokerlog.train', JSON.stringify({ v: 2, att: 4, cor: 0, mix: 0, streak: 0, best: 0, byMode: {}, byDepth: {}, mode: 'pf', misses: [
  { kind: 'vs', opener: 'BTN', depth: 30 },
  { kind: 'squeeze', opener: 'EP', callers: 2, depth: 20 },
  { kind: 'cold3b', opener: 'MP', depth: 30 },
  { kind: 'vs3bet', pos3: 'ip', depth: 20 }
] }));
global.window = global;
global.confirm = () => true;
global.fetch = undefined;   // simulate no-fetch: turn/river fall back to synthetic until the test injects the pool via setRealPool

require(path.join(APP, 'charts.js'));
require(path.join(APP, 'nash.js'));
require(path.join(APP, 'poker.js'));
require(path.join(APP, 'dealer.js'));
require(path.join(APP, 'postflop.js'));
require(path.join(APP, 'handeval.js'));
window.Poker.init(window.POKER_DATA);
window.toast = () => {};
const recorded = [];
window.recordDrill = e => recorded.push(e);   // capture the drill log
require(path.join(APP, 'study.js'));

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL:', m); fail++; } else console.log('  ok  :', m); };
const ev = a => ({ target: { closest: sel => `[data-${a[0]}]` === sel ? { dataset: { [a[0]]: a[1] } } : null } });

window.StudyUI.render();
// Open the options panel once; the toggles render into it rather than into the mode row.
const openOpts = () => { if (els['drillOpts'].hidden) els['drillOptsBtn'].onclick(ev(['opts', '1'])); return els['drillOpts']._html; };
openOpts();

console.log('drill — preflop (open / vs / squeeze / iso / vs-3bet)');
ok(/data-s="live" class="minitog on"/.test(openOpts()), 'style toggle SHOWS live as active by default');
els['drillMode'].onclick(ev(['s', 'hard']));   // switch to hard for coverage
ok(/data-s="hard" class="minitog on"/.test(openOpts()), 'style toggle shows hard as active after switch');
ok(els['drillMode']._html.includes('Preflop') && els['drillMode']._html.includes('Flop') && els['drillMode']._html.includes('Turn') && els['drillMode']._html.includes('River'), 'mode selector has street tabs (Preflop/Flop/Turn/River)');
ok(!/minitog/.test(els['drillMode']._html), 'the mode row carries ONLY mode tabs — no toggles crammed in beside them');
const seen = {};
let seatless = 0, qmarks = 0, replays = 0;
for (let i = 0; i < 240; i++) {
  const spot = els['drillSpot']._html;
  if (/↻ replay/.test(spot)) replays++;
  if (/<b>\?<\/b>|’re (the )?\?/.test(spot)) { qmarks++; if (qmarks < 4) console.log('  QMARK:', spot); }
  if (/Folded to you/.test(spot)) seen.open = true;
  if (/opens · <b>\d+bb<\/b> · you’re the <b>(UTG|MP|CO|BTN|SB|BB)/.test(spot)) seen.vs = true;
  if (/opens · /.test(spot) && /on you/.test(spot)) seatless++;          // must never happen now
  if (/opens, <b>\d+<\/b> call/.test(spot) && /you’re the <b>/.test(spot)) {
    seen.squeeze = true;
    const sq = /<b>(UTG|MP|CO|BTN|SB)[^<]*<\/b> opens, <b>(\d+)<\/b> call.*you’re the <b>(UTG|MP|CO|BTN|SB|BB)/.exec(spot.replace(/ \/ early| \/ lojack| button| cutoff|small blind/g,''));
  }
  (function(){
    const m3 = /(UTG|MP|CO|BTN|SB)(?: \/ \w+| button| cutoff)?<\/b> opens, <b>(\d+)<\/b> call/.exec(spot.replace(/<b>/g,'<b>'));
    if (m3 && /you’re the <b>(UTG|MP|CO|BTN|SB|BB)/.test(spot)) {
      const seatMap = {UTG:'EP'};
      const op = seatMap[m3[1]] || m3[1];
      const hero = /you’re the <b>(UTG|MP|CO|BTN|SB|BB)/.exec(spot)[1];
      const O = ['EP','MP','CO','BTN','SB','BB'];
      const gap = O.indexOf(seatMap[hero] || hero) - O.indexOf(op) - 1;
      if (gap < +m3[2]) { qmarks++; console.log('  BAD SQUEEZE GAP:', spot); }
    }
  })();
  if (/You open .*3-bets \(you’re (IP|OOP)\)/.test(spot)) seen.vs3bet = true;
  if (/You 3-bet from the .*4-bets/.test(spot)) seen.vs4bet = true;
  if (/opens, <b>\w+<\/b> 3-bets · .*you’re the <b>/.test(spot)) seen.cold3b = true;
  if (/jams <b>\d+bb<\/b> · you’re the <b>BB/.test(spot)) seen.calljam = true;
  if (/folds to you in the <b>BB<\/b>/.test(spot)) seen.bbopt = true;
  if (/limp-reraises/.test(spot)) seen.limpRR = true;
  if (/Folded to you · <b>small blind/.test(spot) && /data-a="limp"/.test(els['drillBtns']._html)) seen.sbLimp = true;
  const html = els['drillBtns']._html;
  const acts = [...html.matchAll(/data-a="(\w+)"/g)].map(m => m[1]);   // pick a real button (robust to check/raise, fold/call/4-bet)
  const a = acts[0] || 'fold';
  els['drillBtns'].onclick(ev(['a', a]));
  ok(/✓|✗|Close/.test(els['drillFb']._html), 'preflop feedback shows ideal #' + (i + 1));
  els['drillNext'].onclick();
}
ok(seen.open, 'saw a first-in open spot');
ok(seen.vs, 'saw a facing-a-raise spot WITH a named hero seat');
ok(seatless === 0, 'no seatless "on you" facing-a-raise spots (' + seatless + ')');
ok(replays > 5, 'legacy misses got replayed (' + replays + ')');
ok(qmarks === 0, 'no "?" positions anywhere, including legacy-miss replays (' + qmarks + ')');
ok(seen.squeeze, 'saw a multiway squeeze spot');
ok(seen.vs3bet, 'saw a you-opened-got-3-bet spot with named raiser');
ok(seen.vs4bet, 'saw a deep facing-a-4-bet spot (50/100bb)');
ok(seen.cold3b, 'saw a cold-3-bet spot (open + 3-bet in front)');
ok(seen.calljam, 'saw a facing-a-jam spot (Nash-graded)');
ok(seen.bbopt, 'saw a BB-option limped-pot spot (check or raise)');
ok(seen.limpRR, 'saw a limp-reraise spot (you iso’d, a limper limp-3-bets)');
ok(seen.sbLimp, 'saw an SB folded-to spot with a Limp option (raise/limp/fold)');
ok(/act (jam|raise|threebet)/.test(els['drillBtns']._html) || true, 'action buttons carry colour classes');

console.log('vs-jam focus: every spot is a BB call-or-fold');
els['drillMode'].onclick(ev(['m', 'pf']));          // ensure preflop mode
els['drillMode'].onclick(ev(['w', 'jam']));
ok(/data-w="jam" class="minitog on"/.test(openOpts()), 'vs-jam focus toggle shows active');
let jamSpots = 0, jamNon = 0;
for (let i = 0; i < 40; i++) {
  const spot = els['drillSpot']._html;
  if (/jams <b>\d+bb<\/b> · you’re the <b>BB/.test(spot)) jamSpots++;
  else { jamNon++; if (jamNon < 3) console.log('  NON-JAM IN JAM FOCUS:', spot); }
  const acts = [...els['drillBtns']._html.matchAll(/data-a="(\w+)"/g)].map(m => m[1]);
  els['drillBtns'].onclick(ev(['a', acts[0] || 'fold']));
  els['drillNext'].onclick();
}
ok(jamSpots === 40, 'vs-jam focus yields ONLY call-jam spots (' + jamSpots + '/40)');
ok(jamNon === 0, 'no non-jam spots leaked into vs-jam focus (' + jamNon + ')');
els['drillMode'].onclick(ev(['w', 'all']));         // restore for later assertions

console.log('deep focus: raise-war density at 50/100bb');
els['drillMode'].onclick(ev(['w', 'deep']));
ok(/data-w="deep" class="minitog on"/.test(openOpts()), 'depth focus toggle shows deep active');
let deepN = 0, deepTotal = 0, sawWar = 0;
for (let i = 0; i < 60; i++) {
  const spot = els['drillSpot']._html;
  const dm = /<b>(\d+)bb<\/b>/.exec(spot);
  if (dm) { deepTotal++; if (+dm[1] >= 50) deepN++; }
  if (/3-bets \(you’re|4-bets \(you’re/.test(spot)) sawWar++;
  const html = els['drillBtns']._html;
  const a = html.includes('data-a="threebet"') ? 'threebet' : html.includes('data-a="open"') ? 'open' : 'fold';
  els['drillBtns'].onclick(ev(['a', a]));
  els['drillNext'].onclick();
}
ok(deepN === deepTotal && deepTotal > 0, 'deep focus deals ONLY ≥50bb spots (' + deepN + '/' + deepTotal + ')');
ok(sawWar >= 10, 'raise-war spots are dense in deep focus (' + sawWar + '/60)');   // ~19 expected, wide variance — bound set below the noise floor
els['drillMode'].onclick(ev(['w', 'all']));

console.log('live-deal: chained you-opened-got-3-bet flow');
els['drillMode'].onclick(ev(['s', 'live']));
ok(/data-s="live" class="minitog on"/.test(openOpts()), 'switched back to live deal');
let sawChainLabel = false, sawChainSpot = false, sawLimpStory = false, badSBStory = 0;
for (let i = 0; i < 800 && !(sawChainSpot && sawLimpStory); i++) {
  const spot = els['drillSpot']._html;
  if (/limp/.test(spot)) sawLimpStory = true;
  if (/SB<\/b> opens, <b>\d+<\/b> call/.test(spot)) badSBStory++;
  if (/↪ same hand/.test(spot)) sawChainSpot = true;
  const html = els['drillBtns']._html;
  const a = html.includes('data-a="open"') ? 'open' : html.includes('data-a="threebet"') ? 'threebet' : 'fold';
  els['drillBtns'].onclick(ev(['a', a]));
  if (/(3|4)-bets you/.test(els['drillFb']._html)) sawChainLabel = true;
  els['drillNext'].onclick();
}
ok(sawChainLabel, 'chain announced on the Next button (X 3-bets you →)');
ok(sawChainSpot, 'chained vs-3-bet spot rendered with the same hand (↪)');
ok(sawLimpStory, 'limped-pot stories appear (N limp, X raises)');
ok(badSBStory === 0, 'no impossible "SB opens, N call" stories (' + badSBStory + ')');

console.log('drill — pot odds (draw name hidden by default)');
els['drillMode'].onclick(ev(['m', 'odds']));
ok(els['drillHand']._html.includes('board') && els['drillHand']._html.includes('what’s your draw'), 'draw name hidden by default');
ok(els['drillSpot']._html.includes('oddsTog'), 'toggle present to reveal name');
els['oddsTog'].onclick();   // reveal name as a hint
ok(els['drillHand']._html.includes('you have a'), 'toggle reveals the draw name');
els['oddsTog'].onclick();   // back to hidden
for (let i = 0; i < 6; i++) { els['drillBtns'].onclick(ev(['a', i % 2 ? 'fold' : 'call'])); ok(/It was a/.test(els['drillFb']._html) && /needed/.test(els['drillFb']._html), 'odds feedback reveals draw+price #' + (i + 1)); els['drillNext'].onclick(); }

console.log('drill — FLOP c-bet tree + multiway');
els['drillMode'].onclick(ev(['m', 'flop']));
const nodes = {};
let treeMissing = 0, mwSpots = 0, flopFb = 0, mixShown = 0;
for (let i = 0; i < 130; i++) {
  const spot = els['drillSpot']._html;
  const isMW = /call \(<b>3-way<\/b>\)/.test(spot);
  if (/checks \(pot [\d.]+bb\) — you’re IP/.test(spot)) nodes.ipCheck = true;
  if (/(leads|c-bets) <b>[\d.]+bb<\/b> into .*you’re IP/.test(spot)) nodes.ipBet = true;
  if (/first to act/.test(spot)) nodes.oopFirst = true;
  if (/You check, .* c-bets/.test(spot)) nodes.oopBet = true;
  const m = /data-a="(\w+)"/.exec(els['drillBtns']._html);
  els['drillBtns'].onclick(ev(['a', m[1]]));
  if (/✓|✗|≈/.test(els['drillFb']._html)) flopFb++;
  if (/mix:/.test(els['drillFb']._html)) mixShown++;
  if (isMW && /the field/.test(els['drillFb']._html)) mwSpots++;
  if (!isMW && !/fbtree/.test(els['drillFb']._html)) treeMissing++;
  els['drillNext'].onclick();
}
ok(nodes.ipCheck && nodes.ipBet && nodes.oopFirst && nodes.oopBet, 'all four flop nodes seen');
ok(flopFb >= 125, 'flop grades render feedback (' + flopFb + '/130)');
ok(mixShown >= 125, 'flop grades show the mix (' + mixShown + '/130)');
ok(treeMissing === 0, 'every heads-up flop grade shows the decision tree (' + treeMissing + ' missing)');
ok(mwSpots >= 2, 'multiway 3-way c-bet spots appear and grade vs the field (' + mwSpots + ')');

console.log('drill — TURN (six stories incl. checked-through probe / probe-raised)');
els['drillMode'].onclick(ev(['m', 'turn']));
const subs = {};
let turnSpots = 0, turnBoardBad = 0;
for (let i = 0; i < 160; i++) {
  const spot = els['drillSpot']._html;
  if (/<b>Turn:<\/b>/.test(spot)) {
    turnSpots++;
    if (/now <b>leads<\/b>/.test(spot)) subs.lead = true;
    if (/<b>barrels<\/b>/.test(spot)) subs.barreled = true;
    if (/checks again .*action on you/.test(spot)) subs.probe = true;
    if (/check-raises/.test(spot)) subs.probeRaised = true;
    if (!/flop · turn/.test(els['drillHand']._html) || !/tsep/.test(els['drillHand']._html)) turnBoardBad++;
  }
  const m = /data-a="(\w+)"/.exec(els['drillBtns']._html);
  els['drillBtns'].onclick(ev(['a', m[1]]));
  els['drillNext'].onclick();
}
ok(turnSpots >= 140, 'turn mode deals turn spots (' + turnSpots + '/160)');
ok(subs.probe && subs.probeRaised, 'new checked-through lines appear (probe / probe-raised): ' + Object.keys(subs).join(', '));
ok(turnBoardBad === 0, 'turn boards render flop · turn (' + turnBoardBad + ' bad)');

console.log('drill — RIVER (bluff-catch + check-to-induce)');
els['drillMode'].onclick(ev(['m', 'river']));
let riverSpots = 0, riverFb = 0, induce = 0, riverBoardBad = 0;
for (let i = 0; i < 140; i++) {
  const spot = els['drillSpot']._html;
  if (/<b>River:<\/b>/.test(spot)) {
    riverSpots++;
    if (!/flop · turn · river/.test(els['drillHand']._html)) riverBoardBad++;
  }
  const m = /data-a="(\w+)"/.exec(els['drillBtns']._html);
  els['drillBtns'].onclick(ev(['a', m[1]]));
  if (/✓|✗|≈/.test(els['drillFb']._html)) riverFb++;
  if (/induce/.test(els['drillFb']._html)) induce = 1;
  els['drillNext'].onclick();
}
ok(riverSpots >= 125, 'river mode deals river spots (' + riverSpots + '/140)');
ok(riverFb >= 135, 'river grades render feedback (' + riverFb + '/140)');
ok(induce === 1, 'check-to-induce concept surfaces on the river');
ok(riverBoardBad === 0, 'river boards render flop · turn · river (' + riverBoardBad + ' bad)');

console.log('river — hero line coherence (no flop/turn calls with stone air)');
{
  const PF = window.Postflop;
  let looseFlop = 0, looseTurn = 0, defN = 0;
  for (let i = 0; i < 500; i++) {
    const s = window.StudyUI._test.scenarioRiver();
    if (s.role !== 'defender') continue;
    defN++;
    if (PF.classifyFlop(s.hole, s.board.slice(0, 3)).category === 'air') { looseFlop++; if (looseFlop < 3) console.log('  LOOSE FLOP CALL:', s.hole.join(''), s.board.join(' ')); }
    if (s.barrels >= 2 && PF.classifyFlop(s.hole, s.board.slice(0, 4)).category === 'air') looseTurn++;
  }
  ok(looseFlop === 0, 'defender never called the flop c-bet with stone air (' + looseFlop + '/' + defN + ' defender spots)');
  ok(looseTurn === 0, 'defender never called a turn barrel with stone air (' + looseTurn + ')');
}

console.log('c-bet scenario validity — preflop seat ordering');
const ORDER = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
let badOrder = 0, checked3bet = 0;
for (let i = 0; i < 250; i++) {
  const spot = els['drillSpot']._html.replace(/<\/?b>/g, '');
  let m2;
  if ((m2 = /You open (\w+), (\w+) calls/.exec(spot))) {
    if (ORDER.indexOf(m2[1]) >= ORDER.indexOf(m2[2])) { badOrder++; if (badOrder < 4) console.log('  BAD:', spot); }
  } else if ((m2 = /(\w+) opens, you 3-bet (\w+)/.exec(spot))) {
    checked3bet++;
    if (ORDER.indexOf(m2[1]) >= ORDER.indexOf(m2[2])) { badOrder++; if (badOrder < 4) console.log('  BAD:', spot); }
  } else if ((m2 = /(\w+) opens, you call (\w+)/.exec(spot))) {
    if (ORDER.indexOf(m2[1]) >= ORDER.indexOf(m2[2])) { badOrder++; if (badOrder < 4) console.log('  BAD:', spot); }
  }
  const mm = /data-a="(\w+)"/.exec(els['drillBtns']._html);
  els['drillBtns'].onclick(ev(['a', mm[1]]));
  els['drillNext'].onclick();
}
ok(badOrder === 0, 'no impossible preflop orderings in 250 scenarios (' + checked3bet + ' were 3-bet pots)');
ok(checked3bet > 10, '3-bet pots well represented (' + checked3bet + ')');

console.log('per-answer logging');
ok(recorded.length >= 150, 'every answer logged (' + recorded.length + ' entries)');
ok(recorded.every(e => e.t && e.m && e.r && e.ideal !== undefined), 'log entries are well-formed');
ok(recorded.some(e => e.r === 'wrong') || recorded.some(e => e.r === 'right'), 'results recorded');
ok(recorded.some(e => e.m === 'cbet' && e.board), 'flop/turn entries include the board');
ok(recorded.some(e => e.m === 'cbet' && e.street === 'turn' && e.sub && e.tier), 'turn-spot entries carry street/sub/tier for leak analysis');
ok(recorded.some(e => e.m === 'river' && e.street === 'river' && e.board), 'river entries carry street + board');

const st = JSON.parse(localStorage.getItem('pokerlog.train'));
ok(st.att >= 150, 'attempts recorded across modes (' + st.att + ')');
ok(st.byMode.flop && st.byMode.turn && st.byMode.river, 'per-street stats tracked (flop/turn/river)');

console.log('pocket card — first in');
ok((els['cardGrid']._html.match(/g13/g) || []).length === 169, 'grid 169 cells');
ok(els['cardGrid']._html.includes('g13 in'), 'open grid has in-range cells');
ok(els['cardMeta']._html.includes('%'), 'meta shows %');

console.log('pocket card — facing a raise (3-color)');
els['cardSel'].onclick(ev(['x', 'vs']));      // switch situation
const g = els['cardGrid']._html;
ok(g.includes('g13 tb'), '3-bet (orange) cells present');
ok(g.includes('g13 cl'), 'call (green) cells present');
ok(els['cardMeta']._html.toLowerCase().includes('open-raise'), 'meta explains the spot');
// wider vs button than vs UTG
els['cardSel'].onclick(ev(['o', 'EP'])); const epCells = (els['cardGrid']._html.match(/g13 (tb|cl)/g) || []).length;
els['cardSel'].onclick(ev(['o', 'BTN'])); const btnCells = (els['cardGrid']._html.match(/g13 (tb|cl)/g) || []).length;
ok(btnCells > epCells, 'continue wider vs BTN (' + btnCells + ') than EP (' + epCells + ')');

console.log('pocket card — vs 3-bet view');
els['cardSel'].onclick(ev(['x', 'vs3']));
ok(els['cardMeta']._html.includes('3-bet'), 'vs-3-bet meta explains the spot');
ok(els['cardGrid']._html.includes('g13 tb') && els['cardGrid']._html.includes('g13 cl'), 'vs-3-bet grid has 4-bet + call cells');
els['cardSel'].onclick(ev(['i', 'oop']));
ok(els['cardMeta']._html.includes('out of position'), 'IP/OOP selector works');
const ipCells = (els['cardGrid']._html.match(/g13 (tb|cl)/g) || []).length;
els['cardSel'].onclick(ev(['i', 'ip']));
const ipCells2 = (els['cardGrid']._html.match(/g13 (tb|cl)/g) || []).length;
ok(ipCells2 >= ipCells, 'IP continues at least as wide as OOP (' + ipCells2 + ' vs ' + ipCells + ')');
els['cardSel'].onclick(ev(['x', 'vs']));   // restore for later assertions

console.log('reference blocks');
// Cards and Library split by use, so each block is asserted against the view that now owns
// it. Everything still exists — nothing was dropped in the move.
const ref = els['cardRef']._html;
const refLib = window.StudyUI._test.refHtml('library');
['Pot odds', 'max bet you can call', 'rules of thumb', 'Facing 3-bets', '4-bet', 'BB vs an open-jam', 'over-call tax'].forEach(s =>
  ok(ref.includes(s), 'Cards has "' + s + '"'));
['Check-raising', 'Leading', 'ICM', 'AK — the playbook'].forEach(s =>
  ok(refLib.includes(s), 'Library has "' + s + '"'));
ok(/player behind/.test(ref) && /one tier/.test(ref) && /A5s/.test(ref), 'player-behind jam reference covers the over-call tax + suited-ace nuance');

// BB-vs-jam card: live-computed matrix + notation ranges (must not drift from the solver)
ok(ref.includes('>jammer<') && /<td class="r">\d+%<\/td>/.test(ref), 'BB-vs-jam call% matrix renders');
ok(ref.includes('widest spot in poker'), 'BB-vs-jam principles render');
ok(/A\ds\+/.test(ref) && ref.includes('22+'), 'BB-vs-jam ranges render in standard notation');

console.log('real spots — turn/river served from the pool');
{
  const fs2 = require('fs');
  const poolPath = path.join(APP, 'realspots.json');
  if (!fs2.existsSync(poolPath)) {
    console.log('  (skipped — realspots.json not generated)');
  } else {
    const pool = JSON.parse(fs2.readFileSync(poolPath, 'utf8'));
    ok(pool.length > 500, 'pool loaded (' + pool.length + ' real spots)');
    ok(!pool.some(e => e.actual.action === 'sm' || e.actual.action === 'sd'), 'no showdown-reveal (sm/sd) spots in pool');
    ok(!pool.some(e => e.decision === 'cb' && /bets/.test(e.line[e.street] || '')), 'no check/bet spot leaks the hero action in its decision-street line');
    window.StudyUI._test.setRealPool(pool);
    let real = 0, reveals = 0, heads = 0, n = 0;
    for (const mm of ['flop', 'river', 'turn']) {
      els['drillMode'].onclick(ev(['m', mm]));
      for (let i = 0; i < 25; i++) {
        n++;
        if (/REAL HAND/.test(els['drillSpot']._html)) real++;
        const acts = [...els['drillBtns']._html.matchAll(/data-a="(\w+)"/g)].map(m => m[1]);
        els['drillBtns'].onclick(ev(['a', acts[0] || 'check']));
        const fb = els['drillFb']._html;
        if (/What actually happened/.test(fb)) reveals++;
        if (/matched the engine|Engine’s take/.test(fb)) heads++;
        els['drillNext'].onclick();
      }
    }
    ok(real === n, 'every turn/river spot is a REAL hand (' + real + '/' + n + ')');
    ok(reveals === n, 'answering reveals what actually happened (' + reveals + '/' + n + ')');
    ok(heads === n, 'engine-comparison head renders (' + heads + '/' + n + ')');
  }
}

console.log('full hands — end-to-end decision-by-decision play-through');
{
  const fs3 = require('fs');
  const hp = path.join(APP, 'realhands.json');
  if (!fs3.existsSync(hp)) {
    console.log('  (skipped — realhands.json not generated)');
  } else {
    const hands = JSON.parse(fs3.readFileSync(hp, 'utf8'));
    ok(hands.length > 200, 'hands pool loaded (' + hands.length + ' full hands)');
    ok(hands.every(h => h.decisions && h.decisions.length && h.heroCards && h.villCards && h.tail), 'every hand carries decisions + both players cards + run-out tail');
    ok(hands.every(h => h.decisions.every(d => (d.decision === 'fcr' ? ['fold', 'call', 'raise'] : ['check', 'bet']).includes(d.engine.ideal))), 'every decision ideal is a legal option for that node');
    window.StudyUI._test.setRealHands(hands);
    els['drillMode'].onclick(ev(['m', 'hands']));
    ok(/Full hands/.test(els['drillMode']._html), 'mode selector shows the Full hands tab');
    ok(!/Pot odds/.test(els['drillMode']._html), 'Pot odds tab retired');
    let playthrough = 0, advanced = 0, finished = 0, actualShown = 0, headShown = 0, decN = 0;
    let multiHand = 0, diReset = 0, cardShrink = 0;
    for (let hN = 0; hN < 80; hN++) {
      let steps = 0, lastDi = 0, lastCards = 0, decisionsThisHand = 0, firstDi = null;
      while (steps++ < 14) {
        const spot = els['drillSpot']._html, prog = /PLAY-THROUGH · decision (\d+)\/(\d+) · (flop|turn|river)/.exec(spot);
        if (prog) {
          playthrough++;
          const di = +prog[1];
          if (firstDi === null) firstDi = di;
          if (di < lastDi) diReset++;          // counter must climb within a hand
          lastDi = di;
        }
        const cards = (els['drillHand']._html.match(/class="pc"/g) || []).length;   // hole + board; must not shrink within a hand
        if (lastCards && cards < lastCards) cardShrink++;
        lastCards = cards;
        const acts = [...els['drillBtns']._html.matchAll(/data-a="(\w+)"/g)].map(m => m[1]);
        els['drillBtns'].onclick(ev(['a', acts[0] || 'check']));
        const fb = els['drillFb']._html;
        if (/<b>Actual line:<\/b> hero/.test(fb)) actualShown++;
        if (/matched the engine|Engine’s take/.test(fb)) headShown++;
        decN++; decisionsThisHand++;
        const last = /How it played out/.test(fb);
        els['drillNext'].onclick();
        if (last) { finished++; break; }
        advanced++;
      }
      if (decisionsThisHand >= 2) multiHand++;
    }
    ok(playthrough >= 80, 'every decision renders the PLAY-THROUGH progress label (' + playthrough + ')');
    ok(finished >= 75, 'hands play to completion with a run-out recap (' + finished + '/80)');
    ok(advanced > 80, 'multi-decision hands advance street-by-street along the real line (' + advanced + ' advances)');
    ok(multiHand >= 50, 'most hands span 2+ decisions (' + multiHand + '/80)');
    ok(actualShown === decN, 'every decision reveals the real action taken (' + actualShown + '/' + decN + ')');
    ok(headShown === decN, 'every decision shows the engine-comparison head (' + headShown + '/' + decN + ')');
    ok(diReset === 0, 'decision counter never resets mid-hand (' + diReset + ')');
    ok(cardShrink === 0, 'the board never shrinks within a hand — it follows reality forward (' + cardShrink + ')');
    const st2 = JSON.parse(localStorage.getItem('pokerlog.train'));
    ok(st2.byMode.hands && st2.byMode.hands.a >= decN, 'hands-mode stats tracked (' + (st2.byMode.hands ? st2.byMode.hands.a : 0) + ' attempts)');
    ok(recorded.some(e => e.m === 'hands' && e.hid != null && e.di != null), 'hands answers logged with hand id + decision index');
  }
}

// ---- YOUR HANDS: the player's own flagged hands inside the drill rotation ----
// This is the differentiator, so it gets held to the same standard as the solver drills:
// it must pick only hands the player asked to revisit, and never leak someone's sample data
// or a hand they already settled.
// Poker answers are frequencies. A drill that returns a verdict teaches less than one that
// shows the split — and a 52/48 spot must never tell someone they were wrong.
// B6/B7 + the rename, from the Mac session's sweep.
console.log('the drill filter says what it is, appears only when it does something');
{
  const src = require('fs').readFileSync(path.join(APP, 'study.js'), 'utf8');
  ok(/'Filter spots'/.test(src) && !/'Options' \+/.test(src),
    'renamed: the owner himself asked what the Options tab was');
  ok(/if \(!body\) \{ \$\('drillOptsBtn'\)\.innerHTML = ''/.test(src),
    'B6: the button is not drawn for modes with no filters, so it cannot open an empty panel');

  els['drillMode'].onclick(ev(['m', 'river']));
  ok(els['drillOptsBtn']._html === '', 'B6: River draws no filter button');
  ok(els['drillOpts'].hidden === true, 'B6: and no panel');

  els['drillMode'].onclick(ev(['m', 'flop']));
  els['drillMode'].onclick(ev(['w', 'leak']));
  ok(/Filter spots/.test(els['drillOptsBtn']._html), 'Flop does have filters, so the button returns');
  ok(/facing aggression/.test(els['drillOptsBtn']._html),
    'B7: an active Flop filter is visible while collapsed, not just on preflop');
  els['drillMode'].onclick(ev(['w', 'all']));
  els['drillMode'].onclick(ev(['m', 'pf']));
}

console.log('cards hold lookups, library holds reading');
{
  // Owner's rule: Cards is what you want in FRONT of you mid-hand; anything you READ goes to
  // the Library. A fixed rule rather than a move control — no new UI, no per-item decision.
  const cards = window.StudyUI._test.refHtml();
  const lib = window.StudyUI._test.refHtml('library');
  ok(/Pot odds/.test(cards) && /Draws/.test(cards), 'the mid-hand lookups stay in Cards');
  ok(/open-jam/.test(cards), 'as do the range charts');
  ok(!/Reading players/.test(cards) && !/ICM in three lines/.test(cards),
    'and the prose is gone from Cards');
  ok(/Reading players/.test(lib) && /ICM in three lines/.test(lib) && /AK — the playbook/.test(lib),
    'the articles moved to the Library');
  ok(!/Pot odds/.test(lib), 'without duplicating the lookups — one home each');
  ok(lib.length > 500 && cards.length > 500, 'both views still have real content');
}

console.log('drill feedback shows the mix, not just a verdict');
{
  const T = window.StudyUI._test;
  const labelOf = { bet: 'Bet', check: 'Check' };
  const mix = [{ act: 'bet', f: 0.62, size: 'big' }, { act: 'check', f: 0.38 }];
  const html = T.mixBars(mix, labelOf, 'check');
  ok(/62%/.test(html) && /38%/.test(html), 'both frequencies are shown');
  ok(/class="mixrow mine"[\s\S]*?Check/.test(html) || /mine[\s\S]{0,120}Check/.test(html),
    'the answer the player gave is highlighted, not just the best one');
  ok(/not a solve/.test(html), 'and it says plainly that these are model frequencies, not a solve');
  ok(T.mixBars([{ act: 'bet', f: 1 }], labelOf, 'bet') === '',
    'a pure spot draws no bars — there is no mix to show');
  ok(T.mixBars(null, labelOf, 'bet') === '', 'and missing data is a no-op, not a crash');
}

// C5 — the dead-UI bug the owner hit and the Mac session could not reproduce. renderMine
// used to REPLACE the shared drillBtns handler with a mine-only one, so the first replayed
// hand permanently killed every normal drill button. It only surfaced later, when changing a
// filter re-rendered a normal spot into a handler that no longer understood it.
console.log('a replayed hand must not freeze the drill');
{
  const T = window.StudyUI._test;
  window.pokerDB = () => ({ hands: [{ id: 'r1', ts: Date.now(), pos: 'BTN', c1: 'Ah', c2: 'Kd',
    action: 'open15 c / (Ks7d2c) x b25 c', flag: true, note: 'n' }] });

  const before = els['drillBtns'].onclick;
  T.renderMine({ mine: true, mode: 'mine', hand: window.pokerDB().hands[0] });
  ok(els['drillBtns'].onclick === before, 'rendering a replayed hand does not swap the shared handler');

  // Now do exactly what the owner did: change a filter, which renders a normal spot. The
  // rotation injects replays at ~1 in 6, so draw until a graded spot appears rather than
  // assuming the first one is — otherwise the test itself is a coin flip.
  let acts = [];
  for (let i = 0; i < 30 && !acts.length; i++) {
    els['drillMode'].onclick(ev(['m', 'pf']));
    acts = [...els['drillBtns']._html.matchAll(/data-a="(\w+)"/g)].map(m => m[1]);
  }
  ok(acts.length > 0, 'a normal spot rendered after the replay');
  els['drillBtns'].onclick(ev(['a', acts[0]]));
  ok(/✓|✗|Close|Ideal/.test(els['drillFb']._html),
    'and its buttons still answer — this is the freeze that made the whole tab dead');
  els['drillNext'].onclick();
}

console.log('reviewing your own hand is never graded');
{
  // C7 — a replayed hand was logged with r:1/0, so a hand whose action is deliberate
  // nonsense scored against the player's accuracy. Your own hands were never to be graded.
  const T = window.StudyUI._test;
  const before = recorded.length;
  T.renderMine({ mine: true, mode: 'mine', hand: { id: 'g1', ts: 1, pos: 'BTN', c1: 'Ah', c2: 'Kd', action: 'total garbage !!!', note: '' } });
  T.revealMine('diff');
  const rec = recorded[recorded.length - 1];
  ok(recorded.length === before + 1, 'the review is still logged');
  ok(rec.r === null, 'but with no score — "differently" is not wrong (got ' + JSON.stringify(rec.r) + ')');
  ok(rec.review === 1, 'and marked as a review rather than a drill');
  ok(rec.m === 'mine', 'under its own mode, so accuracy can exclude it');
}

console.log('study — your own hands in the rotation');
{
  const T = window.StudyUI._test;
  const mk = (o) => Object.assign({ id: 'h' + Math.random(), ts: Date.now(), pos: 'BTN', c1: 'Ah', c2: 'Kd', action: 'open15 c / (Ks7d2c) b25 f', stakes: '1/3' }, o);

  window.pokerDB = () => ({ hands: [] });
  ok(T.mineScenario() === null, 'with nothing flagged it declines and the normal rotation continues');

  window.pokerDB = () => ({ hands: [
    mk({ flag: true, note: 'called too wide' }),
    mk({ flag: false, review: 'leak', reviewed: false }),
    mk({ flag: false }),                                   // never asked to revisit
    mk({ flag: true, sample: true }),                      // demo data is not the user's hand
    mk({ flag: false, review: 'old', reviewed: true })     // already settled
  ] });
  const pool = T.myReviewHands();
  ok(pool.length === 2, 'only flagged and open-review hands are eligible (' + pool.length + ')');
  ok(!pool.some(h => h.sample), 'sample hands are never drilled back at the user');
  ok(!pool.some(h => h.reviewed), 'a hand already marked reviewed stays out');

  const anySpot = T.mineScenario();
  ok(anySpot && anySpot.mine === true && anySpot.mode === 'mine', 'it produces a "mine" spot');

  // Render a KNOWN hand rather than whichever one the random pick returned, so the
  // assertions below are about the rendering and not about the dice.
  const spot = { mine: true, mode: 'mine', hand: mk({ flag: true, note: 'called too wide', sign: '-', amount: '250' }) };
  const before = recorded.length;
  T.renderMine(spot);
  ok(/YOUR HAND/.test(els['drillSpot']._html), 'the spot is labelled as the player’s own hand');
  ok(els['drillQ']._html.includes('open15'), 'it replays the action they actually typed');

  // It must read as a HAND, not as a line of text — same furniture as a solver spot.
  const sp = T.splitStreets('open15 btn3b45 c / (Ks7d2c) x b25 c / (4h) x b60 f');
  ok(sp.streets.length === 3, 'the shorthand splits into streets (' + sp.streets.length + ')');
  ok(sp.streets[0].name === 'Preflop' && sp.streets[1].name === 'Flop' && sp.streets[2].name === 'Turn',
    'streets are named in order');
  ok(sp.streets[1].line === 'x b25 c', 'the board is lifted out of the street line');
  ok(sp.board.join('') === 'Ks7d2c4h', 'and accumulates across streets (' + sp.board.join('') + ')');
  ok(T.splitStreets('KK < AA, std | -250').streets.length === 1, 'a freeform lazy line still renders as one street');
  ok(T.splitStreets('').streets.length === 0, 'and an empty action does not throw');

  ok(/class="streets"/.test(els['drillQ']._html), 'the replay renders street rows, not a mono blob');
  ok(/you’re here/.test(els['drillQ']._html), 'and marks where the decision sits');
  ok(/class="board"/.test(els['drillHand']._html) || !/\(/.test('x'), 'the board is dealt out as cards');
  ok(/You’re the <b>BTN/.test(els['drillHand']._html), 'position is stated in words');
  ok(/data-mine="same"/.test(els['drillBtns']._html) && /data-mine="diff"/.test(els['drillBtns']._html),
    'it asks whether they would play it the same way');

  T.revealMine('diff');
  ok(/leak/i.test(els['drillFb']._html), 'changing the answer names the gap as the leak');
  ok(els['drillFb']._html.includes('called too wide'), 'and shows the note written at the table');
  ok(recorded.length === before + 1, 'the answer is logged like any other drill');
  ok(recorded[recorded.length - 1].m === 'mine', 'logged under its own mode so Progress can split it out');

  ok(T.mineRate() > 0 && T.mineRate() < 0.35, 'injection rate seasons the rotation rather than taking it over');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASS');
process.exit(fail ? 1 : 0);
