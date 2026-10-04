/**
 * LiveFolio State Bridge — injected into shared-folio iframes (?lf_pins=1 with
 * data editing enabled) by app/api/raw/[id]/[[...path]]/route.ts.
 *
 * The share viewer embeds a folio in a sandboxed iframe
 * (sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"), so the
 * document's origin is opaque and native localStorage THROWS on every access:
 * the folio's own try/catch swallows the throw and viewer edits vanish on
 * reload. This script replaces `localStorage` inside the folio with an
 * in-memory map that is
 *
 *   1. seeded SYNCHRONOUSLY from the inline `window.__LF_STATE__` written by the
 *      raw route (first children of <head>), so the folio's parse-time
 *      `localStorage.getItem(...)` returns the owner's saved state;
 *   2. relayed to the parent page over postMessage — `LIVEFOLIO_STATE_PUT`
 *      {state, baseRev} debounced ~400 ms — because only the parent (same-origin
 *      with the platform, holding the session cookie) may call the state API;
 *   3. updated from the parent's `LIVEFOLIO_STATE_SYNC` {state, rev, readOnly,
 *      reason?} replies, REV-GATED so a stale sync can never destroy a local
 *      write that has not been acknowledged yet.
 *
 * Every behaviour below is a constraint measured against the exact sandboxed
 * iframe the share viewer uses, in both Chromium and WebKit:
 *   · install via Object.defineProperty(window,'localStorage',{value:<Proxy>,
 *     writable:false, enumerable:true, configurable:true}) — the native
 *     accessor is configurable:true, which is what makes the retrofit work;
 *   · the Proxy variant (not a plain object) is what makes bare-property entry
 *     idioms (`localStorage.foo = x`, `'foo' in localStorage`, Object.keys) hit
 *     the map instead of silently vanishing;
 *   · the native Storage surface is matched: setItem/removeItem/clear return
 *     undefined, `length` is a live getter, key(n) follows ToUint32 and returns
 *     null out of range, enumeration follows insertion order;
 *   · memory-only when the parent is silent (no seed / editor preview / OSS)
 *     and never throws into the folio — no error text is ever pattern-matched
 *     (Chromium and WebKit word SecurityError differently);
 *   · `storage` events NEVER fire here (an opaque origin has no same-origin
 *     peer) — no cross-tab promises.
 *
 * Message authentication is by window identity (e.source), never e.origin: from
 * an opaque origin e.origin is the string "null" and carries nothing.
 *
 * This file is a plain classic script (no build step) so it can be served
 * cacheable straight from /public.
 */
(function () {
  'use strict';

  // ── Double-injection guard ────────────────────────────────────────────
  // A cached folio HTML may inject this script twice; the second run must be a
  // no-op (the map it would re-seed from could be stale). The installed value
  // is a Proxy, so `window.localStorage === <target>` is not a usable identity
  // check — the guard flag is separate, mirroring __livefolioPinBridge.
  if (window.__lfStateShim) return;
  window.__lfStateShim = true;

  // Must equal STATE_SEED_MAX_BYTES in lib/folio-state.ts (and the RPC's cap).
  var MAX_BYTES = 262144;
  // One flush per burst (spike measured exactly one PUT for ~8 writes).
  var DEBOUNCE_MS = 400;

  // ── Store ─────────────────────────────────────────────────────────────
  // A Map, not a plain object: insertion order must be exact for key(n) and
  // enumeration (native Storage is strictly insertion-ordered, while an object
  // re-orders integer-like keys), and a key named `__proto__` must be an
  // ordinary entry.
  var map = new Map();

  // Native reference, for contexts where localStorage IS reachable (a
  // non-sandboxed direct view). Capture it BEFORE the shadow — afterwards the
  // window property is ours. In the sandboxed share iframe this read throws and
  // the reference stays null (the normal case: memory-only).
  var nativeStorage = null;
  try {
    var native = window.localStorage;
    if (native && typeof native.setItem === 'function') nativeStorage = native;
  } catch (e) { nativeStorage = null; }

  function mirrorToNative(op) {
    if (!nativeStorage) return;
    try { op(nativeStorage); } catch (e) { /* best-effort mirror, never fatal */ }
  }

  // ── Seed (synchronous, parse-time) ────────────────────────────────────
  var seedRev = 0;
  var readOnly = false;
  try {
    var NS = window.__LF_STATE__;
    if (NS && typeof NS === 'object') {
      if (typeof NS.v === 'number' && isFinite(NS.v)) seedRev = Math.max(0, Math.trunc(NS.v));
      readOnly = NS.ro === true;
      var s = NS.s;
      if (s && typeof s === 'object' && !Array.isArray(s)) {
        for (var k in s) {
          if (Object.prototype.hasOwnProperty.call(s, k)) map.set(String(k), String(s[k]));
        }
      }
    }
  } catch (e) { /* a malformed seed must never take the folio down */ }

  // ── Rev gate ──────────────────────────────────────────────────────────
  // lastAppliedRev is the rev of the map we serve (seed `v`, else 0).
  // pendingBaseRev >= 0 means: local writes exist that the server has not
  // acknowledged, based on that rev. While it is set, any SYNC whose rev does
  // NOT exceed it cannot contain our write (the RPC's rev = rev + 1 makes an
  // acknowledgement always strictly greater than the base it was sent with),
  // so it is dropped. This is the spike's measured bug: the prototype applied
  // every SYNC and a boot sync racing a user write destroyed the write.
  // pendingBaseRev is set at the MOMENT OF THE WRITE (not at flush time) —
  // otherwise a sync landing inside the 400 ms debounce window would clobber a
  // write that has not even been sent yet.
  var lastAppliedRev = seedRev;
  var pendingBaseRev = -1;
  // Local changes not yet handed to the parent. Cleared when a PUT goes out (or
  // when a sync replaces the map), so the exit hooks below cannot double-PUT.
  var dirty = false;

  function markDirty() {
    dirty = true;
    if (pendingBaseRev < 0) pendingBaseRev = lastAppliedRev;
  }

  // ── Size (client half of the 256 KB cap; the RPC is authoritative) ────
  function byteLength(str) {
    try {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    } catch (e) { /* fall through to the manual count */ }
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  function snapshot() {
    // defineProperty per key so a key literally named `__proto__` becomes an
    // own key rather than a silent prototype write.
    var out = {};
    map.forEach(function (value, key) {
      try {
        Object.defineProperty(out, key, {
          value: value, writable: true, enumerable: true, configurable: true,
        });
      } catch (e) { /* non-string key shapes cannot come from the Storage API */ }
    });
    return out;
  }

  // ── Parent channel ────────────────────────────────────────────────────
  var parentWin = null;
  try {
    if (window.parent && window.parent !== window) parentWin = window.parent;
  } catch (e) { parentWin = null; }

  function post(msg) {
    if (!parentWin) return;
    try { parentWin.postMessage(msg, '*'); } catch (e) { /* parent navigated away */ }
  }

  var timer = null;

  function scheduleFlush() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flushNow, DEBOUNCE_MS);
  }

  function flushNow() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (!parentWin || !dirty || pendingBaseRev < 0) return;
    var state = snapshot();
    var json;
    try { json = JSON.stringify(state); } catch (e) { return; }
    if (byteLength(json) > MAX_BYTES) {
      // Oversized: the RPC would 413 it. Keep the value in the local map (the
      // folio keeps working) but never relay it — and stop holding the rev gate
      // open for a write that will never be acknowledged.
      dirty = false;
      pendingBaseRev = -1;
      return;
    }
    dirty = false;
    post({ type: 'LIVEFOLIO_STATE_PUT', state: state, baseRev: pendingBaseRev });
  }

  // ── The Storage surface ───────────────────────────────────────────────
  function getItem(key) {
    key = String(key);
    return map.has(key) ? map.get(key) : null;
  }

  function setItem(key, value) {
    key = String(key);
    value = String(value);
    map.set(key, value);
    markDirty();
    mirrorToNative(function (native) { native.setItem(key, value); });
    scheduleFlush();
    // Native setItem returns undefined.
  }

  function removeItem(key) {
    key = String(key);
    map.delete(key);
    markDirty();
    mirrorToNative(function (native) { native.removeItem(key); });
    scheduleFlush();
  }

  function clear() {
    map.clear();
    markDirty();
    mirrorToNative(function (native) { native.clear(); });
    scheduleFlush();
  }

  function keyAt(i) {
    // WebIDL unsigned long: ToUint32 — key(-1) → 4294967295 (out of range),
    // key(NaN) → 0, and out of range returns null.
    var n = Number(i) >>> 0;
    if (n >= map.size) return null;
    var idx = 0;
    var it = map.keys();
    var step = it.next();
    while (!step.done) {
      if (idx === n) return step.value;
      idx += 1;
      step = it.next();
    }
    return null;
  }

  var shim = {
    getItem: getItem,
    setItem: setItem,
    removeItem: removeItem,
    clear: clear,
    key: keyAt,
  };
  try {
    Object.defineProperty(shim, 'length', {
      get: function () { return map.size; },
      enumerable: false,
      configurable: true,
    });
  } catch (e) { /* length is best-effort on exotic engines */ }

  // ── Proxy wrapper: entry-level idioms hit the map ─────────────────────
  // Native Storage exposes entries as named properties ([LegacyOverrideBuiltIns]
  // — entries shadow built-ins), so `localStorage.foo = x` persists, `'foo' in
  // localStorage` is true and Object.keys enumerates entries. A plain object
  // shim cannot do that, and the failure is SILENT (the write lands on the shim
  // object, getItem never sees it). The spike measured the Proxy variant green
  // in both engines; the only costs are `instanceof Storage` (false either way)
  // and `===` identity (hence the separate guard flag).
  function hasOwn(target, prop) {
    return Object.prototype.hasOwnProperty.call(target, prop);
  }

  var exposed = new Proxy(shim, {
    get: function (target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (map.has(prop)) return map.get(prop);      // entries shadow built-ins, like native
      if (prop in target) return target[prop];      // getItem/setItem/…/length
      return undefined;                             // missing entry
    },
    set: function (target, prop, value) {
      if (typeof prop === 'symbol') { target[prop] = value; return true; }
      if (map.has(prop)) {
        map.set(prop, String(value));
        markDirty();
        scheduleFlush();
        return true;
      }
      if (hasOwn(target, prop)) {
        // Method/`length` assignment: native ignores `length = x` (no setter)
        // and a strict-mode throw would break the folio, so swallow it.
        try { target[prop] = value; } catch (e) { /* native-equivalent no-op */ }
        return true;
      }
      map.set(String(prop), String(value));
      markDirty();
      scheduleFlush();
      return true;
    },
    has: function (target, prop) {
      if (typeof prop === 'symbol') return prop in target;
      return map.has(prop) || (prop in target);
    },
    ownKeys: function (target) {
      // Native instances expose ONLY their entries as own properties (the
      // methods live on Storage.prototype). Mirror that, but never violate the
      // Proxy invariants: a non-extensible target (or a third party defining a
      // non-configurable own property) must still be reported in full.
      if (!Object.isExtensible(target)) {
        return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
      }
      var keys = [];
      map.forEach(function (value, k) { keys.push(k); });
      var own = Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
      for (var i = 0; i < own.length; i++) {
        var d = Object.getOwnPropertyDescriptor(target, own[i]);
        if (d && !d.configurable && keys.indexOf(own[i]) === -1) keys.push(own[i]);
      }
      return keys;
    },
    getOwnPropertyDescriptor: function (target, prop) {
      if (map.has(prop)) {
        return { value: map.get(prop), writable: true, enumerable: true, configurable: true };
      }
      return Object.getOwnPropertyDescriptor(target, prop);
    },
    deleteProperty: function (target, prop) {
      if (typeof prop === 'string' && map.has(prop)) {
        map.delete(prop);
        markDirty();
        scheduleFlush();
        return true;
      }
      // Deleting a method name is a no-op on a native instance (it lives on the
      // prototype), so never remove our own machinery.
      return true;
    },
  });

  // ── Install ───────────────────────────────────────────────────────────
  function install() {
    try {
      Object.defineProperty(window, 'localStorage', {
        value: exposed,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      return true;
    } catch (e) { /* fall through to the delete+define ladder */ }
    try {
      delete window.localStorage;
      Object.defineProperty(window, 'localStorage', {
        value: exposed,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      return true;
    } catch (e2) {
      // Nothing left to try — the folio keeps today's behaviour (its own
      // try/catch around a throwing native getter). Never throw.
      return false;
    }
  }

  install();

  // Third-party code (or a folio itself) can `delete window.localStorage`; both
  // engines then leave `undefined` in place of the throwing native getter, and
  // the binding is never restored. Re-install on the next bridge interaction —
  // cheap insurance, since the map lives in this closure and survives.
  function ensureInstalled() {
    try { if (window.localStorage === exposed) return; } catch (e) { /* deleted / replaced */ }
    install();
  }

  // ── SYNC ──────────────────────────────────────────────────────────────
  var reasonLogged = false;

  function applySync(d) {
    // readOnly is informational, not a gate: the server refuses writes, and the
    // shim keeps relaying them so the day the viewer may write again (a
    // reload/re-sign-in) nothing has to change here. The warning is the only
    // channel by which the parent's human-readable reason reaches a developer.
    if (d.readOnly === true) {
      readOnly = true;
      if (typeof d.reason === 'string' && d.reason && !reasonLogged) {
        reasonLogged = true;
        try {
          console.warn('[LiveFolio] data editing is read-only for this viewer: ' + d.reason);
        } catch (e) { /* no console */ }
      }
    }

    var rev = Number(d.rev);
    if (!isFinite(rev)) return;                       // malformed: keep the local map
    if (rev < lastAppliedRev) return;                 // stale against what we serve
    if (pendingBaseRev >= 0 && rev <= pendingBaseRev) return; // cannot contain our unacknowledged write

    var s = d.state;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;

    var json;
    try { json = JSON.stringify(s); } catch (e) { return; }
    if (byteLength(json) > MAX_BYTES) return; // oversized: dropped locally (invariant 7)

    map.clear();
    for (var k in s) {
      if (Object.prototype.hasOwnProperty.call(s, k)) map.set(String(k), String(s[k]));
    }
    lastAppliedRev = rev;
    // The applied map IS the server's, so there is nothing local left to push…
    dirty = false;
    // …and our write is acknowledged (or superseded by a newer one).
    if (pendingBaseRev >= 0) pendingBaseRev = -1;
  }

  function onMessage(e) {
    // Window identity is the only usable authentication from an opaque origin.
    if (!parentWin || e.source !== parentWin) return;
    ensureInstalled(); // a deleted property leaves `undefined`; heal on interaction
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'LIVEFOLIO_STATE_SYNC') applySync(d);
  }

  try {
    window.addEventListener('message', onMessage);
    // bfcache restore: the boot REQUEST heals later reads only (never the
    // folio's parse-time read), so re-ask when a restored page reappears.
    window.addEventListener('pageshow', function (ev) {
      if (ev && ev.persisted) {
        ensureInstalled();
        post({ type: 'LIVEFOLIO_STATE_REQUEST' });
      }
    });
    // A viewer who acts and immediately leaves must not lose the last burst to
    // the debounce — flush it while the parent can still receive the message.
    // BOTH hooks, because message delivery from them is engine-dependent
    // (measured: Chromium delivers the beforeunload post and drops the pagehide
    // one; WebKit does the exact opposite). `dirty` makes the pair idempotent:
    // whichever hook lands first sends the single PUT, the other is a no-op.
    window.addEventListener('beforeunload', function () { flushNow(); });
    window.addEventListener('pagehide', function () { flushNow(); });
  } catch (e) { /* no event target — the shim still serves the seeded map */ }

  // Ask for a sync on boot: covers a missing or stale seed for every read AFTER
  // the folio's own parse-time read (which only the server-side seed can serve).
  post({ type: 'LIVEFOLIO_STATE_REQUEST' });
})();
