/* boot.js — Align PM application bootstrap
 * Runs on DOMContentLoaded. Decides destination BEFORE first paint.
 * Load order: store.js → api.js → router.js → modules → boot.js
 */

(function () {
  'use strict';

  function finish(routeName) {
    var app = document.getElementById('app');
    var bootScreen = document.getElementById('boot-screen');

    // Route renders into hidden app
    if (window.Router) window.Router.start(routeName);

    // Show app, hide boot screen
    if (app) app.style.visibility = 'visible';

    if (bootScreen) {
      // Fade out boot screen
      bootScreen.style.transition = 'opacity 200ms ease';
      bootScreen.style.opacity = '0';
      setTimeout(function () {
        if (bootScreen.parentNode) bootScreen.parentNode.removeChild(bootScreen);
      }, 250);
    }
  }

  function boot() {
    var token = null;
    // Use secure token store (iOS Keychain + localStorage mirror)
    if (window.TokenStore) {
      window.TokenStore.load().then(function(t) { 
        token = t;
        _continueBoot(token);
      });
    } else {
      token = window.Store && window.Store.loadToken();
      _continueBoot(token);
    }
  }

  function _continueBoot(token) {
    // Version handshake: check server config before rendering
    window.Api.get('/api/config').then(function(cfg) {
      if (cfg && cfg.minClientVersion) {
        var clientVer = '2.0.0'; // sync with package.json on deploy
        if (clientVer < cfg.minClientVersion) {
          // Force update — render update screen
          var app = document.getElementById('app');
          if (app) {
            app.style.visibility = 'visible';
            app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px"><div><h2>Update Required</h2><p>Please update Align PM to continue.</p><p style="color:var(--muted)">Your version: '+clientVer+'<br>Required: '+cfg.minClientVersion+'</p></div></div>';
          }
          var bs = document.getElementById('boot-screen');
          if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
          return;
        }
      }
      _doBoot(token);
    }).catch(function() {
      // Config fetch failed — proceed anyway (offline tolerance)
      _doBoot(token);
    });
  }

  function _doBoot(token) {

    if (!token) {
      window._routerBooted = true;
      finish('signin');
      return;
    }

    window.Store.set('token', token);

    // Race: session fetch vs 6s timeout
    var timeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, 6000);
    });

    Promise.race([
      window.Api.get('/api/session'),
      timeout
    ]).then(function (data) {
      if (window.Store) window.Store.hydrate(data);
      window._routerBooted = true;
      finish('projects');
    }).catch(function () {
      window._routerBooted = true;
      var cached = window.Store && window.Store.get('user');
      if (cached) {
        if (window.Store) window.Store.set('stale', true);
        finish('projects');
      } else {
        // No session, no cache — sign in
        if (window.Store) window.Store.clear();
        finish('signin');
      }
    });
  }

  // Wait for DOM + essential scripts
  // Set flag immediately so old auth system knows to yield
  window._routerBooted = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
