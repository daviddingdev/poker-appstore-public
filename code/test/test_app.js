// Boots the real inline script from www/index.html in a shimmed DOM.
//
// Nothing tested this file before — test_ui_smoke covers study.js only — so the entire
// logging app (save, delete, restore, boot) shipped unverified. It also guards the
// de-Spark: this app must never reach for a server, because in a shipped build there
// isn't one. Run: node tools/test_app.js
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'www');
const HTML = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL:', m); fail++; } else console.log('  ok  :', m); };

/* ============ source-level guarantees (cheap, and they catch regressions early) ============ */
console.log('de-Spark — no server, no tailnet, no leftovers');
{
  const banned = [
    ['Spark', /Spark/],
    ['api/backup', /api\/backup/],
    ['fetch(', /fetch\s*\(/],
    ['Tailscale', /Tailscale/i],
    ['scheduleSync', /scheduleSync/],
    ['adoptCanonical', /adoptCanonical/],
    ['hands\\/YYYY-MM.md', /YYYY-MM\.md/]
  ];
  banned.forEach(([label, re]) => ok(!re.test(HTML), 'index.html contains no ' + label));
  const study = fs.readFileSync(path.join(APP, 'study.js'), 'utf8');
  ok(!/Spark/.test(study), 'study.js contains no Spark');
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  ok(/storage\.js/.test(sw), 'service worker caches storage.js (else offline boot has no storage layer)');
}

console.log('every element the script reaches for actually exists in the markup');
{
  // The DOM shim below auto-creates any id on demand, so a `$('foo')` pointing at markup
  // that was deleted would sail through the runtime tests and break only on a real phone.
  // This is what caught nothing today and must keep catching it tomorrow.
  // Scan the whole file, not just the static markup: several ids (sessStart, viewSaved…)
  // are legitimately written by innerHTML a line before they're wired up. What must never
  // happen is an id that NO code path creates — the case where markup was deleted and its
  // handler was left behind.
  const declared = new Set((HTML.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1)));
  const dynamic = new Set(['created']);
  const referenced = [...new Set((HTML.match(/\$\('([a-zA-Z][\w-]*)'\)/g) || [])
    .map(s => s.slice(3, -2)))];
  const missing = referenced.filter(id => !declared.has(id) && !dynamic.has(id));
  ok(missing.length === 0, 'no $(id) points at markup that does not exist' +
    (missing.length ? ' — MISSING: ' + missing.join(', ') : ' (' + referenced.length + ' ids checked)'));
}

/* ============ DOM shim ============ */
const els = {};
function mkEl(id) {
  const el = {
    id, _html: '', textContent: '', value: '', hidden: false, onclick: null, onchange: null,
    dataset: {}, style: {}, files: null, checked: false,
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; },
    appendChild() {}, removeChild() {}, remove() {}, select() {}, focus() {}, blur() {}, click() {},
    setAttribute() {}, getAttribute() { return null; }, scrollIntoView() {}, insertBefore() {}
  };
  return el;
}
const el = id => els[id] || (els[id] = mkEl(id));

global.window = global;
global.document = {
  getElementById: el,
  createElement: () => mkEl('created'),
  querySelectorAll: () => [], querySelector: () => null,
  addEventListener(t, fn) { (this._h = this._h || {})[t] = fn; },
  body: mkEl('body'), hidden: false
};
global.navigator = { clipboard: { writeText: () => Promise.resolve() }, platform: 'test', userAgent: 'test' };
global.location = { protocol: 'file:', hostname: 'localhost', hash: '' };
global.Blob = function (parts) { this.parts = parts; };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
global.FileReader = function () {
  this.readAsText = f => { this.result = f._text; setTimeout(() => this.onload && this.onload(), 0); };
};
global.addEventListener = () => {};
global.confirm = () => true;
global.scrollTo = () => {};
// confirm() was replaced by an in-app sheet, so tests answer that instead of stubbing a
// browser dialog. Returns a tick so the promise callback has run before we assert.
const answerAsk = v => { el(v ? 'askYes' : 'askNo').onclick(); return new Promise(r => setTimeout(r, 0)); };

const ls = (() => {
  let s = {};
  return {
    getItem: k => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: k => { delete s[k]; },
    _wipe: () => { s = {}; }, _raw: () => s
  };
})();
global.localStorage = ls;

// Durable mirror, as Capacitor would provide it.
const files = {};
global.Capacitor = { Plugins: { Filesystem: {
  writeFile: o => Promise.resolve().then(() => { files[o.path] = o.data; return {}; }),
  readFile: o => Promise.resolve().then(() => {
    if (!(o.path in files)) throw new Error('not found');
    return { data: files[o.path] };
  })
} } };

/* ============ load the app exactly as the page does ============ */
require(path.join(APP, 'storage.js'));
require(path.join(APP, 'charts.js'));
require(path.join(APP, 'nash.js'));
require(path.join(APP, 'poker.js'));
require(path.join(APP, 'dealer.js'));
require(path.join(APP, 'postflop.js'));
require(path.join(APP, 'handeval.js'));

// The last <script> with no src is the app itself.
const inline = HTML.match(/<script>\n([\s\S]*?)<\/script>/g)
  .map(s => s.replace(/^<script>\n/, '').replace(/<\/script>$/, ''))
  .pop();
ok(inline && inline.length > 10000, 'extracted the inline app script (' + (inline || '').length + ' chars)');

console.log('boot — the app must come up with no data and no server');
// The app runs under 'use strict', so eval scopes every declaration to the eval itself.
// Append a tail that publishes the handful of internals the test drives; `db` needs an
// accessor because restoring a backup REASSIGNS it.
const EXPORTS = '\n;globalThis.A = { get db(){return db}, set db(v){db=v}, ' +
  'save, persist, tombstone, showTab, restoreFrom, fresh, hasData, refreshDataPanel, ' +
  'showIntro, closeIntro, loadSamples, removeSamples, hasSamples, renderHist, ' +
  'renderProgress, renderGameProgress, resultRows, tabFromHash, renderSession, ' +
  'resetForm, editHand, checkStaleSession, endSession, renderHome, renderLiveBar, ' +
  'setTyping, get typing(){return typing}, renderLeaksCard, ' +
  'exportBackup, migrate, maybePromptBackup, openHandDetail, renderHands, discardSession, goBack, ' +
  'setHandFilter: f => { handFilter = f; renderHands(); }, ' +
  'selPos: p => { selPos = p; }, deleteResult };';
let booted = true;
try {
  (0, eval)(inline + EXPORTS);
} catch (e) {
  booted = false;
  console.log('  FAIL: boot threw:', e && e.message);
  console.log(e && e.stack && e.stack.split('\n').slice(0, 4).join('\n'));
  fail++;
}
ok(booted, 'inline script boots clean on an empty store');

if (!booted) { console.log('\n' + fail + ' FAILURES'); process.exit(1); }

(async () => {

ok(typeof A.db === 'object' && Array.isArray(A.db.hands), 'db initialised');
ok(typeof A.save === 'function' && typeof A.persist === 'function', 'save/persist exist');
ok(typeof scheduleSync === 'undefined', 'no scheduleSync in scope — saves cannot trigger a network call');

console.log('saving goes to durable storage, not to a server');
{
  A.db.hands.push({ id: 'h1', ts: Date.now(), pos: 'BTN', action: 'open' });
  A.save();
  const raw = ls.getItem('pokerlog.v1');
  ok(!!raw && JSON.parse(raw).hands.length === 1, 'save() wrote the hand to the working copy');
  await Store.flush();
  ok(!!files['pokerlog/pokerlog.v1.json'], 'save() mirrored the hand to durable storage');
  ok(JSON.parse(files['pokerlog/pokerlog.v1.json']).hands[0].id === 'h1', 'the mirrored copy is the real hand');
}

console.log('drill answers persist the same way');
{
  const before = (A.db.drills || []).length;
  window.recordDrill({ t: Date.now(), m: 'pf', k: 'open|BTN', a: 'raise', ideal: 'raise', r: 1 });
  ok(A.db.drills.length === before + 1, 'recordDrill appended');
  ok(JSON.parse(ls.getItem('pokerlog.v1')).drills.length === before + 1, 'recordDrill persisted immediately');
}

console.log('deletion is local and final, and its log stays bounded');
{
  for (let i = 0; i < 600; i++) A.tombstone('x' + i);
  ok(A.db.deleted.length === 500, 'tombstone log capped at 500 (was ' + A.db.deleted.length + ')');
  ok(A.db.deleted[A.db.deleted.length - 1].id === 'x599', 'the cap drops the OLDEST tombstones, keeping recent ones');
}

console.log('the Data screen renders without a server');
{
  A.showTab('Data');
  const html = el('dataStatus')._html;
  ok(html.length > 0, 'data panel rendered');
  ok(/never uploaded|leaves this device/.test(html), 'it tells the user the data stays on the device');
  ok(!/Spark|Tailscale|sync/i.test(html), 'no sync language survives in the panel');
  ok(/1 hands|<b>1 hands<\/b>/.test(html), 'it counts the logged hand');
}

console.log('restore from a backup file');
{
  const backup = { hands: [{ id: 'r1', ts: 1, pos: 'CO' }, { id: 'r2', ts: 2, pos: 'SB' }], tourneys: [], sessions: [], drills: [] };
  const f = { _text: JSON.stringify(backup) };
  el('importFile').files = [f];
  await new Promise(res => {
    el('importFile').onchange({ target: { files: [f], value: '' } });
    setTimeout(res, 5);
  });
  await answerAsk(true);
  ok(A.db.hands.length === 2 && A.db.hands[0].id === 'r1', 'file import replaced the data');
  ok(JSON.parse(ls.getItem('pokerlog.v1')).hands.length === 2, 'the restore was persisted');
}

console.log('a junk file is rejected, not swallowed');
{
  const snapshot = A.db.hands.length;
  const f = { _text: '{"nope":1}' };
  await new Promise(res => {
    el('importFile').onchange({ target: { files: [f], value: '' } });
    setTimeout(res, 5);
  });
  ok(A.db.hands.length === snapshot, 'a non-pokerlog JSON file left the data alone — and never even asks');
}

console.log('first run — the intro must appear once, teach the shorthand, and stay re-openable');
{
  // Fresh install: no prefs at all.
  A.db = A.fresh();
  ok(A.db.prefs.onboarded === false, 'a fresh db has not been onboarded');

  A.showIntro();
  ok(el('intro').hidden === false, 'intro opens on a fresh install');
  ok(/Log the hands that mattered/.test(el('introBody')._html), 'slide 1 says what the app is for');

  el('introNext').onclick();
  ok(/open15 btn3b45/.test(el('introBody')._html), 'slide 2 shows a worked shorthand example');
  ok(/reads as/.test(el('introBody')._html), 'and decodes it into plain English');

  // Walk to the end rather than assuming a slide count — the deck grows as the product does.
  const seen = [];
  for (let i = 0; i < 20 && el('introNext').textContent !== 'Start logging'; i++) {
    el('introNext').onclick();
    seen.push(el('introBody')._html);
  }
  const deck = seen.join(' ');
  ok(/flag come back around/.test(deck), 'the deck sells the closed loop — your flagged hands return in Study');
  ok(/stakes, room and day/.test(deck), 'and the splits that make Progress worth opening');
  ok(/never leaves your phone/.test(el('introBody')._html), 'the last slide makes the privacy promise');
  ok(el('introNext').textContent === 'Start logging', 'the last slide commits instead of saying Next');

  el('introNext').onclick();
  ok(el('intro').hidden === true, 'intro closes');
  ok(A.db.prefs.onboarded === true, 'onboarding is remembered so it never nags twice');
  ok(JSON.parse(ls.getItem('pokerlog.v1')).prefs.onboarded === true, 'and that fact is persisted');

  el('introAgain').onclick();
  ok(el('intro').hidden === false, 'Data tab can re-open the intro');
  el('introSkip').onclick();
  ok(el('intro').hidden === true, 'skip closes it');
}

console.log('sample data — reversible, and removal is surgical');
{
  A.db = A.fresh();
  A.loadSamples();
  const n = A.db.hands.length;
  ok(n === 8, 'sample hands loaded (' + n + ')');
  ok(A.db.tourneys.length === 2 && A.db.sessions.length === 2, 'sample tournaments and sessions loaded');
  ok(A.db.hands.every(h => h.sample === true), 'every sample record is tagged');
  ok(A.db.hands.every(h => h.action && h.pos && h.c1 && h.c2), 'sample hands are complete enough to render');

  // A real hand logged alongside the samples must survive their removal — this is the
  // whole reason the records carry a tag instead of being cleared by date or count.
  A.db.hands.unshift({ id: 'real1', ts: Date.now(), pos: 'BTN', c1: 'Ah', c2: 'Kd', action: 'open15 f', sign: '+', amount: '15' });
  A.removeSamples();
  ok(A.db.hands.length === 1 && A.db.hands[0].id === 'real1', 'removing samples kept the hand the user logged');
  ok(A.db.tourneys.length === 0 && A.db.sessions.length === 0, 'sample tourneys/sessions removed');

  A.loadSamples();
  const before = A.db.hands.length;
  A.loadSamples();
  ok(A.db.hands.length === before, 'loading samples twice does not duplicate them');
  A.removeSamples();
}

console.log('the reference pages are reachable and can get back');
{
  ok(/href="playbook\.html"/.test(HTML), 'Study links to the playbook');
  ok(/href="horse\.html"/.test(HTML), 'Study links to the HORSE sheet');
  ['playbook.html', 'horse.html'].forEach(p => {
    const src = fs.readFileSync(path.join(APP, p), 'utf8');
    // Plain index.html is not enough: it re-enters the app at its DEFAULT tab, which dumped
    // the reader on the hand-entry form instead of the Study tab they left from.
    ok(/href="index\.html#study"/.test(src), p + ' returns you to Study, not to whatever tab boots first');
    ok(/viewport-fit=cover/.test(src), p + ' opts into the safe area');
    ok(/env\(safe-area-inset/.test(src), p + ' actually pads for the notch and home bar');
    ok(/theme-color/.test(src), p + ' sets a theme colour so iOS chrome does not flash');
  });
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  ok(/playbook\.html/.test(sw) && /horse\.html/.test(sw), 'both pages are cached for offline use');

  // ...and the app has to honour that hash when it boots, or the link is decoration.
  global.location.hash = '#study';
  ok(A.tabFromHash() === 'Study', 'the app resolves #study to the Study tab');
  global.location.hash = '#progress';
  ok(A.tabFromHash() === 'Progress', 'and #progress to Progress');
  global.location.hash = '#nonsense';
  ok(A.tabFromHash() === null, 'an unknown hash is ignored rather than blanking the app');
  global.location.hash = '';

  ok(/id="studyLib"/.test(HTML), 'the guides live in a Library view, not as loose buttons under the drill');
  ok(/data-v="lib"/.test(HTML), 'Study has a Library segment');
  ok(/class="libitem"/.test(HTML), 'each guide gets a described entry rather than a bare link');
}

console.log('drill controls — one row of modes, options folded away');
{
  ok(/id="drillOptsBtn"/.test(HTML) && /id="drillOpts"/.test(HTML), 'options have their own button and panel');
  const study = fs.readFileSync(path.join(APP, 'study.js'), 'utf8');
  // The regression that mattered: mode tabs and 7 tiny toggles concatenated into one row.
  ok(!/\}\)\.join\(''\) \+ \(mode === 'pf'/.test(study),
    'the mode row no longer has the focus toggles concatenated onto it');
  ok(/function optionsHtml/.test(study), 'the toggles moved into their own panel builder');
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  const tog = /\.minitog\{[^}]*\}/.exec(css)[0];
  ok(/height:40px/.test(tog), 'option chips are 40px tall, not the old 11px-font 22px sliver');
  ok(/\.sel\.modes button\{[^}]*min-height:44px/.test(css), 'mode tabs meet the 44px tap minimum');
}

console.log('log tab — session card first, then the hand');
{
  ok(/id="sessPanel"/.test(HTML), 'the session gets its own card');
  ok(/id="sessSetup"/.test(HTML), 'and its setup fields are a separable block');
  A.db = A.fresh();
  A.renderSession();
  ok(el('sessSetup').hidden === false, 'with no session running the setup fields are shown');
  ok(/Start session/.test(el('sessRow')._html), 'and the primary action is to start one');

  A.db.activeSession = { id: 's1', game: 'cash', stakes: '1/3', venue: 'Card room', startTs: Date.now() - 3600000 * 2.5 };
  A.renderSession();
  ok(el('sessSetup').hidden === true, 'once running, the setup fields disappear instead of sitting there greyed out');
  ok(/2h 30m/.test(el('sessRow')._html), 'the card shows elapsed time (2h 30m)');
  ok(/End session/.test(el('sessRow')._html), 'and offers to end it');
  ok(/0 hands logged/.test(el('sessRow')._html), 'with a count of what has been captured');
}

console.log('information architecture — four destinations, settings behind the gear');
{
  const navIds = (HTML.match(/<nav>[\s\S]*?<\/nav>/) || [''])[0].match(/id="nav(\w+)"/g) || [];
  ok(navIds.length === 4, 'the tab bar has four buttons, not five (' + navIds.length + ')');
  ok(/id="navData"[^>]*class="gear"/.test(HTML), 'Data moved to a header gear');
  ['tab-log', 'tab-history', 'tab-study', 'tab-progress', 'tab-data'].forEach(id =>
    ok(HTML.includes('id="' + id + '"'), id + ' section exists'));
  ok(!/id="tab-new"/.test(HTML) && !/id="tab-hands"/.test(HTML), 'the old New/Hands sections are gone, not orphaned');
}

console.log('history holds both record views');
{
  A.db = A.fresh();
  A.loadSamples();
  // seg() reads its current value from the `.on` button in the markup; the shim's
  // querySelector returns null, so stand in for the default selection here.
  el('segHist').querySelector = () => ({ dataset: { v: 'hands' } });
  A.showTab('History');
  ok(el('tab-history').hidden === false, 'History opens');
  ok(el('histHands').hidden === false && el('histResults').hidden === true, 'it lands on Hands');
  ok(el('handList')._html.length > 0, 'the hand list rendered');

  el('segHist').querySelector = () => ({ dataset: { v: 'results' } });
  A.renderHist();
  ok(el('histResults').hidden === false && el('histHands').hidden === true, 'switching to Results swaps the view');
  ok(el('logList')._html.length > 0, 'the results list rendered');
}

console.log('adding a result reveals the form in the capture tab');
{
  el('resultPanel').hidden = true;
  el('addResult').onclick();
  ok(el('resultPanel').hidden === false, 'the result form is revealed');
  ok(el('tab-log').hidden === false, 'and we are on the capture tab to fill it in');
}

console.log('progress — the report, and the splits that are the point of it');
{
  A.db = A.fresh();
  A.showTab('Progress');
  ok(/Nothing to report yet/.test(el('progMoney')._html), 'empty state explains what will appear');

  A.loadSamples();
  A.showTab('Progress');
  const html = el('progMoney')._html;
  // sample data: cash +485 and −110; tourneys −150 and +1200  =>  +1425 over 10.5 logged hours
  ok(/\$1,425/.test(html), 'net is computed across cash AND tournaments (expected $1,425)');
  ok(/10\.5 hours/.test(html), 'hours come from the sessions that have them');
  ok(/<svg class="curve"/.test(html), 'the bankroll curve is drawn');
  ok(/By room/.test(html) && /By day/.test(html), 'splits by room and by day are present');
  ok(/By stakes/.test(html), 'split by stakes is present');
  ok(/50%/.test(html), 'winning-session rate is right (2 of 4)');

  // A losing record must read as losing — a tracker that flatters you is worse than none.
  A.db = A.fresh();
  A.db.sessions.push({ id: 'x', date: '2026-08-01', venue: 'Room', stakes: '1/3', hours: '4', buyin: '500', cashout: '100' });
  A.showTab('Progress');
  ok(/−\$400/.test(el('progMoney')._html), 'a losing session shows a negative net, not an absolute value');
  ok(/−\$100\/h/.test(el('progMoney')._html), 'and a negative hourly rate');
}

console.log('progress — your game (skill, not money)');
{
  A.db = A.fresh();
  A.showTab('Progress');
  el('segProg').querySelectorAll = () => [];
  A.renderGameProgress();
  ok(/Not enough drills yet/.test(el('progGame')._html), 'asks for drills before claiming a trend');

  for (let i = 0; i < 60; i++) A.db.drills.push({ t: i, m: i % 2 ? 'pf' : 'flop', k: 'x' + i, r: i % 3 ? 1 : 0 });
  A.renderGameProgress();
  const g = el('progGame')._html;
  ok(/Last 50 spots/.test(g), 'reports recent accuracy');

  // C7 — a hand replay is a review. Counting it would let freeform nonsense in a logged hand
  // drag down a number that is meant to measure drilling.
  const gradedOnly = /(\d+)%/.exec(g)[1];
  for (let i = 0; i < 40; i++) A.db.drills.push({ t: 1000 + i, m: 'mine', k: 'r' + i, r: null, review: 1 });
  A.renderGameProgress();
  ok(/(\d+)%/.exec(el('progGame')._html)[1] === gradedOnly,
    'forty hand-reviews do not move drill accuracy at all (' + gradedOnly + '%)');
  ok(/Preflop/.test(g) && /Flop/.test(g), 'breaks accuracy down by street');
  ok(!/\$/.test(g), 'the skill view never shows dollar signs — it is percentages');
}

console.log('eviction recovery is wired into boot, not just into storage.js');
{
  // Self-contained: the sections above reset db, so establish our own known state here.
  A.db = A.fresh();
  A.db.hands.push({ id: 'keep1', ts: 1, pos: 'CO' }, { id: 'keep2', ts: 2, pos: 'SB' });
  A.save();
  await Store.flush();
  const mirrored = files['pokerlog/pokerlog.v1.json'];
  ok(!!mirrored && JSON.parse(mirrored).hands.length === 2, 'mirror holds the saved hands');

  ls._wipe();                                   // iOS reclaims the working copy
  A.db = A.fresh();                             // ...and the app boots empty, as it would
  ok(A.db.hands.length === 0, 'the app came up with nothing after eviction');

  await Store.recover(['pokerlog.v1']);
  ok(ls.getItem('pokerlog.v1') !== null, 'recover() put the working copy back');
  ok(A.db.hands.length === 2 && A.db.hands[0].id === 'keep1', 'the app re-hydrated db from the recovered copy');
}

// Found on a real iOS build by the Mac session (issue #2, bug 1). The first-run decision
// runs at boot, but the mirror restore resolves later — so a user who had just LOST their
// localStorage was shown a welcome tour for an app they already owned, at the exact moment
// they were deciding whether it had eaten their data.
// One test per row of the session decision table in MAC_SESSION.md Part 2. This is the
// bug-prone surface of the whole app, so the table is executable rather than aspirational.
// Every one of these was found on hardware or in a simulator by the Mac session (issue #2).
// The highest-severity bug in the project, found on device: export was a browser download
// WKWebView ignores, and the timestamp was written anyway — so the app reported a backup it
// had never made, against the one promise everything else rests on.
// Standing constraint from the owner: the UI must size flexibly at any screen. The wireflow
// was drawn at iPhone 16 Pro dimensions — a reference rendering, not a layout target.
// Found by the owner in real use — mostly navigation and state, not logic.
// Found on a device by the Mac session — R1 was my own regression, and none of these are
// visible in a browser, where env(safe-area-inset-*) is 0 and date inputs render as text.
console.log('swipe back, and only where there is a back to go to');
{
  // The iOS pattern is a LEFT-EDGE swipe meaning Back on a drill-down. Deliberately not
  // swiping between tabs: that is Material, it collides with this gesture, and Study's mode
  // row is a horizontal scroller a tab-level swipe would fight with.
  ok(/const BACK_TO = \{History: 'Progress', Hand: 'History', Game: 'Progress', Data: 'Home'\}/.test(HTML),
    'every pushed window knows where back goes');
  ok(/EDGE = 24/.test(HTML), 'the gesture must start at the edge, so it cannot fire mid-scroll');
  ok(/dx > dy \* 1\.6/.test(HTML), 'and must be clearly horizontal, or it was a scroll');
  ok(!/swipe.*between.*tabs/i.test(HTML), 'no tab-to-tab swiping');

  A.showTab('History');
  ok(A.goBack() === true && el('tab-progress').hidden === false, 'History swipes back to Progress');
  A.showTab('Hand');
  ok(A.goBack() === true && el('tab-history').hidden === false, 'Hand goes back to History, not straight out');
  A.showTab('Home');
  ok(A.goBack() === false, 'a top-level tab has nowhere to go back to, so nothing happens');
}

console.log('controls share a height and clear the tap minimum');
{
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  // D1 residual: bottoms aligned but the segment was 46px against 41px inputs, so its label
  // sat 5px high — and 41px is under the 44pt iOS tap minimum either way.
  ok(/input\[type=text\],input\[type=number\],input\[type=date\],textarea\{[^}]*min-height:46px/.test(css),
    'inputs are 46px — matching the segment and clearing the 44pt tap minimum');
  ok(/\.seg\{min-height:46px\}/.test(css), 'the segment is the same height');
  ok(/input\[type=date\]\{[^}]*height:46px/.test(css), 'and so is the date control');
}

console.log('the intro describes the app that exists');
{
  // It had not been re-read since the tab bar changed: it still pointed at a "⚙ screen"
  // and never mentioned the session clock, which is now the first thing a user meets.
  ok(/⚙ Settings/.test(HTML), 'it names Settings as it is actually labelled');
  ok(/the clock runs in the background/.test(HTML), 'and explains the session clock');
  ok(/an hourly rate there would be invented/.test(HTML), 'and why tournaments are judged differently');
}

console.log('layout regressions the browser cannot see');
{
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));

  // R1 — header is the first element in body, so top:env(...) sticks at scroll 0 and adds a
  // second inset on top of its own padding. The padding is the correct one.
  ok(/header\{position:sticky; top:0;/.test(css), 'R1: the header sticks at 0, not at one inset');
  ok(/header\{padding:calc\(10px \+ env\(safe-area-inset-top\)\)/.test(css),
    'R1: while its padding still clears the status bar — that half was right');
  ok(!/position:sticky; top:env\(safe-area-inset-top\)/.test(css), 'R1: the duplicate offset is gone');
  ok(/body::before\{[^}]*height:env\(safe-area-inset-top\)/.test(css), 'R1: and the backdrop is untouched');

  // D3 — iOS sizes input[type=date] from its native shadow content and ignores width:100%,
  // so it overflowed its column and landed on the field beside it. min-width:0 did not help.
  ok(/input\[type=date\]\{-webkit-appearance:none; appearance:none/.test(css),
    'D3: the native date appearance is dropped so the control can be sized');
  ok(/input\[type=text\],input\[type=number\],input\[type=date\],textarea\{[^}]*min-width:0/.test(css),
    'D3: and fields may shrink inside their column');

  // D2(b) — iOS aligns a focused field to the viewport top, which is under the sticky header.
  ok(/scroll-margin-top:calc\(96px \+ env\(safe-area-inset-top\)\)/.test(css),
    'D2: focused fields reserve the header height so they do not land beneath it');

  // D1 — the segment had no label, so it stretched into the label row and sat taller.
  ok(/<label class="lab" style="margin-top:0">Game<\/label>/.test(HTML), 'D1: the game control has a label');
  ok(/\.seg button\{flex:1; height:44px/.test(css), 'D1: and matches the height of the fields beside it');
  ok(/\.row\{display:flex; gap:8px; align-items:flex-end\}/.test(css),
    'D4: rows bottom-align, so a label that wraps cannot drag its input out of line');
}

console.log('a session started by mistake can be discarded');
{
  A.db = A.fresh();
  A.db.activeSession = { id: 'oops', game: 'cash', stakes: '1/3', venue: 'R', startTs: Date.now() };
  A.db.hands.push({ id: 'k1', ts: 1, pos: 'BTN', sessionId: 'oops' });
  A.renderSession();
  ok(/sessDiscard/.test(el('sessRow')._html), 'D5: a running session offers a way out');

  A.discardSession();
  await answerAsk(false);
  ok(A.db.activeSession !== null, 'declining leaves it running');

  A.discardSession();
  await answerAsk(true);
  ok(A.db.activeSession === null, 'accepting stops the clock');
  ok(A.db.hands.length === 1, 'and KEEPS the hand — hands are the expensive thing, a session frame is a timestamp');
  ok(A.db.hands[0].sessionId === null, 'just unlinked, matching what deleting a results row does');
  ok(A.db.sessions.length === 0 && A.db.tourneys.length === 0, 'no result is invented for a session that did not happen');
}

console.log('currency drives the labels too, not just the amounts');
{
  A.db = A.fresh();
  ok(/Buy-in <span class="curSym">/.test(HTML), 'money labels carry a symbol element rather than a hardcoded $');
  ok((HTML.match(/class="curSym"/g) || []).length >= 6, 'on every money field');
  ok(/function paintCurrency/.test(HTML), 'and something repaints them when the setting changes');
}

console.log('hand detail is its own screen');
{
  A.db = A.fresh();
  A.db.hands.push({ id: 'd1', ts: Date.now(), pos: 'BTN', c1: 'Ah', c2: 'Kd', stakes: '1/3',
    venue: 'Room', action: 'open15 btn3b45 c', sign: '-', amount: '120', note: 'gave up too fast' });
  A.openHandDetail('d1');
  const h = el('handDetail')._html;
  ok(el('tab-hand').hidden === false, 'it opens as a pushed window, not an inline expander');
  ok(/gave up too fast/.test(h), 'the note is shown');
  ok(/open15 btn3b45 c/.test(h), 'and the action as typed');
  ok(/Flag for review/.test(h) && /Mark reviewed/.test(h), 'flag and review live here — the loop entry point');

  el('dFlag').onclick();
  ok(A.db.hands[0].flag === true, 'flagging works');
  el('dReviewed').onclick();
  ok(A.db.hands[0].reviewed === true && A.db.hands[0].flag === false,
    'marking reviewed clears the flag — it is settled, so it leaves the rotation');

  el('handBack').onclick();
  ok(el('tab-history').hidden === false, 'back returns to History');

  A.openHandDetail('nope');
  ok(/gone/.test(el('handDetail')._html), 'a deleted hand says so instead of rendering blank');
}

console.log('history search');
{
  A.db = A.fresh();
  A.db.hands.push(
    { id: 'a', ts: 3, pos: 'BTN', c1: 'Ah', c2: 'Kd', action: 'open15', note: 'squeeze spot' },
    { id: 'b', ts: 2, pos: 'CO', c1: 'Qs', c2: 'Qh', action: 'open12', note: '' });
  el('histSearch').value = '';
  A.renderHands();
  ok((el('handList')._html.match(/data-act="toggle"/g) || []).length === 2, 'no query shows everything');
  el('histSearch').value = 'squeeze';
  A.renderHands();
  ok((el('handList')._html.match(/data-act="toggle"/g) || []).length === 1, 'a note matches');
  el('histSearch').value = 'qs';
  A.renderHands();
  ok((el('handList')._html.match(/data-act="toggle"/g) || []).length === 1, 'so do cards');
  el('histSearch').value = 'zzz';
  A.renderHands();
  ok(/No hands in this view/.test(el('handList')._html), 'and a miss says so');
  el('histSearch').value = '';
  A.renderHands();
}

console.log('no browser dialogs left, and the status bar has a backdrop');
{
  const app = HTML.replace(/Replaces confirm\(\)[\s\S]*?\*\//, '');
  ok(!/[^.\w]confirm\(/.test(app), 'no confirm() survives — a WKWebView titles it with the app host');
  ok(/id="ask"/.test(HTML) && /id="askYes"/.test(HTML), 'an in-app sheet replaces it');
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  ok(/body::before\{content:''; position:fixed; top:0[^}]*height:env\(safe-area-inset-top\)/.test(css),
    'the status-bar inset is painted, so nothing scrolls under the clock unreadably');
  ok(/header\{position:sticky/.test(css), 'and the header stays put');

  // Destructive actions must be answerable both ways.
  A.db = A.fresh();
  A.db.hands.push({ id: 'x', ts: 1, pos: 'BTN' });
  el('clearAll').onclick();
  await answerAsk(false);
  ok(A.db.hands.length === 1, 'declining Erase everything keeps the data');
  el('clearAll').onclick();
  await answerAsk(true);
  ok(A.db.hands.length === 0, 'accepting it erases');
}

console.log('what keeps catching you');
{
  A.db = A.fresh();
  // Scattered misses are not a pattern, and claiming one would be invention.
  for (let i = 0; i < 8; i++) A.db.drills.push({ t: i, m: ['pf','flop','turn','river'][i % 4], k: 'real:cb', r: 'wrong' });
  A.db.drills.forEach((d, i) => { if (i % 2) d.k = 'real:fcr'; });
  A.renderGameProgress();
  const scattered = el('progGame')._html;

  A.db = A.fresh();
  for (let i = 0; i < 14; i++) A.db.drills.push({ t: i, m: 'river', k: 'real:fcr', r: i < 11 ? 'wrong' : 'right' });
  for (let i = 0; i < 6; i++) A.db.drills.push({ t: 100 + i, m: 'pf', k: 'open|BTN', r: 'right' });
  A.renderGameProgress();
  const g = el('progGame')._html;
  ok(/What keeps catching you/.test(g), 'the section exists');
  ok(/River, facing a bet/.test(g), 'a real cluster is named in English (got: ' + (/<b>([^<]*)<\/b>/.exec(g) || [])[1] + ')');
  ok(/11 of your last 11 misses/.test(g), 'with the count it is based on');
  ok(!/River, facing a bet/.test(scattered), 'and scattered misses claim nothing');
}

console.log('currency is display-only');
{
  A.db = A.fresh();
  A.db.sessions.push({ id: 's', date: '2026-08-01', venue: 'R', stakes: '1/3', hours: '2', buyin: '100', cashout: '250' });
  A.showTab('Progress');
  ok(/\$150/.test(el('progMoney')._html), 'dollars by default');
  A.db.prefs.cur = '€';
  A.renderProgress();
  ok(/€150/.test(el('progMoney')._html), 'switching the symbol re-renders amounts');
  ok(!/\$150/.test(el('progMoney')._html), 'and the dollar sign is gone');
  ok(/never converted/.test(HTML), 'the screen says it is display-only, not a conversion');
  A.db.prefs.cur = '$';
}

console.log('a restored user gets a count, not a welcome');
{
  A.db = A.fresh();
  A.db.prefs.onboarded = true;
  A.db.hands.push({ id: 'a', ts: 1, pos: 'BTN' }, { id: 'b', ts: 2, pos: 'CO' });
  A.db.drills.push({ t: 1, m: 'pf', k: 'x', r: 'right' });
  A.save();
  await Store.flush();
  ls._wipe();
  A.db = A.fresh();
  await Store.recover(['pokerlog.v1']);
  const h = el('homeRestored')._html;
  ok(el('homeRestored').hidden === false, 'a card appears rather than a toast that scrolls away');
  ok(/2 hands/.test(h), 'naming exactly what came back');
  ok(/Nothing was lost/.test(h), 'and answering the question they are actually asking');
  el('restoredOk').onclick();
  ok(el('homeRestored').hidden === true, 'and it dismisses');
}

console.log('real-use findings C1-C9');
{
  // C1 — a fresh load with a hash fires no hashchange, so "Back to Study" always hit Home.
  global.location.hash = '#study';
  A.showTab(A.tabFromHash() || 'Home');
  ok(el('tab-study').hidden === false, 'C1: a load carrying #study opens Study, not Home');
  global.location.hash = '';
  A.showTab(A.tabFromHash() || 'Home');
  ok(el('tab-home').hidden === false, 'C1: and no hash still falls back to Home');

  // C9 — Log was the one tab that did not re-render on navigation, so it showed whatever was
  // drawn there last. That is a bug factory: every mutating path must remember to refresh it.
  ok(/if \(name === 'Log'\)\{ renderSession\(\); renderLog\(\); \}/.test(HTML),
    'C9: Log re-renders on navigation like every other tab');

  // C3 — a running session is rendered by three surfaces; both save handlers refreshed two.
  const saves = HTML.match(/toast\('(tournament|session) saved'\)/g) || [];
  ok(saves.length === 2, 'both save handlers found');
  ok((HTML.match(/renderLog\(\); renderProgress\(\); renderSession\(\); renderHome\(\); renderLiveBar\(\);/g) || []).length === 2,
    'C3: and both now refresh the session surfaces too, not just Log and Progress');

  // C2 — Home used to navigate to Log and then click Start for you, so a returning user with
  // saved prefs got a running session at their last stakes with no confirmation.
  ok(!/const b = \$\('sessStart'\); if \(b\) b\.onclick\(\)/.test(HTML),
    'C2: Home never starts a session on the user’s behalf');
  A.db = A.fresh();
  A.db.prefs.stakes = '1/3'; A.db.prefs.venue = 'Test';
  A.renderHome();
  el('homeStart').onclick();
  ok(!A.db.activeSession, 'C2: tapping Start a session opens the setup rather than starting one');
  ok(el('tab-log').hidden === false, 'C2: and takes you to where the details are entered');

  // C4 — the card looked exactly like the ones that are buttons, and had no handler at all.
  A.db = A.fresh();
  A.db.hands.push({ id: 'f', ts: 1, pos: 'BTN', c1: 'Ah', c2: 'Kd', action: 'open15', flag: true });
  A.renderLeaksCard();
  ok(/id="drillLeaks"/.test(el('studyLeaks')._html), 'C4: the leaks card offers a real action');

  // C6 — Home is the hub; a hub whose numbers are dead ends is a dashboard.
  A.renderHome();
  ok(/data-go="Progress"/.test(el('homeTiles')._html), 'C6: This month opens Progress');
  ok(/data-go="Game"/.test(el('homeTiles')._html), 'C6: Drills opens Your game');
  ok(/data-go="History"/.test(el('homeRoutes')._html), 'C6: and Home has a hand-history route');

  // C8 — the primary action butted into the segmented control and the two inputs.
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  ok(/#sessSetup\{margin-bottom:\d+px\}/.test(css), 'C8: the session setup has breathing room below it');
}

console.log('layout is not pinned to one device');
{
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  ok(/--maxw:\d+px/.test(css), 'there is one knob for the width ceiling');
  ok(/main\{max-width:var\(--maxw\)/.test(css), 'content is capped and centred rather than stretched');
  ok(/nav\{[^}]*padding-left:max\(0px/.test(css), 'and the tab bar keeps its buttons in the same column');
  ok(/font-size:clamp\(/.test(css), 'display numbers scale with the viewport');

  // Nothing may force the layout wider than a small phone's content box (375 − 28 padding).
  const mins = [...css.matchAll(/min-width:(\d+)px/g)].map(m => +m[1]).filter(n => n > 0);
  const tooWide = mins.filter(n => n > 347);
  ok(tooWide.length === 0, 'no rule forces a width an iPhone SE cannot give (' + JSON.stringify(tooWide) + ')');
  const cols = [...css.matchAll(/minmax\((\d+)px/g)].map(m => +m[1]);
  ok(cols.every(n => n * 2 <= 347), 'two-up grids still fit two-up on the smallest phone');
}

console.log('export writes a real file, and never lies about it');
{
  A.db = A.fresh();
  A.db.hands.push({ id: 'h', ts: 1, pos: 'BTN' });

  // Native path: a file must land on disk BEFORE anything claims success.
  const realWriteFile = window.Capacitor.Plugins.Filesystem.writeFile;
  const writes = [];
  window.Capacitor.Plugins.Filesystem.writeFile = o => {
    writes.push(o); return Promise.resolve({ uri: 'file:///Documents/' + o.path });
  };
  const shared = [];
  window.Capacitor.Plugins.Share = { share: o => { shared.push(o); return Promise.resolve(); } };

  await A.exportBackup();
  ok(writes.length === 1, 'a file is written');
  ok(writes[0].directory === 'DOCUMENTS', 'into Documents, so it shows up in the Files app');
  ok(/pokerlog-backup-\d{4}-\d{2}-\d{2}\.json/.test(writes[0].path), 'with a dated name');
  ok(JSON.parse(writes[0].data).hands.length === 1, 'containing the actual data');
  ok(JSON.parse(writes[0].data).v === 1, 'and a schema version, so a future restore knows what it has');
  ok(A.db.prefs.lastExportTs > 0, 'and only now is the export recorded');
  ok(shared.length === 1, 'the share sheet is offered on top');

  // Cancelling the share sheet must not undo a file that already exists — that is the whole
  // reason the write comes first.
  const ts = A.db.prefs.lastExportTs;
  window.Capacitor.Plugins.Share.share = () => Promise.reject(new Error('cancelled'));
  await A.exportBackup();
  ok(A.db.prefs.lastExportTs >= ts, 'a cancelled share still leaves a saved backup');

  // A failed write must NOT claim success. This is the exact trap that shipped.
  A.db = A.fresh();
  A.db.hands.push({ id: 'h', ts: 1, pos: 'BTN' });
  window.Capacitor.Plugins.Filesystem.writeFile = () => Promise.reject(new Error('disk full'));
  await A.exportBackup();
  ok(!A.db.prefs.lastExportTs, 'a failed export records nothing — the app never reports a backup it did not make');

  // Put the real mirror mock back. These stubs are shared with the eviction tests further
  // down, and leaving a rejecting writeFile in place silently broke them.
  window.Capacitor.Plugins.Filesystem.writeFile = realWriteFile;
  delete window.Capacitor.Plugins.Share;
}

console.log('schema version');
{
  ok(/const SCHEMA = 1/.test(HTML), 'the store carries a schema version');
  ok(A.fresh().v === 1, 'new databases are stamped');
  const legacy = A.migrate({ hands: [], tourneys: [], sessions: [] });
  ok(legacy.v === 1, 'pre-versioning data is treated as v1 rather than left undefined');

  // Restoring a NEWER backup would silently drop fields this build does not know about.
  A.db = A.fresh();
  A.db.hands.push({ id: 'keep', ts: 1, pos: 'BTN' });
  A.restoreFrom({ v: 99, hands: [{ id: 'newer', ts: 2 }] });
  ok(A.db.hands.length === 1 && A.db.hands[0].id === 'keep', 'a backup from a newer version is refused, not mangled');
}

console.log('the app asks for a backup once, before it is too late');
{
  A.db = A.fresh();
  for (let i = 0; i < 24; i++) A.db.hands.push({ id: 'h' + i, ts: i, pos: 'BTN' });
  ok(A.maybePromptBackup() === false, 'quiet below the threshold');
  A.db.hands.push({ id: 'h25', ts: 25, pos: 'BTN' });
  ok(A.maybePromptBackup() === true, 'prompts at 25 hands');
  await answerAsk(false);                              // "not now"
  ok(A.maybePromptBackup() === false, 'and never again — a prompt people learn to dismiss is worth nothing');
  A.db = A.fresh();
  A.db.prefs.lastExportTs = Date.now();
  for (let i = 0; i < 40; i++) A.db.hands.push({ id: 'x' + i, ts: i, pos: 'BTN' });
  ok(A.maybePromptBackup() === false, 'and never at all for someone who already exported');
}

console.log('settings and about');
{
  A.db = A.fresh();
  A.showTab('Data');
  ok(/version 0\.\d+\.\d+/.test(el('appVersion').textContent), 'a version is shown (' + el('appVersion').textContent + ')');
  ok(/dataBack/.test(HTML), 'Settings is a pushed screen with a way back');

  // The MIT licence has to travel with the bundled hand corpus, so it ships IN the app —
  // a notice that only exists in a repo file does not satisfy the licence for a shipped app.
  ok(/Universal, Open, Free, and Transparent Computer Poker Research Group/.test(HTML),
    'the phh copyright holder is named');
  ok(/MIT License/.test(HTML), 'the licence is named');
  ok(/Permission is hereby granted, free of charge/.test(HTML), 'and the permission notice ships verbatim');
  ok(/WITHOUT WARRANTY OF ANY KIND/.test(HTML), 'along with the warranty disclaimer the licence requires');
  ok(/anonymised online hand histories from 2009/.test(HTML),
    'and it says what "real hands" actually are, so the claim is not oversold');

  // Default state lives in the markup; the shim does not read it, so assert it there.
  ok(/<div id="credits" hidden>/.test(HTML), 'the licence text is collapsed by default');
  el('credits').hidden = true;
  el('showCredits').onclick();
  ok(el('credits').hidden === false, 'and opens on tap');
  ok(/Hide acknowledgements/.test(el('showCredits').textContent), 'with the button saying how to close it');

  // Overclaiming the engine invites refunds and a comparison this loses.
  ok(/approximate-Nash/.test(HTML) && /not a full postflop solver/.test(HTML),
    'About states plainly what the drill answers are and are not');

  // A Restore button that restores nothing is worse than none — App Review wants the path to
  // work, not merely to exist. It stays hidden until in-app purchase is real.
  ok(el('proRow').hidden === true, 'Restore purchases is hidden while there is no purchase to restore');
  ok(/const IAP_READY = false/.test(HTML), 'gated on one flag the paywall work flips');
}

console.log('bug sweep regressions');
{
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  // B12 — tab-log kept the old default's visibility, so first launch stacked Home AND the
  // whole Log form, showing a new user two Start-session buttons.
  ok(/<section id="tab-log" hidden>/.test(HTML), 'B12: tab-log starts hidden');
  const sections = (HTML.match(/<section id="tab-[a-z]+"( hidden)?>/g) || []);
  ok(sections.filter(x => !/hidden/.test(x)).length === 1, 'B12: exactly one section is visible in the markup');
  ok(/showTab\(tabFromHash\(\) \|\| 'Home'\);/.test(HTML),
    'B12/C1: boot derives the tab from the hash, falling back to Home — markup is not load-bearing');

  // B13 — .big was used for three buttons and never defined: white pills in a dark app.
  ok(/\n  \.big\{/.test(css), 'B13: .big is defined');
  ok(/\.big b\{display:block/.test(css), 'B13: title and description are separated');

  // B8 — WKWebView will not repaint a placeholder on an unfocused input.
  ok(/id="stakesLab"/.test(HTML), 'B8: stakes uses a real label element');
  ok(!/\$\('stakes'\)\.placeholder =/.test(HTML), 'B8: and nothing mutates its placeholder any more');
}

console.log('amount and eff cannot store nonsense');
{
  // B9 — Won/Lost carries the sign, so a typed "-50" made a hand marked won, for minus fifty.
  A.db = A.fresh();
  A.resetForm();
  A.selPos('BTN');
  el('segWL').querySelector = () => ({ dataset: { v: '+' } });   // "Won" is selected
  el('action').value = 'open15';
  el('amount').value = '-50';
  el('eff').value = 'abc';
  el('saveHand').onclick();
  const h = A.db.hands[0];
  ok(h.amount === '50', 'B9: a typed minus is stripped — the sign lives in Won/Lost (got ' + h.amount + ')');
  ok(h.eff === '', 'B11: non-numeric eff is rejected rather than saved as "abcbb" (got ' + JSON.stringify(h.eff) + ')');

  A.resetForm();
  A.selPos('CO');
  el('action').value = 'open15';
  el('amount').value = '12.5';
  el('eff').value = '300';
  el('saveHand').onclick();
  ok(A.db.hands[0].amount === '12.5' && A.db.hands[0].eff === '300', 'but real numbers pass through untouched');
}

console.log('the splits do not flatter you');
{
  // B14 — tournaments carry no clock, so a mixed group divided tournament winnings by
  // cash-only hours and reported a venue ~4x more profitable per hour than it was.
  A.db = A.fresh();
  A.loadSamples();
  el('segProg').querySelector = () => ({ dataset: { v: 'all' } });
  A.showTab('Progress');
  const m = el('progMoney')._html;
  const room = /Card room[\s\S]{0,400}?\$([\d,.]+)\/h/.exec(m);
  ok(!!room, 'the by-room split shows an hourly rate');
  if (room) ok(!/135\.71/.test(room[0]), 'B14: it is no longer the inflated $135.71/h');
  ok(/\/h cash/.test(m), 'B14: and a mixed group labels the rate cash-only');
  ok(/\$1,425/.test(m), 'while net still counts tournaments');
}

console.log('home — the hub');
{
  A.db = A.fresh();
  A.showTab('Home');
  ok(el('tab-home').hidden === false, 'Home opens');
  ok(/Start a session/.test(el('homeSession')._html), 'with nothing running, the primary action is to start');
  // A brand-new user should be told what will appear here, not shown two dashes.
  ok(/Nothing logged yet/.test(el('homeRoutes')._html), 'a first-time Home explains itself instead of showing empty tiles');
  ok(el('homeTiles')._html === '', 'and draws no stat furniture with nothing to put in it');
  ok(/Log your first hand/.test(el('homeRoutes')._html), 'offering the two things they can actually do');

  A.db.hands.push({ id: 'seed', ts: Date.now(), pos: 'BTN' });
  A.renderHome();
  ok(/This month/.test(el('homeTiles')._html) && /Drills/.test(el('homeTiles')._html), 'once there is data, two tiles answer "how am I doing"');

  A.db.activeSession = { id: 'h1', game: 'cash', stakes: '1/3', venue: 'Room', startTs: Date.now() - 2.5 * 3600000 };
  A.db.hands.push({ id: 'x', ts: 1, pos: 'BTN', sessionId: 'h1' });
  A.renderHome();
  ok(/2h 30m/.test(el('homeSession')._html), 'with a session running the clock is the page');
  ok(/Log a hand/.test(el('homeSession')._html), 'and logging is the primary button');
  ok(/1 hand logged/.test(el('homeSession')._html), 'counting what has been captured, in English');

  A.db.hands.push({ id: 'f', ts: 2, pos: 'CO', flag: true });
  A.renderHome();
  ok(/hand to review|hands to review/.test(el('homeRoutes')._html), 'flagged hands are surfaced on Home');
}

console.log('empty states say what will appear, not nothing');
{
  A.db = A.fresh();
  A.showTab('Study');
  ok(/Nothing flagged yet/.test(el('studyLeaks')._html), 'Study explains the flagged-hand loop before it has anything in it');
  ok(/no tracker does/.test(el('studyLeaks')._html), 'and says why it matters, since it is the differentiator');

  A.db.hands.push({ id: 'f1', ts: 1, pos: 'BTN', flag: true });
  A.showTab('Study');
  ok(/1 flagged hand waiting/.test(el('studyLeaks')._html), 'and counts them once they exist, in English');

  A.db = A.fresh();
  A.db.hands.push({ id: 'a', ts: 1, pos: 'BTN' });
  A.setHandFilter('flag');
  ok(/Tap ⚑ while logging/.test(el('handList')._html), 'an empty filter explains how to fill it rather than saying "none"');
  A.setHandFilter('all');
}

console.log('a running session follows you onto every tab');
{
  A.db = A.fresh();
  A.db.activeSession = { id: 'h1', game: 'cash', stakes: '1/3', venue: 'Room', startTs: Date.now() - 3600000 };
  A.showTab('Study');
  ok(el('liveBar').hidden === false, 'the live bar shows on Study');
  ok(/1h 00m/.test(el('liveBar')._html), 'carrying the clock');
  A.showTab('Home');
  ok(el('liveBar').hidden === true, 'but not on Home, where the card already IS the clock');
  A.db.activeSession = null;
  A.showTab('Study');
  ok(el('liveBar').hidden === true, 'and never when no session is running');
}

console.log('progress — scoped, with honest tournament stats');
{
  A.db = A.fresh();
  A.loadSamples();
  el('segProg').querySelector = () => ({ dataset: { v: 'mtt' } });
  A.showTab('Progress');
  const m = el('progMoney')._html;
  // samples: $150 buy-in x2 bullets, cashed 0 + $150 bounty = -150; $250 x1, cashed 1450 = +1200
  ok(/ROI/.test(m) && !/Per hour/.test(m), 'tournaments show ROI, never an hourly rate they cannot support');
  ok(/191%/.test(m), 'ROI is net over buy-ins ($1,050 on $550 = 191%)');
  ok(/In the money/.test(m) && /1 of 2 cashed/.test(m), 'and in-the-money, which is what a tournament player judges by');
  ok(/no clock, so an hourly figure would be invented/.test(m), 'the screen says WHY there is no hourly rate');

  el('segProg').querySelector = () => ({ dataset: { v: 'cash' } });
  A.renderProgress();
  const c = el('progMoney')._html;
  ok(/Per hour/.test(c) && !/ROI/.test(c), 'cash shows an hourly rate, which it can support');
  ok(/\$375/.test(c), 'cash net is right (+485 and −110)');

  el('segProg').querySelector = () => ({ dataset: { v: 'all' } });
  A.renderProgress();
  const a = el('progMoney')._html;
  ok(/\$1,425/.test(a), 'overall combines both');
  ok(/cash only/.test(a), 'and labels the hourly rate as cash-only rather than quietly averaging tournaments in');
}

console.log('history and your game are pushed windows, not tabs');
{
  const nav = (HTML.match(/<nav>[\s\S]*?<\/nav>/) || [''])[0];
  ok(!/navHistory/.test(nav), 'History no longer holds a nav slot');
  ok(/navHome/.test(nav), 'Home took one');
  ok((nav.match(/id="nav/g) || []).length === 4, 'still exactly four tabs');

  A.showTab('Progress');
  ok(/openHist/.test(el('progMoney')._html) && /openGame/.test(el('progMoney')._html), 'Progress offers both windows');
  A.showTab('History');
  ok(el('tab-history').hidden === false, 'History opens as its own screen');
  ok(el('tab-progress').hidden === true, 'over Progress, not beside it');
  el('histBack').onclick();
  ok(el('tab-progress').hidden === false, 'and back returns to Progress');
  A.showTab('Game');
  ok(el('tab-game').hidden === false, 'Your game is its own window too');
}

console.log('session state machine');
{
  const HOUR = 3600000;

  // Row: the clock must survive a force-quit.
  A.db = A.fresh();
  A.db.activeSession = { id: 's1', game: 'cash', stakes: '1/3', venue: 'Room', startTs: Date.now() - 2.5 * HOUR };
  A.renderSession();
  ok(/2h 30m/.test(el('sessRow')._html), 'elapsed derives from the stored start, so a suspended app still reads 2h 30m');

  // Row: two sessions at once must be impossible.
  el('stakes').value = '2/5';
  const running = A.db.activeSession;
  A.renderSession();
  if (el('sessStart').onclick) el('sessStart').onclick();
  ok(A.db.activeSession === running, 'starting a second session does not replace the running one');

  // Row: a hand takes the session that was live when the FORM OPENED, not when Save ran.
  A.db = A.fresh();
  A.db.activeSession = { id: 'live1', game: 'cash', stakes: '1/3', venue: 'Room', startTs: Date.now() - HOUR };
  A.resetForm();                                   // player opens the entry form mid-session
  A.db.activeSession = null;                       // ...and the session ends before they hit save
  el('action').value = 'open15 c';
  A.selPos('BTN');
  el('saveHand').onclick();
  ok(A.db.hands.length === 1, 'the hand saved');
  ok(A.db.hands[0].sessionId === 'live1', 'and kept the session it was started under, not null');

  // Row: editing a hand must never re-assign its session.
  A.db.activeSession = { id: 'tonight', game: 'cash', stakes: '5/10', venue: 'Other', startTs: Date.now() };
  A.resetForm();
  A.editHand(A.db.hands[0].id);
  el('note').value = 'fixing a typo months later';
  el('saveHand').onclick();
  ok(A.db.hands[0].sessionId === 'live1',
    'editing an old hand during tonight\'s session did NOT move it to tonight (got ' + A.db.hands[0].sessionId + ')');
  ok(A.db.hands[0].note === 'fixing a typo months later', 'but the edit itself applied');

  // Row: deleting a results row keeps the hands and clears the dangling link.
  A.db = A.fresh();
  A.db.sessions.push({ id: 'r1', sessionId: 'r1', date: '2026-08-01', venue: 'Room', stakes: '1/3', hours: '4', buyin: '300', cashout: '500' });
  A.db.hands.push({ id: 'h1', ts: 1, pos: 'BTN', sessionId: 'r1' }, { id: 'h2', ts: 2, pos: 'CO', sessionId: 'r1' });
  A.deleteResult('r1', 's');
  ok(A.db.sessions.length === 0, 'the results row is gone');
  ok(A.db.hands.length === 2, 'both hands survived — hands are the expensive thing, not the row');
  ok(A.db.hands.every(h => h.sessionId === null), 'and their link was cleared rather than left dangling');

  // Row: a session left running gets caught rather than poisoning every hourly figure.
  A.db = A.fresh();
  A.db.activeSession = { id: 'stale', game: 'cash', stakes: '1/3', venue: 'Room', startTs: Date.now() - 26 * HOUR };
  const raised = A.checkStaleSession();
  await answerAsk(false);                          // "no, it ended"
  ok(raised === true && A.db.activeSession === null, 'a 26-hour session is offered up and ends');
  A.db.activeSession = { id: 'ok', game: 'cash', stakes: '1/3', venue: 'Room', startTs: Date.now() - 5 * HOUR };
  ok(A.checkStaleSession() === false && A.db.activeSession !== null, 'a normal 5-hour session is left alone');
}

// Confirmed on a real iOS build by the Mac session (issue #2, bug 3).
console.log('the keyboard must not eat the live shorthand preview');
{
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  ok(/body\.typing nav\{display:none\}/.test(css),
    'the tab bar is hidden while typing — a fixed bar lands mid-screen once the webview is resized');
  ok(/body\.typing\{padding-bottom:16px\}/.test(css), 'and the space it freed is given back to the form');

  A.setTyping(true);
  ok(A.typing === true, 'focusing an input enters typing mode');
  A.setTyping(false);
  ok(A.typing === false, 'and blurring leaves it');

  const inputs = ['action','note','amount','eff','stakes','venue'];
  const wired = inputs.filter(id => /'\['?action'?,'?note/.test(HTML) || HTML.includes("'" + id + "'"));
  ok(wired.length === inputs.length, 'every text input in the capture path toggles it');
}

console.log('an evicted user is not a new user');
{
  A.db = A.fresh();
  A.db.prefs.onboarded = true;
  A.db.hands.push({ id: 'old1', ts: 1, pos: 'BTN' });
  A.save();
  await Store.flush();

  ls._wipe();
  A.db = A.fresh();                       // boots empty, onboarded is false again...
  A.showIntro();                          // ...so the intro opens, exactly as it did on device
  ok(el('intro').hidden === false, 'the intro is showing at the moment the restore lands');

  await Store.recover(['pokerlog.v1']);
  ok(A.db.prefs.onboarded === true, 'the restore brought back that they had been onboarded');
  ok(el('intro').hidden === true, 'and the intro got out of the way instead of welcoming them');
  ok(A.db.hands.length === 1, 'their hand came back');
}

console.log('counts read as English');
{
  A.db = A.fresh();
  A.db.hands.push({ id: 'a', ts: 1, pos: 'BTN' });
  A.renderProgress();
  el('count').textContent = '';
  A.save();
  ok(el('count').textContent === '1 hand', 'one hand is "1 hand", not "1 hands" (got: ' + el('count').textContent + ')');
  A.db.hands.push({ id: 'b', ts: 2, pos: 'CO' });
  A.save();
  ok(el('count').textContent === '2 hands', 'two is "2 hands"');
}

console.log('the reference pages are readable on a phone');
{
  // Mac session, issue #2 bug 4: the rightmost column was clipped off-screen with no way
  // to reach it — on a page whose entire purpose is being read on a phone.
  const pb = fs.readFileSync(path.join(APP, 'playbook.html'), 'utf8');
  const tables = (pb.match(/<table class="cheat">/g) || []).length;
  const wrapped = (pb.match(/<div class="tscroll"><table class="cheat">/g) || []).length;
  ok(tables > 0 && wrapped === tables, 'every cheat table sits in its own scroll container (' + wrapped + '/' + tables + ')');
  ok(/\.tscroll\{[^}]*overflow-x:auto/.test(pb), 'that container actually scrolls');
  ok(/@media \(max-width:520px\)[^}]*\{[^}]*min-width:0/.test(pb), 'and narrow screens drop the min-width instead of clipping');
}

console.log(fail ? '\n' + fail + ' FAILURES' : '\nALL PASS');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('THREW:', e); process.exit(1); });
