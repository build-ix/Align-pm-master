/* api.js — Align PM single API wrapper
 * Every network call goes through here. Handles auth, errors, offline.
 */

(function () {
  'use strict';

  var BASE = ''; // same-origin for web, set by Capacitor if needed

  function authHeaders() {
    var token = window.Store && window.Store.get('token');
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
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
    // GET/HEAD/DELETE should not have Content-Type set
    if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
      delete opts.headers['Content-Type'];
    }

    return fetch(BASE + path, opts).then(function (res) {
      // Auth failure — clear state, redirect
      if (res.status === 401) {
        if (window.Store) window.Store.clear();
        if (window.Router) window.Router.navigate('signin');
        throw new Error('unauthorized');
      }
      // 204 No Content
      if (res.status === 204) return null;
      // Parse JSON, fallback to text
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
      // Network error (offline) — don't clear auth
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        var netErr = new Error('offline');
        netErr.offline = true;
        throw netErr;
      }
      throw err;
    });
  }

  window.Api = {
    get: function (path) { return request('GET', path); },
    post: function (path, body) { return request('POST', path, body); },
    put: function (path, body) { return request('PUT', path, body); },
    del: function (path) { return request('DELETE', path); },
    authHeaders: authHeaders,
    request: request
  };
})();
