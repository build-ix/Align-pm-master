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
    var token = window.Store && window.Store.loadToken();

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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
