/* home.js — Align PM Home page for new SPA router
 * Renders tile grid filtered by role from Store
 */

(function () {
  'use strict';

  // Default tiles — extend these as modules register
  var _fallbackTiles = [
    { id: 'daily-logs', title: 'Daily Logs', icon: '📋', route: 'daily-logs', roles: ['user','admin'], order: 1 },
    { id: 'punchlist', title: 'Punchlist', icon: '✓', route: 'punchlist', roles: ['user','admin'], order: 2 },
    { id: 'drawings', title: 'Drawings', icon: '📐', route: 'drawings', roles: ['user','admin'], order: 3 },
    { id: 'files', title: 'Files', icon: '📁', route: 'files', roles: ['user','admin'], order: 4 },
    { id: 'photos', title: 'Photos', icon: '📷', route: 'photos', roles: ['user','admin'], order: 5 },
    { id: 'tasks', title: 'Tasks', icon: '📝', route: 'tasks', roles: ['user','admin'], order: 6 },
    { id: 'contacts', title: 'Directory', icon: '👥', route: 'contacts', roles: ['user','admin'], order: 7 },
    { id: 'schedule', title: 'Schedule', icon: '📅', route: 'schedule', roles: ['user','admin'], order: 8 },
    { id: 'budget', title: 'Budget', icon: '💰', route: 'budget', roles: ['user','admin'], order: 9 },
    { id: 'specs', title: 'Specifications', icon: '📋', route: 'specs', roles: ['user','admin'], order: 10 },
    { id: 'procurement', title: 'Procurement', icon: '📦', route: 'procurement', roles: ['user','admin'], order: 11 },
    { id: 'rfis', title: 'RFIs', icon: '❓', route: 'rfis', roles: ['user','admin'], order: 12 },
    { id: 'settings', title: 'Settings', icon: '⚙', route: 'settings', roles: ['admin'], order: 20 },
    { id: 'members', title: 'Members', icon: '👤', route: 'members', roles: ['admin'], order: 21 },
    { id: 'dev', title: 'Dev Panel', icon: '🔧', route: 'dev', roles: ['admin'], order: 99 }
  ];

  function mount(container) {
    if (!container) return;
    container.innerHTML = '';

    // Show old app header + dashboard (bridge compatibility)
    document.body.classList.remove('section-open');
    document.body.classList.remove('ps-open');

    var appHeader = document.querySelector('.app-header');
    var tileGrid = document.getElementById('tile-grid');
    var dashboard = document.getElementById('dashboard');
    var essentials = document.getElementById('essentials');
    var sectionPage = document.getElementById('section-page');

    if (appHeader) appHeader.style.display = '';
    if (tileGrid) tileGrid.style.display = '';
    if (dashboard) dashboard.style.display = '';
    if (essentials) essentials.style.display = '';
    if (sectionPage) sectionPage.style.display = 'none';

    // Render new-style tile grid below old dashboard
    _renderTileGrid(container);
  }

  function unmount() {}

  function _renderTileGrid(container) {
    var tiles = window.Store && window.Store.get('tiles');
    var user = window.Store && window.Store.get('user');
    var role = user ? user.role : 'user';
    var roles = [role];
    if (role === 'admin') roles = ['admin', 'user'];

    var gridEl = document.createElement('div');
    gridEl.className = 'new-tile-grid';
    gridEl.id = 'new-tile-grid';

    // Filter tiles to what this role can see
    var tileIds = tiles || _fallbackTiles.map(function (t) { return t.id; });
    var visible = _fallbackTiles.filter(function (t) {
      return tileIds.indexOf(t.id) !== -1 && t.roles.some(function (r) { return roles.indexOf(r) !== -1; });
    });

    visible.forEach(function (def) {
      var tileEl = document.createElement('div');
      tileEl.className = 'new-tile';
      tileEl.setAttribute('data-route', def.route);
      tileEl.innerHTML =
        '<span class="new-tile-icon">' + def.icon + '</span>' +
        '<span class="new-tile-title">' + window._esc(def.title) + '</span>';
      tileEl.addEventListener('click', function () {
        if (window.Router) window.Router.navigate(def.route);
      });
      gridEl.appendChild(tileEl);
    });

    container.appendChild(gridEl);
  }

  window.HomePage = {
    mount: mount,
    unmount: unmount
  };
})();
