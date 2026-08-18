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
  const mirrored = fsPlugin._files['pokerlog/' + KEY + '.json'];
  ok(mirrored === DATA, 'flush() puts the value in the mirror');
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
  ok(JSON.parse(fsPlugin._files['pokerlog/' + KEY + '.json']).hands[0].id === 'h24', 'mirror holds the LAST value, not the first');
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
  ok(fsPlugin._files['pokerlog/' + KEY + '.json'] === DATA, 'mirror still intact after restore');
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
  ok(fsPlugin._files['pokerlog/' + KEY + '.json'] === DATA, 'mirror untouched by a read-only recover');
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
  ok(fsPlugin._files['pokerlog/' + KEY + '.json'] === DATA, 'the value still reached durable storage');
  ok(Store.describe().error === 'QuotaExceededError', 'describe() surfaces the quota error for the Data screen');
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
