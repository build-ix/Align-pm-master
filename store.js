/* store.js — Align PM in-memory state store
 * Single source of truth for session, auth, and navigation state.
 * Persists token to localStorage (Capacitor Preferences when native).
 */

(function () {
  'use strict';

  var _state = {
    token: null,
    user: null,
    projects: [],
    tiles: [],
    currentProjectId: null,
    stale: false
  };

  var STORE_KEY = 'apm_token';

  window.Store = {
    get: function (key) { return _state[key]; },
    set: function (key, val) { _state[key] = val; },

    /* Hydrate all session state from a single bootstrap object */
    hydrate: function (data) {
      if (!data) return;
      if (data.token) _state.token = data.token;
      if (data.user) _state.user = data.user;
      if (data.projects) _state.projects = data.projects;
      if (data.tiles) _state.tiles = data.tiles;
      _state.stale = false;
    },

    /* Clear everything (logout / expired token) */
    clear: function () {
      _state.token = null;
      _state.user = null;
      _state.projects = [];
      _state.tiles = [];
      _state.currentProjectId = null;
      _state.stale = false;
      try { localStorage.removeItem(STORE_KEY); } catch (_) {}
      try { localStorage.removeItem('apm_last_project'); } catch (_) {}
    },

    /* Persist bearer token to localStorage (with Capacitor fallback) */
    persistToken: function (token) {
      _state.token = token;
      try { localStorage.setItem(STORE_KEY, token); } catch (_) {}
    },

    /* Load cached token — returns null if none */
    loadToken: function () {
      try { return localStorage.getItem(STORE_KEY); } catch (_) { return null; }
    },

    /* Persist last selected project ID */
    setLastProject: function (id) {
      _state.currentProjectId = id;
      try { localStorage.setItem('apm_last_project', id); } catch (_) {}
    },

    getLastProject: function () {
      try { return localStorage.getItem('apm_last_project'); } catch (_) { return null; }
    }
  };
})();
