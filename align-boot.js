/* align-boot.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Single, awaited bootstrap.  THE source of truth for startup order.
 *
 * WHY THIS EXISTS
 *   Before this file, two storage engines (align-api.js = server, and
 *   align-storage.js = localStorage) raced to install themselves on
 *   window.AlignStorage.  Script tags run synchronously, but the backend
 *   `/api/ping` check is async — so the localStorage version ALWAYS won the
 *   race, then the API version overwrote it ~50ms later, AFTER consumers had
 *   already grabbed a (wrong) reference or called a method.  That nondeterm-
 *   inism is what made the dashboard "sometimes" disappear and turned arrays
 *   into Promises (`tasksAll.forEach is not a function`).
 *
 * THE FIX (one explicit, awaited sequence — no racing):
 *   1. Ping the backend ONCE and wait for the answer.
 *   2. Pick exactly one engine and install it on window.AlignStorage / AlignAuth.
 *   3. If it's the API engine, HYDRATE it: pre-load projects + the active
 *      project's records into a synchronous in-memory cache, so the rest of
 *      the app can keep calling listRecords()/getActiveProject() synchronously
 *      (same contract as the localStorage engine — no UI rewrite needed).
 *   4. Restore the saved session (auth.init()).
 *   5. ONLY THEN fire `align-ready`.  Every consumer waits for that event.
 *
 * Public surface:
 *   window.Align.ready  → Promise that resolves when boot is complete
 *   window.Align.boot() → idempotent; returns the same ready Promise
 *   document 'align-ready' event → fired once, after boot resolves
 *   window.Align.mode   → 'api' | 'local' (which engine won)
 */
(function (global) {
  'use strict';

  var _resolveReady;
  var _readyPromise = new Promise(function (res) { _resolveReady = res; });
  var _booted = false;

  var Align = {
    ready: _readyPromise,
    mode: null,          // 'api' | 'local'
    boot: boot
  };
  global.Align = Align;

  function checkBackend() {
    // Short timeout so a missing backend doesn't stall the cold-load.
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 3000);
    return fetch('/api/ping', ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { clearTimeout(timer); return r.ok; })
      .catch(function () { clearTimeout(timer); return false; });
  }

  function boot() {
    if (_booted) return _readyPromise;
    if (global.__AlignBootRan) { _booted = true; return _readyPromise; }
    global.__AlignBootRan = true;
    _booted = true;

    checkBackend().then(function (apiUp) {
      if (apiUp && global.__AlignApiEngine) {
        // ── Server engine ────────────────────────────────────────────────
        Align.mode = 'api';
        var api = global.__AlignApiEngine;
        global.AlignStorage = api.storage;
        global.AlignAuth = api.auth;
        console.log('[Align] Backend detected — server storage');

        // Restore session first (so hydrate knows the active project),
        // then hydrate the synchronous cache, THEN signal ready.
        return api.auth.init()
          .then(function () { return api.storage.hydrate(); })
          .catch(function (e) { console.warn('[Align] hydrate failed:', e); });
      }

      // ── Local engine (no backend, or dev on index/localhost) ────────────
      Align.mode = 'local';
      // align-storage.js installs window.AlignStorage synchronously on load
      // as long as it is NOT told to stand down. It only stands down for API.
      console.log('[Align] No backend — localStorage storage');
      // localStorage engine is already synchronous; nothing to hydrate.
      return null;
    }).then(function () {
      finishBoot();
    }).catch(function (e) {
      console.error('[Align] boot error:', e);
      finishBoot();
    });

    return _readyPromise;
  }

  function finishBoot() {
    window._alignReadyFired = true;
    _resolveReady(Align.mode);
    try {
      document.dispatchEvent(new CustomEvent('align-ready', { detail: { mode: Align.mode } }));
    } catch (e) {
      var ev = document.createEvent('Event');
      ev.initEvent('align-ready', false, false);
      document.dispatchEvent(ev);
    }
  }

  // Kick off as soon as this script runs. Engines registered just above us
  // (align-api.js, align-storage.js) are already defined by load order.
  boot();

})(window);
