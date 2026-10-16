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
 * THE MIRROR IS TWO-SLOT GENERATIONS. Each key owns two slot files written
 * alternately, each holding an envelope {seq, data}; the newest parseable envelope
 * wins on read. A write that dies mid-file corrupts only the slot being written —
 * the other slot still holds the previous complete generation. That is atomicity
 * WITHOUT rename(): Capacitor's iOS rename maps to NSFileManager.moveItem, which
 * fails when the destination exists, so a tmp+rename scheme passes every mock and
 * bricks on device. The pre-generation single file (pokerlog/<k>.json) is still
 * read as seq 0 so existing installs recover seamlessly; it is no longer written.
 *
 * The mirror is a durability copy, NOT a sync channel. localStorage wins when it
 * has content — with ONE precise exception: after a quota failure (flagged by a
 * tiny sentinel that still fits when the real write does not), every save reaches
 * only the mirror, so the mirror is strictly newer than the working copy. recover()
 * then restores the mirror over the stale working copy, or — if localStorage is
 * still full — serves the recovered value from an in-memory overlay so the app
 * boots on real data. There is no server, no merge, and no network in this file.
 *
 * On the web build (no Capacitor) the mirror is a no-op and behavior is identical
 * to plain localStorage, so the same source runs in the browser and native shell.
 */
(function (root) {
  'use strict';

  var MIRROR_DEBOUNCE_MS = 1000;   // coalesce bursts of saves into one mirror write
  var QUOTA_FLAG = 'pokerlog.quota';   // sentinel: "the mirror is newer than localStorage"
  var KEYS = [];                   // every key ever touched, so recover() knows where to look
  var pending = {};                // key -> value awaiting flush
  var timer = null;
  var recoverCbs = [];
  var lastError = null;
  var overlay = {};                // quota-degraded boot: recovered values localStorage can't hold

  /* ---------- working copy: localStorage ---------- */

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) {
      // QuotaExceededError. The mirror still gets this value; the sentinel below is
      // tiny enough to fit in a full store and tells the NEXT boot that the mirror
      // is the newer copy — without it, relaunching silently rolled back everything
      // saved after the first quota failure.
      lastError = e;
      try { localStorage.setItem(QUOTA_FLAG, '1'); } catch (e2) { /* truly full */ }
      return false;
    }
  }

  function quotaFlagged() { return lsGet(QUOTA_FLAG) === '1'; }
  function clearQuotaFlag() { try { localStorage.removeItem(QUOTA_FLAG); } catch (e) { /* nothing */ } }

  /* ---------- durable copy: two-slot generation mirror ---------- */

  // Resolved lazily: Capacitor injects its plugins after this script parses.
  function fs() {
    var C = root.Capacitor;
    var F = C && C.Plugins && C.Plugins.Filesystem;
    return F && typeof F.writeFile === 'function' ? F : null;
  }

  function fileOpts(path, extra) {
    var o = { path: path, directory: 'DOCUMENTS', encoding: 'utf8' };
    if (extra) for (var p in extra) o[p] = extra[p];
    return o;
  }

  function slotPath(k, slot) { return 'pokerlog/' + k + '.' + slot + '.json'; }
  function legacyPath(k) { return 'pokerlog/' + k + '.json'; }

  function readRaw(path) {
    var F = fs();
    if (!F) return Promise.resolve(null);
    return F.readFile(fileOpts(path))
      .then(function (r) { return r && typeof r.data === 'string' ? r.data : null; })
      .catch(function () { return null; });   // absent file is the normal first-run case
  }

  // A slot is trustworthy only if its envelope parses whole — JSON string escaping
  // means any truncation breaks the parse, so "envelope parses" IS the integrity check.
  function decodeSlot(raw) {
    if (!raw) return null;
    try {
      var e = JSON.parse(raw);
      if (e && typeof e.seq === 'number' && e.seq >= 1 && typeof e.data === 'string') return e;
    } catch (err) { /* torn write — the other slot has the previous generation */ }
    return null;
  }

  // Read both slots + the legacy single file; report the best generation and which
  // slot the NEXT write should take (always the one not holding the best data).
  function readSlots(k) {
    return Promise.all([readRaw(slotPath(k, 'a')), readRaw(slotPath(k, 'b')), readRaw(legacyPath(k))])
      .then(function (rs) {
        var a = decodeSlot(rs[0]), b = decodeSlot(rs[1]);
        var best = null, next = 'a';
        if (a && (!b || a.seq >= b.seq)) { best = { seq: a.seq, value: a.data }; next = 'b'; }
        else if (b) { best = { seq: b.seq, value: b.data }; next = 'a'; }
        if (!best && rs[2] != null) {
          // Pre-generation install. The legacy file has no envelope, so validate the
          // payload itself (every key this app stores is JSON) before trusting it.
          try { JSON.parse(rs[2]); best = { seq: 0, value: rs[2] }; }
          catch (e) { lastError = e; }
        }
        return { best: best, next: next };
      });
  }

  var slotState = {};                    // k -> {seq, next} once learned
  var writeChain = Promise.resolve();    // mirror writes serialize: an overlapping debounce
                                         // flush and pagehide flush must not race a slot

  function mirrorWrite(k, v) {
    if (!fs()) return Promise.resolve(false);
    writeChain = writeChain.then(function () {
      var known = slotState[k]
        ? Promise.resolve(slotState[k])
        : readSlots(k).then(function (s) {
            return (slotState[k] = { seq: s.best ? s.best.seq : 0, next: s.next });
          });
      return known.then(function (st) {
        var seq = st.seq + 1;
        var envelope = JSON.stringify({ seq: seq, data: v });
        return fs().writeFile(fileOpts(slotPath(k, st.next), { data: envelope, recursive: true }))
          .then(function () {
            slotState[k] = { seq: seq, next: st.next === 'a' ? 'b' : 'a' };
            return true;
          })
          .catch(function (e) { lastError = e; return false; });
      });
    });
    return writeChain;
  }

  function mirrorRead(k) {
    if (!fs()) return Promise.resolve(null);
    return readSlots(k).then(function (s) {
      if (!slotState[k]) slotState[k] = { seq: s.best ? s.best.seq : 0, next: s.next };
      return s.best ? s.best.value : null;
    });
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    var batch = pending;
    pending = {};
    var keys = Object.keys(batch);
    if (!keys.length) return Promise.resolve(true);
    return Promise.all(keys.map(function (k) {
      return mirrorWrite(k, batch[k]).then(function (ok) {
        // A failed write re-queues its value (unless a newer one is already pending) so
        // the mirror catches up on the next flush instead of silently lagging. No
        // schedule() here — a permanently failing disk must not busy-loop; the retry
        // rides along with the next set() or the visibilitychange/pagehide flush.
        if (!ok && !(k in pending)) pending[k] = batch[k];
        return ok;
      });
    })).then(function (rs) { return rs.every(Boolean); });
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; flush(); }, MIRROR_DEBOUNCE_MS);
  }

  /* ---------- public API ---------- */

  function track(k) { if (KEYS.indexOf(k) < 0) KEYS.push(k); }

  var Store = {
    /** Synchronous read: the quota-recovery overlay first, else the working copy. */
    get: function (k) {
      track(k);
      if (overlay[k] != null) return overlay[k];
      return lsGet(k);
    },

    /** Write both copies. Returns false if the working copy was rejected (quota). */
    set: function (k, v) {
      track(k);
      delete overlay[k];               // a new value supersedes any recovered overlay
      var ok = lsSet(k, v);
      pending[k] = v;
      schedule();
      return ok;
    },

    remove: function (k) {
      track(k);
      delete overlay[k];
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
     *
     * The one case where a NON-empty working copy loses: the quota sentinel is set,
     * which proves every save since the first quota failure reached only the mirror.
     * The mirror is then strictly newer and wins; if localStorage is still too full
     * to take it back, the value is served from the in-memory overlay instead so
     * the app still boots on the real data.
     *
     * Resolves with the list of restored keys (empty on the normal path).
     */
    recover: function (keys) {
      var want = (keys || KEYS).slice();
      if (!fs() || !want.length) return Promise.resolve([]);
      var quota = quotaFlagged();
      return Promise.all(want.map(function (k) {
        var live = lsGet(k);
        if (!quota && live && live !== '{}') return null;    // working copy is fine
        return mirrorRead(k).then(function (backup) {
          if (!backup || backup === '{}') return null;
          // A torn mirror (both slots bad is the only way here) or pre-generation
          // legacy file that does not parse must NOT be restored — surface it instead.
          try { JSON.parse(backup); } catch (e) { lastError = e; return null; }
          if (quota && live === backup) return null;         // nothing newer after all
          if (lsSet(k, backup)) delete overlay[k];
          else overlay[k] = backup;                          // still full: boot from memory
          // Re-assert the mirror. A persist() racing this async read (e.g. the user
          // taps through the post-eviction intro) queues a near-empty working copy,
          // and its debounced flush would land AFTER this restore. Queueing the
          // restored value means whatever flushes next is the real data. Still
          // one-way: this value originated in the mirror.
          pending[k] = backup; schedule();
          return k;
        });
      })).then(function (rs) {
        var restored = rs.filter(Boolean);
        // The sentinel clears only when the working copy actually holds the data
        // again; while anything still lives only in the overlay, the next boot must
        // keep trusting the mirror.
        if (quota && !Object.keys(overlay).length) clearQuotaFlag();
        if (restored.length) recoverCbs.forEach(function (cb) { cb(restored); });
        return restored;
      });
    },

    /** Notified when recover() actually restored something. */
    onRecover: function (cb) { recoverCbs.push(cb); },

    /**
     * Write a user-facing file into the pokerlog folder (Documents — visible in the
     * Files app). For export artifacts like the rolling auto-backup: a plain named
     * file a person can find and copy, NOT part of the slot mirror and never read
     * back by recover(). Resolves false on web builds or write failure.
     */
    backupFile: function (name, data) {
      var F = fs();
      if (!F) return Promise.resolve(false);
      return F.writeFile(fileOpts('pokerlog/' + name, { data: data, recursive: true }))
        .then(function () { return true; })
        .catch(function (e) { lastError = e; return false; });
    },

    /** For the Data screen and the Home banner: who holds the durable copy, how big,
     *  and whether the store is running quota-degraded (mirror newer than working copy). */
    describe: function () {
      var bytes = 0;
      var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
      KEYS.forEach(function (k) { var v = Store.get(k); if (v) bytes += enc ? enc.encode(v).length : v.length; });
      return {
        mirrored: !!fs(),
        backend: fs() ? 'device storage (Documents)' : 'this browser',
        bytes: bytes,
        keys: KEYS.slice(),
        quotaDegraded: quotaFlagged(),
        error: lastError ? (lastError.name || String(lastError)) : null
      };
    },

    /** Test seam. */
    _reset: function () {
      KEYS = []; pending = {}; recoverCbs = []; lastError = null; overlay = {}; slotState = {};
      writeChain = Promise.resolve();
      if (timer) { clearTimeout(timer); timer = null; }
    }
  };

  root.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
