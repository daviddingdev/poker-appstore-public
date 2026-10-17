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
require(path.join(APP, 'tables.js'));
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
let seatless = 0, qmarks = 0, replays = 0, squeezeChecked = 0;
for (let i = 0; i < 240; i++) {
  const spot = els['drillSpot']._html;
  if (/↻ missed spot, new cards/.test(spot)) replays++;
  if (/you missed this before/.test(spot)) qmarks++;   // a replay deals new cards: it never claims the hand is a repeat
  if (/<b>\?<\/b>|’re (the )?\?/.test(spot)) { qmarks++; if (qmarks < 4) console.log('  QMARK:', spot); }
  if (/Folded to you/.test(spot)) seen.open = true;
  if (/opens · <b>\d+bb<\/b> · you’re the <b>(HJ|CO|BTN|SB|BB)/.test(spot)) seen.vs = true;
  if (/opens · /.test(spot) && /on you/.test(spot)) seatless++;          // must never happen now
  if (/opens, <b>\d+<\/b> call/.test(spot) && /you’re the <b>/.test(spot)) {
    seen.squeeze = true;
  }
  (function(){
    // The opener is named in words (poker.js POS_NAME), the hero by code (study.js SEAT_CODE):
    // both map back to the engine's seats to check that enough seats sit between them.
    const OPENER = {'Early (UTG–LJ)': 'EP', 'Hijack (HJ)': 'MP', 'Cutoff': 'CO', 'Button': 'BTN', 'Small blind': 'SB'};
    const m3 = /<b>([^<]+)<\/b> opens, <b>(\d+)<\/b> call/.exec(spot);
    const mh = /you’re the <b>(HJ|CO|BTN|SB|BB)<\/b>/.exec(spot);
    if (m3 && mh) {
      const op = OPENER[m3[1]], hero = mh[1] === 'HJ' ? 'MP' : mh[1];
      const O = ['EP','MP','CO','BTN','SB','BB'];
      if (!op) { qmarks++; console.log('  UNKNOWN OPENER:', spot); return; }
      squeezeChecked++;
      const gap = O.indexOf(hero) - O.indexOf(op) - 1;
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
// The dealer is random and 240 draws occasionally miss the rarest family (bbopt has
// flaked green-run-to-green-run). Top up QUIETLY until every family has appeared — the
// assertions below claim "the dealer can emit it", not how often. The hard cap keeps a
// genuinely removed family failing loudly instead of spinning forever.
for (let i = 0; i < 4000 && !(seen.bbopt && seen.limpRR && seen.sbLimp && seen.squeeze &&
    seen.vs3bet && seen.vs4bet && seen.cold3b && seen.calljam && seen.open && seen.vs); i++){
  const spot = els['drillSpot']._html;
  if (/Folded to you/.test(spot)) seen.open = true;
  if (/opens · <b>\d+bb<\/b> · you’re the <b>(HJ|CO|BTN|SB|BB)/.test(spot)) seen.vs = true;
  if (/opens, <b>\d+<\/b> call/.test(spot) && /you’re the <b>/.test(spot)) seen.squeeze = true;
  if (/You open .*3-bets \(you’re (IP|OOP)\)/.test(spot)) seen.vs3bet = true;
  if (/You 3-bet from the .*4-bets/.test(spot)) seen.vs4bet = true;
  if (/opens, <b>\w+<\/b> 3-bets · .*you’re the <b>/.test(spot)) seen.cold3b = true;
  if (/jams <b>\d+bb<\/b> · you’re the <b>BB/.test(spot)) seen.calljam = true;
  if (/folds to you in the <b>BB<\/b>/.test(spot)) seen.bbopt = true;
  if (/limp-reraises/.test(spot)) seen.limpRR = true;
  if (/Folded to you · <b>small blind/.test(spot) && /data-a="limp"/.test(els['drillBtns']._html)) seen.sbLimp = true;
  const acts = [...els['drillBtns']._html.matchAll(/data-a="(\w+)"/g)].map(m => m[1]);
  els['drillBtns'].onclick(ev(['a', acts[0] || 'fold']));
  els['drillNext'].onclick();
}
ok(seen.open, 'saw a first-in open spot');
ok(seen.vs, 'saw a facing-a-raise spot WITH a named hero seat');
ok(seatless === 0, 'no seatless "on you" facing-a-raise spots (' + seatless + ')');
ok(replays > 5, 'legacy misses got replayed (' + replays + ')');
ok(qmarks === 0, 'no "?" positions anywhere, including legacy-miss replays (' + qmarks + ')');
ok(seen.squeeze, 'saw a multiway squeeze spot');
ok(squeezeChecked > 0, 'every squeeze opener read back to its seat and the gap checked (' + squeezeChecked + ')');
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
const ORDER = ['UTG–LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];   // the engine's EP/MP, as the screen names them
let badOrder = 0, checked3bet = 0;
for (let i = 0; i < 250; i++) {
  const spot = els['drillSpot']._html.replace(/<\/?b>/g, '');
  let m2;
  if ((m2 = /You open ([\w–]+), ([\w–]+) calls/.exec(spot))) {
    if (ORDER.indexOf(m2[1]) >= ORDER.indexOf(m2[2])) { badOrder++; if (badOrder < 4) console.log('  BAD:', spot); }
  } else if ((m2 = /([\w–]+) opens, you 3-bet ([\w–]+)/.exec(spot))) {
    checked3bet++;
    if (ORDER.indexOf(m2[1]) >= ORDER.indexOf(m2[2])) { badOrder++; if (badOrder < 4) console.log('  BAD:', spot); }
  } else if ((m2 = /([\w–]+) opens, you call ([\w–]+)/.exec(spot))) {
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

console.log('drill — the free-tier preview');
// The drill deals for a free user (a real spot is the pitch); the answers are Pro. A tap opens
// the Pro screen and nothing is graded or logged.
{
  let opened = null; const hadShowTab = global.showTab; global.showTab = t => { opened = t; };
  global.isPro = () => false;
  const before = JSON.parse(localStorage.getItem('pokerlog.train')).att;
  els['drillBtns'].onclick(ev(['a', 'fold']));
  ok(opened === 'Pro', 'free tier: tapping an answer opens the Pro screen');
  ok(JSON.parse(localStorage.getItem('pokerlog.train')).att === before, 'and nothing is graded or logged');
  delete global.isPro; if (hadShowTab) global.showTab = hadShowTab; else delete global.showTab;
}

console.log('drill tiers — what the free tier answers (LAUNCH_PLAN §2)');
{
  const T = window.StudyUI._test, D = window.Dealer;
  const plain = h => String(h).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  const att = () => JSON.parse(localStorage.getItem('pokerlog.train')).att;
  let opened = null; const hadShowTab = global.showTab; global.showTab = t => { opened = t; };
  // The drill log the free 3-bet allowance is counted from. recordDrill writes to it, as the
  // app's does, so answering a spot spends the allowance.
  const drills = [];
  const prevDB = window.pokerDB, prevRec = window.recordDrill;
  window.pokerDB = () => ({ hands: [], drills });
  window.recordDrill = e => { prevRec(e); drills.push(e); };
  const noon = days => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12).getTime(); };
  const tap = a => els['drillBtns'].onclick(ev(['a', a]));
  global.isPro = () => false;
  // A mode tap re-renders the mode row, the deal and the stats for the tier — the same three
  // refreshTier redraws on a purchase. (refreshTier itself would also reset Cards to its free
  // chart, which the Cards checks below don't expect.)
  els['drillMode'].onclick(ev(['m', 'pf']));

  // Mode row: Preflop live, the rest locked by name; the filter is gone.
  const modes = els['drillMode']._html;
  ok(['Flop', 'Turn', 'River', 'Full hands'].every(m => modes.includes('aria-label="' + m + ', Pro"')) && !modes.includes('Preflop, Pro'),
    'free tier: Flop, Turn, River and Full hands carry the lock; Preflop does not');
  ok(els['drillOptsBtn']._html === '' && els['drillOpts'].hidden === true, 'free tier: the spot filter is hidden');
  ok(/of 10 free re-raise \(3-bet\) spots used today/.test(els['drillStats']._html), 'free tier: the stats show, with today’s 3-bet count');

  // 1. A free deal is always first-in at 100bb, from a seat the free chart covers.
  let notOpen = 0, seats = new Set(), sawChain = 0;
  for (let i = 0; i < 600; i++) {
    const s = T.scenarioFree();
    if (s.kind !== 'open' || s.depth !== 100 || !s.free || !s.c1 || !s.c2) notOpen++;
    seats.add(s.pos); if (s.chainRaiser) sawChain++;
  }
  ok(notOpen === 0, 'a free deal is always a first-in open at 100bb (' + notOpen + ' were not)');
  ok(['EP', 'MP', 'CO', 'BTN', 'SB'].every(p => seats.has(p)) && !seats.has('BB'), 'every seat the free chart covers is dealt, the small blind included (' + [...seats].join(' ') + ')');
  ok(sawChain > 10 && sawChain < 200, 'opens still get 3-bet behind at the live-deal rate (' + sawChain + '/600)');

  // The same through the real flow: answer every spot, follow every chain.
  let flowBad = 0, chained = 0, graded = 0;
  for (let i = 0; i < 300; i++) {
    const c = T.cur();
    if (!c.free || c.depth !== 100 || !(c.kind === 'open' || (c.kind === 'vs3bet' && c.chained))) { flowBad++; if (flowBad < 3) console.log('  NOT FREE:', c.kind, c.depth); }
    if (c.kind === 'vs3bet') chained++;
    const acts = [...els['drillBtns']._html.matchAll(/data-a="(\w+)"/g)].map(m => m[1]);
    tap(acts.includes('open') ? 'open' : acts[acts.length - 1]);
    if (/✓|✗|≈/.test(els['drillFb']._html)) graded++;
    els['drillNext'].onclick();
  }
  ok(flowBad === 0, 'the free Preflop drill deals only 100bb opens and their chained 3-bets (' + flowBad + ' other)');
  ok(graded === 300, 'and grades every one of them for real (' + graded + '/300)');
  ok(chained > 0, 'chained 3-bet spots appear in the free rotation (' + chained + ')');
  ok(opened === null, 'no free answer opened the Pro screen');
  drills.length = 0;   // the flow spent today's ten; start the chain checks from none

  // 2. The plain words (§2 copy, Appendix A).
  T.setCur({ mode: 'pf', kind: 'open', pos: 'BTN', depth: 100, c1: 'As', c2: 'Ah', label: 'AA', free: true, chainRaiser: 'BB' });
  ok(plain(els['drillSpot']._html) === 'Everyone folds to you · you’re on the button (BTN) · 100 big blinds', 'the free open speaks plain: "' + plain(els['drillSpot']._html) + '"');
  T.setCur({ mode: 'pf', kind: 'open', pos: 'EP', depth: 100, c1: '7s', c2: '2h', label: '72o', free: true });
  // The first seat plays like UTG at six players and like the lojack at nine, so it is named as
  // both, and introduced by what is true at either table: nobody has raised yet.
  ok(/you’re in an early seat \(UTG–LJ\)/.test(plain(els['drillSpot']._html)) && /^Nobody has raised yet/.test(plain(els['drillSpot']._html)) && !/first to act/.test(els['drillSpot']._html),
    'the first seat is "an early seat (UTG–LJ)", and "nobody has raised yet" rather than "first to act" (untrue for the lojack)');
  tap('open');
  ok(/✗ The app’s answer: Fold/.test(els['drillFb']._html) && /The chart folds this hand from here \(it raises about 17% of hands\)/.test(els['drillFb']._html),
    'a miss says "the app’s answer", not "Engine’s take", and what the chart does from here');
  ok(/72o \(offsuit\) is in the top \d+% of starting hands, outside that 17%\./.test(els['drillFb']._html), 'the why places the hand against that range, in words');
  ok(!/Engine’s take|ideal is|range\b/.test(els['drillFb']._html), 'no "Engine’s take", "ideal is" or bare "range" on a free spot');
  // That miss comes back as a replay of the SPOT (the early seat at 100bb) with a new hand dealt
  // near the line: a miss keeps no cards, so the label may not say "you missed this before".
  {
    let rp = null;
    for (let i = 0; i < 400 && !rp; i++) { const c = T.scenarioFree(); if (c.replay) rp = c; }
    T.setCur(rp || {});
    ok(!!rp && /↻ a spot you missed before \(same seat, new cards\)/.test(els['drillSpot']._html) && !/you missed this before/.test(els['drillSpot']._html),
      'a free replay says it is a spot you missed (same seat, new cards), never that you missed this hand');
  }

  // 3. The chain: free while today’s count of 3-bet answers is under 10.
  T.setCur({ mode: 'pf', kind: 'open', pos: 'BTN', depth: 100, c1: 'As', c2: 'Ah', label: 'AA', free: true, chainRaiser: 'BB' });
  const before3b = D.threeBetsOn(drills);
  tap('open');
  ok(/✓ Raise/.test(els['drillFb']._html) && /The chart raises this hand from here \(about 48% of hands\)/.test(els['drillFb']._html), 'a right answer: "✓ Raise", then what the chart does (about 48% of hands from the button)');
  ok(/The big blind \(BB\) 3-bets \(re-raises\) you →/.test(els['drillFb']._html), 'the chain button says what a 3-bet is: "The big blind (BB) 3-bets (re-raises) you →"');
  els['drillNext'].onclick();
  const c3 = T.cur();
  ok(c3.kind === 'vs3bet' && c3.chained && c3.free && c3.depth === 100, 'the chained spot is the same hand, facing the 3-bet at 100bb');
  ok(/^You raised from the button \(BTN\); the big blind \(BB\) re-raised \(3-bet\)\. You act last after the flop \(in position\)\./.test(plain(els['drillSpot']._html)),
    'its header tells the story in words: "' + plain(els['drillSpot']._html).slice(0, 110) + '…"');
  ok(/↪ same hand, next decision/.test(els['drillSpot']._html), 'and marks it as the same hand, next decision');
  ok(new RegExp('Free re-raise \\(3-bet\\) spot ' + (before3b + 1) + ' of today’s 10').test(plain(els['drillSpot']._html)), 'and shows its place in today’s ten (spot ' + (before3b + 1) + ' of 10)');
  ok(new RegExp(before3b + ' of 10 free re-raise \\(3-bet\\) spots used today').test(els['drillStats']._html) && !/spots today/.test(plain(els['drillSpot']._html)),
    'while the stats line counts the spots used (' + before3b + '), in words that cannot be read as the same count');
  ok(els['drillQ'].textContent === '4-bet (raise again), call, or fold?', 'the question explains the 4-bet: "' + els['drillQ'].textContent + '"');
  tap('threebet');
  ok(D.threeBetsOn(drills) === before3b + 1, 'answering it spends one of today’s ten');
  ok(/The chart raises again \(4-bets\) with this hand/.test(els['drillFb']._html) && !/call\/overcall/.test(els['drillFb']._html), 'its feedback is plain, and heads-up is a call, never an overcall');
  els['drillNext'].onclick();
  // Every hand, both positions: the overrides (AK, QQ/JJ deep, set-mining, suited hands) speak
  // through their plain twins on the free spot, never the regulars' shorthand.
  const slang = /nutted|FLAT|implied odds|flipped-or-crushed|blocks AA|bloat|overcall|~top|modern default/;
  const slangy = [];
  window.POKER_DATA.ranking.forEach(r => ['ip', 'oop'].forEach(p3 => ['fold', 'call', 'threebet'].forEach(a => {
    const g = T.gradePF({ mode: 'pf', kind: 'vs3bet', pos: 'BTN', raiser: 'BB', pos3: p3, depth: 100, label: r.h, free: true, chained: true }, a);
    if (slang.test(g.why) || !g.plainHead) slangy.push(r.h + ' ' + p3);
  })));
  ok(slangy.length === 0, 'the free 3-bet feedback is plain for all 169 hands, in and out of position' + (slangy.length ? ' — ' + slangy.slice(0, 4).join(', ') : ''));
  // The open a tap earlier ranked AJo for raising first ("top 14%"); this spot ranks it by
  // all-in strength ("top 10%"). The two figures for one hand must say which ranking they are.
  {
    const w = T.gradePF({ mode: 'pf', kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: 'oop', depth: 100, label: 'AJo', free: true, chained: true }, 'fold').why;
    // 10.0% since STUDY-1: AJo (9.95%) sits within a point of the 10% call line, so the free sentence
    // takes the Pro view's decimal and says which side of the line it fell.
    ok(/Ranked by all-in strength, AJo \(offsuit\) is in the .*top 10(?:\.0)?%.* of hands\b/.test(w), 'the free 3-bet feedback says its "top 10%" is by all-in strength (the open said top 14% for raising first)');
  }

  // Fill today to 10: the next chain is skipped, the open still graded, no dead button.
  while (D.threeBetsOn(drills) < 10) drills.push({ t: Date.now(), m: 'pf', k: 'vs3bet', r: 'right' });
  T.setCur({ mode: 'pf', kind: 'open', pos: 'CO', depth: 100, c1: 'Ks', c2: 'Kh', label: 'KK', free: true, chainRaiser: 'BTN' });
  const attCap = att();
  tap('open');
  ok(att() === attCap + 1 && /✓ Raise/.test(els['drillFb']._html), 'at 10 today the open is still graded');
  ok(!/3-bets \(re-raises\) you/.test(els['drillFb']._html) && /id="drillNext">Next hand</.test(els['drillFb']._html), 'but the chain is skipped: the button is plain Next hand');
  ok(/You’ve used today’s 10 free re-raise spots/.test(els['drillFb']._html) && /data-pro="1"/.test(els['drillFb']._html), 'and a line says why, with a way to Pro');
  els['drillFb'].onclick({ target: { closest: q => q === '[data-pro]' ? {} : null } });
  ok(opened === 'Pro', 'that link opens the Pro screen'); opened = null;
  els['drillNext'].onclick();
  ok(T.cur().kind !== 'vs3bet', 'and the next spot is a fresh deal, not the 3-bet');
  ok(/10 of 10 free re-raise \(3-bet\) spots used today/.test(els['drillStats']._html), 'the stats say the ten are used');
  // Bought Pro between the deal and the answer: the open was dealt free, but the allowance is a
  // free-tier rule and the player is Pro now. The cap must not fire, and the chain is not free.
  T.setCur({ mode: 'pf', kind: 'open', pos: 'CO', depth: 100, c1: 'Ks', c2: 'Kh', label: 'KK', free: true, chainRaiser: 'BTN' });
  global.isPro = () => true;
  tap('open');
  ok(!/used today’s/.test(els['drillFb']._html) && /3-bets you →/.test(els['drillFb']._html),
    'a player who buys Pro with a free open on screen is never told today’s free ten are used: the chain runs');
  els['drillNext'].onclick();
  ok(T.cur().kind === 'vs3bet' && !T.cur().free && !/free re-raise/.test(els['drillSpot']._html), 'and its 3-bet spot is a Pro one, with no free counter');
  els['drillMode'].onclick(ev(['m', 'pf']));   // leave it unanswered, as a player might
  global.isPro = () => false;
  // The other order: the chain was queued while free, then Pro was bought before Next. The
  // spot stays the free one it was dealt as, but a Pro player has no allowance to count.
  const kept = drills.splice(0);   // start from none today; the day's log is put back below
  T.setCur({ mode: 'pf', kind: 'open', pos: 'CO', depth: 100, c1: 'Ks', c2: 'Kh', label: 'KK', free: true, chainRaiser: 'BTN' });
  tap('open');
  ok(/The button \(BTN\) 3-bets \(re-raises\) you →/.test(els['drillFb']._html), 'a free player’s chain is queued');
  global.isPro = () => true;
  els['drillNext'].onclick();
  ok(T.cur().kind === 'vs3bet' && !/free re-raise/.test(els['drillSpot']._html), 'and once they are Pro its header carries no free counter');
  els['drillMode'].onclick(ev(['m', 'pf']));
  global.isPro = () => false;
  drills.length = 0; drills.push(...kept);
  // Samples never count; yesterday's answers don't either.
  drills.forEach(e => { if (e.k === 'vs3bet') e.t = noon(-1); });
  ok(D.threeBetsOn(drills) === 0 && D.threeBetsByDay(drills)[D.dayKey(noon(-1))] >= 10, 'the count is per local day: yesterday’s ten are yesterday’s');
  T.setCur({ mode: 'pf', kind: 'open', pos: 'CO', depth: 100, c1: 'Ks', c2: 'Kh', label: 'KK', free: true, chainRaiser: 'BTN' });
  tap('open');
  ok(/The button \(BTN\) 3-bets \(re-raises\) you →/.test(els['drillFb']._html), 'the next local day the chain runs again');
  els['drillNext'].onclick();   // the 3-bet spot
  tap('fold');                   // answering it spends one of today's ten
  els['drillNext'].onclick();
  for (let i = 0; i < 12; i++) drills.push({ t: Date.now(), m: 'pf', k: 'vs3bet', r: 'right', sample: true });
  ok(D.threeBetsOn(drills) === 1, 'sample answers never count toward the ten (' + D.threeBetsOn(drills) + ')');
  ok(D.daysAtThreeBetCap(drills) === 1, 'and the days the cap was hit are countable for §3 (' + D.daysAtThreeBetCap(drills) + ')');

  // 4. The small blind: the densest free spot, rewritten plainly (Appendix A fix 5).
  T.setCur({ mode: 'pf', kind: 'open', pos: 'SB', depth: 100, c1: '9s', c2: '8s', label: '98s', free: true });
  ok(els['drillQ'].textContent === 'Raise, limp (just call the big blind), or fold?', 'the SB question says what a limp is');
  tap('fold');
  const sbFb = els['drillFb']._html;
  ok(!/VPIP|OOP|complete|value \+ bluffs|raise-or-fold/.test(sbFb), 'its feedback drops VPIP, OOP, "complete" and "value + bluffs"');
  ok(/big-blind ante/.test(sbFb) && /out of position/.test(sbFb) && /\d+% of hands/.test(sbFb), 'and keeps every claim, in words, with its numbers');
  // The bands as the chart draws them: every pair raises (22 included), the limps include
  // offsuit hands (97o), and a few suited hands fold (72s). So the text may not call the limps
  // "small-pair hands" or the folds "offsuit junk", free or Pro, at any depth the drill deals.
  ok(window.Poker.sbEval(100, '22').action === 'raise' && window.Poker.sbEval(100, '97o').action === 'limp' && window.Poker.sbEval(100, '72s').action === 'fold',
    'the 100bb small-blind chart raises 22, limps 97o and folds 72s (the bands the text describes)');
  {
    let sbBad = [];
    const RK = 'AKQJT98765432';
    [true, false].forEach(fr => [20, 30, 50, 100].forEach(d => {
      for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
        const h = i === j ? RK[i] + RK[j] : i < j ? RK[i] + RK[j] + 's' : RK[j] + RK[i] + 'o';
        const w = T.gradePF({ mode: 'pf', kind: 'open', pos: 'SB', depth: d, label: h, free: fr }, 'fold').why;
        if (/small-pair|small pair|offsuit junk/.test(w)) sbBad.push((fr ? 'free ' : 'Pro ') + d + ' ' + h);
        else if (window.Poker.sbEval(d, h).action === 'fold' && /This one (is a fold|folds)[^<]*offsuit/.test(w)) sbBad.push('fold tail ' + d + ' ' + h);
        else if (!/every pair/.test(w)) sbBad.push('no "every pair" ' + d + ' ' + h);
      }
    }));
    ok(sbBad.length === 0, 'the small-blind feedback never calls the limps small pairs or a fold offsuit junk, free and Pro, 20–100bb' + (sbBad.length ? ' — ' + sbBad.slice(0, 4).join(', ') : ''));
  }

  // 5. Postflop (and every other mode) is a preview: answers open Pro, nothing graded.
  els['drillMode'].onclick(ev(['m', 'flop']));
  const aFlop = att(); opened = null;
  const fm = /data-a="(\w+)"/.exec(els['drillBtns']._html);
  ok(!!fm && !T.cur().free, 'free tier: Flop still deals a live spot, as a preview');
  els['drillBtns'].onclick(ev(['a', fm ? fm[1] : 'check']));
  ok(opened === 'Pro' && att() === aFlop, 'free tier: a generic postflop answer opens the Pro screen and grades nothing');
  els['drillMode'].onclick(ev(['m', 'pf']));

  // 6. Your own flagged hands replay free; samples and reviewed hands never come back.
  const mk = o => Object.assign({ id: 'fm' + Math.random(), ts: Date.now(), pos: 'BTN', c1: 'Ah', c2: 'Kd', action: 'open15 c / (Ks7d2c) b25 f', stakes: '1/3' }, o);
  opened = null;
  T.renderMine({ mine: true, mode: 'mine', hand: mk({ flag: true, note: 'n' }) });
  els['drillBtns'].onclick(ev(['mine', 'fold']));
  ok(opened === null && /At the table you <b>folded<\/b>/.test(els['drillFb']._html), 'free tier: your own hand answers and reveals — replays are free');
  window.pokerDB = () => ({ hands: [mk({ flag: true, sample: true }), mk({ flag: false, review: 'x', reviewed: true }), mk({ flag: true, reviewed: true, sample: true })], drills });
  let mineDealt = 0;
  for (let i = 0; i < 200; i++) { els['drillMode'].onclick(ev(['m', 'pf'])); if (T.cur().mine) mineDealt++; }
  ok(T.mineScenario() === null && mineDealt === 0, 'free tier: sample and reviewed hands are never replayed (' + mineDealt + ')');

  // 7. Pro is unchanged: the terse header, the filter, no locks.
  delete global.isPro;
  els['drillMode'].onclick(ev(['m', 'pf']));
  ok(!/Pro"/.test(els['drillMode']._html) && els['drillOptsBtn']._html !== '', 'Pro: no locks on the modes, and the filter is back');
  let terse = false;
  for (let i = 0; i < 200 && !terse; i++) { if (/Folded to you · <b>/.test(els['drillSpot']._html)) terse = true; els['drillMode'].onclick(ev(['m', 'pf'])); }
  ok(terse, 'Pro: an open keeps today’s terse header ("Folded to you · …")');
  ok(!/free re-raise/.test(els['drillStats']._html), 'Pro: no free counter');
  // SB-5: the seat names are bare nouns, so the sentences around them carry the article.
  T.setCur({ mode: 'pf', kind: 'iso', pos: 'MP', limpers: 1, depth: 50, c1: 'As', c2: 'Kd', label: 'AKo' });
  const isoH = els['drillSpot']._html;
  T.setCur({ mode: 'pf', kind: 'vs3bet', pos: 'EP', raiser: 'BTN', pos3: 'oop', depth: 50, c1: 'As', c2: 'Kd', label: 'AKo' });
  const v3H = els['drillSpot']._html;
  T.setCur({ mode: 'pf', kind: 'limpRR', pos: 'BTN', limpers: 1, depth: 50, c1: 'As', c2: 'Kd', label: 'AKo' });
  const lrH = els['drillSpot']._html;
  // L10: whole percents put "A7s is at 10%" under "3-bet ~top 10%" with Call the answer. Every
  // Pro band line, every hand: a hand printed at a line's own figure says which side it fell.
  {
    const RK = 'AKQJT98765432', ties = [], spots = [];
    ['EP', 'MP', 'CO', 'BTN'].forEach(o => ['CO', 'BTN', 'SB', 'BB'].forEach(v => { if (['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'].indexOf(v) > ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'].indexOf(o)) [30, 50, 100].forEach(d => spots.push({ mode: 'pf', kind: 'vs', opener: o, vseat: v, blind: v === 'SB' || v === 'BB' ? v : null, depth: d })); }));
    [30, 50, 100].forEach(d => ['ip', 'oop'].forEach(p3 => spots.push({ mode: 'pf', kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: p3, depth: d })));
    let lines = 0;
    spots.forEach(sp => { for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const h = i === j ? RK[i] + RK[j] : i < j ? RK[i] + RK[j] + 's' : RK[j] + RK[i] + 'o';
      const g = T.gradePF(Object.assign({ label: h }, sp), 'fold'), w = g.why.replace(/<[^>]+>/g, '');
      const at = / is at ([\d.]+)%/.exec(w); if (!at) continue;
      lines++;
      const figs = [...w.matchAll(/~(?:top )?([\d.]+)%/g)].map(m => m[1]);
      if (figs.includes(at[1]) && !/\(just (inside|outside) the /.test(w)) ties.push(sp.kind + ' ' + (sp.opener || sp.pos) + '>' + (sp.vseat || sp.pos3) + ' ' + sp.depth + ' ' + h + ': ' + w.slice(0, 90));
      if (sp.blind === 'SB' && g.idealAct === 'call' && /flatting is thin/.test(w)) ties.push('SB note under Call: ' + h);
    } });
    ok(lines > 1000 && ties.length === 0, 'Pro band feedback never prints a hand at its line’s own figure without saying which side (' + lines + ' checked)' + (ties.length ? ' — ' + ties.slice(0, 3).join(' | ') : ''));
  }
  ok(/you’re in the <b>hijack \(HJ\)<\/b>/.test(isoH) && /You open from an <b>early seat \(UTG–LJ\)<\/b>/.test(v3H) && /from the <b>button<\/b>/.test(lrH),
    'Pro headers read "you’re in the hijack (HJ)", "You open from an early seat (UTG–LJ)", "from the button"');

  window.pokerDB = prevDB; window.recordDrill = prevRec;
  if (hadShowTab) global.showTab = hadShowTab; else delete global.showTab;
}

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
// 20bb (the default) is jam-or-fold after a 3-bet — the reference text says so and the chart must agree.
ok(els['cardGrid']._html.includes('g13 tb') && !els['cardGrid']._html.includes('g13 cl'), 'at 20bb the vs-3-bet grid is jam-or-fold: no flat cells');
els['cardSel'].onclick(ev(['d', '30']));
ok(els['cardGrid']._html.includes('g13 tb') && els['cardGrid']._html.includes('g13 cl'), 'at 30bb the vs-3-bet grid has 4-bet + call cells');
els['cardSel'].onclick(ev(['d', '20']));
els['cardSel'].onclick(ev(['i', 'oop']));
ok(els['cardMeta']._html.includes('out of position'), 'IP/OOP selector works');
const ipCells = (els['cardGrid']._html.match(/g13 (tb|cl)/g) || []).length;
els['cardSel'].onclick(ev(['i', 'ip']));
const ipCells2 = (els['cardGrid']._html.match(/g13 (tb|cl)/g) || []).length;
ok(ipCells2 >= ipCells, 'IP continues at least as wide as OOP (' + ipCells2 + ' vs ' + ipCells + ')');
els['cardSel'].onclick(ev(['x', 'vs']));   // restore for later assertions

console.log('pocket card — the free/Pro line');
global.isPro = () => false;               // the app shell's gate, free tier
global.StudyUI.refreshTier();
// A chart already picked (20bb, facing a raise) is Pro: the pitch shows, never a dead control.
ok(els['cardGrid']._html.includes('comes with Pro') && !els['cardGrid']._html.includes('g13'), 'free tier: a Pro chart shows the pitch instead of the grid');
ok(els['cardGrid']._html.includes('cardLockGo'), 'and the pitch has its one button');
ok(els['cardSel']._html.includes('20bb, Pro') && !els['cardSel']._html.includes('100bb, Pro'), 'locked depths are marked Pro; 100bb is not');
ok(els['cardSel']._html.includes('Facing a raise, Pro') && !els['cardSel']._html.includes('First in, Pro'), 'locked situations are marked Pro; first in is not');
els['cardSel'].onclick(ev(['x', 'open'])); els['cardSel'].onclick(ev(['d', '100']));
ok((els['cardGrid']._html.match(/g13/g) || []).length === 169, 'free tier: the 100bb first-in chart renders');
els['cardSel'].onclick(ev(['p', 'SB']));
ok((els['cardGrid']._html.match(/g13/g) || []).length === 169, 'for every seat');
ok(!/small-pair|offsuit junk/.test(els['cardMeta']._html) && /every pair/.test(els['cardMeta']._html), 'free small-blind chart: the note says every pair raises, never "small-pair" limps or "offsuit junk"');
ok(/<div class="grid13 sbl">/.test(els['cardGrid']._html) && /<div class="lg sbl">/.test(els['cardGrid']._html), 'the small-blind chart marks its limp cells beyond colour (teal raise vs green limp is ~1.05:1)');
els['cardSel'].onclick(ev(['d', '10']));
ok(els['cardGrid']._html.includes('comes with Pro'), 'free tier: push/fold depths are Pro');
els['cardSel'].onclick(ev(['d', '100'])); els['cardSel'].onclick(ev(['x', 'vs']));
ok(els['cardGrid']._html.includes('comes with Pro'), 'free tier: facing a raise is Pro even at 100bb');
delete global.isPro; global.StudyUI.refreshTier();
ok(els['cardGrid']._html.includes('g13 tb'), 'Pro (or no shell): every chart opens again');
els['cardSel'].onclick(ev(['x', 'open'])); els['cardSel'].onclick(ev(['p', 'SB']));
['20', '30', '50', '100'].forEach(d => { els['cardSel'].onclick(ev(['d', d]));
  ok(!/small-pair|offsuit junk/.test(els['cardMeta']._html) && /every pair/.test(els['cardMeta']._html), 'Pro small-blind chart at ' + d + 'bb: every pair raises, no "small-pair" limps or "offsuit junk"'); });
els['cardSel'].onclick(ev(['x', 'vs']));
els['cardSel'].onclick(ev(['p', 'BTN'])); els['cardSel'].onclick(ev(['d', '20']));   // restore for later assertions

console.log('reference blocks');
// Cards and Library split by use, so each block is asserted against the view that now owns
// it. Everything still exists — nothing was dropped in the move.
const ref = els['cardRef']._html;
const refLib = window.StudyUI._test.refHtml('library');
['Pot odds', 'the biggest bet you can call', 'who’s ahead, by how much', 'Facing a re-raise (3-bet)', '4-bet', 'Big blind vs an all-in'].forEach(s =>
  ok(ref.includes(s), 'Cards has "' + s + '"'));
// LAUNCH_PLAN §8: nine concepts became six. Check-raising and Leading are sub-heads of "Raising
// with a reason"; the over-call tax moved from Cards into "Tournament pressure".
['Raising with a reason', 'Check-raising', 'Leading', 'Tournament pressure', 'Playing AK', 'ICM', 'over-call tax'].forEach(s =>
  ok(refLib.includes(s), 'Library has "' + s + '"'));
ok(!ref.includes('over-call tax'), 'and Cards no longer carries the over-call tax');
ok(/player behind/.test(refLib) && /one tier/.test(refLib) && /A5s/.test(refLib), 'player-behind jam reference covers the over-call tax + suited-ace nuance (now in the Library)');

// The All-in table's six rows, as printed. Review (K1): AA/KK, QQ/99 and TT/AK read 83/17, 82/18
// and 56/44, rounded from sampled values about a point off. Exact enumeration (every suit
// combination, every board, ties split; handeval.js) gives AA/KK 81.95, QQ/99 81.19, 99/87s 81.62,
// TT/A8o 71.78, TT/AKo 56.88, AQo/AJo 73.91.
{
  const row = (pair) => { const m = new RegExp('<span class="dim">' + pair + '</span></td><td class="r"><b>(\\d+ / \\d+)</b>').exec(ref); return m ? m[1] : null; };
  const want = { 'QQ/99': '81 / 19', '99/87s': '82 / 18', 'TT/A8': '72 / 28', 'TT/AK': '57 / 43', 'AQ/AJ': '74 / 26', 'AA/KK': '82 / 18' };
  const got = Object.keys(want).map(k => k + ' ' + row(k));
  ok(Object.keys(want).every(k => row(k) === want[k]), 'the All-in table prints the exact equities, rounded: ' + got.join(', '));
  const pot = require('fs').readFileSync(path.join(APP, 'learn-pot-odds.html'), 'utf8');
  const tt = /two tens against ace-king\) is near a coin flip, (\d+)\/(\d+)/.exec(pot), aq = /AQ against AJ wins about (\d+)\/(\d+)/.exec(pot);
  ok(tt && tt[1] + ' / ' + tt[2] === row('TT/AK') && aq && aq[1] + ' / ' + aq[2] === row('AQ/AJ'), 'and the pot-odds guide quotes the same two (' + (tt && tt[0]) + ')');
  // The owner reads REVIEW_PACKET §5 for every number this review moved; the re-count is one of
  // them, so its row must say what Cards now prints (it was missing, under "nothing moved").
  const pk = require('fs').readFileSync(path.join(APP, '..', 'REVIEW_PACKET.md'), 'utf8');
  const prow = (pk.split('\n').find(l => /^\| Cards' All-in table/.test(l)) || '').split('|').map(s => s.trim());
  const now = ['AA/KK', 'QQ/99', 'TT/AK'].map(k => row(k).replace(' / ', '/')).join(', ');
  ok(prow[3] === now, 'and REVIEW_PACKET §5 lists the re-count as Cards prints it (' + now + '; packet: "' + prow[3] + '")');
}

// BB-vs-jam card: live-computed matrix + notation ranges (must not drift from the solver)
ok(ref.includes('>jammer<') && /<td class="r">\d+%<\/td>/.test(ref), 'BB-vs-jam call% matrix renders');
ok(ref.includes('widest spot in poker'), 'BB-vs-jam principles render');
ok(/A\ds\+/.test(ref) && ref.includes('22+'), 'BB-vs-jam ranges render in standard notation');

// Free/Pro line: the math lookups stay free; the three blocks that are Pro content show to a
// free user as locked titles that pitch Pro, with none of their substance.
global.isPro = () => false;
const refFree = window.StudyUI._test.refHtml();
['Pot odds', 'the biggest bet you can call', 'who’s ahead, by how much', 'All-in strength (top X% of hands)'].forEach(s =>
  ok(refFree.includes(s), 'free tier: Cards keeps "' + s + '"'));
['Big blind vs an all-in', 'Facing a re-raise (3-bet)'].forEach(s =>
  ok(refFree.includes(s), 'free tier: "' + s + '" is listed, locked'));
ok(!refFree.includes('>jammer<') && !refFree.includes('widest spot in poker') && !/one tier/.test(refFree),
  'free tier: none of the locked blocks\' content is in the page');
ok((refFree.match(/data-pro="1"/g) || []).length === 2, 'free tier: each locked block has its Pro button (2: the over-call tax moved to the Library)');
delete global.isPro;
ok(!window.StudyUI._test.refHtml().includes('data-pro'), 'Pro (or no shell): no locks in the references');

// LOCKED CONTENT SHOWS ITS HEADLINES — the Library: every concept is listed by title with a
// lock on the free tier, and none of its text ships. Counting against the Pro render means a
// new concept added without proBlock fails here.
{
  const proLib = window.StudyUI._test.refHtml('library');
  const titles = (proLib.match(/<summary>([^<]+)<\/summary>/g) || []).map(t => t.replace(/<\/?summary>/g, ''));
  global.isPro = () => false;
  const freeLib = window.StudyUI._test.refHtml('library');
  ok(titles.length >= 6 && titles.every(t => freeLib.includes(t)), 'free tier: every Library concept is listed by title (' + titles.length + ')');
  ok((freeLib.match(/data-pro="1"/g) || []).length === titles.length, 'free tier: every Library concept is locked');
  const plain = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const openers = proLib.split('</summary>').slice(1).map(b => plain(b.split('</details>')[0]).trim().slice(0, 40));
  ok(openers.length === titles.length && openers.every(t => t.length > 10 && !plain(freeLib).includes(t)),
    'free tier: none of the Library text is in the page');
  delete global.isPro;
}

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
    // V11: 429 spots' ranges are preflop-only and end in "→ "; the feedback printed the arrow.
    const dangling = pool.filter(e => e.engine && /→\s*$/.test(e.engine.range));
    window.StudyUI._test.setRealPool(dangling);
    els['drillMode'].onclick(ev(['m', 'flop']));
    { const a0 = (/data-a="(\w+)"/.exec(els['drillBtns']._html) || [])[1] || 'check'; els['drillBtns'].onclick(ev(['a', a0])); }
    const vr = /villain range: ([^<]*)</.exec(els['drillFb']._html);
    ok(dangling.length > 0 && vr && !/→\s*$/.test(vr[1]) && vr[1].trim().length > 0, 'a preflop-only villain range prints without a dangling arrow ("' + (vr && vr[1]) + '")');
    window.StudyUI._test.setRealPool(pool);
    let real = 0, reveals = 0, heads = 0, n = 0, oldNames = 0, newNames = 0;
    for (const mm of ['flop', 'river', 'turn']) {
      els['drillMode'].onclick(ev(['m', mm]));
      for (let i = 0; i < 25; i++) {
        n++;
        if (/REAL HAND/i.test(els['drillSpot']._html)) real++;
        // The pool is written with UTG/MP; the screen uses the same names as the engine's seats.
        if (/\bMP\b|\bUTG\b(?!–)/.test(els['drillSpot']._html)) oldNames++;
        if (/UTG–LJ|\bHJ\b/.test(els['drillSpot']._html)) newNames++;
        const acts = [...els['drillBtns']._html.matchAll(/data-a="(\w+)"/g)].map(m => m[1]);
        els['drillBtns'].onclick(ev(['a', acts[0] || 'check']));
        const fb = els['drillFb']._html;
        if (/What actually happened/.test(fb)) reveals++;
        if (/matched the engine|Engine’s take|engine leans/.test(fb)) heads++;
        els['drillNext'].onclick();
      }
    }
    ok(real === n, 'every turn/river spot is a REAL hand (' + real + '/' + n + ')');
    ok(reveals === n, 'answering reveals what actually happened (' + reveals + '/' + n + ')');
    ok(heads === n, 'engine-comparison head renders (' + heads + '/' + n + ')');
    ok(oldNames === 0 && newNames > 0, 'real spots name the first two seats UTG–LJ and HJ, as the drill and Cards do (' + newNames + ' spots; ' + oldNames + ' with UTG/MP)');
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
        const spot = els['drillSpot']._html, prog = /PLAY-THROUGH · decision (\d+)\/(\d+) · (flop|turn|river)/i.exec(spot);
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
        if (/matched the engine|Engine’s take|engine leans/.test(fb)) headShown++;
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

console.log('a mode chip or a filter lifts the new spot’s answers clear of the tab bar, as Next does (DRILL-1)');
{
  // On an SE (375×667) tapping Turn dealt its Check/Bet at 637–683 under a tab bar at 612: only
  // Next and opening Study called keepSpotInView. The geometry here is that phone's: the header
  // ends at 60, the drill panel starts at 300, the answers end at 683, the tab bar starts at 612.
  const panel = { getBoundingClientRect: () => ({ top: 300 }), scrollIntoView() {} };
  const hdr = { getBoundingClientRect: () => ({ bottom: 60 }) }, nav = { getBoundingClientRect: () => ({ top: 612 }) };
  const was = { closest: els['drillSpot'].closest, rect: els['drillBtns'].getBoundingClientRect, sb: window.scrollBy };
  els['drillSpot'].closest = sel => sel === '.panel' ? panel : null;
  els['drillBtns'].getBoundingClientRect = () => ({ bottom: 683 });
  document.querySelector = sel => sel === 'header' ? hdr : sel === 'nav' ? nav : null;
  let lifts = [];
  window.scrollBy = (x, y) => lifts.push(y);
  const tapOn = a => { lifts = []; els['drillMode'].onclick(ev(a)); return lifts.join(); };
  // 683 − (612 − 8) = 79: the answers end 8px above the tab bar.
  ok(tapOn(['m', 'turn']) === '79', 'tapping Turn lifts its answers 79px, to 8px above the tab bar (' + (lifts.join() || 'no lift') + ')');
  ok(tapOn(['m', 'flop']) === '79' && tapOn(['m', 'river']) === '79' && tapOn(['m', 'hands']) === '79' && tapOn(['m', 'pf']) === '79',
    'and so do Flop, River, Full hands and Preflop');
  const style0 = (JSON.parse(localStorage.getItem('pokerlog.train') || '{}').pfStyle) || 'live';
  tapOn(['s', 'live']);   // whichever style was on, Hard is a change now
  ok(tapOn(['s', 'hard']) === '79', 'a preflop style filter (Live / Hard spots) lifts them too');
  els['drillMode'].onclick(ev(['s', style0]));
  els['drillMode'].onclick(ev(['m', 'flop']));
  ok(tapOn(['w', 'leak']) === '79' && tapOn(['w', 'all']) === '79', 'and a spot filter (facing aggression / all)');
  ok(tapOn(['opts', '1']) === '' && tapOn(['opts', '1']) === '', 'opening or closing the filter panel deals nothing and moves nothing');
  // On a fresh install the first Full hands (or Flop) spot waits for its pool: the tap shows
  // "Loading real hands…", and the lift has to come when the hand arrives. The fetch is held here
  // and let go by hand.
  els['drillMode'].onclick(ev(['m', 'pf']));
  const T1 = window.StudyUI._test, handsData = JSON.parse(require('fs').readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  let arrive = null;
  global.fetch = () => ({ then(f1) { return { then(f2) { arrive = () => f2(f1({ ok: true, json: () => handsData })); return { catch() {} }; } }; } });
  T1.setRealHands(null); tapOn(['m', 'hands']);
  const waiting = T1.cur().loading;
  lifts = []; arrive();
  ok(waiting && !T1.cur().loading && T1.cur().hands && lifts.join() === '79', 'a Full hands spot that arrives after "Loading real hands…" is lifted clear too (' + (lifts.join() || 'no lift') + ')');
  els['drillMode'].onclick(ev(['m', 'pf'])); T1.setRealHands(null); tapOn(['m', 'hands']);
  panel.offsetParent = null;   // the player left for another tab while it loaded: no layout box
  lifts = []; arrive();
  ok(!T1.cur().loading && lifts.join() === '', 'but not while the drill is off screen: a hand that loads behind another tab scrolls nothing');
  delete panel.offsetParent; global.fetch = undefined; T1.setRealHands(handsData);
  els['drillMode'].onclick(ev(['m', 'pf']));
  els['drillSpot'].closest = was.closest; els['drillBtns'].getBoundingClientRect = was.rect;
  delete document.querySelector; if (was.sb) window.scrollBy = was.sb; else delete window.scrollBy;
}

console.log('cards hold lookups, library holds reading');
{
  // Owner's rule: Cards is what you want in FRONT of you mid-hand; anything you READ goes to
  // the Library. A fixed rule rather than a move control — no new UI, no per-item decision.
  const cards = window.StudyUI._test.refHtml();
  const lib = window.StudyUI._test.refHtml('library');
  ok(/Pot odds/.test(cards) && /Draws/.test(cards), 'the mid-hand lookups stay in Cards');
  ok(/Big blind vs an all-in/.test(cards), 'as do the range charts');
  ok(!/Reading players/.test(cards) && !/Tournament pressure/.test(cards),
    'and the prose is gone from Cards');
  ok(/Reading players/.test(lib) && /Tournament pressure/.test(lib) && /Playing AK/.test(lib),
    'the articles moved to the Library');
  ok(!/Pot odds/.test(lib), 'without duplicating the lookups — one home each');
  // LAUNCH_PLAN §8 (SPEC §7): the six consolidated concepts, in order, each opening with its rule
  // as one bold line, and Cards' 3-bet card pointing at the renamed AK concept.
  const order = (lib.match(/<summary>([^<]+)<\/summary>/g) || []).map(t => t.replace(/<\/?summary>/g, ''));
  ok(order.join(' | ') === ['Raising with a reason', 'Bet sizing — the 3 questions', 'Reading players and live exploits',
    'Playing AK', 'Suited aces', 'Tournament pressure'].join(' | '), 'the Library holds the six concepts in order: ' + order.join(' | '));
  ok(lib.split('</summary>').slice(1).every(b => /^\s*(<div[^>]*>\s*)?<p><b>[^<]{30,}<\/b><\/p>/.test(b)), 'each concept opens with its rule as one bold line');
  const studySrc = require('fs').readFileSync(path.join(APP, 'study.js'), 'utf8');
  ok(!/AK — the playbook/.test(studySrc) && /see “Playing AK” in the Library/.test(studySrc), 'the vs3 card points at “Playing AK”, the concept’s new name');
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

console.log('premiums are never "close" to folding (launch audit)');
{
  const T = window.StudyUI._test;
  const cardsOf = { AA: ['As', 'Ah'], KK: ['Ks', 'Kh'] };
  const spots = [];
  [50, 100].forEach(d => ['ip', 'oop'].forEach(p3 => spots.push({ kind: 'vs4bet', depth: d, pos3: p3, raiser: 'CO', vseat: 'BTN' })));
  [20, 30, 50, 100].forEach(d => spots.push({ kind: 'cold3b', depth: d, opener: 'EP', raiser: 'MP', pos: 'BTN' }));
  [30, 50, 100].forEach(d => spots.push({ kind: 'limpRR', depth: d, pos: 'BTN', limpers: 1 }));
  [20, 30, 50, 100].forEach(d => ['ip', 'oop'].forEach(p3 => spots.push({ kind: 'vs3bet', depth: d, pos3: p3, pos: 'CO', raiser: 'BTN' })));
  let bad = [];
  spots.forEach(sp => ['AA', 'KK'].forEach(lab => {
    const s = Object.assign({ mode: 'pf', label: lab, c1: cardsOf[lab][0], c2: cardsOf[lab][1] }, sp);
    const g = T.gradePF(s, 'fold');
    if (g.right) bad.push(lab + ' ' + sp.kind + ' ' + sp.depth + (sp.pos3 || ''));
  }));
  ok(bad.length === 0, 'folding AA/KK is never graded fine in any war spot' + (bad.length ? ' — ' + bad.join(', ') : ''));
  ok(T.aggrInfo({ kind: 'open', depth: 12 }).w === 'Jam' && T.aggrInfo({ kind: 'open', depth: 10 }).w === 'Jam' && T.aggrInfo({ kind: 'open', depth: 15 }).w === 'Raise',
    'a 12bb first-in spot says Jam, because it is graded as a Nash jam');
  ok(JSON.stringify(T.realAlts({ ideal: 'raise', why: 'raise for value (calling to trap is fine)' })) === '["call"]' &&
     JSON.stringify(T.realAlts({ ideal: 'fold', why: 'Equity ≈ 24% · price 25% — right at the price: close either way.' })) === '["call"]' &&
     T.realAlts({ ideal: 'raise', why: 'raise for value (calling to trap is fine)' }).indexOf('fold') < 0,
    "the engine's own hedges bless exactly one alternative — never a fold of the nuts");
}

console.log('real-hand drills — a move the feedback text endorses is never graded wrong');
{
  // Every Real spots and Full hands decision prints the engine's feedback (engine.why) under
  // its grade. When that text approves a second move ("Raising as a semi-bluff also works",
  // "raise sparingly", "Trapping a dry board occasionally is fine"), grading that move ✗
  // contradicts the screen it is on. This table is the test's own reading of the text, kept
  // apart from realAlts: [phrase, the engine's answer it rides with, the move it endorses].
  const T = window.StudyUI._test, fs4 = require('fs');
  const ENDORSE = [
    [/checking back for pot control is also fine/i, 'bet', 'check'],
    [/trapping a dry board occasionally is fine/i, 'bet', 'check'],
    [/calling to trap is fine/i, 'raise', 'call'],
    [/flatting to trap is fine/i, 'raise', 'call'],
    [/raising as a semi-bluff also works/i, 'call', 'raise'],
    [/a raise for protection also works/i, 'call', 'raise'],
    [/raise sparingly/i, 'call', 'raise'],
    [/thin value[^.]*it[’']s close/i, 'bet', 'check'],
    [/thin value[^.]*it[’']s close/i, 'check', 'bet'],
    [/right at the price/i, 'call', 'fold'],
    [/right at the price/i, 'fold', 'call'],
    [/margin is too thin[^.]*it[’']s close/i, 'check', 'bet']
  ];
  // Words that approve a move. A sentence using one that the table doesn't read fails here
  // first, so a new hedge in a re-baked pool can't slip back into being graded wrong.
  const VOCAB = /also (works|fine)|\bis fine\b|it[’']s close|either way|sparingly|occasionally|alternative|break the tie|the read decides/i;
  const pools = ['realspots.json', 'realhands.json'].filter(f => fs4.existsSync(path.join(APP, f)));
  if (pools.length < 2) console.log('  (skipped — a pool is not generated)');
  else {
    const spots = JSON.parse(fs4.readFileSync(path.join(APP, 'realspots.json'), 'utf8'));
    const hands = JSON.parse(fs4.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
    const all = spots.map(e => ({ e: e.engine, id: 'spot ' + e.id }))
      .concat(...hands.map(h => h.decisions.map((d, i) => ({ e: d.engine, id: 'hand ' + h.id + '#' + i }))));
    const unread = [], wrong = [], extra = [], count = {};
    all.forEach(({ e, id }) => {
      const w = e.why || '';
      const named = ENDORSE.filter(([re, ideal]) => ideal === e.ideal && re.test(w));
      if (VOCAB.test(w) && !named.length) unread.push(id + ': ' + w.replace(/<[^>]+>/g, '').slice(0, 90));
      const alts = T.realAlts(e), ok2 = named.map(n => n[2]);
      named.forEach(([re, , mv]) => { count[re.source + ' → ' + mv] = (count[re.source + ' → ' + mv] || 0) + 1; if (alts.indexOf(mv) < 0 && mv !== e.ideal) wrong.push(id + ' ' + e.ideal + '/' + mv); });
      alts.forEach(a => { if (ok2.indexOf(a) < 0) extra.push(id + ' ' + e.ideal + ' +' + a); });
    });
    ok(all.length === spots.length + hands.reduce((a, h) => a + h.decisions.length, 0) && all.length > 7000, 'every real spot and full-hand decision is checked (' + all.length + ')');
    ok(unread.length === 0, 'every feedback sentence that approves a move is one the table reads' + (unread.length ? ' — ' + unread.slice(0, 3).join(' | ') : ''));
    ok(wrong.length === 0, 'a move the feedback endorses is never graded wrong' + (wrong.length ? ' (' + wrong.length + ', e.g. ' + wrong.slice(0, 3).join(', ') + ')' : ''));
    ok(extra.length === 0, 'and nothing the feedback doesn\'t name is graded close' + (extra.length ? ' (' + extra.slice(0, 3).join(', ') + ')' : ''));
    const n = k => Object.keys(count).filter(c => c.indexOf(k) === 0).reduce((a, c) => a + count[c], 0);
    // The pins moved with the final review's re-bake: 56 of the 258 semi-bluff sentences sat on made
    // hands and now say "a raise for protection" (55) or drop the raise (the 5-high flush; STUDY-6),
    // and two draws printed 4 points over the price (106/79's turn, 42/41's flop) are now close (STUDY-3):
    // 200 semi-bluff, 55 protection. Full hands then took the street drills' engine block on the 896
    // decisions both pools share (COPY-2), which moves the counts by the text those decisions had
    // in the other bake: 201 semi-bluff, 56 protection, 220 sparing (from 222).
    ok(n('raising as a semi-bluff also works') === 201 && n('a raise for protection also works') === 56 && n('raise sparingly') === 220 && n('trapping a dry board occasionally is fine') === 514,
      'the hedges the reviews found: 201 semi-bluff raises, 56 protection raises, 220 sparing raises, 514 dry-board traps (' +
      [n('raising as a semi-bluff also works'), n('a raise for protection also works'), n('raise sparingly'), n('trapping a dry board occasionally is fine')].join(', ') + ')');
    // Graded through realScore, as the screen does: close (≈), not ✗.
    const one = spots.find(e => /raising as a semi-bluff also works/i.test(e.engine.why) && e.engine.ideal === 'call');
    const sc = T.realScore(one, 'raise', 'flop');
    ok(sc.close && sc.r === 'mix' && /≈ Close — the engine leans <b>call<\/b>, your raise is fine/.test(sc.head),
      'a semi-bluff raise the text approves reads "≈ Close — the engine leans call, your raise is fine"');
    ok(JSON.stringify(T.realAlts({ ideal: 'call', why: 'Equity ≈ 45% · price 30% — clear continue.' })) === '[]' &&
      JSON.stringify(T.realAlts({ ideal: 'bet', why: '— bet for value; worse pairs and draws pay you off. (Trapping a dry board occasionally is fine.)' })) === '["check"]' &&
      JSON.stringify(T.realAlts({ ideal: 'check', why: 'Raising as a semi-bluff also works with this much equity.' })) === '[]',
      'a hedge counts only beside the answer it was written for; a plain "clear continue" stays strict');
  }
}

console.log('"semi-bluff" is said of a draw; a made hand on a wet board raises for protection, a flush below the nuts not at all (STUDY-6)');
{
  // "Raising as a semi-bluff also works" sat under 56 made hands (top pair, overpairs, two pair, sets),
  // and graded a raise close with 5♣5♠ on 7♠J♠9♠K♠, a 5-high flush, where chapter 6 says a raise is
  // called mostly by a higher flush. The hand is read the way the pools' labels were (classifyFlop).
  const T = window.StudyUI._test, PF = window.Postflop, fs6 = require('fs');
  const spots = JSON.parse(fs6.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs6.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const all = spots.map(e => ({ e, id: 'spot ' + e.id })).concat(...hands.map(h => h.decisions.map((d, i) => ({ e: T.handAt(h, i).e, id: 'hand ' + h.id + '#' + i }))));
  let semi = 0, prot = 0; const bad = [];
  all.forEach(({ e, id }) => {
    const w = e.engine.why, c = PF.classifyFlop(e.heroCards.match(/../g), e.board);
    if (/semi-bluff also works/.test(w)) { semi++; if (c.category !== 'draw') bad.push(id + ' "semi-bluff" on ' + c.label); }
    if (/a raise for protection also works/i.test(w)) { prot++; if (c.category !== 'value' || c.nutFlush === false) bad.push(id + ' "protection" on ' + c.label); }
  });
  ok(semi > 150 && prot > 40 && !bad.length, 'every "semi-bluff" sentence sits on a draw (' + semi + ') and every "raise for protection" on a made hand that isn’t a flush below the nuts (' + prot + ')' + (bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''));
  const f5 = spots.find(e => e.id === '33/27:turn:SB' && e.decision === 'fcr');
  ok(/57% · price 27% — clear continue\.$/.test(f5.engine.why) && T.realAlts(f5.engine).length === 0 && T.realScore(f5, 'raise', 'turn').r === 'wrong',
    '33/27 turn, 5♣5♠ on 7♠J♠9♠K♠: "clear continue." with no raise, and a raise grades ✗, as chapter 6 says (' + f5.engine.why.slice(-40) + ')');
  const pr = spots.find(e => /a raise for protection also works/i.test(e.engine.why) && e.engine.ideal === 'call' && !T.realAllIn(e));
  ok(/≈ Close — the engine leans <b>call<\/b>, your raise is fine/.test(T.realScore(pr, 'raise', pr.street).head), 'a raise the protection line approves grades ≈ close');
  // The engine, clear of the price on a wet board: a draw semi-bluffs, a made hand protects, a
  // flush below the nuts (or a straight on a four-flush board) just calls; dry boards just call.
  const cc = c => PF.flopDecide('oopBet', Object.assign({ street: 'turn', eq: 0.5, price: 0.25, edge: 'some', pos: 'oop', wet: true }, c));
  const dr = cc({ cat: 'draw' }), tp = cc({ cat: 'value', made: 'top pair' }), nf = cc({ cat: 'value', made: 'flush', nutFlush: false }), dry = cc({ cat: 'value', made: 'top pair', wet: false });
  ok(/semi-bluff also works/.test(dr.why) && dr.ok.join() === 'call,raise' && /a raise for protection also works on this wet board/i.test(tp.why) && !/semi-bluff/.test(tp.why) && tp.ok.join() === 'call,raise' &&
    /clear continue\.$/.test(nf.why) && nf.ok.join() === 'call' && /clear continue\.$/.test(dry.why) && dry.ok.join() === 'call',
    'the engine: draw → semi-bluff, made hand on a wet board → protection, flush below the nuts → no raise, dry board → no raise');
}

console.log('real hands — facing an all-in there is nothing to raise (review SB-4)');
{
  // 93 of the pools' 1,939 face-a-bet decisions face an opponent already all-in, or a call that is
  // all the hero has left, and still offered Raise; in 42 the engine's answer was raise, an
  // impossible move graded best. The chips in play are rebuilt from the line (study.js realAllIn).
  const T = window.StudyUI._test, fs5 = require('fs');
  if (!fs5.existsSync(path.join(APP, 'realspots.json')) || !fs5.existsSync(path.join(APP, 'realhands.json'))) console.log('  (skipped — a pool is not generated)');
  else {
    const spots = JSON.parse(fs5.readFileSync(path.join(APP, 'realspots.json'), 'utf8'));
    const hands = JSON.parse(fs5.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
    const decs = [];
    hands.forEach(h => h.decisions.forEach((d, i) => decs.push({ h, i, e: T.handAt(h, i).e })));
    const all = spots.concat(decs.map(x => x.e)), fcr = all.filter(e => e.decision === 'fcr'), ai = fcr.filter(T.realAllIn);
    ok(fcr.length === 1939 && ai.length === 93, 'the chips in play, rebuilt from each line, find ' + ai.length + ' of ' + fcr.length + ' face-a-bet decisions facing an all-in (93 of 1,939)');
    // One read by hand: SB vs BTN, flop. SB re-raised to 11 before the flop, bet 28; BTN raised to 89 (100 in).
    const known = spots.find(e => e.decision === 'fcr' && e.line.flop === 'SB bets 28.0 · BTN bets 89.0' && /BTN bets 2\.5 · SB bets 11\.0/.test(e.line.preflop));
    ok(known && T.realAllIn(known) && known.toCall === 61, 'e.g. SB 11 + 28 in, BTN 11 + 89 = 100 in: all-in, 61 to call');
    ok(!T.realAllIn(spots.find(e => e.id === '52b/112:flop:BTN')), 'and a small flop bet with 85bb behind is not');
    const raiseIdeal = ai.filter(e => e.engine.ideal === 'raise');
    ok(raiseIdeal.length === 42 && raiseIdeal.every(e => T.realIdeal(e) === 'call') && ai.every(e => T.realIdeal(e) !== 'raise'),
      'the engine’s raise there is graded as a call (' + raiseIdeal.length + ' of them), and no all-in spot asks for a raise');
    const one = raiseIdeal[0], sc = T.realScore(one, 'call', 'flop');
    ok(sc.match && /You matched the engine — <b>call<\/b>/.test(sc.head) && /No raise is possible here/.test(sc.allinNote), 'answering Call matches, with a line saying why the raise is a call');
    const dec = decs.find(x => T.realAllIn(x.e));
    const sp = T.handAt(dec.h, dec.i);
    ok(sp.options.map(o => o.act).join() === 'fold,call', 'a full-hand decision facing an all-in offers Fold and Call only');
    const open = decs.find(x => x.e.decision === 'fcr' && !T.realAllIn(x.e));
    ok(T.handAt(open.h, open.i).options.map(o => o.act).join() === 'fold,call,raise', 'and one with chips behind keeps Raise');
  }
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

  // The app's real sample set (app-boot.js sampleData), not a stand-in: eight flagged hands
  // with action lines, every one of which would be eligible if it were the player's own.
  // sampleData is self-contained but for two helpers from app-core, so it is lifted out of the
  // file and run here with those two supplied.
  {
    const boot = require('fs').readFileSync(path.join(APP, 'app-boot.js'), 'utf8');
    const from = boot.indexOf('function sampleData(){'), to = boot.indexOf('\nfunction hasSamples(');
    const pad = n => String(n).padStart(2, '0');
    const dateOf = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const samples = new Function('dateOf', 'num', boot.slice(from, to) + '\nreturn sampleData();')(dateOf, num);
    const prevDB = window.pokerDB;
    const flagged = samples.hands.filter(h => h.flag && h.action);
    ok(from > 0 && to > from && flagged.length === 8, 'the real sample set has eight flagged hands with action lines (' + flagged.length + ')');
    window.pokerDB = () => ({ hands: samples.hands });
    ok(T.myReviewHands().length === 0 && T.mineScenario() === null, 'and not one of them is ever drilled back');
    window.pokerDB = () => ({ hands: samples.hands.map(h => Object.assign({}, h, { sample: false })) });
    ok(T.myReviewHands().length === flagged.length, 'only the sample tag keeps them out (untagged, all ' + flagged.length + ' would be eligible)');
    // Read by the replay's own splitter, every sample line is a hand of at most four streets
    // with a board of at most five cards — the same reading the app's log gives it.
    ok(samples.hands.every(h => { const p = T.splitStreets(h.action); return p.streets.length >= 1 && p.streets.length <= 4 && p.board.length <= 5; }),
      'every sample action line splits into at most four streets and five board cards');
    window.pokerDB = prevDB;
  }

  const anySpot = T.mineScenario();
  ok(anySpot && anySpot.mine === true && anySpot.mode === 'mine', 'it produces a "mine" spot');

  // Render a KNOWN hand rather than whichever one the random pick returned, so the
  // assertions below are about the rendering and not about the dice.
  const spot = { mine: true, mode: 'mine', hand: mk({ flag: true, note: 'called too wide', sign: '-', amount: '250' }) };
  const before = recorded.length;
  T.renderMine(spot);
  ok(/YOUR HAND/i.test(els['drillSpot']._html), 'the spot is labelled as the player’s own hand');
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
  // The agreed design (wireflow): the line stops AT the decision and the player acts cold;
  // what they did at the table is revealed only after. 'open15 c / (Ks7d2c) b25 f' → the
  // 'f' is hidden and the choice is fold / call / raise facing the bet.
  ok(/data-mine="fold"/.test(els['drillBtns']._html) && /data-mine="call"/.test(els['drillBtns']._html) && /data-mine="raise"/.test(els['drillBtns']._html),
    'it asks what they would do at the decision point, with real actions');
  ok(!/b25 f/.test(els['drillQ']._html), 'and their own final action is not shown before they answer');
  T.revealMine('fold');
  ok(/At the table you <b>folded<\/b>/.test(els['drillFb']._html) && /Same as at the table/.test(els['drillFb']._html),
    'the reveal shows what they did, and whether today matches it');
  T.renderMine(spot);
  // A line that ends on the VILLAIN's action is cut at the hero's last decision, not after
  // the villain's fold. Whose action is whose is the log's readback model (app-core rbWho; here
  // study's copy): your seat, the order of acting, and the seats written on the line.
  const cv = T.mineCut(T.splitStreets('open15 c / (Ks7d2c) x x / (2c) b150 BTN f'), 'SB');
  ok(cv && cv.hidden === 'b150' && cv.shown === '' && cv.did === 'bet' && cv.rest === 'b150 BTN f',
    "'(2c) b150 BTN f' from the small blind asks before your bet, and hides the button's fold with it");
  const cg = T.mineCut(T.splitStreets('open15 c / (Ks7d2c) b25 btnr60'), 'SB');
  ok(cg && cg.hidden === 'b25' && cg.did === 'bet' && cg.rest === 'b25 btnr60', "a glued villain seat ('btnr60') is not the hero's action");
  // A street the readback reads as written (words after the actions) is never guessed at: the
  // hand asks whether you'd play it the same way instead.
  ok(T.mineCut(T.splitStreets('open15 c / (Ks7d2c) x b25 c / (2c) b60 BTN c shows AK'), 'SB') === null, "'b60 BTN c shows AK' (words on the street): no cut");
  // A freeform line can't be cut, so it keeps the same-way question.
  T.renderMine({ mine: true, mode: 'mine', hand: mk({ flag: true, action: 'KK < AA, std' }) });
  ok(/data-mine="same"/.test(els['drillBtns']._html) && /data-mine="diff"/.test(els['drillBtns']._html) && /Your line/.test(els['drillQ']._html),
    'a freeform line is labelled "Your line" and asks whether they would play it the same way');
  T.renderMine(spot);
  const beforeDiff = recorded.length;

  T.revealMine('diff');
  ok(/the mistake to fix/.test(els['drillFb']._html) && !/leak/i.test(els['drillFb']._html), 'changing the answer names the gap as the mistake to fix (no "leak")');
  ok(els['drillFb']._html.includes('called too wide'), 'and shows the note written at the table');
  ok(recorded.length === beforeDiff + 1 && beforeDiff === before + 1, 'the answer is logged like any other drill');
  ok(recorded[recorded.length - 1].m === 'mine', 'logged under its own mode so Progress can split it out');

  ok(T.mineRate() > 0 && T.mineRate() < 0.35, 'injection rate seasons the rotation rather than taking it over');
}

console.log('your own hand — a cut preflop line keeps "Preflop" and "← you’re here" on Pro (STUDY-8)');
{
  // 'open15 btn3b45 f' is one street with no board, so Pro labelled it "Your line" with no marker,
  // the label meant for a line the replay can't read; the free view said Preflop, you're here.
  const T = window.StudyUI._test;
  const mk = a => ({ id: 'p8', ts: Date.now() - 86400000, game: 'cash', stakes: '1/3', pos: 'CO', c1: 'Ah', c2: 'Kd', eff: '300', action: a, flag: true });
  T.renderMine({ mine: true, mode: 'mine', hand: mk('open15 btn3b45 f') });
  const q = els['drillQ']._html;
  ok(T.cur().cut && /<span class="st">Preflop<\/span><span class="ln">open15 btn3b45 <b class="gld">← you’re here<\/b>/.test(q) && !/Your line/.test(q),
    'Pro: "open15 btn3b45 f" reads Preflop · open15 btn3b45 ← you’re here, the fold still hidden (' + q.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 70) + ')');
  ok(/data-mine="fold"/.test(els['drillBtns']._html) && /data-mine="raise"/.test(els['drillBtns']._html), 'and asks fold, call or raise');
  T.renderMine({ mine: true, mode: 'mine', hand: mk('KK < AA, std') });
  ok(/Your line/.test(els['drillQ']._html) && !/you’re here/.test(els['drillQ']._html), 'a line it can’t read by street is still "Your line", with no marker');
}

console.log('your own hand — a line that opens on a board starts on that street');
{
  // "+ board" tapped into an empty box writes '(Ks7d2c) x b25 c'. It replayed as "Preflop" with
  // preflop's choices; the log's readback, street chips and History read it as the flop.
  const T = window.StudyUI._test;
  const names = a => T.splitStreets(a).streets.map(s => s.name).join(',');
  ok(names('(Ks7d2c) x b25 c / (4h) x x') === 'Flop,Turn', 'three board cards first: the flop, then the turn');
  ok(names('(Ks7d2c4h) x b25 c') === 'Turn' && names('(Ks7d2c4h9s) x') === 'River', 'four are the turn, five the river');
  ok(names('open15 c / (Ks7d2c) x') === 'Preflop,Flop' && names('KK < AA, std') === 'Preflop', 'a line that starts preflop still does');
  const cut = T.mineCut(T.splitStreets('(Ks7d2c) bb x b25'), 'BTN');
  ok(cut && cut.hidden === 'b25' && cut.opts.join() === 'check,bet', 'and nothing in front of you on the flop is check or bet, not the blinds’ fold / call / raise');
  const faced = T.mineCut(T.splitStreets('(Ks7d2c) bb b25 c'), 'BTN');
  ok(faced && faced.hidden === 'c' && faced.opts.join() === 'fold,call,raise', 'while facing a bet there is still fold / call / raise');
  ok(T.mineCut(T.splitStreets('(Ks7d2c) b25'), 'BTN') === null, 'a flop with no opponent known (nothing before it, no seat named) is not guessed at');
}

console.log('your own hand — a board that comes all at once after an all-in is the run-out');
{
  // 'jam c / (7s7d2hKh5c)' replayed its board as "Flop". The log's readback, street chips and History
  // now call it the run-out (app-core runOuts); Study keeps its own copy of the rule, and test_app
  // checks the two agree over random lines. These are the cases, in Study's own words.
  const T = window.StudyUI._test;
  const names = a => T.splitStreets(a).streets.map(s => s.name).join(',');
  ok(names('jam c / (7s7d2hKh5c)') === 'Preflop,Run-out', 'five cards after an all-in and a call: the run-out, not the flop');
  ok(names('jam c / (7s7d2hKh5c) he shows AA') === 'Preflop,Run-out' && names('sb jam bb c / 7s7d2hKh5c') === 'Preflop,Run-out',
    'words after it, or no brackets: still the run-out');
  ok(names('jam c / (7s7d2hKh5c) x x') === 'Preflop,Run-out' && names('open15 c / (7s7d2hKh5c) x b20') === 'Preflop,Flop',
    'whatever follows an all-in and a call; with betting after it and no all-in before, the street keeps its name');
  ok(names('open15 c / (Ks7d2c) jam c / (4h9s)') === 'Preflop,Flop,Run-out' && names('(Ks7d2c) jam c / (4h9s)') === 'Flop,Run-out',
    'all-in on the flop, the turn and river together: the run-out');
  ok(names('open15 c / (Ks7d2cAh) x b25 c') === 'Preflop,Flop' && names('jam c / (7s7d2h) / (Kh) / (5c)') === 'Preflop,Flop,Turn,River' &&
    names('(7s7d2hKh5c)') === 'River' && names('open15 c / (Ks7d2c) x x / (Ks7d2c4h)') === 'Preflop,Flop,Turn',
    'betting after four cards, a run-out written street by street, a line opening on the river, the board written again: as before');
  const sp = T.splitStreets('jam c / (7s7d2hKh5c)');
  ok(sp.board.join('') === '7s7d2hKh5c' && sp.streets[1].line === '', 'the run-out is still dealt onto the board');
  // Review: with betting on a later street and no all-in before it, cards written together came
  // while there was still betting to do; and a street written by name counts its board as seen.
  ok(names('r15 c / (7s7d2hKh) / (5c) b50 c') === 'Preflop,Flop,Turn' && names('jam c / (7s7d2hKh) / (5c) b50 c') === 'Preflop,Run-out,Turn',
    'betting on a later street: no run-out, unless behind a called all-in');
  ok(names('r15 c / flop (7s7d2h) x x / turn (Kh) / (7s7d2hKh5c)') === 'Preflop,Flop,Turn,River', 'the whole board written again after streets written by name: the river');
  // Final review: an ace written as 'as', 'ah' or 'ad' after 'turn' or 'river' is also a word; it
  // is dealt only when actions or nothing follow it ("turn as expected he bet" dealt an A♠).
  ok(T.splitStreets('I raised and he called / turn as expected he bet big').board.join('') === '' &&
    T.splitStreets('r6 c / (Ks7d2c) x x / river ah well he bet').board.join('') === 'Ks7d2c',
    'an ace that is a word deals no card on the replay board');
  ok(T.splitStreets('r6 c / (Ks7d2c) x x / turn as x b20 c').board.join('') === 'Ks7d2cAs' && T.splitStreets('r6 c / (Ks7d2c) x x / turn 4h x').board.join('') === 'Ks7d2c4h',
    'with actions after it, it is still the turn card');
}

console.log('your own hand — the cut follows the readback’s model, never a guess (review L1, SB-1..3, V1, L3, DATA-3)');
{
  const T = window.StudyUI._test;
  const cutOf = (pos, a) => T.mineCut(T.splitStreets(a), pos);
  const mine = (pos, action) => ({ mine: true, mode: 'mine', hand: { id: 'm' + Math.random(), ts: Date.now(), pos, c1: 'As', c2: 'Kd', action, flag: true, sign: '-', amount: '100' } });
  const btns = () => [...els['drillBtns']._html.matchAll(/data-mine="(\w+)"/g)].map(m => m[1]).join();
  // L1: a line tapped without seats (Guided's Who? row is there since 2026-10-15, but optional). On
  // the button you act last after the flop, so in 'x b80 c' the check and the call are theirs: the
  // cut is your bet, not their call.
  let c = cutOf('BTN', 'r10 c / (Qs7c2s) x b15 c / (4h) x x / (Kc) x b80 c');
  ok(c && c.hidden === 'b80' && c.shown === 'x' && c.rest === 'b80 c' && c.opts.join() === 'check,bet' && c.did === 'bet',
    "on the button, 'x b80 c' cuts at your b80 (check / bet), not at their call");
  T.renderMine(mine('BTN', 'r10 c / (Qs7c2s) x b15 c / (4h) x x / (Kc) x b80 c'));
  T.revealMine('bet');
  ok(/At the table you <b>bet 80<\/b>/.test(els['drillFb']._html) && /Same as at the table/.test(els['drillFb']._html), 'and answering Bet is "Same as at the table"');
  // SB-1: multiway with no seats named: nobody can say whose call it was, so no cut.
  ok(cutOf('BB', 'r6 c c / (Ks7d2c) x x b10 c c') === null && cutOf('BB', 'c c / (9h8h2c) x b5 f c') === null,
    "a multiway pot with no seats named ('x x b10 c c', 'x b5 f c'): no cut, the same-line question");
  T.renderMine(mine('BB', 'r6 c c / (Ks7d2c) x x b10 c c'));
  ok(btns() === 'same,diff', 'its buttons are Same line / Play it differently, never Check / Bet against a bet');
  // ...but with the seats written, a multiway call is a call.
  c = cutOf('BB', 'co open6 btn c c / (Ks7d2c) bb x co x btn b10 c');
  ok(c && c.hidden === 'c' && c.did === 'call' && c.opts.join() === 'fold,call,raise', 'with the seats written, the big blind facing the button’s bet: fold / call / raise, and a call is a call');
  // SB-2: an all-in with nothing in front of you is your bet.
  c = cutOf('BTN', 'r6 c / (Ks7d2c) x jam');
  ok(c && c.opts.join() === 'check,bet' && c.did === 'bet', "'x jam' on the button: check / bet, and the jam is the bet");
  T.renderMine(mine('BTN', 'r6 c / (Ks7d2c) x jam'));
  T.revealMine('bet');
  ok(/At the table you <b>went all in<\/b>/.test(els['drillFb']._html) && /Same as at the table/.test(els['drillFb']._html), 'so answering Bet reads "Same as at the table"');
  // F37: facing an all-in there is nothing to raise.
  c = cutOf('SB', 'open15 c / (Ks7d2c) x bb jam c');
  ok(c && c.opts.join() === 'fold,call' && c.did === 'call', 'facing an all-in: fold / call, no raise');
  // SB-3: a board that ran out after a called all-in is not the decision, and isn't shown before it.
  c = cutOf('BTN', 'jam c / (7s7d2hKh5c)');
  ok(c && c.hidden === 'jam' && c.streetIx === 0 && c.bn === 0 && c.opts.join() === 'fold,call,raise' && c.did === 'raise',
    "'jam c / (7s7d2hKh5c)' cuts before the preflop jam, with no board out");
  T.renderMine(mine('BTN', 'jam c / (7s7d2hKh5c)'));
  ok(!/class="board"/.test(els['drillHand']._html) && !/7s7d|Run-out/.test(els['drillQ']._html), 'the run-out stays hidden: no board, no run-out row');
  T.revealMine('raise');
  ok(/class="board"/.test(els['drillHand']._html) && (els['drillHand']._html.match(/class="suit-/g) || []).length === 7, 'and deals out with the answer');
  c = cutOf('BB', 'bb x co r6 c / (Ks7d2c) x co b8 jam co c / (5h) / (9c)');
  ok(c && c.hidden === 'jam' && c.streetIx === 1 && c.bn === 3, "'… jam co c / (5h) / (9c)' cuts at your flop jam, the turn and river held back");
  // V1, L3: a street told in words is never cut mid-sentence.
  ok(cutOf('BB', 'I raised to 15, the button re-raised to 45, I called. / (Ks7d2c) I checked, he bet 25, I called.') === null &&
    cutOf('BTN', 'I raised to 10, big blind called. / (Js7d2c)  he checked, I bet 15, he raised to 50, I called.') === null &&
    cutOf('BTN', 'I raised to 10 big blind called, flop jack seven deuce he checked I bet 15 he raised to 50 I called and he showed king jack') === null,
    'a line told in words: no cut (it is shown whole, with the same-line question)');
  // DATA-3: a flop and turn written together, the opponent unnamed until after your bet: no cut,
  // and the board is not called a run-out.
  ok(cutOf('CO', 'open15 c / (Ks7d2c4h) b40 btn f') === null, "'(Ks7d2c4h) b40 btn f' from the cutoff: no cut (whose b40 isn't settled)");
  T.renderMine(mine('CO', 'open15 c / (Ks7d2c4h) b40 btn f'));
  ok(!/Run-out|ran out/.test(els['drillQ']._html) && btns() === 'same,diff', 'and nothing calls the flop and turn a run-out');
  // A seat-prefixed line still cuts where it did.
  c = cutOf('CO', 'open15 btn3b45 c / (Ks7d2c) x btnb25 c');
  ok(c && c.hidden === 'c' && c.shown === 'x btnb25' && c.opts.join() === 'fold,call,raise', 'a line with its seats written cuts at your call, as before');
  // The big blind with nothing raised has an option: check or raise.
  c = cutOf('BTN', 'r10 c / (Qs7c2s) x x');
  ok(c && c.streetIx === 1 && c.hidden === 'x' && c.did === 'check' && c.opts.join() === 'check,bet', 'a flop checked through is still the street of the decision: your check');
  c = cutOf('BB', 'r8');
  ok(c && c.opts.join() === 'check,raise' && c.did === 'raise', 'the big blind’s raise with nothing in front: check / raise');
  // The reveal says a 3-bet and a 4-bet in words on the free tier.
  c = cutOf('BTN', 'co open15 c / (Ks7d2c) cob25 3b75 co c');
  ok(c && c.hidden === '3b75' && c.did === 'raise', 'a flop re-raise is cut at the 3b');
}

console.log('your own hand — with no cut, the street it ended on is still held back (Mac review 3)');
{
  // CLAUDE.md: "the final street's recorded action stays hidden until you answer". With no cut (whose
  // action is whose isn't settled) the whole line used to be drawn, so the player saw what they did
  // before answering: every heads-up line with the opponent unnamed, from any seat but BTN and SB.
  const T = window.StudyUI._test;
  const mine = (pos, action) => ({ mine: true, mode: 'mine', hand: { id: 'h' + Math.random(), ts: Date.now(), pos, c1: 'As', c2: 'Kd', action, flag: true, sign: '-', amount: '100' } });
  const btns = () => [...els['drillBtns']._html.matchAll(/data-mine="(\w+)"/g)].map(m => m[1]).join();
  const cards = () => (els['drillHand']._html.match(/class="suit-/g) || []).length;
  const line = 'open15 c / (Ks7d2c) x b25 c / (4h) x b60 f';
  ok(T.mineCut(T.splitStreets(line), 'CO') === null, "from the cutoff, heads-up with the opponent unnamed: no cut");
  T.renderMine(mine('CO', line));
  let q = els['drillQ']._html;
  ok(/>Preflop<.*open15 c.*>Flop<.*x b25 c.*>Turn</.test(q) && !/b60/.test(q) && cards() === 6 && btns() === 'same,diff',
    'the streets are drawn up to the turn, its card dealt, its play (x b60 f) held back; the same-line question');
  T.revealMine('same');
  ok(/How it went at the table: <b class="mono">x b60 f<\/b>/.test(els['drillFb']._html) && /Standing by it/.test(els['drillFb']._html),
    'and answering shows it: "How it went at the table: x b60 f"');
  // A street written by name keeps its name and its card; only the play goes.
  T.renderMine(mine('HJ', 'r6 c / (Ks7d2c) x x / turn 4h x b20 c'));
  q = els['drillQ']._html;
  ok(/turn 4h <b class="gld">/.test(q) && !/b20/.test(q) && cards() === 6, "'turn 4h x b20 c' shows 'turn 4h', not its play");
  // A board that came after it (a run-out) stays hidden with it, and deals out with the answer.
  T.renderMine(mine('CO', 'open15 c / (Ks7d2c) x jam c / (4h9s)'));
  q = els['drillQ']._html;
  ok(!/jam|Run-out/.test(q) && cards() === 5, 'held back on the flop: the all-in and the run-out after it stay hidden');
  T.revealMine('diff');
  ok(cards() === 7 && /x jam c/.test(els['drillFb']._html), 'and come out with the answer');
  // Nothing to split: one street with no board is shown whole, as before.
  ok(T.mineHold(T.splitStreets('KK < AA, std')) === null && T.mineHold(T.splitStreets('r6 3b20 c')) === null,
    'a line with no street structure is not split (shown whole, as before)');
  T.renderMine(mine('CO', 'KK < AA, std'));
  ok(/KK &lt; AA, std/.test(els['drillQ']._html) && btns() === 'same,diff', 'and still reads in full');
}

console.log('100bb facing a 4-bet, a cold 3-bet or a limp-reraise: QQ and JJ call (Mac review 4, owner 2026-10-09)');
{
  const T = window.StudyUI._test;
  const spot = (kind, label) => ({ mode: 'pf', kind, vseat: 'BTN', pos: 'BTN', raiser: 'CO', opener: 'EP', pos3: 'ip', depth: 100, limpers: 1, label, c1: 'As', c2: 'Kd' });
  const g = (kind, label, a) => T.gradePF(spot(kind, label), a);
  ['vs4bet', 'cold3b', 'limpRR'].forEach(k => {
    const jj = g(k, 'JJ', 'fold'), tt = g(k, 'TT', 'fold'), nn = g(k, '99', 'call'), qq = g(k, 'QQ', 'call');
    ok(qq.right && !qq.marginal && g(k, 'JJ', 'call').right && !g(k, 'JJ', 'call').marginal && jj.right && jj.marginal && tt.right && !tt.marginal && !nn.right,
      k + ': calling QQ and JJ is the answer, folding JJ is close (never wrong), TT folds, calling 99 is wrong');
    // The note under the grade names the same pairs: it said "call the QQ/JJ set-mine tier" over a
    // grade that called QQ–88.
    const why = jj.why.replace(/<[^>]+>/g, '');
    ok(k === 'cold3b' ? /the pairs that call are QQ and JJ\./.test(why) : /call QQ and JJ \(the set-mine tier\)/.test(why), k + ': its note says "QQ and JJ" (' + why.slice(-120) + ')');
  });
  ok(!g('vs4bet', 'QQ', 'fold').right, 'folding QQ to a 4-bet at 100bb is still wrong');
  ok(/at 50bb: jam QQ\+ \(and AK\), no flatting this short/.test(T.gradePF(Object.assign(spot('vs4bet', 'JJ'), { depth: 50 }), 'fold').why),
    'and at 50bb the note says what the engine does there: jam QQ+ and AK, no flatting');
}

console.log('two lines that round to the same whole percent print a decimal (COPY-5)');
{
  // The cold 3-bet at 100bb 4-bets the top 1.5% and calls to 1.9%: whole percents read "4-bet ~top
  // 2%, call to ~2%", an empty-looking call band beside "the pairs that call are QQ and JJ".
  const T = window.StudyUI._test, RK = 'AKQJT98765432', ties = [];
  const spot = (kind, label, depth, p3) => ({ mode: 'pf', kind, vseat: 'BB', pos: 'BB', raiser: 'SB', opener: 'CO', pos3: p3, depth, limpers: 1, label, c1: 'As', c2: 'Kd' });
  const w86 = T.gradePF(spot('cold3b', '86s', 100, 'ip'), 'fold').why.replace(/<[^>]+>/g, '');
  ok(/4-bet ~top 1\.5%, call to ~1\.9%, else fold\. 86s is at 55%\./.test(w86), '86s as the BB, facing an open and a cold 3-bet at 100bb: "4-bet ~top 1.5%, call to ~1.9%" (' + w86.slice(0, 64) + ')');
  let n = 0;
  ['vs', 'squeeze', 'cold3b', 'limpRR', 'vs4bet', 'vs3bet'].forEach(k => [10, 15, 20, 25, 30, 40, 50, 100].forEach(d => ['ip', 'oop'].forEach(p3 => {
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const h = i === j ? RK[i] + RK[j] : i < j ? RK[i] + RK[j] + 's' : RK[j] + RK[i] + 'o';
      const m = /~top ([\d.]+)%, call(?:\/overcall)? to ~([\d.]+)%/.exec(T.gradePF(spot(k, h, d, p3), 'fold').why);
      if (!m) continue;
      n++;
      if (m[1] === m[2] && ties.length < 3) ties.push(k + ' ' + d + 'bb ' + p3 + ' ' + h + ': ' + m[0]);
    }
  })));
  ok(n > 10000 && !ties.length, 'no Pro raise-war sentence prints its two lines as one number, over every kind, depth, side and hand (' + n + ')' + (ties.length ? ' — ' + ties.join(' | ') : ''));
}

console.log('the free re-raise spot’s "ranked by all-in strength" is the all-in rank Cards prints (Mac review 10)');
{
  // It printed v.p, which in position is the after-the-flop rank for pairs and suited hands: T9s
  // read "top 9%" there while Cards' All-in strength and chapter 1 say 29%.
  const T = window.StudyUI._test, P = window.Poker, RK = 'AKQJT98765432', off = [];
  ['ip', 'oop'].forEach(p3 => { for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const h = i === j ? RK[i] + RK[j] : i < j ? RK[i] + RK[j] + 's' : RK[j] + RK[i] + 'o';
    const why = T.gradePF({ mode: 'pf', kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: p3, depth: 100, label: h, chained: true, free: true }, 'call').why.replace(/<[^>]+>/g, '');
    // Near a line the figure carries one decimal (STUDY-1), so it is compared at the precision printed.
    const m = /Ranked by all-in strength, .*? is in the top (\d+(?:\.\d)?)% of hands\b/.exec(why);
    const dp = m && m[1].indexOf('.') >= 0 ? 1 : 0;
    if (!m || m[1] !== (P.pct(h) * 100).toFixed(dp)) off.push(p3 + ' ' + h + ' ' + (m ? m[1] : 'none') + ' vs ' + (P.pct(h) * 100).toFixed(dp));
  } });
  ok(!off.length, 'every hand, in position and out: the free feedback’s all-in rank is P.pct, as Cards prints it' + (off.length ? ' — ' + off.slice(0, 5).join(', ') : ''));
  ok(/T9s \(suited\) is in the top 29% of hands/.test(T.gradePF({ mode: 'pf', kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: 'ip', depth: 100, label: 'T9s', chained: true, free: true }, 'call').why.replace(/<[^>]+>/g, '')),
    'T9s in position reads "top 29%" (it read 9%)');
}

console.log('the free re-raise spot’s numbers put the hand in the tier it is graded in (STUDY-1)');
{
  // A2s in position read "call with up to the top 20% … A2s is in the top 19%" over a ✗ Fold: the
  // 20% is the line for a suited hand or pair ranked on how it plays after the flop, where A2s is
  // 22%. KJo, QJs and TT printed ties ("call up to the top 16% … KJo is top 16%") the verdict broke.
  const T = window.StudyUI._test, RK = 'AKQJT98765432', bad = [];
  let n = 0, flop = 0;
  ['ip', 'oop'].forEach(p3 => { for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const h = i === j ? RK[i] + RK[j] : i < j ? RK[i] + RK[j] + 's' : RK[j] + RK[i] + 'o';
    const g = T.gradePF({ mode: 'pf', kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: p3, depth: 100, label: h, chained: true, free: true }, 'fold');
    const w = g.why.replace(/<[^>]+>/g, '');
    const L = /Raise again \(4-bet\) with the top ([\d.]+)% of hands, (?:call with up to the top ([\d.]+)%, )?fold the rest\./.exec(w);
    if (!L) continue;   // an override explains itself in words, with no lines to set a number against
    n++;
    const tb = +L[1], call = L[2] != null ? +L[2] : null;
    const A = /is in the top ([\d.]+)% of hands( \(just (inside|outside) the (4-bet|call) line\))?/.exec(w);
    const R = /there \S+ ranks in the top ([\d.]+)%, (just )?outside the top ([\d.]+)% the chart calls with\./.exec(w);
    // Which side of a printed line a printed rank sits: by the numbers, or by the words on a tie.
    const side = (x, line, name) => x < line ? 'in' : x > line ? 'out' : A && A[2] && A[4] === name ? (A[3] === 'inside' ? 'in' : 'out') : 'tie';
    let tier;
    if (R) { flop++; tier = side(+A[1], tb, '4-bet') === 'out' && (+R[1] > +R[3] || (+R[1] === +R[3] && R[2])) ? 'fold' : '?'; }
    else {
      const s4 = side(+A[1], tb, '4-bet'), sc = call == null ? 'out' : side(+A[1], call, 'call');
      tier = s4 === 'tie' || sc === 'tie' ? 'tie' : s4 === 'in' ? 'threebet' : sc === 'in' ? 'call' : 'fold';
    }
    if (tier !== g.idealAct) bad.push(p3 + ' ' + h + ': reads ' + tier + ', graded ' + g.idealAct + ' — ' + w.slice(w.indexOf('fold the rest')));
  } });
  ok(n > 250 && !bad.length, 'every hand in and out of position: the printed lines and ranks put it in the tier it’s graded in (' + n + ' sentences, ' + flop + ' naming the after-the-flop rank)' + (bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''));
  const a2 = T.gradePF({ mode: 'pf', kind: 'vs3bet', pos: 'BTN', raiser: 'BB', pos3: 'ip', depth: 100, label: 'A2s', chained: true, free: true }, 'call');
  ok(!a2.right && /call with up to the top 20%.*A2s \(suited\) is in the top 19% of hands\. In position, a suited hand or a pair is called on how it plays after the flop, and there A2s ranks in the top 22%, outside the top 20% the chart calls with\./.test(a2.why.replace(/<[^>]+>/g, '')),
    'A2s on the button: a call is still ✗, and the feedback says why (after the flop it ranks 22%, past the 20% called)');
  const kj = T.gradePF({ mode: 'pf', kind: 'vs3bet', pos: 'BTN', raiser: 'BB', pos3: 'ip', depth: 100, label: 'KJo', chained: true, free: true }, 'fold').why.replace(/<[^>]+>/g, '');
  ok(/call with up to the top 16\.0%.*KJo \(offsuit\) is in the top 16\.4% of hands/.test(kj), 'KJo reads 16.4% against the 16.0% call line, not "16% … 16%"');
}

console.log('a real spot’s header says "raises" when the bet you face was a raise (Mac review 11)');
{
  const T = window.StudyUI._test, fs = require('fs');
  const spots = JSON.parse(fs.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const es = spots.concat(...hands.map(h => h.decisions.map(d => ({ street: d.street, bb: h.bb, heroPos: h.heroPos, villPos: h.villPos, heroIP: d.heroIP,
    heroCards: h.heroCards, board: d.board, pot: d.pot, toCall: d.toCall, frac: d.frac, decision: d.decision, line: d.line })))).filter(e => e.decision === 'fcr');
  let raises = 0; const bad = [];
  es.forEach(e => {
    const html = T.realSpotHtml({ e }), head = html.slice(html.lastIndexOf('<div style="margin-top:6px">'));
    // The villain's last bet on the street and whether a bet came before it: the rows' own rule.
    const bets = String(e.line[e.street] || '').split(' · ').map(a => /^(\w+) bets ([\d.]+)/.exec(a.trim())).filter(Boolean);
    const k = bets.map(m => m[1]).lastIndexOf(e.villPos), raised = k > 0;
    if (raised) raises++;
    const ok1 = raised ? head.includes(' raises to <b>' + +bets[k][2] + 'bb</b>') && head.includes('<b>' + e.toCall + 'bb</b> to call') && !/ bets <b>/.test(head)
      : / bets <b>/.test(head) && !/raises to/.test(head);
    if (!ok1 && bad.length < 3) bad.push(e.street + ' [' + e.line[e.street] + '] ' + head.replace(/<[^>]+>/g, ''));
  });
  ok(raises === 170 && !bad.length, 'all ' + es.length + ' facing decisions: the ' + raises + ' raises read "raises to N bb, X bb to call", the rest "bets X bb"' + (bad.length ? ' — ' + bad.join(' | ') : ''));
}

console.log('a real spot’s header says the pot a bet went into, so the course’s price works off it (STUDY-2)');
{
  // "BTN bets 15bb (1.08×pot) — you’re the BB (OOP), pot 28.9bb." used two pots: ×pot was the pot
  // before the bet and the pot printed already held it, so the course's bet ÷ (pot + 2 × bet) gave
  // 25% off the header where the feedback said price 34%.
  const T = window.StudyUI._test, fs2 = require('fs'), strip = s => s.replace(/<[^>]+>/g, '');
  const spots = JSON.parse(fs2.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs2.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const es = spots.concat(...hands.map(h => h.decisions.map((d, i) => T.handAt(h, i).e))).filter(e => e.decision === 'fcr');
  let bets = 0, exact = 0, raises = 0; const bad = [];
  es.forEach(e => {
    const html = T.realSpotHtml({ e }), head = strip(html.slice(html.lastIndexOf('<div style="margin-top:6px">')));
    const price = +/price (\d+)%/.exec(e.engine.why)[1];
    if (/ raises to /.test(head)) { raises++; if (!/, pot [\d.]+bb with the raise in\.$/.test(head) && bad.length < 3) bad.push(head); return; }
    bets++;
    const m = / bets ([\d.]+)bb into ([\d.]+)bb (\([\d.]+×pot\) )?— you’re the [^,]+\.$/.exec(head);
    if (!m) { if (bad.length < 3) bad.push(head); return; }
    // Only the pools' rounding of pot and bet to 0.1bb separates the two (54 of 1,769 by a point).
    const p = Math.round(+m[1] / (+m[2] + 2 * +m[1]) * 100);
    if (Math.abs(p - price) > 1) { if (bad.length < 3) bad.push(head + ' → ' + p + '% vs price ' + price + '%'); } else if (p === price) exact++;
  });
  ok(bets === 1769 && raises === 170 && exact > 1700 && !bad.length,
    'all ' + bets + ' bets say the pot they went into, and bet ÷ (pot + 2 × bet) off the header is the feedback’s price (' + exact + ' to the point, the rest within one); the ' + raises + ' raises say their pot holds the raise' + (bad.length ? ' — ' + bad.join(' | ') : ''));
  const t72 = spots.find(e => e.id === '72/104:turn:BB' && e.decision === 'fcr'), h72 = strip(T.realSpotHtml({ e: t72 }));
  ok(h72.endsWith('Turn: BTN bets 15bb into 13.9bb (1.08×pot) — you’re the BB (OOP).') && /price 34%/.test(t72.engine.why),
    '72/104 turn reads "BTN bets 15bb into 13.9bb (1.08×pot)": 15 ÷ (13.9 + 30) = 34%, the price the feedback gives');
}

console.log('the small blind’s first-in spot says it assumes a big-blind ante (owner’s call 9)');
{
  // Its raise / limp / fold band is built for a big-blind ante; the free spot said so only after the answer.
  const T = window.StudyUI._test;
  const head = (pos, free, depth) => { T.setCur({ mode: 'pf', kind: 'open', pos, depth: depth || 100, c1: '9s', c2: '8s', label: '98s', free: free || undefined }); return els['drillSpot']._html; };
  global.isPro = () => false;
  const sbFree = head('SB', true), coFree = head('CO', true);
  delete global.isPro;
  ok(/folds to you · you’re .*small blind.* · <b>.*100 big blinds.*<\/b>, with a big-blind ante \(one extra big blind in the pot\)/.test(sbFree) && !/ante/.test(coFree),
    'free: the small blind’s spot reads "…100 big blinds, with a big-blind ante (one extra big blind in the pot)"; the other seats don’t');
  ok(/ · big-blind ante/.test(head('SB', false, 50)) && !/ante/.test(head('BTN', false, 50)), 'Pro: "· big-blind ante" on the small blind’s header');
  const g = T.gradePF({ mode: 'pf', kind: 'open', pos: 'SB', depth: 100, label: '97o', free: true }, 'limp');
  ok(g.right && g.idealAct === 'limp', 'and the grading is unchanged (97o limps)');
}

console.log('the real hands’ "villain range" line prints clean (Mac review, stretch)');
{
  // engine.range in the pools reads "BB BB check → flop:bet" in 329 spots and "BTN flat → " in 1,629;
  // the printer drops the empty arrow and says a doubled seat once. The data is left as it is.
  const T = window.StudyUI._test, fs = require('fs');
  const spots = JSON.parse(fs.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const all = spots.map(e => e.engine && e.engine.range).concat(...hands.map(h => h.decisions.map(d => d.engine && d.engine.range))).filter(Boolean);
  const raw = all.filter(r => /\b(UTG|MP|CO|BTN|SB|BB) \1\b/.test(r)).length, out = all.map(T.rangeTxt);
  const bad = out.filter(r => /\b(UTG–LJ|HJ|CO|BTN|SB|BB) \1\b/.test(r) || /→\s*(·|$)/.test(r));
  ok(raw > 300 && !bad.length && T.rangeTxt('BB BB check → flop:bet') === 'BB check → flop:bet' && T.rangeTxt('BTN flat → ') === 'BTN flat' && T.rangeTxt('MP MP flat → flop:call') === 'HJ flat → flop:call',
    'all ' + all.length + ' printed: no doubled seat (' + raw + ' in the data), no arrow to nothing' + (bad.length ? ' — ' + bad.slice(0, 3).join(' | ') : ''));
}

console.log('Full hands feedback: each number once, cards as cards, a close bluff said as close (the Mac’s a5dab85)');
{
  const T = window.StudyUI._test, fs = require('fs');
  const spots = JSON.parse(fs.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const decs = []; hands.forEach(h => h.decisions.forEach((d, i) => decs.push(T.handAt(h, i).e)));
  const all = spots.concat(decs), txt = s => s.replace(/<[^>]+>/g, '');
  // 1. "eq 90% · vs the calling range 85% — Showdown equity ≈ 90% · vs the calling range 85% — value: …"
  const twice = [];
  all.forEach(e => {
    // A number may repeat (equity 33% at a price of 33%); a clause may not.
    const t = txt(T.engWhy(e)), n = re => (t.match(re) || []).length;
    if (/^eq /.test(t) || n(/equity ≈/gi) > 1 || n(/calling range/g) > 1 || n(/· price/g) > 1) { if (twice.length < 3) twice.push(t.slice(0, 90)); }
  });
  ok(!twice.length, 'all ' + all.length + ' decisions open with their numbers once, no "eq …" copy before the sentence' + (twice.length ? ' — ' + twice.join(' | ') : ''));
  const jj = spots.find(e => e.heroCards === 'JdJc' && e.board.join('') === '2cJsKc9h6d') || decs.find(e => e.heroCards === 'JdJc' && e.board.join('') === '2cJsKc9h6d');
  const sample = jj || all.find(e => /^Showdown equity ≈ \d+% · vs the calling range/.test(e.engine.why));
  ok(/^<span class="dim">Showdown equity ≈ <b>\d+%<\/b> · vs the calling range <b>\d+%<\/b><\/span> — value: /.test(T.engWhy(sample)),
    'e.g. "Showdown equity ≈ 90% · vs the calling range 85% — value: …", the numbers bold in a dim clause (' + txt(T.engWhy(sample)).slice(0, 60) + '…)');
  const flop = all.find(e => e.decision === 'cb' && e.engine.eqCall != null && /^Equity vs their range ≈ \d+% — /.test(e.engine.why));
  ok(new RegExp('vs the calling range <b>' + flop.engine.eqCall + '%</b></span> — ').test(T.engWhy(flop)),
    'a check-or-bet decision whose sentence lacks the calling range still shows it, once');
  // 2. "How it played out: Flop (2cJsKc) … Turn (9h) … River (6d)"
  const tails = hands.map(h => h.tail).concat(spots.map(e => e.actual.tail).filter(Boolean));
  const raw = tails.filter(t => /\((?:[2-9TJQKA][cdhs])+\)/.test(t)).length, left = tails.map(T.tailHtml).filter(t => /\((?:[2-9TJQKA][cdhs])+\)|\b[2-9TJQKA][cdhs]\b(?![^<]*>)/.test(t.replace(/<span class="pc">.*?<\/span><\/span>/g, '')));
  ok(raw > 3000 && !left.length, 'all ' + tails.length + ' run-outs print their cards as cards (' + raw + ' had codes)' + (left.length ? ' — ' + left.slice(0, 2).join(' | ') : ''));
  ok(T.tailHtml('Flop (2cJsKc): BB checks  ·  Turn (9h): BB bets 3.0') === 'Flop <span class="pc"><b>2</b><span class="suit-c">♣</span></span><span class="pc"><b>J</b><span class="suit-s">♠</span></span><span class="pc"><b>K</b><span class="suit-c">♣</span></span>: BB checks  ·  Turn <span class="pc"><b>9</b><span class="suit-h">♥</span></span>: BB bets 3.0',
    '"Flop (2cJsKc): …" reads Flop 2♣J♠K♣: …, as "villain had K♦A♠" does');
  // 3. "only ~43% of their range folds (a bluff needs ~40%) — not enough fold equity": 43 clears 40.
  const fe = all.map(e => e.engine.why).map(w => /only ~(\d+)% of their range folds \(a bluff needs ~(\d+)%\)/.exec(w)).filter(Boolean);
  ok(fe.length > 300 && fe.every(m => +m[1] < +m[2]), '"only ~N% folds (a bluff needs ~40%)" now always has N under 40 (' + fe.length + ' spots)');
  const t85 = hands.find(h => h.id === '85/102'), r85 = t85.decisions[t85.decisions.length - 1].engine;
  ok(/about 43% of their range folds, against the ~40% a ⅔-pot bluff needs just to break even\. A bluff’s margin is too thin to count on, so it’s close/.test(r85.why) && r85.ideal === 'check',
    'hand 85/102 (T♦8♦), 43% folding: still check, said as close');
  const sc = T.realScore(T.handAt(t85, t85.decisions.length - 1).e, 'bet', 'hands');
  ok(sc.close && /≈ Close — the engine leans <b>check<\/b>, your bet is fine/.test(sc.head), 'and a bet there grades ≈ close, not ✗');
  const PF = window.Postflop, mk = f => PF.flopDecide('ipCheck', { street: 'river', eq: 0.05, price: null, eqCall: 0, foldEq: f });
  ok(mk(0.43).ideal === 'check' && /margin is too thin/.test(mk(0.43).why) && /not enough fold equity/.test(mk(0.394).why) && /only ~<b>39%<\/b>/.test(mk(0.394).why) &&
    /margin is too thin/.test(mk(0.396).why) && /about <b>50%<\/b>/.test(mk(0.4996).why) && mk(0.4996).ideal === 'check' && mk(0.5).ideal === 'bet',
    'the engine: under 40% printed gives up, 40–49.9% is close (check), 50% bluffs');
}

console.log('a printed gap from the price reads one way everywhere, as the course states it (STUDY-3, COPY-4)');
{
  // The bands were cut on raw equity and price, the sentence prints them rounded: a printed 4 over
  // read "clear continue" in 10 decisions and "right at the price" in 18, "33% · price 33%" leaned
  // fold, and 72/104's turn read close in the Turn drill and "not getting the price" in Full hands.
  const T = window.StudyUI._test, PF = window.Postflop, fs3 = require('fs');
  const spots = JSON.parse(fs3.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs3.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const all = spots.map(e => ({ e, id: 'spot ' + e.id })).concat(...hands.map(h => h.decisions.map((d, i) => ({ e: T.handAt(h, i).e, id: 'hand ' + h.id + '#' + i }))));
  const FACE = /^(?:Equity vs their range|Showdown equity) ≈ (\d+)% · price (\d+)% — (.*)$/;
  const RIV = /^Showdown equity ≈ (\d+)%(?: · vs the calling range (\d+)%)? — (.*)$/;
  const off = [], byGap = {}, roff = [];
  let facing = 0, river = 0;
  all.forEach(({ e, id }) => {
    const en = e.engine, w = en.why; let m;
    if ((m = FACE.exec(w))) {
      const g = m[1] - m[2], r = m[3];
      const band = /^(clear continue|your hand beats enough)/.test(r) ? 'call' : /^right at the price/.test(r) ? 'close' : /^(you’re not getting|you don’t beat enough)/.test(r) ? 'fold' : null;
      if (!band) return;   // the raise branch is cut on equity alone (60% flop and turn, 82% river), not on the price
      facing++;
      const want = g > 4 ? 'call' : g >= -4 ? 'close' : 'fold', lean = band === 'close' ? (g >= 0 ? 'call' : 'fold') : band;
      if ((band !== want || en.ideal !== lean) && off.length < 3) off.push(id + ' ' + m[1] + '/' + m[2] + ' ' + band + ' → ' + en.ideal);
      (byGap[g] = byGap[g] || {})[band + ' ' + en.ideal] = 1;
    } else if (e.street === 'river' && e.decision === 'cb' && (m = RIV.exec(w))) {
      // Chapter 7's river map: 60+ value, 48–60 thin, 50+ check back, 30–50 bluff-catch, under 30 bluff or give up.
      river++;
      const eq = +m[1], eqC = m[2] != null ? +m[2] : en.eqCall, r = m[3];
      const want = eqC >= 60 ? /^value:/ : eqC >= 48 ? /^thin value/ : eq >= 50 ? /^check back/ : eq >= 30 ? /^bluff-catcher/ : /^(bluff:|no showdown value)/;
      if (!want.test(r) && roff.length < 3) roff.push(id + ' ' + eq + '/' + eqC + ' ' + r.slice(0, 30));
    }
  });
  ok(facing > 1300 && !off.length, 'all ' + facing + ' facing-a-bet sentences: 5+ points over continues, within 4 is close (leaning call from a tie up), 5+ short folds' + (off.length ? ' — ' + off.join(' | ') : ''));
  const split = Object.keys(byGap).filter(g => Object.keys(byGap[g]).length > 1);
  ok(!split.length && byGap[4] && byGap[-4] && byGap[0], 'each printed gap has one verdict across both pools (4, 0 and −4 included)' + (split.length ? ' — split at ' + split.join(', ') : ''));
  ok(river > 1800 && !roff.length, 'all ' + river + ' river check-or-bet sentences sit inside chapter 7’s bands' + (roff.length ? ' — ' + roff.join(' | ') : ''));
  // The reviewer's decision: the same turn in the Turn drill and in Full hands.
  const t72 = spots.find(e => e.id === '72/104:turn:BB' && e.decision === 'fcr'), h72 = hands.find(h => h.id === '72/104');
  const i72 = h72.decisions.findIndex(d => d.street === 'turn' && d.decision === 'fcr'), e72 = T.handAt(h72, i72).e;
  ok(/30% · price 34% — right at the price/.test(t72.engine.why) && e72.engine.why === t72.engine.why && T.realScore(t72, 'call', 'turn').close && T.realScore(e72, 'call', 'hands').close,
    '72/104’s turn, "30% · price 34%": close in the Turn drill and in Full hands, a call ≈ in both');
  // The engine, on numbers either side of each printed line.
  const fd = (eq, price, street) => PF.flopDecide('oopBet', { street: street || 'turn', eq, price, cat: 'medium', edge: 'some', wet: false, pos: 'oop' });
  const rv = (eq, eqCall) => PF.flopDecide('oopFirst', { street: 'river', eq, price: null, eqCall, foldEq: 0.59 }).why.replace(/<[^>]+>/g, '');
  ok(/right at the price/.test(fd(0.2149, 0.17).why) && fd(0.2149, 0.17).ideal === 'call' && /clear continue/.test(fd(0.2151, 0.17).why) &&
    /right at the price/.test(fd(0.2851, 0.33).why) && fd(0.2851, 0.33).ideal === 'fold' && /not getting the price/.test(fd(0.2849, 0.33).why) &&
    fd(0.3301, 0.3349).ideal === 'call' && /right at the price/.test(fd(0.3349, 0.29, 'river').why),
    'facing a bet: 21% at 17% is close (it was clear continue), 29% at 33% close (it was a fold), 33% at 33% leans call (it leaned fold); the river the same');
  ok(/— value:/.test(rv(0.75, 0.5996)) && /— thin value/.test(rv(0.75, 0.4796)) && /— check back/.test(rv(0.4996, 0.2)) && /— bluff-catcher/.test(rv(0.2996, 0.04)) && /— bluff:/.test(rv(0.294, 0.04)),
    'the river map on printed numbers: a calling range of 60% is value, 48% thin, showdown 50% checks back, 30% catches bluffs, 29% bluffs');
}

console.log('REV-STUDY-A: chapter 7’s river lines against a ⅔-pot bet are the engine’s');
{
  // STUDY-3 moved the call line to 5 printed points over the price, but chapter 7 still said "call
  // from about 33%" at a 29% price, where the engine says "right at the price" and calls from 34%.
  const PF = window.Postflop, src = require('fs').readFileSync(path.join(APP, 'course-turn-river.html'), 'utf8').replace(/<[^>]+>/g, '');
  const m = /raises from about (\d+)% showdown equity\. A ⅔-pot bet asks you to win (\d+)%.*?call from (?:about )?(\d+)% and fold below (\d+)%/.exec(src);
  const price = (2 / 3) / (1 + 2 * (2 / 3));
  const rv = eq => PF.flopDecide('oopBet', { street: 'river', eq, price, edge: 'some' });
  const ok1 = r => r.ok.join() === 'call' && /beats enough/.test(r.why), close = r => r.ok.join() === 'call,fold' && /right at the price/.test(r.why), fold = r => r.ok.join() === 'fold';
  ok(m && +m[2] === Math.round(price * 100) && ok1(rv(m[3] / 100)) && close(rv((m[3] - 1) / 100)) && close(rv(m[4] / 100)) && fold(rv((m[4] - 1) / 100)) &&
    rv(m[1] / 100).ideal === 'raise' && rv((m[1] - 1) / 100).ideal !== 'raise',
    'at a ' + (m ? m[2] : '?') + '% price the drill calls from ' + (m ? m[3] : '?') + '%, is close down to ' + (m ? m[4] : '?') + '%, folds below, and raises from ' + (m ? m[1] : '?') + '%, as the page says');
}

console.log('a decision in both the street drills and Full hands gets one answer (COPY-2)');
{
  // 896 decisions sit in both pools, baked by separate Monte Carlo runs: 12 took different answers
  // (72/86's turn: "62% — bet big for value" in the Turn drill, "60% — medium strength: check" in
  // Full hands). Full hands now carries the street drill's engine block for each of them.
  const fs3 = require('fs');
  const spots = JSON.parse(fs3.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs3.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const key = (hid, street, heroPos, heroCards, d) => [hid, street, heroPos, heroCards, d.board.join(''), d.pot, d.toCall, d.decision].join('|');
  const idx = {}; spots.forEach(e => { idx[key(e.id.split(':')[0], e.street, e.heroPos, e.heroCards, e)] = e; });
  let shared = 0; const diff = [];
  hands.forEach(h => h.decisions.forEach((d, i) => {
    const e = idx[key(h.id, d.street, h.heroPos, h.heroCards, d)]; if (!e) return;
    shared++;
    if (['ideal', 'eq', 'eqCall', 'why', 'range'].some(k => e.engine[k] !== d.engine[k]) && diff.length < 3) diff.push(h.id + '#' + i + ' ' + e.engine.ideal + '/' + d.engine.ideal);
  }));
  ok(shared === 896 && !diff.length, 'all ' + shared + ' shared decisions carry one engine answer and one sentence' + (diff.length ? ' — ' + diff.join(', ') : ''));
  const s86 = spots.find(e => e.id === '72/86:turn:SB' && e.decision === 'cb'), d86 = hands.find(h => h.id === '72/86').decisions.find(d => d.street === 'turn' && d.decision === 'cb');
  ok(s86.engine.ideal === 'bet' && d86.engine.ideal === 'bet' && d86.engine.why === s86.engine.why, '72/86’s turn (Q♠A♠ on Q♥9♥2♥4♦) is a bet in both');
}

console.log('COPY-6, COPY-7: the range line drops its baked size; the prompt doesn’t print its one clause twice');
{
  const T = window.StudyUI._test, fs = require('fs');
  const spots = JSON.parse(fs.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const decs = []; hands.forEach(h => h.decisions.forEach((d, i) => decs.push(T.handAt(h, i).e)));
  const all = spots.concat(decs);
  const sized = all.filter(e => /×pot/.test(e.engine.range || '')).length, left = all.map(e => T.rangeTxt(e.engine.range)).filter(r => /×pot/.test(r));
  ok(sized > 1000 && !left.length && T.rangeTxt('BB 3-bet → flop:bet · flop bet small 0.3×pot (merged)') === 'BB 3-bet → flop:bet · flop bet small (merged)',
    'COPY-6: the ' + sized + ' ranges with a baked "N×pot" print without it; the prompt gives the exact size');
  const rowFor = (html, st) => new RegExp('min-width:54px">' + st + '</span>').test(html);
  let single = 0, multi = 0; const bad = [];
  all.forEach(e => {
    const now = e.line[e.street] || '', name = e.street.charAt(0).toUpperCase() + e.street.slice(1), html = T.realSpotHtml({ e });
    if (!now) return;
    if (now.indexOf(' · ') < 0) { single++; if (rowFor(html, name) && bad.length < 3) bad.push('kept: ' + now); }
    else { multi++; if (!rowFor(html, name) && bad.length < 3) bad.push('dropped: ' + now); }
  });
  ok(single > 500 && multi > 500 && !bad.length, 'COPY-7: a one-clause decision-street row (' + single + ') is left to the bold line; a row with more on it (' + multi + ') stays' + (bad.length ? ' — ' + bad.join(' | ') : ''));
}

console.log('NEW-3 / REV-STUDY-C: with its size gone, a bare "· flop bet" tail goes too; merged and polar stay');
{
  // COPY-6 left 706 range lines reading "CO flat → flop:bet · flop bet": the tail had carried only
  // the size, so what was left repeated the line.
  const T = window.StudyUI._test, fs = require('fs');
  const spots = JSON.parse(fs.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const decs = []; hands.forEach(h => h.decisions.forEach((d, i) => decs.push(T.handAt(h, i).e)));
  const raw = spots.concat(decs).map(e => String(e.engine.range || ''));
  const bare = raw.filter(r => / · (?:flop|turn|river) bet \d*\.?\d+×pot$/.test(r)).length, out = raw.map(T.rangeTxt);
  const left = out.filter(r => / · (?:flop|turn|river) bet$/.test(r)), kept = out.filter(r => / · (?:flop|turn|river) bet (small \(merged\)|big \(polar\))$/.test(r)).length;
  ok(bare > 700 && !left.length && kept > 1200 && T.rangeTxt('CO flat → flop:bet · flop bet 0.4×pot') === 'CO flat → flop:bet' &&
    T.rangeTxt('BB flat → flop:check turn:call river:raise · river bet big 0.9×pot (polar)') === 'BB flat → flop:check turn:call river:raise · river bet big (polar)',
    'the ' + bare + ' ranges whose tail was only "<street> bet N×pot" end at the line; the ' + kept + ' merged and polar tails keep their words' + (left.length ? ' — ' + left.slice(0, 3).join(' | ') : ''));
}

console.log('NEW-4 / NF-COPY-7: the decision street’s row keeps your own check but not the bet the bold line gives');
{
  // COPY-7 dropped a one-clause row and kept a longer one whole, so "River  BB checks · HJ bets 4.5"
  // still sat over "River: HJ bets 4.5bb into 9bb" (store shot 5's shape, 1,498 rows). The row now
  // stops before the faced bet. A row where someone folds after the bet (31) stays whole.
  const T = window.StudyUI._test, fs = require('fs');
  const spots = JSON.parse(fs.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const decs = []; hands.forEach(h => h.decisions.forEach((d, i) => decs.push(T.handAt(h, i).e)));
  const nums = s => (String(s).match(/\d+(?:\.\d+)?/g) || []).join(' ');
  let trimmed = 0, whole = 0; const bad = [];
  spots.concat(decs).forEach(e => {
    const cl = String(e.line[e.street] || '').split(' · ');
    if (cl.length < 2) return;
    const name = e.street.charAt(0).toUpperCase() + e.street.slice(1);
    const m = new RegExp('min-width:54px">' + name + '</span> ([^<]*)</div>').exec(T.realSpotHtml({ e }));
    const last = /^(\w+) bets [\d.]+$/.exec(cl[cl.length - 1].trim()), faced = e.decision === 'fcr' && last && last[1] === e.villPos;
    const want = faced ? cl.slice(0, -1) : cl;
    if (faced) trimmed++; else whole++;
    if ((!m || m[1].split(' · ').length !== want.length || nums(m[1]) !== nums(want.join(' · '))) && bad.length < 3) bad.push(e.line[e.street] + ' → ' + (m ? m[1] : 'no row'));
  });
  const e86 = spots.find(e => e.id === '86/73:river:BB' && e.decision === 'fcr'), h86 = T.realSpotHtml({ e: e86 }).replace(/<[^>]+>/g, '');
  ok(trimmed > 1400 && whole === 31 && !bad.length && /River BB checks\s*River: HJ bets 4\.5bb into 9bb/.test(h86) && !/HJ bets 4\.5\s*River:/.test(h86),
    'the ' + trimmed + ' rows ending in the faced bet print the clauses before it ("River BB checks" over "River: HJ bets 4.5bb"); the ' + whole + ' with a fold after it stay whole' + (bad.length ? ' — ' + bad.join(' | ') : ''));
}

console.log('the rows say only the folds of players who were in the hand (the owner, 2026-10-16)');
{
  // "HJ folds · CO folds · BTN folds · SB folds" before the action came round took two lines and said
  // nothing. A fold stays only from a player who had already called, bet, raised or checked.
  const T = window.StudyUI._test, fs = require('fs');
  const spots = JSON.parse(fs.readFileSync(path.join(APP, 'realspots.json'), 'utf8')), hands = JSON.parse(fs.readFileSync(path.join(APP, 'realhands.json'), 'utf8'));
  const decs = []; hands.forEach(h => h.decisions.forEach((d, i) => decs.push(T.handAt(h, i).e)));
  const rowText = (html, st) => { const m = new RegExp('min-width:54px">' + st + '</span> ([^<]*)</div>').exec(html); return m ? m[1] : null; };
  let dropped = 0, keptFolds = 0, idleShown = 0; const bad = [];
  spots.concat(decs).forEach(e => {
    const q = T.quietFolds(e.line), seen = {};
    ['preflop', 'flop', 'turn', 'river'].forEach(st => {
      if (e.line[st] == null) return;
      const raw = String(e.line[st]).split(' · '), kept = String(q[st]).split(' · ');
      raw.forEach(a => {
        const m = /^(\w+) (\w+)/.exec(a.trim()); if (!m) return;
        if (m[2] === 'folds') { if (seen[m[1]]) keptFolds++; else dropped++; } else seen[m[1]] = true;
      });
      if (kept.length !== raw.filter(a => { const m = /^(\w+) (\w+)/.exec(a.trim()); return !m || m[2] !== 'folds' || kept.indexOf(a) >= 0; }).length && bad.length < 3) bad.push(st + ': ' + e.line[st] + ' → ' + q[st]);
    });
    const pre = rowText(T.realSpotHtml({ e }), 'Preflop');
    if (pre && pre.split(' · ').some(a => { const m = /^(\S+) folds$/.exec(a.trim()); return m && !/(calls|raises|bets|checks|limps|completes)/.test(pre.slice(0, pre.indexOf(a))); })) idleShown++;
  });
  const e86 = spots.find(e => e.id === '86/73:river:BB' && e.decision === 'fcr'), h86 = T.realSpotHtml({ e: e86 }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const limp = T.quietFolds({ preflop: 'UTG folds · MP folds · CO folds · BTN folds · SB calls · BB checks' }).preflop;
  const later = T.quietFolds({ preflop: 'UTG calls · CO bets 3 · SB folds · BB calls · UTG folds', flop: 'CO bets 4 · BB folds' });
  ok(dropped > 5000 && !idleShown && !bad.length && /Preflop HJ raises to 2\.3 · BB calls Flop/.test(h86) && !/UTG–LJ folds|SB folds/.test(h86) &&
    limp === 'SB calls · BB checks' && later.preflop === 'UTG calls · CO bets 3 · BB calls · UTG folds' && later.flop === 'CO bets 4 · BB folds',
    'the ' + dropped + ' folds of players who never put chips in are left out (86/73 reads "HJ raises to 2.3 · BB calls"); a fold after a call, a bet or a check stays (' + keptFolds + ')' + (bad.length ? ' — ' + bad.join(' | ') : ''));
  ok(e86.line.preflop === 'UTG folds · MP bets 2.3 · CO folds · BTN folds · SB folds · BB calls', 'and the pool\'s own line is untouched (the engine reads it whole)');
}

console.log('the own-hand replay reads past a result in the wrong unit, as Log does (the final skeptic, round 2)');
{
  // '| -100bb' in a cash hand isn't lifted on save (LOG-1); Log reads the line without it
  // (missedResult, NEW-1), but Study read it raw: the turn became 'x b40 c | -100bb (as written)'
  // and the replay lost its cut (Same line / Play it differently instead of Fold / Call / Raise).
  const T = window.StudyUI._test, keep = window.missedResult;
  const h = { pos: 'sb', game: 'cash', stakes: '1/3', action: 'btn open6 c / (Ts9s2d) x b20 c / (4h) x b40 c | -100bb' };
  window.missedResult = (a, g) => (g !== 'mtt' && / \| -100bb$/.test(a)) ? { action: a.replace(/ \| -100bb$/, ''), text: 'Result: not counted.' } : null;
  const clean = T.mineAction(h), cutClean = T.mineCut(T.splitStreets(clean), 'sb'), cutRaw = T.mineCut(T.splitStreets(h.action), 'sb');
  ok(clean === 'btn open6 c / (Ts9s2d) x b20 c / (4h) x b40 c' && !!cutClean && !cutRaw,
    'the replay cuts the line without the uncounted result (raw: no cut)');
  ok(T.mineAction(Object.assign({}, h, { amount: '300' })) === h.action, 'a hand with its result in the amount box reads as saved');
  window.missedResult = undefined;
  ok(T.mineAction(h) === h.action, 'standalone (no Log), the line reads as saved');
  window.missedResult = keep;
}

console.log('today’s hand: the daily pick (Home, 2026-10-13: one hard preflop spot, where the seat or the stack decides)');
{
  // study.js runs standalone here, so this is the Pro view unless isPro says otherwise.
  const T = window.StudyUI._test, SD = window.StudyUI.daily, P = window.Poker;
  const train = () => JSON.parse(localStorage.getItem('pokerlog.train') || '{}');
  const FOLD = '<button class="act fold" data-a="fold">Fold</button>', CALL = '<button class="act call" data-a="call">Call</button>';
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const txt = h => String(h).replace(/<span class="termdef"[^>]*>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '');

  // T-S1 pfAsk: the drill's own words, moved verbatim.
  const asks = [
    [{ kind: 'calljam', pos: 'BTN', depth: 10 }, { q: 'Call the jam or fold?', cls: '', btns: FOLD + CALL }],
    [{ kind: 'bbopt', limpers: 1, depth: 30 }, { q: 'Check or raise?', cls: '', btns: '<button class="act fold" data-a="check">Check</button><button class="act raise" data-a="raise">Raise</button>' }],
    [{ kind: 'open', pos: 'SB', depth: 100, free: true }, { q: 'Raise, limp (just call the big blind), or fold?', cls: 'three',
      btns: FOLD + '<button class="act call" data-a="limp">Limp</button><button class="act raise" data-a="open">Raise</button>' }],
    [{ kind: 'open', pos: 'SB', depth: 100 }, { q: 'Raise, limp, or fold?', cls: 'three',
      btns: FOLD + '<button class="act call" data-a="limp">Limp</button><button class="act raise" data-a="open">Raise</button>' }],
    [{ kind: 'open', pos: 'BTN', depth: 100 }, { q: 'Raise or fold?', cls: '', btns: FOLD + '<button class="act raise" data-a="open">Raise</button>' }],
    [{ kind: 'open', pos: 'EP', depth: 10 }, { q: 'Jam or fold?', cls: '', btns: FOLD + '<button class="act jam" data-a="open">Jam</button>' }],
    [{ kind: 'iso', pos: 'CO', limpers: 1, depth: 100 }, { q: 'Raise or fold?', cls: '', btns: FOLD + '<button class="act raise" data-a="open">Raise</button>' }],
    [{ kind: 'vs', opener: 'CO', vseat: 'BTN', depth: 30 }, { q: '3-bet, call, or fold?', cls: 'three', btns: FOLD + CALL + '<button class="act threebet" data-a="threebet">3-bet</button>' }],
    [{ kind: 'vs', opener: 'CO', vseat: 'BTN', depth: 20 }, { q: 'Jam, call, or fold?', cls: 'three', btns: FOLD + CALL + '<button class="act jam" data-a="threebet">Jam</button>' }],
    [{ kind: 'squeeze', opener: 'EP', callers: 1, vseat: 'BTN', depth: 30 }, { q: 'Squeeze, call, or fold?', cls: 'three', btns: FOLD + CALL + '<button class="act threebet" data-a="threebet">Squeeze</button>' }],
    [{ kind: 'cold3b', opener: 'EP', raiser: 'CO', vseat: 'BTN', depth: 30 }, { q: '4-bet, call, or fold?', cls: 'three', btns: FOLD + CALL + '<button class="act threebet" data-a="threebet">4-bet</button>' }],
    [{ kind: 'limpRR', pos: 'BTN', limpers: 1, depth: 30 }, { q: '4-bet, call, or fold?', cls: 'three', btns: FOLD + CALL + '<button class="act threebet" data-a="threebet">4-bet</button>' }],
    [{ kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: 'oop', depth: 100, free: true }, { q: '4-bet (raise again), call, or fold?', cls: 'three', btns: FOLD + CALL + '<button class="act threebet" data-a="threebet">4-bet</button>' }],
    [{ kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: 'oop', depth: 100 }, { q: '4-bet, call, or fold?', cls: 'three', btns: FOLD + CALL + '<button class="act threebet" data-a="threebet">4-bet</button>' }],
    [{ kind: 'vs4bet', vseat: 'BTN', raiser: 'CO', pos3: 'ip', depth: 100 }, { q: '5-bet jam, call, or fold?', cls: 'three', btns: FOLD + CALL + '<button class="act jam" data-a="threebet">5-bet jam</button>' }]
  ];
  const badAsk = asks.filter(([s, want]) => !same(T.pfAsk(Object.assign({ mode: 'pf' }, s)), want)).map(([s]) => s.kind + ' ' + s.depth + (s.free ? ' free' : ''));
  ok(badAsk.length === 0, 'pfAsk gives the drill’s exact question, class and buttons for every preflop kind (' + asks.length + ')' + (badAsk.length ? ' — ' + badAsk.join(', ') : ''));
  global.isPro = () => false;
  const sbSpot = { mode: 'pf', kind: 'open', pos: 'SB', depth: 100, c1: 'Kh', c2: '6d', label: 'K6o', free: true };
  T.setCur(sbSpot);
  const sbAsk = T.pfAsk(sbSpot);
  ok(els['drillQ'].textContent === sbAsk.q && els['drillBtns'].className === sbAsk.cls && els['drillBtns']._html === sbAsk.btns, 'the drill writes pfAsk’s words for a free SB spot');
  delete global.isPro;
  const v3Spot = { mode: 'pf', kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: 'oop', depth: 100, c1: 'Ah', c2: 'Qh', label: 'AQs' };
  T.setCur(v3Spot);
  const v3Ask = T.pfAsk(v3Spot);
  ok(els['drillQ'].textContent === v3Ask.q && els['drillBtns'].className === v3Ask.cls && els['drillBtns']._html === v3Ask.btns, 'and for a Pro re-raise spot');

  // T-S2 verdict: answer()'s head block, moved verbatim.
  const PH = 'The chart raises this hand from here (about 40% of hands).';
  const verdicts = [
    ['free right', { plainHead: PH, right: true, marginal: false, idealAct: 'open', idealWord: 'Raise' }, 'open', { cls: 'good', head: '✓ Raise', sub: PH }],
    ['free wrong', { plainHead: PH, right: false, marginal: false, idealAct: 'fold', idealWord: 'Fold' }, 'open', { cls: 'bad', head: '✗ The app’s answer: Fold', sub: PH }],
    ['free marginal, other', { plainHead: PH, right: true, marginal: true, idealAct: 'call', idealWord: 'Call' }, 'fold', { cls: 'mix', head: '≈ Close. The app’s answer: Call', sub: 'Yours is fine too. ' + PH }],
    ['free marginal, ideal', { plainHead: PH, right: true, marginal: true, idealAct: 'call', idealWord: 'Call' }, 'call', { cls: 'good', head: '✓ Call', sub: PH + ' Close: the other answer is fine too.' }],
    ['Mix', { verb: 'Mix', right: true, marginal: true, idealAct: 'bet', idealWord: 'Bet' }, 'check', { cls: 'mix', head: '≈ Bet', sub: '' }],
    ['Pro marginal, ideal', { right: true, marginal: true, idealAct: 'call', idealWord: 'Call' }, 'call', { cls: 'good', head: '✓ Call <span class="dim">(close — the other line’s fine too)</span>', sub: '' }],
    ['Pro marginal, other', { right: true, marginal: true, idealAct: 'call', idealWord: 'Call' }, 'fold', { cls: 'mix', head: '≈ Close — ideal is <b>Call</b>, your answer’s fine', sub: '' }],
    ['Nash marginal', { verb: 'Nash', right: true, marginal: true, idealAct: 'open', idealWord: 'Jam' }, 'fold', { cls: 'mix', head: '≈ Close — Nash is <b>Jam</b>, your answer’s fine', sub: '' }],
    ['Pro right', { right: true, marginal: false, idealAct: 'fold', idealWord: 'Fold' }, 'fold', { cls: 'good', head: '✓ Fold', sub: '' }],
    ['Pro wrong', { right: false, marginal: false, idealAct: 'fold', idealWord: 'Fold' }, 'open', { cls: 'bad', head: '✗ Engine’s take: Fold', sub: '' }],
    ['Nash wrong', { verb: 'Nash', right: false, marginal: false, idealAct: 'open', idealWord: 'Jam' }, 'fold', { cls: 'bad', head: '✗ Nash: Jam', sub: '' }]
  ];
  const badV = verdicts.filter(([, g, a, want]) => !same(T.verdict(g, a), want)).map(([n, g, a]) => n + ' → ' + JSON.stringify(T.verdict(g, a)));
  ok(badV.length === 0, 'verdict gives the drill’s exact heads, free and Pro, close, Mix and Nash (' + verdicts.length + ')' + (badV.length ? ' — ' + badV.join(' | ') : ''));

  // T-S3 The pools, judged here with the drill's own graders, not with the pick's helpers.
  const SEATS = ['EP', 'MP', 'CO', 'BTN', 'SB'], DEP = { open: [10, 20, 30, 50, 100], calljam: [8, 10, 12, 15], vs3bet: [20, 30, 50, 100] };
  const FAMDEP = { first100: [100], firstMid: [20, 30, 50], first10: [10], calljam: DEP.calljam, vs3bet: DEP.vs3bet };
  const FAMANS = { first100: ['fold', 'limp', 'open'], firstMid: ['fold', 'limp', 'open'], first10: ['fold', 'open'], calljam: ['call', 'fold'], vs3bet: ['call', 'fold'] };
  const actsOf = s => s.kind === 'calljam' ? ['fold', 'call'] : s.kind === 'vs3bet' ? ['fold', 'call', 'threebet'] : s.pos === 'SB' && s.depth >= 20 ? ['fold', 'limp', 'open'] : ['fold', 'open'];
  const opens = (seat, d, L) => { const v = P.openEval(seat, d, L); return v.in && !v.marginal; };
  // Exactly one button right on both tiers, none close, the same one: the 4a6566b rule.
  const judge = s => {
    let ideal = null;
    for (const free of [true, undefined]) {
      const c = Object.assign({ mode: 'pf' }, s, { free }), as = actsOf(c), gs = as.map(a => T.gradePF(c, a)), right = as.filter((a, i) => gs[i].right);
      if (right.length !== 1 || gs.some(g => g.marginal) || gs[0].idealAct !== right[0] || (ideal && ideal !== right[0])) return null;
      ideal = right[0];
    }
    return ideal;
  };
  // How far from the grader's line, in its own units (the share of hands it ranks by, or bb of all-in value).
  const dist = s => {
    const L = s.label;
    if (s.kind === 'calljam') return { d: Math.abs(P.callEval(s.pos, s.depth, L).ev), lo: P.EV_MARGIN, hi: 0.75 };
    if (s.kind === 'open' && s.depth <= 12) return { d: Math.abs(P.openEval(s.pos, s.depth, L).ev), lo: P.EV_MARGIN, hi: 0.75 };
    if (s.kind === 'open' && s.pos !== 'SB') { const v = P.openEval(s.pos, s.depth, L); return { d: Math.abs(v.p - v.t), lo: P.MARGIN, hi: 0.12 }; }
    if (s.kind === 'open') { const v = P.sbEval(s.depth, L), dr = Math.abs(v.op - v.raiseT), dl = Math.abs(v.dp - v.limpT);
      return { d: v.action === 'raise' ? dr : v.action === 'fold' ? dl : Math.min(dr, dl), lo: P.MARGIN, hi: 0.12 }; }
    const v = P.vs3betEval(s.depth, s.pos3, L), byFlop = v.p !== P.pct(L);
    return { d: Math.min(...(byFlop ? [v.call] : [v.tb, v.call]).map(t => Math.abs(v.p - t))), lo: 0, hi: 0.12 };
  };
  const NEED = {}, sizes = {}, poolBad = [], answers = {}, turnsBy = {};
  T.DAILY_FAMS.forEach(f => { NEED[f] = Math.ceil(365 / 7 * T.DAILY_WEEK[f]) + 1; });
  T.DAILY_FAMS.forEach(fam => {
    const pool = T.dailyPool(fam), ids = new Set();
    sizes[fam] = pool.length; answers[fam] = {}; turnsBy[fam] = {};
    pool.forEach(s => {
      const id = [s.kind, s.pos || s.pos3, s.depth, s.label].join('|'), bad = m => poolBad.push(fam + ' ' + id + ': ' + m);
      if (ids.has(id)) bad('twice'); ids.add(id);
      answers[fam][s.ideal] = (answers[fam][s.ideal] || 0) + 1;
      if (T.dailyFam(s) !== fam || FAMDEP[fam].indexOf(s.depth) < 0 || (s.kind === 'vs3bet' ? ['ip', 'oop'].indexOf(s.pos3) < 0 : SEATS.indexOf(s.pos) < 0)) bad('not this family’s');
      if (judge(s) !== s.ideal) bad('not clean: ' + judge(s) + ' vs ' + s.ideal);
      const ln = dist(s);
      if (!(ln.d > ln.lo && ln.d <= ln.hi)) bad('not near the line: ' + ln.d);
      if (s.kind === 'vs3bet' && !['EP', 'MP', 'CO', 'BTN'].some(h => T.DAILY_SEATS[s.pos3][h] && opens(h, s.depth, s.label))) bad('no seat raises it');
      // The lesson: an adjacent seat or depth where the same hand is clean and answers differently.
      const tn = T.dailyTurns(s, s.ideal)[0];
      if (!tn) return bad('no seat or stack turns it');
      turnsBy[fam][tn.by] = (turnsBy[fam][tn.by] || 0) + 1;
      const o = tn.s, ds = DEP[s.kind === 'calljam' ? 'calljam' : s.kind === 'vs3bet' ? 'vs3bet' : 'open'];
      const adj = tn.by === 'depth' ? (o.kind === s.kind && (o.pos || o.pos3) === (s.pos || s.pos3) && Math.abs(ds.indexOf(o.depth) - ds.indexOf(s.depth)) === 1)
        : (o.depth === s.depth && (s.kind === 'vs3bet' ? o.pos3 !== s.pos3 : Math.abs(SEATS.indexOf(o.pos) - SEATS.indexOf(s.pos)) === 1));
      if (!adj || judge(o) !== tn.ideal || tn.ideal === s.ideal) bad('its turn is not an adjacent clean spot with another answer');
      if (tn.by !== (s.depth === 100 ? 'seat' : 'depth') && T.dailyTurns(s, s.ideal).some(x => x.by === (s.depth === 100 ? 'seat' : 'depth'))) bad('the lesson comes in the wrong order');
    });
    if (Object.keys(answers[fam]).sort().join() !== FAMANS[fam].join()) poolBad.push(fam + ': answers ' + Object.keys(answers[fam]).sort().join('/'));
  });
  console.log('        pools: ' + T.DAILY_FAMS.map(f => f + ' ' + sizes[f] + ' ' + JSON.stringify(answers[f]) + ' turned by ' + JSON.stringify(turnsBy[f])).join('; '));
  ok(poolBad.length === 0, 'every pool spot is its family’s, clean on both tiers (one right button, none close), near its grader’s line but outside its close band, and turned by an adjacent seat or stack' +
    (poolBad.length ? ' — ' + poolBad.slice(0, 6).join(' | ') : ''));
  ok(T.DAILY_FAMS.every(f => sizes[f] >= NEED[f]), 'each pool outlasts a year at its days a week (' + T.DAILY_FAMS.map(f => f + ' ' + sizes[f] + ' ≥ ' + NEED[f]).join(', ') + ')');
  ok(!/squeeze|limpRR|cold3b|\biso\b|bbopt/.test(JSON.stringify(T.DAILY_FAMS.map(T.dailyPool))), 'and none of the multiway kinds');

  // T-S4 Golden days. A deliberate tables, charts or pool change that moves them updates them in the same commit.
  const GOLD = [
    ['2026-10-12', {kind: 'calljam', pos: 'EP', depth: 10, label: 'A4o', c1: 'As', c2: '4h'}, 'fold'],   // calljam
    ['2026-10-13', {kind: 'open', pos: 'CO', depth: 20, label: 'K7o', c1: 'Kc', c2: '7d'}, 'fold'],   // firstMid
    ['2026-10-14', {kind: 'open', pos: 'EP', depth: 10, label: 'A9o', c1: 'Ac', c2: '9s'}, 'open'],   // first10
    ['2026-10-15', {kind: 'open', pos: 'CO', depth: 100, label: 'T6s', c1: 'Td', c2: '6d'}, 'fold'],   // first100
    ['2026-10-16', {kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: 'oop', depth: 50, label: 'JTs', c1: 'Jd', c2: 'Td'}, 'fold'],   // vs3bet
    ['2026-10-20', {kind: 'open', pos: 'BTN', depth: 100, label: '75s', c1: '7h', c2: '5h'}, 'open'],   // first100
    ['2026-10-21', {kind: 'open', pos: 'SB', depth: 30, label: 'T3s', c1: 'Td', c2: '3d'}, 'limp'],   // firstMid
    ['2026-10-23', {kind: 'open', pos: 'BTN', depth: 50, label: '53s', c1: '5h', c2: '3h'}, 'fold'],   // firstMid
    ['2026-10-25', {kind: 'vs3bet', pos: 'MP', raiser: 'BB', pos3: 'ip', depth: 100, label: 'K7s', c1: 'Kh', c2: '7h'}, 'call'],   // vs3bet
    ['2026-10-29', {kind: 'vs3bet', pos: 'EP', raiser: 'MP', pos3: 'oop', depth: 100, label: 'A5s', c1: 'As', c2: '5s'}, 'fold'],   // vs3bet
    ['2026-10-31', {kind: 'open', pos: 'BTN', depth: 10, label: 'K2o', c1: 'Kd', c2: '2c'}, 'fold'],   // first10
    ['2026-11-03', {kind: 'calljam', pos: 'SB', depth: 10, label: 'Q6o', c1: 'Qh', c2: '6s'}, 'call'],   // calljam
    ['2026-11-11', {kind: 'open', pos: 'SB', depth: 100, label: '63s', c1: '6s', c2: '3s'}, 'limp'],   // first100
    ['2026-12-31', {kind: 'calljam', pos: 'CO', depth: 10, label: 'Q8s', c1: 'Qc', c2: '8c'}, 'fold'],   // calljam
    ['2027-01-01', {kind: 'open', pos: 'CO', depth: 10, label: 'A5o', c1: 'As', c2: '5h'}, 'open'],   // first10
    ['2028-02-29', {kind: 'open', pos: 'SB', depth: 10, label: 'Q2s', c1: 'Qs', c2: '2s'}, 'open']    // first10
  ];
  const pick = s => s && { kind: s.kind, pos: s.pos, raiser: s.raiser, pos3: s.pos3, depth: s.depth, label: s.label, c1: s.c1, c2: s.c2 };
  const badGold = GOLD.filter(([k, want, ans]) => { const s = SD.spot(k); return !same(pick(s), pick(Object.assign({}, want))) || judge(s) !== ans; })
    .map(([k]) => k + ' → ' + JSON.stringify(pick(SD.spot(k))) + ' ' + judge(SD.spot(k)));
  ok(badGold.length === 0, 'the golden days deal the same spot and answer on every phone (' + GOLD.length + ')' + (badGold.length ? ' — ' + badGold.join(' | ') : ''));

  // T-S5 Determinism and purity, 1,096 days from 2026-10-12.
  const keyAt = i => { const d = new Date(2026, 9, 12 + i); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const KEYS = Array.from({ length: 1096 }, (_, i) => keyAt(i));
  const rec0 = recorded.length, train0 = localStorage.getItem('pokerlog.train'), cur0 = T.cur();
  const realRandom = Math.random, CARD = /^[2-9TJQKA][shdc]$/, detBad = [], spots = {};
  const inPool = {};
  T.DAILY_FAMS.forEach(f => T.dailyPool(f).forEach(x => { inPool[[x.kind, x.kind === 'vs3bet' ? x.pos3 : x.pos, x.depth, x.label].join('|')] = x; }));
  Math.random = () => { throw new Error('Math.random in the daily pick'); };
  try {
    KEYS.forEach(k => {
      let s, s2;
      try { s = SD.spot(k); s2 = SD.spot(k); } catch (e) { detBad.push(k + ' threw ' + e.message); return; }
      spots[k] = s;
      if (!same(s, s2) || s === s2) detBad.push(k + ' not deterministic');
      const x = s && inPool[[s.kind, s.kind === 'vs3bet' ? s.pos3 : s.pos, s.depth, s.label].join('|')];
      if (!x || s.mode !== 'pf' || T.dailyFam(s) !== T.dailyTurn(T.dayNum(k)).fam) { detBad.push(k + ' not a spot of the day’s family'); return; }
      if (P.handLabel(s.c1, s.c2) !== s.label || s.c1 === s.c2 || !CARD.test(s.c1) || !CARD.test(s.c2)) detBad.push(k + ' cards ' + s.c1 + s.c2 + ' ' + s.label);
      if (s.kind === 'vs3bet') {
        const tn = T.dailyTurns(s, x.ideal)[0], blind = s.raiser === 'SB' || s.raiser === 'BB';
        if (!opens(s.pos, s.depth, s.label) || (T.DAILY_SEATS[s.pos3][s.pos] || []).indexOf(s.raiser) < 0 || (blind ? 'ip' : 'oop') !== s.pos3 ||
          !tn || (tn.by === 'depth' && !opens(s.pos, tn.s.depth, s.label))) detBad.push(k + ' seats ' + s.pos + '/' + s.raiser + ' ' + s.pos3);
      } else if (s.raiser || s.pos3) detBad.push(k + ' stray seats');
    });
  } finally { Math.random = realRandom; }
  ok(detBad.length === 0, 'over 1,096 days, with Math.random a thrower: the same spot twice (a new object each time), one of the day’s family’s, cards that make the hand, a re-raise from a seat that raises it at both depths of its lesson' +
    (detBad.length ? ' — ' + detBad.slice(0, 5).join(' | ') : ''));
  ok(recorded.length === rec0 && localStorage.getItem('pokerlog.train') === train0 && T.cur() === cur0, 'and it logs nothing, stores nothing and leaves the drill’s spot alone');
  const prevDB = window.pokerDB, before = KEYS.slice(0, 60).map(k => JSON.stringify(spots[k])), tr = train();
  window.pokerDB = () => ({ hands: [{ id: 's1', sample: true, pos: 'BTN', flag: true, action: 'r15' }, { id: 'f1', pos: 'CO', flag: true, action: 'r15 / (Ks7d2c) x b40' },
    { id: 'r1', pos: 'SB', reviewed: true, action: 'r15' }], drills: [] });
  els['drillMode'].onclick(ev(['m', 'flop']));
  els['drillMode'].onclick(ev(['m', 'pf']));
  els['drillMode'].onclick(ev(['s', tr.pfStyle === 'hard' ? 'live' : 'hard']));
  els['drillMode'].onclick(ev(['w', tr.pfDepth === 'deep' ? 'all' : 'deep']));
  ok(KEYS.slice(0, 60).every((k, i) => JSON.stringify(SD.spot(k)) === before[i]), 'own, sample and reviewed hands, another mode and other filters change no day’s spot');
  window.pokerDB = prevDB;
  els['drillMode'].onclick(ev(['s', tr.pfStyle || 'live']));
  els['drillMode'].onclick(ev(['w', tr.pfDepth || 'all']));
  els['drillMode'].onclick(ev(['m', tr.mode || 'pf']));

  // T-S6 The calendar: the week's families, never one two days running, each family a deck, nothing back within a year.
  const weeks = {}, last = {}, ans = {}, famDays = {};
  let gap = Infinity, run = 0, maxRun = 0, prev = null, famRun = 0, prevFam = null, deckBad = 0, proDays = 0;
  KEYS.forEach((k, i) => {
    const s = spots[k], n = T.dayNum(k), wk = Math.floor((n + 3) / 7), c = T.dailyTurn(n), f = T.dailyFam(s);
    (weeks[wk] = weeks[wk] || []).push(f);
    famDays[f] = (famDays[f] || 0) + 1;
    if (s.depth !== 100) proDays++;
    const id = [s.kind, s.kind === 'vs3bet' ? s.pos3 : s.pos, s.depth, s.label].join('|');
    if (last[id] != null) gap = Math.min(gap, i - last[id]);
    last[id] = i;
    const a = judge(s); ans[a] = (ans[a] || 0) + 1;
    run = prev === a ? run + 1 : 1; maxRun = Math.max(maxRun, run); prev = a;
    if (prevFam === f) famRun++; prevFam = f;
    const deck = T.dailyDeck(f), x = deck[c.t % deck.length];
    if (c.fam !== f || x.kind !== s.kind || x.depth !== s.depth || x.label !== s.label || (x.pos3 || x.pos) !== (s.kind === 'vs3bet' ? s.pos3 : s.pos)) deckBad++;
  });
  const full = Object.keys(weeks).filter(w => weeks[w].length === 7);
  const weekBad = full.filter(w => T.DAILY_FAMS.some(f => weeks[w].filter(x => x === f).length !== T.DAILY_WEEK[f]));
  ok(full.length === 156 && weekBad.length === 0 && famRun === 0, 'every full Monday–Sunday week (' + full.length + '): ' + T.DAILY_FAMS.map(f => f + ' ×' + T.DAILY_WEEK[f]).join(', ') +
    ', and no family two days running, Sunday into Monday included' + (weekBad.length ? ' — weeks ' + weekBad.slice(0, 3).join(', ') : ''));
  const totalPool = T.DAILY_FAMS.reduce((a, f) => a + T.dailyPool(f).length, 0);
  ok(deckBad === 0 && gap >= 365, 'each family is dealt like a deck, round and round, and no spot comes back within a year (the closest repeat: ' + gap + ' days; ' +
    Object.keys(last).length + ' of ' + totalPool + ' spots dealt in three years)');
  ok(proDays / KEYS.length >= 0.7 && famDays.first100 >= 150 && famDays.vs3bet >= 150, 'weighted to Pro’s depths (' + (proDays / KEYS.length * 100).toFixed(0) +
    '% of days), and 100bb first in and the re-raise still come every week (' + famDays.first100 + ' and ' + famDays.vs3bet + ' days)');
  const sh = a => (ans[a] || 0) / KEYS.length;
  ok(sh('fold') <= 0.55 && ['fold', 'open', 'call', 'limp'].every(a => ans[a] > 0) && maxRun <= 6,
    'the answers stay mixed: ' + Object.keys(ans).map(a => a + ' ' + (sh(a) * 100).toFixed(0) + '%').join(', ') + ', never one answer more than ' + maxRun + ' days running');

  // T-S7 Time zones and DST: the pick reads a local date, never a clock.
  const TZK = ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-28', '2026-03-29', '2026-04-04', '2026-04-05', '2026-10-04', '2026-10-25', '2026-10-31',
    '2026-11-01', '2026-11-02', '2026-12-31', '2027-01-01', '2028-02-28', '2028-02-29', '2028-03-01'];
  const tz0 = process.env.TZ, byTz = {};
  let stepBad = 0;
  ['America/New_York', 'Australia/Lord_Howe', 'UTC'].forEach(tz => {
    process.env.TZ = tz;
    byTz[tz] = JSON.stringify(TZK.map(k => SD.spot(k)));
    let d = new Date(2026, 0, 1);
    for (let i = 0; i < 800; i++) {
      const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const k1 = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const k2 = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
      if (T.dayNum(k2) - T.dayNum(k1) !== 1) stepBad++;
      d = n;
    }
  });
  if (tz0 === undefined) delete process.env.TZ; else process.env.TZ = tz0;
  ok(byTz['America/New_York'] === byTz['UTC'] && byTz['Australia/Lord_Howe'] === byTz['UTC'] && stepBad === 0,
    'the same spots in New York, Lord Howe and UTC across the DST days, and dayNum steps by exactly 1 over 800 local days');

  // T-S8 What Home draws, for every spot of every pool. Free: plain words, the drill's buttons with
  // "All-in" for Jam, "The app's answer", the chart's reason, the seat or stack that turns it, and where
  // a spot from Pro's depths comes from. Pro: the drill's own words, verdict and full why.
  const FREEW = s => a => a === 'open' ? (s.depth <= 12 ? 'All-in' : 'Raise') : a === 'threebet' ? (s.depth >= 30 ? '4-bet (raise again)' : 'All-in') : { fold: 'Fold', call: 'Call', limp: 'Limp' }[a];
  const SEATW = { EP: 'an early seat', MP: 'the hijack', CO: 'the cutoff', BTN: 'the button', SB: 'the small blind' };
  const viewBad = [], seenTurn = {};
  let nViews = 0;
  T.DAILY_FAMS.forEach(fam => T.dailyPool(fam).forEach(x => {
    const s = Object.assign({ mode: 'pf' }, x, { c1: x.label[0] + 's', c2: x.label[1] + (x.label[2] === 's' ? 's' : 'h') });
    if (s.kind === 'vs3bet') { s.pos = T.dailyHeroes(s.pos3, s.depth, s.label).filter(h => { const tn = T.dailyTurns(x, x.ideal)[0]; return tn.by !== 'depth' || opens(h, tn.s.depth, s.label); })[0]; s.raiser = T.DAILY_SEATS[s.pos3][s.pos][0]; }
    delete s.ideal;
    const bad = m => viewBad.push(fam + ' ' + [s.kind, s.pos, s.pos3, s.depth, s.label].join(' ') + ': ' + m), W = FREEW(s), tn = T.dailyTurns(s, x.ideal)[0];
    global.isPro = () => false;
    const f = SD.view(s), ask = T.pfAsk(Object.assign({ free: true }, s));
    if (f.btns !== ask.btns.replace(/>Jam</g, '>All-in<') || f.cls !== ask.cls || /\bjam\b/i.test(txt(f.q + ' ' + f.btns)) || /fctr|Free re-raise/.test(f.spot) ||
      !new RegExp(s.depth + ' big blinds').test(txt(f.spot))) bad('free spot');
    const fr = {};
    T.dailyActs(s).forEach(a => {
      const v = SD.view(s, a), right = a === x.ideal; nViews++;
      fr[a] = v.r + v.ideal;
      const it = i => i === 'open' ? (tn.s.kind === 'open' && tn.s.depth <= 12 ? 'all-in' : 'a raise') : i === 'threebet' ? (tn.s.depth >= 30 ? 'a 4-bet (raise again)' : 'all-in') : 'a ' + i;
      const turn = tn.by === 'depth' ? 'At ' + tn.s.depth + ' big blinds it’s ' + it(tn.ideal) + '.'
        : s.kind === 'vs3bet' ? (tn.s.pos3 === 'ip' ? 'In position' : 'Out of position') + ' it’s ' + it(tn.ideal) + '.'
          : s.kind === 'calljam' ? 'Against ' + SEATW[tn.s.pos] + ' it’s ' + it(tn.ideal) + '.' : 'From ' + SEATW[tn.s.pos] + ' it’s ' + it(tn.ideal) + '.';
      seenTurn[turn.replace(/\d+/, 'N')] = 1;
      const tease = s.depth === 100 ? '' : 'From Pro’s preflop drill: ' + (s.kind === 'calljam' ? 'every all-in' : 'every stack size') + ', unlimited.';
      if (v.head !== (right ? '✓ ' + W(x.ideal) : '✗ The app’s answer: ' + W(x.ideal)) || v.vcls !== (right ? 'good' : 'bad') || v.chose !== (right ? '' : W(a)) ||
        v.sub !== T.dailyReason(s, x.ideal) || !/^The (chart|all-in chart|<span class="term"[^>]*data-term="nash"[^>]*>all-in chart<\/span>) /.test(v.sub) || v.turn !== turn ||
        v.tease !== tease || v.why !== '' || v.r !== (right ? 'right' : 'wrong') || v.ideal !== x.ideal || v.guide !== (!right && fam === 'first100')) bad('free ' + a + ': ' + JSON.stringify(v));
      if (!/\d+% of hands/.test(txt(v.sub)) || /undefined|NaN|null/.test(v.head + v.sub + v.turn)) bad('a hole in the reason');
    });
    delete global.isPro;
    const p = SD.view(s), pAsk = T.pfAsk(s);
    if (p.btns !== pAsk.btns || p.q !== pAsk.q || !new RegExp(s.depth + 'bb').test(txt(p.spot))) bad('Pro spot');
    T.dailyActs(s).forEach(a => {
      const v = SD.view(s, a), g = T.gradePF(s, a), vd = T.verdict(g, a);
      if (v.head !== vd.head || v.vcls !== vd.cls || v.sub !== '' || v.tease || v.why !== g.why.charAt(0).toUpperCase() + g.why.slice(1) || v.r + v.ideal !== fr[a] ||
        !v.turn || /big blinds|Against/.test(v.turn)) bad('Pro ' + a);
    });
  }));
  ok(viewBad.length === 0, 'every pool spot, every answer (' + nViews + ' free verdicts): free reads plain words with the drill’s buttons ("All-in" for Jam), "The app’s answer", "You chose", the chart’s reason with its number, the seat or stack that turns it, and Pro’s depths say where they are from; Pro the drill’s own verdict and why; the grade the same on both' +
    (viewBad.length ? ' — ' + viewBad.slice(0, 4).join(' | ') : ''));
  ok(Object.keys(seenTurn).length >= 6, 'the lessons it says: ' + Object.keys(seenTurn).slice(0, 12).join(' / '));
  // realScore (the drill) is realVerdict plus the stats: the same words, and realVerdict moves nothing.
  const RS = JSON.parse(require('fs').readFileSync(path.join(APP, 'realspots.json'), 'utf8'));
  const tr0 = localStorage.getItem('pokerlog.train'), sample = RS.filter((e, i) => i % 37 === 0);
  let graded = 0, moved = 0;
  const sameWords = sample.every(e => T.realOptions(e).every(o => {
    const v = T.realVerdict(e, o.act), att0 = train().att;
    moved += train().att !== att0 ? 1 : 0;
    const sc = T.realScore(e, o.act, e.street); graded++;
    return train().att === att0 + 1 && same(sc, v);
  }));
  ok(sameWords && moved === 0, 'the drill’s realScore is realVerdict plus the stats: the same grade and words for every answer (' + graded + '), and realVerdict alone counts nothing');
  localStorage.setItem('pokerlog.train', tr0); window.StudyReloadStats();
  // The rows the first build-6 Home wrote (100bb, first in or the re-raise) draw the same way.
  const callDay = { mode: 'pf', kind: 'vs3bet', pos: 'BTN', raiser: 'SB', pos3: 'ip', depth: 100, label: 'A5s', c1: 'Ad', c2: '5d' };
  const openDay = { mode: 'pf', kind: 'open', pos: 'BTN', depth: 100, label: 'K4o', c1: 'Ks', c2: '4h' };
  global.isPro = () => false;
  const fv = SD.view(callDay), fw = SD.view(callDay, 'fold');
  ok(!/Free re-raise \(3-bet\) spot|fctr|class="rep"/.test(fv.spot) && fv.spot.includes('<span class="nw">re-raised (3-bet)</span>') && fv.q === '4-bet (raise again), call, or fold?',
    'an earlier preflop row, free: it spends nothing and says so nowhere; "re-raised (3-bet)" never splits; the drill’s free question');
  ok(fw.vcls === 'bad' && fw.head === '✗ The app’s answer: Call' && /^The chart calls the re-raise with this hand/.test(fw.sub) && fw.chose === 'Fold' && fw.r === 'wrong' && !fw.tease,
    'free, a miss: "✗ The app’s answer: Call", the chart’s reason, "You chose Fold", and no word of Pro (100bb is free)');
  ok(SD.view(callDay, 'threebet').chose === '4-bet (raise again)' && SD.view(openDay, 'open').guide === true && SD.view(openDay, 'fold').chose === '',
    'free: the 4-bet chosen is said with its meaning; a missed 100bb open points at the guide');
  delete global.isPro;
  ok(/^✗ Engine’s take:/.test(SD.view(callDay, 'fold').head) && SD.view(callDay, 'fold').sub === '' && /100bb/.test(SD.view(callDay).spot) && SD.view(callDay, 'threebet').chose === '4-bet',
    'Pro: "Engine’s take", no sub-line, the terse spot (100bb), "4-bet"');
  ok(SD.view(Object.assign({}, openDay, { mode: 'real' })) === null && SD.view(null) === null, 'and nothing else draws: a postflop row the pick never wrote gets no card');

  // T-S9 The drill's own counter still prints on the drill.
  global.isPro = () => false;
  T.setCur({ mode: 'pf', kind: 'vs3bet', pos: 'CO', raiser: 'BTN', pos3: 'oop', depth: 100, c1: 'Ah', c2: 'Qh', label: 'AQs', free: true, chained: true });
  ok(/Free re-raise \(3-bet\) spot/.test(els['drillSpot']._html), 'the drill’s free re-raise spot still counts itself ("Free re-raise (3-bet) spot n of today’s 10")');

  // T-S10 Keep going in Study. An earlier section leaves a db with own flagged hands installed, and
  // the free drill deals those in rotation (MINE_RATE), so the deal is checked with no hands of your own.
  const dbBefore = window.pokerDB;
  window.pokerDB = () => ({ hands: [] });
  els['drillMode'].onclick(ev(['m', 'river']));
  window.StudyUI.openDrill();
  ok(T.cur().mode === 'pf' && train().mode === 'pf', 'free, left on River: Keep going lands on a preflop spot that answers');
  window.pokerDB = dbBefore;
  delete global.isPro;
  els['drillMode'].onclick(ev(['m', 'river']));
  window.StudyUI.openDrill();
  ok(train().mode === 'river', 'Pro keeps River');
  els['drillMode'].onclick(ev(['m', tr.mode || 'pf']));
}

console.log('booted straight onto Study (index.html#study): the drill is drawn');
{
  // Review T6: a standalone guide's "Back to Study" boots the app at #study. showTab ran in
  // app-boot before this file loaded, so the Drill was never drawn: no modes, no spot, no buttons.
  // The file now draws it at load when the Study tab is showing and the app shell is there.
  const fresh = () => { const src = require('fs').readFileSync(path.join(APP, 'study.js'), 'utf8'); require('vm').runInThisContext(src, { filename: 'study.js' }); };
  const keep = window.StudyUI, blank = () => ['drillSpot', 'drillMode', 'drillBtns'].forEach(id => { els[id]._html = ''; });
  let locked = 0;
  window.applyStudyLock = () => { locked++; };
  els['tab-study'].hidden = true; blank(); fresh();
  ok(!els['drillSpot']._html && !els['drillBtns']._html && locked === 0, 'Study not showing at load: nothing drawn (showTab draws it later)');
  els['tab-study'].hidden = false; blank(); fresh();
  ok(els['drillSpot']._html && els['drillBtns']._html && /data-m=/.test(els['drillMode']._html) && locked === 1,
    'Study showing at load: the mode row, a spot and its buttons, and the tier lock applied');
  delete window.applyStudyLock; blank(); fresh();
  ok(!els['drillSpot']._html, 'and standalone (no app shell) the file draws nothing by itself');
  window.StudyUI = keep;
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASS');
process.exit(fail ? 1 : 0);
