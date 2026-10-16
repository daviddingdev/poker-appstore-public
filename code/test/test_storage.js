// Tests for www/storage.js — the durable storage layer.
// The whole point of this file is that data survives iOS evicting localStorage, so the
// eviction path is the one that must be proven, not assumed. Run: node tools/test_storage.js
const path = require('path');

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL:', m); fail++; } else console.log('  ok  :', m); };

/* ---------- shims ---------- */
function mkLocalStorage() {
  let s = {}, quota = Infinity;
  return {
    getItem: k => (k in s ? s[k] : null),
    setItem: (k, v) => {
      v = String(v);
      if (v.length > quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      s[k] = v;
    },
    removeItem: k => { delete s[k]; },
    _wipe: () => { s = {}; },                 // what iOS eviction looks like from in here
    _setQuota: n => { quota = n; },
    _raw: () => s
  };
}

// Stands in for Capacitor's Filesystem plugin: an async, non-evictable file store.
function mkFilesystem() {
  const files = {};
  return {
    writeFile: o => Promise.resolve().then(() => { files[o.path] = o.data; return {}; }),
    readFile: o => Promise.resolve().then(() => {
      if (!(o.path in files)) { const e = new Error('not found'); e.name = 'NotFound'; throw e; }
      return { data: files[o.path] };
    }),
    _files: files
  };
}

function load({ withCapacitor }) {
  global.localStorage = mkLocalStorage();
  const fsPlugin = mkFilesystem();
  global.window = global;
  global.Capacitor = withCapacitor ? { Plugins: { Filesystem: fsPlugin } } : undefined;
  delete require.cache[require.resolve(path.join(__dirname, '..', 'www', 'storage.js'))];
  const Store = require(path.join(__dirname, '..', 'www', 'storage.js'));
  return { Store, fsPlugin, ls: global.localStorage };
}

const KEY = 'pokerlog.v1';
const DATA = JSON.stringify({ hands: [{ id: 'a1', pos: 'BTN' }] });

// The mirror is two-slot generations: each slot holds {seq, data}, newest parseable
// envelope wins, and the legacy single file reads as seq 0. These helpers let the
// tests speak in VALUES while the layout stays an implementation detail.
const env = (seq, data) => JSON.stringify({ seq, data });
const mirrorValue = files => {
  const dec = raw => { try { const e = JSON.parse(raw); return e && typeof e.seq === 'number' && typeof e.data === 'string' ? e : null; } catch (err) { return null; } };
  const a = dec(files['pokerlog/' + KEY + '.a.json']), b = dec(files['pokerlog/' + KEY + '.b.json']);
  if (a && (!b || a.seq >= b.seq)) return a.data;
  if (b) return b.data;
  return files['pokerlog/' + KEY + '.json'] != null ? files['pokerlog/' + KEY + '.json'] : null;
};

(async () => {

console.log('web build (no Capacitor) — must behave exactly like plain localStorage');
{
  const { Store, ls } = load({ withCapacitor: false });
  ok(Store.set(KEY, DATA) === true, 'set() reports success');
  ok(Store.get(KEY) === DATA, 'get() reads back what was written');
  ok(ls.getItem(KEY) === DATA, 'value really is in localStorage');
  ok(Store.describe().mirrored === false, 'describe() admits there is no durable mirror');
  const restored = await Store.recover([KEY]);
  ok(restored.length === 0, 'recover() is a no-op with no mirror available');
}

console.log('native build — every write reaches the durable mirror');
{
  const { Store, fsPlugin } = load({ withCapacitor: true });
  Store.set(KEY, DATA);
  ok(Object.keys(fsPlugin._files).length === 0, 'mirror write is debounced, not synchronous');
  await Store.flush();
  ok(mirrorValue(fsPlugin._files) === DATA, 'flush() puts the value in the mirror');
  ok(Store.describe().mirrored === true, 'describe() reports a durable mirror');
}

console.log('a burst of saves coalesces into one mirror write');
{
  const { Store, fsPlugin } = load({ withCapacitor: true });
  let writes = 0;
  const real = fsPlugin.writeFile;
  fsPlugin.writeFile = o => { writes++; return real(o); };
  for (let i = 0; i < 25; i++) Store.set(KEY, JSON.stringify({ hands: [{ id: 'h' + i }] }));
  await Store.flush();
  ok(writes === 1, '25 saves produced exactly 1 mirror write (got ' + writes + ')');
  ok(JSON.parse(mirrorValue(fsPlugin._files)).hands[0].id === 'h24', 'mirror holds the LAST value, not the first');
}

console.log('THE EVICTION CASE — iOS clears localStorage, data must come back');
{
  const { Store, fsPlugin, ls } = load({ withCapacitor: true });
  Store.set(KEY, DATA);
  await Store.flush();

  ls._wipe();                                        // <- iOS reclaims WKWebView storage
  ok(Store.get(KEY) === null, 'working copy is gone after eviction');

  let notified = null;
  Store.onRecover(keys => { notified = keys; });
  const restored = await Store.recover([KEY]);

  ok(restored.length === 1 && restored[0] === KEY, 'recover() reports the key it restored');
  ok(Store.get(KEY) === DATA, 'the hand history is back, byte for byte');
  ok(notified && notified[0] === KEY, 'onRecover fired so the app can re-render');
  ok(mirrorValue(fsPlugin._files) === DATA, 'mirror still intact after restore');
}

console.log('recovery must never clobber a good working copy');
{
  const { Store, fsPlugin } = load({ withCapacitor: true });
  Store.set(KEY, DATA);
  await Store.flush();
  const NEWER = JSON.stringify({ hands: [{ id: 'a1' }, { id: 'a2' }] });
  global.localStorage.setItem(KEY, NEWER);           // live copy moved on; mirror is stale
  let fired = false;
  Store.onRecover(() => { fired = true; });
  const restored = await Store.recover([KEY]);
  ok(restored.length === 0, 'recover() declines to act when the working copy has content');
  ok(Store.get(KEY) === NEWER, 'the newer working copy survived — stale mirror did NOT win');
  ok(fired === false, 'no spurious recovery notification');
  ok(mirrorValue(fsPlugin._files) === DATA, 'mirror untouched by a read-only recover');
}

console.log('an empty mirror is not treated as data');
{
  const { Store, fsPlugin } = load({ withCapacitor: true });
  fsPlugin._files['pokerlog/' + KEY + '.json'] = '{}';
  const restored = await Store.recover([KEY]);
  ok(restored.length === 0, 'an empty {} mirror does not count as recoverable data');
}

console.log('out of space — the write is refused, but loudly and without losing the mirror');
{
  const { Store, fsPlugin, ls } = load({ withCapacitor: true });
  ls._setQuota(10);                                  // anything real is now too big
  const okFlag = Store.set(KEY, DATA);
  ok(okFlag === false, 'set() returns false so the app can warn instead of failing silently');
  await Store.flush();
  ok(mirrorValue(fsPlugin._files) === DATA, 'the value still reached durable storage');
  ok(Store.describe().error === 'QuotaExceededError', 'describe() surfaces the quota error for the Data screen');
}

console.log('a torn mirror write is never "restored" and then destroyed');
{
  // The app being killed mid-write leaves partial JSON. Restoring it verbatim meant the
  // next persist() overwrote the partially-salvageable file with a fresh empty db.
  const { Store, fsPlugin } = load({ withCapacitor: true });
  const TORN = DATA.slice(0, 12);
  fsPlugin._files['pokerlog/' + KEY + '.json'] = TORN;
  let fired = false;
  Store.onRecover(() => { fired = true; });
  const restored = await Store.recover([KEY]);
  ok(restored.length === 0, 'an unparseable mirror is not restored');
  ok(fired === false, 'no recovery notification for a torn file');
  ok(Store.get(KEY) === null, 'the working copy is not polluted with a partial file');
  ok(fsPlugin._files['pokerlog/' + KEY + '.json'] === TORN, 'the torn file is left on disk for salvage');
  ok(!!Store.describe().error, 'and the failure is surfaced for the Data screen');
}

console.log('THE BOOT RACE — a persist during recovery must not destroy the mirror');
{
  // Eviction → boot shows the intro → the user taps through it while the mirror read is
  // in flight → that persist() queued a near-empty db whose debounced flush used to
  // overwrite the mirror AFTER recovery restored localStorage. recover() now re-asserts
  // the restored value into the pending queue, so whatever flushes next is the real data.
  const { Store, fsPlugin, ls } = load({ withCapacitor: true });
  Store.set(KEY, DATA);
  await Store.flush();
  ls._wipe();                                          // evicted
  const inflight = Store.recover([KEY]);               // async mirror read begins
  Store.set(KEY, JSON.stringify({ hands: [] }));       // race: intro tap-through persists
  await inflight;
  await Store.flush();
  ok(mirrorValue(fsPlugin._files) === DATA, 'the mirror holds the restored data, not the race artifact');
  ok(Store.get(KEY) === DATA, 'the working copy is the restored data');
}

console.log('a failed mirror write is retried on the next flush, not dropped');
{
  const { Store, fsPlugin } = load({ withCapacitor: true });
  const real = fsPlugin.writeFile;
  fsPlugin.writeFile = () => Promise.reject(new Error('disk hiccup'));
  Store.set(KEY, DATA);
  await Store.flush();
  ok(mirrorValue(fsPlugin._files) == null, 'the write really failed');
  fsPlugin.writeFile = real;                           // disk is back
  await Store.flush();
  ok(mirrorValue(fsPlugin._files) === DATA, 'the batch was re-queued and lands on the next flush');
}

console.log('GENERATIONS — a torn slot only ever costs the newest write, never the data');
{
  // Slot b (seq 2) died mid-write; slot a still holds the complete previous generation.
  const { Store, fsPlugin, ls } = load({ withCapacitor: true });
  fsPlugin._files['pokerlog/' + KEY + '.a.json'] = env(1, DATA);
  fsPlugin._files['pokerlog/' + KEY + '.b.json'] = env(2, DATA).slice(0, 20);   // torn
  const restored = await Store.recover([KEY]);
  ok(restored.length === 1 && Store.get(KEY) === DATA, 'the previous complete generation restores');

  // And writes alternate: two flushes must land in different slots, so the write that
  // dies can never be overwriting the only good copy.
  ls._wipe(); Store._reset();
  Store.set(KEY, DATA); await Store.flush();
  const NEWER = JSON.stringify({ hands: [{ id: 'a1' }, { id: 'a2' }] });
  Store.set(KEY, NEWER); await Store.flush();
  const slotA = fsPlugin._files['pokerlog/' + KEY + '.a.json'], slotB = fsPlugin._files['pokerlog/' + KEY + '.b.json'];
  ok(!!slotA && !!slotB && slotA !== slotB, 'consecutive generations occupy both slots');
  ok(mirrorValue(fsPlugin._files) === NEWER, 'and the newest seq wins on read');
}

console.log('QUOTA-DEGRADED BOOT — the mirror is newer, and the next launch knows it');
{
  // Once localStorage refuses writes, every save reaches only the mirror. The sentinel
  // (tiny enough to fit in a full store) tells recover() the usual "working copy wins"
  // rule would roll the user back — this is the ONE case the mirror wins over content.
  const { Store, fsPlugin, ls } = load({ withCapacitor: true });
  const STALE = DATA, NEWER = JSON.stringify({ hands: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] });
  ls.setItem(KEY, STALE);
  ls.setItem('pokerlog.quota', '1');                 // a previous run hit quota
  fsPlugin._files['pokerlog/' + KEY + '.a.json'] = env(5, NEWER);
  const restored = await Store.recover([KEY]);
  ok(restored.length === 1, 'recover() restores despite a non-empty working copy');
  ok(Store.get(KEY) === NEWER, 'the strictly-newer mirror won');
  ok(ls.getItem('pokerlog.quota') === null, 'the sentinel clears once localStorage holds the data again');
  ok(Store.describe().quotaDegraded === false, 'and describe() reports healthy');
}

console.log('QUOTA STILL FULL — the app boots on real data from the overlay');
{
  const { Store, fsPlugin, ls } = load({ withCapacitor: true });
  const STALE = '{"hands":[]}', NEWER = DATA;
  ls.setItem(KEY, STALE);
  ls.setItem('pokerlog.quota', '1');
  ls._setQuota(10);                                  // restore cannot fit either
  fsPlugin._files['pokerlog/' + KEY + '.a.json'] = env(3, NEWER);
  const restored = await Store.recover([KEY]);
  ok(restored.length === 1 && Store.get(KEY) === NEWER, 'get() serves the recovered value from memory');
  ok(ls.getItem(KEY) === STALE, 'without pretending localStorage took it');
  ok(ls.getItem('pokerlog.quota') === '1', 'the sentinel survives, so the NEXT boot trusts the mirror again');
  ok(Store.describe().quotaDegraded === true, 'and describe() says so, for the Home banner');
}

console.log('legacy single-file mirrors still recover (pre-generation installs)');
{
  const { Store, fsPlugin } = load({ withCapacitor: true });
  fsPlugin._files['pokerlog/' + KEY + '.json'] = DATA;        // old layout, no envelope
  const restored = await Store.recover([KEY]);
  ok(restored.length === 1 && Store.get(KEY) === DATA, 'the legacy file reads as generation 0');
  await Store.flush();
  ok(!!fsPlugin._files['pokerlog/' + KEY + '.a.json'], 'and the re-assert lands in slot form (the legacy file is never written again)');
  ok(fsPlugin._files['pokerlog/' + KEY + '.json'] === DATA, 'while the legacy file is left untouched');
}

console.log('backupFile() — user-facing export artifacts, outside the slot mirror');
{
  const { Store, fsPlugin } = load({ withCapacitor: true });
  const okW = await Store.backupFile('autobackup.json', DATA);
  ok(okW === true && fsPlugin._files['pokerlog/autobackup.json'] === DATA, 'writes a plain named file into pokerlog/');
  // recover() must never read it back as data — it is an artifact, not a generation.
  const restored = await Store.recover([KEY]);
  ok(restored.length === 0, 'recover() ignores backup artifacts');
  const { Store: webStore } = load({ withCapacitor: false });
  ok((await webStore.backupFile('x.json', DATA)) === false, 'web build: quietly declines');
}

console.log('describe() sizing');
{
  const { Store } = load({ withCapacitor: true });
  Store.set(KEY, 'x'.repeat(2048));
  const d = Store.describe();
  ok(d.bytes === 2048, 'reports bytes held (' + d.bytes + ')');
  ok(d.keys.indexOf(KEY) >= 0, 'reports which keys it manages');
}

console.log(fail ? '\n' + fail + ' FAILURES' : '\nALL PASS');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('THREW:', e); process.exit(1); });
