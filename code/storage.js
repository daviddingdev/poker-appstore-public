/* storage.js — durable key/value with synchronous reads.
 *
 * WHY THIS EXISTS
 * The app hydrates its whole database at script-eval time (`db = JSON.parse(...)`)
 * and writes it back on every save. That demands SYNCHRONOUS reads, which rules out
 * Capacitor Preferences / Filesystem / SQLite — all async — as the primary store
 * unless the entire boot path is restructured.
 *
 * But localStorage alone is not safe to ship: in a WKWebView it is capped around
 * 5 MB per origin and iOS EVICTS it under storage pressure. The live store is
 * already ~2 MB after a year of use, so both the ceiling and the eviction are real.
 *
 * So: localStorage stays the working copy (sync reads, unchanged app code), and a
 * native MIRROR holds the durable copy in the app's Documents directory — which is
 * not evictable and is included in device/iCloud backups. Eviction stops being data
 * loss and becomes a recoverable event: boot finds localStorage empty, reads the
 * mirror, and restores.
 *
 * The mirror is a durability copy, NOT a sync channel. localStorage always wins when
 * it has content; the mirror is only ever read when the working copy is missing.
 * There is no server, no merge, and no network in this file — by design.
 *
 * On the web build (no Capacitor) the mirror is a no-op and behavior is identical to
 * before, so the same source runs in the browser and in the native shell.
 */
(function (root) {
  'use strict';

  var MIRROR_DEBOUNCE_MS = 1000;   // coalesce bursts of saves into one mirror write
  var KEYS = [];                   // every key ever touched, so recover() knows where to look
  var pending = {};                // key -> value awaiting flush
  var timer = null;
  var recoverCbs = [];
  var lastError = null;

  /* ---------- working copy: localStorage ---------- */

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) {
      // QuotaExceededError. Previously this threw uncaught out of persist() and the
      // save silently vanished. Now the mirror still gets it and the app can say so.
      lastError = e;
      return false;
    }
  }

  /* ---------- durable copy: native mirror ---------- */

  // Resolved lazily: Capacitor injects its plugins after this script parses.
  function fs() {
    var C = root.Capacitor;
    var F = C && C.Plugins && C.Plugins.Filesystem;
    return F && typeof F.writeFile === 'function' ? F : null;
  }

  function mirrorOpts(k, extra) {
    var o = { path: 'pokerlog/' + k + '.json', directory: 'DOCUMENTS', encoding: 'utf8' };
    if (extra) for (var p in extra) o[p] = extra[p];
    return o;
  }

  function mirrorWrite(k, v) {
    var F = fs();
    if (!F) return Promise.resolve(false);
    return F.writeFile(mirrorOpts(k, { data: v, recursive: true }))
      .then(function () { return true; })
      .catch(function (e) { lastError = e; return false; });
  }

  function mirrorRead(k) {
    var F = fs();
    if (!F) return Promise.resolve(null);
    return F.readFile(mirrorOpts(k))
      .then(function (r) { return r && typeof r.data === 'string' ? r.data : null; })
      .catch(function () { return null; });   // absent file is the normal first-run case
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    var batch = pending;
    pending = {};
    var keys = Object.keys(batch);
    if (!keys.length) return Promise.resolve(true);
    return Promise.all(keys.map(function (k) { return mirrorWrite(k, batch[k]); }))
      .then(function (rs) { return rs.every(Boolean); });
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; flush(); }, MIRROR_DEBOUNCE_MS);
  }

  /* ---------- public API ---------- */

  function track(k) { if (KEYS.indexOf(k) < 0) KEYS.push(k); }

  var Store = {
    /** Synchronous read of the working copy. */
    get: function (k) { track(k); return lsGet(k); },

    /** Write both copies. Returns false if the working copy was rejected (quota). */
    set: function (k, v) {
      track(k);
      var ok = lsSet(k, v);
      pending[k] = v;
      schedule();
      return ok;
    },

    remove: function (k) {
      track(k);
      try { localStorage.removeItem(k); } catch (e) { /* nothing to do */ }
      pending[k] = '';
      schedule();
    },

    /** Force the mirror write now (call before anything that may terminate the app). */
    flush: flush,

    /**
     * Restore any key whose working copy is gone but whose mirror survives — i.e.
     * iOS evicted localStorage. Async by nature, so the app boots on whatever
     * localStorage had and re-renders if this finds something better.
     * Resolves with the list of restored keys (empty on the normal path).
     */
    recover: function (keys) {
      var want = (keys || KEYS).slice();
      if (!fs() || !want.length) return Promise.resolve([]);
      return Promise.all(want.map(function (k) {
        var live = lsGet(k);
        if (live && live !== '{}') return null;              // working copy is fine
        return mirrorRead(k).then(function (backup) {
          if (!backup || backup === '{}') return null;
          return lsSet(k, backup) ? k : null;
        });
      })).then(function (rs) {
        var restored = rs.filter(Boolean);
        if (restored.length) recoverCbs.forEach(function (cb) { cb(restored); });
        return restored;
      });
    },

    /** Notified when recover() actually restored something. */
    onRecover: function (cb) { recoverCbs.push(cb); },

    /** For the Data screen: what's holding the durable copy, and how big it is. */
    describe: function () {
      var bytes = 0;
      KEYS.forEach(function (k) { var v = lsGet(k); if (v) bytes += v.length; });
      return {
        mirrored: !!fs(),
        backend: fs() ? 'device storage (Documents)' : 'this browser',
        bytes: bytes,
        keys: KEYS.slice(),
        error: lastError ? (lastError.name || String(lastError)) : null
      };
    },

    /** Test seam. */
    _reset: function () {
      KEYS = []; pending = {}; recoverCbs = []; lastError = null;
      if (timer) { clearTimeout(timer); timer = null; }
    }
  };

  root.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
