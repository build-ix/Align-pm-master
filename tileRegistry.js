/* tileRegistry.js — Align PM tile registration system
 * Tiles register themselves. Home page queries by role.
 */

(function () {
  'use strict';

  var _tiles = [];

  window.TileRegistry = {
    register: function (def) {
      if (!def || !def.id || typeof def.render !== 'function') {
        console.warn('[TileRegistry] rejected invalid tile:', def);
        return;
      }
      // Avoid duplicates
      var existing = _tiles.findIndex(function (t) { return t.id === def.id; });
      if (existing >= 0) _tiles[existing] = def;
      else _tiles.push(def);
    },

    get: function (id) {
      return _tiles.find(function (t) { return t.id === id; });
    },

    all: function () {
      return _tiles.slice().sort(function (a, b) {
        return (a.order || 99) - (b.order || 99);
      });
    },

    /* Filter tiles by role — only returns tiles the user can see */
    forRoles: function (roles) {
      if (!roles || !roles.length) return [];
      return _tiles.filter(function (t) {
        // If tile has no roles restriction, show to everyone
        if (!t.roles || !t.roles.length) return true;
        return t.roles.some(function (r) { return roles.indexOf(r) !== -1; });
      });
    }
  };
})();
