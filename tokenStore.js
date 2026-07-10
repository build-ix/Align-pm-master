/* tokenStore.js — secure token storage with Keychain fallback
 * iOS: uses Capacitor Preferences (native storage, survives app delete)
 * Web: uses localStorage
 * Mirrors token so WKWebView storage eviction doesn't log you out
 */

(function () {
  'use strict';

  var KEY = 'align_secure_token';

  window.TokenStore = {
    /* Save token to BOTH localStorage and secure store */
    save: function (token) {
      // localStorage (fast read on boot)
      try { localStorage.setItem(KEY, token); } catch (_) {}
      // Capacitor Preferences (native, survives eviction)
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        window.Capacitor.Plugins.Preferences.set({ key: KEY, value: token }).catch(function () {});
      }
      // Also update Store for immediate use
      if (window.Store) window.Store.persistToken(token);
    },

    /* Load token — tries localStorage first, falls back to secure store */
    load: function () {
      return new Promise(function (resolve) {
        var local = null;
        try { local = localStorage.getItem(KEY); } catch (_) {}
        if (local) return resolve(local);

        // Try Capacitor Preferences
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
          window.Capacitor.Plugins.Preferences.get({ key: KEY }).then(function (result) {
            var val = result && result.value;
            if (val) {
              // Restore to localStorage so next boot is fast
              try { localStorage.setItem(KEY, val); } catch (_) {}
            }
            resolve(val || null);
          }).catch(function () { resolve(null); });
        } else {
          resolve(null);
        }
      });
    },

    /* Remove token everywhere */
    clear: function () {
      try { localStorage.removeItem(KEY); } catch (_) {}
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        window.Capacitor.Plugins.Preferences.remove({ key: KEY }).catch(function () {});
      }
      if (window.Store) window.Store.clear();
    }
  };
})();
