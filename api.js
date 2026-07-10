/* api.js — Align PM single API wrapper
 * Every network call goes through here. Handles auth, errors, cache, offline.
 */

(function () {
  'use strict';

  var BASE = '';
  var CACHE_PREFIX = 'apm_cache_';

  // When running inside Capacitor (bundled shell), API hits the server
  if (typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform) {
    BASE = 'https://alignprojects.net';
  }

  function authHeaders() {
    var token = window.Store && window.Store.get('token');
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  /* ── Cache helpers ──────────────────────────────────────────────────── */
  function cacheKey(path) { return CACHE_PREFIX + path; }

  function cacheGet(path) {
    try {
      var raw = localStorage.getItem(cacheKey(path));
      if (!raw) return null;
      var entry = JSON.parse(raw);
      return entry.data;
    } catch (_) { return null; }
  }

  function cacheSet(path, data) {
    try {
      localStorage.setItem(cacheKey(path), JSON.stringify({ ts: Date.now(), data: data }));
    } catch (_) { /* storage full — ignore */ }
  }

  /* Core request function */
  function request(method, path, body) {
    var opts = {
      method: method,
      headers: authHeaders()
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }
    if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
      delete opts.headers['Content-Type'];
    }

    return fetch(BASE + path, opts).then(function (res) {
      if (res.status === 401) {
        if (window.Store) window.Store.clear();
        if (window.Router) window.Router.navigate('signin');
        throw new Error('unauthorized');
      }
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (_) { data = { error: text }; }
        if (!res.ok) {
          var err = new Error(data.error || ('Request failed (' + res.status + ')'));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }).catch(function (err) {
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        var netErr = new Error('offline');
        netErr.offline = true;
        throw netErr;
      }
      throw err;
    });
  }

  /* Stale-while-revalidate: returns cached data instantly, refreshes in bg */
  function cachedGet(path) {
    var cached = cacheGet(path);
    // Return cached immediately if available
    if (cached) {
      // Background refresh
      request('GET', path).then(function (fresh) {
        if (fresh) cacheSet(path, fresh);
      }).catch(function () { /* silent — cache is sufficient */ });
      return Promise.resolve(cached);
    }
    // No cache — fetch and cache
    return request('GET', path).then(function (data) {
      if (data) cacheSet(path, data);
      return data;
    });
  }

  window.Api = {
    get: function (path) { return request('GET', path); },
    post: function (path, body) { return request('POST', path, body); },
    put: function (path, body) { return request('PUT', path, body); },
    del: function (path) { return request('DELETE', path); },
    cachedGet: cachedGet,
    authHeaders: authHeaders,
    request: request
  };
})();
