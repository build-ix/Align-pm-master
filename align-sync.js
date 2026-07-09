/* align-sync.js — Offline Sync Queue
 * ─────────────────────────────────────────────────────────────────────────────
 * IndexedDB-backed queue for operations performed while offline.
 * When connectivity returns, queued operations are replayed in order.
 *
 * API:
 *   AlignSync.enqueue(op)     — queue an operation { method, url, body, headers }
 *   AlignSync.drain()         — replay all queued operations, clear on success
 *   AlignSync.pending()       — returns count of queued operations
 *   AlignSync.isOnline()      — current connectivity state
 *
 * Depends on: none (standalone). Load after align-api.js so it can intercept.
 */

(function (global) {
  'use strict';

  var DB_NAME = 'align-sync';
  var DB_VERSION = 1;
  var STORE_NAME = 'queue';
  var MAX_RETRIES = 3;
  var RETRY_DELAY_MS = 2000;
  var _db = null;
  var _online = navigator.onLine;
  var _syncing = false;

  /* ── IndexedDB Setup ────────────────────────────────────────────────── */
  function _openDB() {
    return new Promise(function (resolve, reject) {
      if (_db) return resolve(_db);

      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function (e) {
        _db = e.target.result;
        resolve(_db);
      };
      req.onerror = function () {
        reject(new Error('Failed to open IndexedDB'));
      };
    });
  }

  /* ── Queue Operations ───────────────────────────────────────────────── */
  function enqueue(op) {
    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var record = {
          method: op.method || 'POST',
          url: op.url,
          body: op.body || null,
          headers: op.headers || {},
          timestamp: new Date().toISOString(),
          retries: 0
        };
        var req = store.add(record);
        req.onsuccess = function () {
          console.log('[Sync] Queued: ' + op.method + ' ' + op.url + ' (' + pendingCount() + ' pending)');
          resolve(req.result);
        };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function (err) {
      console.warn('[Sync] Failed to queue operation:', err.message);
    });
  }

  function pendingCount() {
    // Synchronous approximate count from DOM attribute (set during drain/poll)
    // For accurate count, use pending() async below
    return parseInt(document.body.getAttribute('data-sync-pending') || '0', 10);
  }

  function pending() {
    return _openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.count();
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(0); };
      });
    });
  }

  /* ── Drain: replay all queued operations ────────────────────────────── */
  function drain() {
    if (_syncing) return Promise.resolve({ drained: 0, remaining: 0 });
    _syncing = true;

    return _openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.getAll();
        req.onsuccess = function () {
          var ops = req.result || [];
          if (ops.length === 0) { _syncing = false; return resolve({ drained: 0, remaining: 0 }); }

          console.log('[Sync] Draining ' + ops.length + ' queued operations...');
          _replayOps(db, ops, 0, 0, resolve);
        };
        req.onerror = function () { _syncing = false; resolve({ drained: 0, remaining: 0 }); };
      });
    });
  }

  function _replayOps(db, ops, index, drained, resolve) {
    if (index >= ops.length) {
      _syncing = false;
      _updatePendingBadge(0);
      console.log('[Sync] Drain complete: ' + drained + ' of ' + ops.length + ' succeeded');
      return resolve({ drained: drained, remaining: ops.length - drained });
    }

    var op = ops[index];
    var headers = op.headers || {};
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';

    var fetchOpts = {
      method: op.method,
      headers: headers
    };
    if (op.body) {
      fetchOpts.body = typeof op.body === 'string' ? op.body : JSON.stringify(op.body);
    }

    fetch(op.url, fetchOpts)
      .then(function (r) {
        if (r.ok) {
          // Success — remove from queue
          return _removeOp(db, op.id).then(function () {
            _updatePendingBadge(ops.length - index - 1);
            _replayOps(db, ops, index + 1, drained + 1, resolve);
          });
        } else {
          // Server rejected — increment retries, maybe give up
          return _incrementRetry(db, op).then(function () {
            if (op.retries >= MAX_RETRIES) {
              console.warn('[Sync] Abandoning ' + op.method + ' ' + op.url + ' after ' + MAX_RETRIES + ' retries (HTTP ' + r.status + ')');
              return _removeOp(db, op.id).then(function () {
                _replayOps(db, ops, index + 1, drained, resolve);
              });
            }
            _replayOps(db, ops, index + 1, drained, resolve);
          });
        }
      })
      .catch(function () {
        // Network error during drain — stop retrying, try again later
        _syncing = false;
        _updatePendingBadge(ops.length - index);
        console.log('[Sync] Drain interrupted (offline). ' + (ops.length - index) + ' remaining.');
        resolve({ drained: drained, remaining: ops.length - index });
      });
  }

  function _removeOp(db, id) {
    return new Promise(function (resolve) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = function () { resolve(); };
    });
  }

  function _incrementRetry(db, op) {
    return new Promise(function (resolve) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      op.retries = (op.retries || 0) + 1;
      store.put(op);
      tx.oncomplete = function () { resolve(); };
    });
  }

  function _updatePendingBadge(count) {
    document.body.setAttribute('data-sync-pending', count);
    var bar = document.getElementById('app-offline-bar');
    if (bar) {
      if (count > 0) {
        bar.style.display = 'block';
        bar.textContent = '⚠ ' + count + ' change' + (count !== 1 ? 's' : '') + ' pending — will sync when back online.';
      } else if (_online) {
        bar.style.display = 'none';
      }
    }
  }

  /* ── Connectivity Monitoring ────────────────────────────────────────── */
  function _onOnline() {
    _online = true;
    console.log('[Sync] Online — draining queue...');
    var bar = document.getElementById('app-offline-bar');
    if (bar) {
      bar.textContent = '🔄 Syncing pending changes...';
      bar.style.background = '#14532d';
    }

    drain().then(function (result) {
      if (bar) {
        if (result.remaining === 0) {
          bar.style.display = 'none';
        } else {
          bar.textContent = '⚠ ' + result.remaining + ' changes still pending. Will retry.';
          bar.style.background = '#78350f';
        }
      }
      // Refresh the current module if one is open
      if (result.drained > 0) {
        _refreshCurrentModule();
      }
    });
  }

  function _onOffline() {
    _online = false;
    var bar = document.getElementById('app-offline-bar');
    if (bar) {
      bar.style.display = 'block';
      bar.style.background = '#78350f';
      pending().then(function (count) {
        bar.textContent = '⚠ No connection — changes saved locally. ' +
          (count > 0 ? count + ' pending sync.' : 'Will sync when back online.');
      });
    }
  }

  function _refreshCurrentModule() {
    // Try to re-render the currently active section
    try {
      var hash = location.hash.replace('#', '');
      if (hash && window.AlignAuth && typeof window.AlignAuth.getCurrentSection === 'function') {
        var section = window.AlignAuth.getCurrentSection();
        if (section && section.render) {
          var modalBody = document.getElementById('modal-body');
          if (modalBody) section.render(modalBody);
        }
      }
    } catch (e) { /* best-effort refresh */ }
  }

  /* ── Initialization ─────────────────────────────────────────────────── */
  function init() {
    window.addEventListener('online', _onOnline);
    window.addEventListener('offline', _onOffline);

    // Set initial state
    _online = navigator.onLine;

    // If online on load, try draining any leftover queue
    if (_online) {
      pending().then(function (count) {
        if (count > 0) {
          console.log('[Sync] ' + count + ' pending operations from previous session — draining...');
          drain();
        }
      });
    }

    // Update the offline bar with pending count
    pending().then(function (count) {
      _updatePendingBadge(count);
    });
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── Public API ─────────────────────────────────────────────────────── */
  global.AlignSync = {
    enqueue: enqueue,
    drain: drain,
    pending: pending,
    isOnline: function () { return _online; },
    reportConnectivity: function(reachable) {
      if (reachable && !_online) {
        _onOnline();
      } else if (!reachable && _online) {
        _onOffline();
      }
    }
  };

  console.log('[Sync] Offline sync queue initialized.');
})(window);
