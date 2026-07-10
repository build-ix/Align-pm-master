/* router.js — Align PM hash-based SPA router
 * Boot flow: Store.loadToken() → /api/session → route decision → first paint
 */

(function () {
  'use strict';

  var _currentModule = null;
  var _currentRoute = null;
  var _container = null;

  /* ── Route Table ──────────────────────────────────────────────────────── */
  var _routes = {
    'signin':        { module: 'AlignAuth',     public: true },
    'projects':      { module: 'AlignProjects', public: false },
    'home':          { module: 'Home',           public: false },
    'daily-logs':    { module: 'AlignDailyLogs', public: false, needsProject: true },
    'punchlist':     { module: 'AlignPunchlist', public: false, needsProject: true },
    'drawings':      { module: 'AlignDrawings',  public: false, needsProject: true },
    'files':         { module: 'AlignFiles',     public: false, needsProject: true },
    'photos':        { module: 'AlignPhotos',    public: false, needsProject: true },
    'tasks':         { module: 'AlignTasks',     public: false, needsProject: true },
    'contacts':      { module: 'AlignContacts',  public: false, needsProject: true },
    'schedule':      { module: 'AlignSchedule',  public: false, needsProject: true },
    'budget':        { module: 'AlignBudget',    public: false, needsProject: true },
    'specs':         { module: 'AlignSpecs',     public: false, needsProject: true },
    'procurement':   { module: 'AlignProcurement', public: false, needsProject: true },
    'rfis':          { module: 'AlignRFIs',      public: false, needsProject: true },
    'settings':      { module: 'AlignSettings',  public: false, needsProject: true },
    'dev':           { module: 'DevPanel',       public: false, role: 'super_admin' }
  };

  /* ── Guard ─────────────────────────────────────────────────────────────── */
  function guard(routeDef) {
    if (!routeDef) return 'signin';
    if (!routeDef.public) {
      var token = window.Store && window.Store.get('token');
      if (!token) return 'signin';
    }
    if (routeDef.role) {
      var user = window.Store && window.Store.get('user');
      if (!user || user.role !== routeDef.role) return 'home';
    }
    if (routeDef.needsProject) {
      var pid = window.Store && window.Store.get('currentProjectId');
      if (!pid) return 'projects';
    }
    return null; // allowed
  }

  /* ── Route Handler ─────────────────────────────────────────────────────── */
  function handleRoute() {
    var hash = location.hash.replace('#', '') || 'home';
    // Parse sub-routes like #section-page?section=drawings
    var qm = hash.indexOf('?');
    var routeName = qm > -1 ? hash.substring(0, qm) : hash;

    var routeDef = _routes[routeName];
    var redirect = guard(routeDef);
    if (redirect) {
      navigate(redirect);
      return;
    }

    if (_currentModule && _currentModule.unmount) {
      try { _currentModule.unmount(); } catch (_) {}
    }
    _currentModule = null;
    _currentRoute = routeName;

    var container = _container || document.getElementById('app');
    if (!container) return;

    // Clear content area (preserve boot structure)
    container.innerHTML = '';

    // Build section page if this is a tile route
    if (routeDef && routeDef.needsProject) {
      container.innerHTML = '<div id="section-page"><div id="section-body"></div></div>';
      var sectionBody = document.getElementById('section-body');
      if (sectionBody && window[routeDef.module] && window[routeDef.module].render) {
        _currentModule = window[routeDef.module];
        try {
          window[routeDef.module].render(sectionBody);
        } catch (err) {
          sectionBody.innerHTML = '<div class="tile-error"><div class="tile-error-inner"><div class="tile-error-title">Something went wrong</div><button class="btn-retry" onclick="window.Router.reload()">Retry</button></div></div>';
        }
      }
    } else if (routeDef) {
      // Module route (signin, projects, home)
      if (window[routeDef.module] && window[routeDef.module].mount) {
        _currentModule = window[routeDef.module];
        window[routeDef.module].mount(container);
      }
    }
  }

  /* ── Start ─────────────────────────────────────────────────────────────── */
  function start(initialRoute) {
    _container = document.getElementById('app');
    if (!_container) return;

    // Set initial hash without triggering handler twice
    history.replaceState(null, '', '#' + (initialRoute || 'home'));
    handleRoute();

    // Now bind future hash changes
    window.addEventListener('hashchange', handleRoute);
  }

  /* ── Navigate ──────────────────────────────────────────────────────────── */
  function navigate(name) {
    if (location.hash === '#' + name) {
      handleRoute(); // force re-render even if same hash
    } else {
      location.hash = name;
    }
  }

  function reload() {
    handleRoute();
  }

  function currentRoute() {
    return _currentRoute;
  }

  /* ── Public API ────────────────────────────────────────────────────────── */
  window.Router = {
    start: start,
    navigate: navigate,
    reload: reload,
    currentRoute: currentRoute,
    handleRoute: handleRoute
  };
})();
