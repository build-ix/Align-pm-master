/* align-storage.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Centralized, project-scoped localStorage engine.
 *
 * ANALOGY: Think of this like a filing cabinet.
 *   • The cabinet itself  = localStorage
 *   • Each drawer         = a Project (e.g. "439 East 77th Street")
 *   • Folders in a drawer = Categories (drawings, daily-logs, rfis…)
 *   • Papers in a folder  = individual records (the actual data)
 *
 * localStorage key layout
 * ───────────────────────
 *   align.projects.v1                     → JSON array of project objects
 *   align.store.{projectId}.{category}    → JSON array of records
 *   align.active-project                  → string project ID (last selected)
 *
 * Public API  (window.AlignStorage)
 * ────────────────────────────────────
 *  Projects
 *    .listProjects()                    → Project[]
 *    .getProject(id)                    → Project | null
 *    .createProject(name, address)      → Project
 *    .updateProject(id, patches)        → Project | null
 *    .deleteProject(id)                 → boolean
 *    .getActiveProject()                → Project | null
 *    .setActiveProject(id)              → void
 *
 *  Records (per project + category)
 *    .listRecords(projectId, category)            → Record[]
 *    .getRecord(projectId, category, recordId)    → Record | null
 *    .saveRecord(projectId, category, record)     → Record  (upsert by .id)
 *    .deleteRecord(projectId, category, recordId) → boolean
 *    .sortRecords(projectId, category, compareFn) → Record[]
 *    .clearCategory(projectId, category)          → void
 *
 *  Utility
 *    .uid()        → unique string id
 *    .nowISO()     → ISO timestamp string
 *    .categories   → string[] of known category slugs
 */

(function (global) {
  'use strict';

  /* ── One-time cleanup of old Buildix data ───────────────────────────────── */
  var CLEANUP_FLAG = 'align.cleanup-ran.v1';
  try {
    if (!global.localStorage.getItem(CLEANUP_FLAG)) {
      /* ---- localStorage keys with old 'buildix.' prefix ---- */
      var keysToNuke = [];
      for (var k = 0; k < global.localStorage.length; k++) {
        var key = global.localStorage.key(k);
        if (key && (key.indexOf('buildix.') === 0 ||
                    key.indexOf('buildix-') === 0)) {
          keysToNuke.push(key);
        }
      }
      for (var n = 0; n < keysToNuke.length; n++) {
        global.localStorage.removeItem(keysToNuke[n]);
      }

      /* ---- IndexedDB databases from old Buildix ---- */
      var oldDBs = ['buildix-blobs', 'buildix-drawings', 'buildix-markups'];
      for (var d = 0; d < oldDBs.length; d++) {
        try {
          var req = global.indexedDB.deleteDatabase(oldDBs[d]);
          // Best-effort — fire-and-forget
        } catch (_) { /* browser may not support deleteDatabase */ }
      }

      /* Stamp flag so we never run again */
      try { global.localStorage.setItem(CLEANUP_FLAG, '1'); } catch (_) {}
    }
  } catch (_) { /* never let cleanup break the app */ }

  /* ── Key helpers ─────────────────────────────────────────────────────────── */
  var PROJECTS_KEY    = 'align.projects.v1';
  var ACTIVE_KEY      = 'align.active-project';
  var STORE_PREFIX    = 'align.store.';

  /** Known categories — mirrors the tile list in index.html */
  var CATEGORIES = [
    'drawings', 'daily-logs', 'specs', 'rfis',
    'punchlist', 'schedule', 'budget', 'contacts',
    'photos', 'tasks', 'procurement', 'files', 'settings'
  ];

  function storeKey(projectId, category) {
    return STORE_PREFIX + projectId + '.' + category;
  }

  /* ── Small utilities ─────────────────────────────────────────────────────── */
  function uid() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  /* ── Raw localStorage read/write (never throws) ──────────────────────────── */
  function lsGet(key) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[AlignStorage] write failed:', key, e);
      return false;
    }
  }

  function lsRemove(key) {
    try {
      global.localStorage.removeItem(key);
    } catch (e) { /* silent */ }
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * PROJECT MANAGEMENT
   * Each project: { id, name, address, createdAt, updatedAt }
   * ════════════════════════════════════════════════════════════════════════════ */

  function loadProjects() {
    var data = lsGet(PROJECTS_KEY);
    return Array.isArray(data) ? data : [];
  }

  function saveProjects(list) {
    lsSet(PROJECTS_KEY, list);
  }

  /** Return all projects, newest first. */
  function listProjects() {
    return loadProjects().slice().sort(function (a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  /** Find a project by ID. */
  function getProject(id) {
    return loadProjects().find(function (p) { return p.id === id; }) || null;
  }

  /** Create a new project with the given name and optional address. */
  function createProject(name, address) {
    name = (name || '').toString().trim();
    if (!name) throw new Error('Project name is required.');
    var project = {
      id:        uid(),
      name:      name,
      address:   (address || '').toString().trim(),
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    var list = loadProjects();
    list.push(project);
    saveProjects(list);
    return project;
  }

  /** Patch fields of an existing project (name, address, etc.). */
  function updateProject(id, patches) {
    var list = loadProjects();
    var idx  = list.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return null;
    Object.assign(list[idx], patches, { id: id, updatedAt: nowISO() });
    saveProjects(list);
    return list[idx];
  }

  /**
   * Delete a project AND all of its stored records (every category).
   * Returns true if the project existed.
   */
  function deleteProject(id) {
    var list = loadProjects();
    var idx  = list.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return false;
    list.splice(idx, 1);
    saveProjects(list);
    // Purge all category buckets for this project
    CATEGORIES.forEach(function (cat) {
      lsRemove(storeKey(id, cat));
    });
    // If this was the active project, clear that too
    if (lsGet(ACTIVE_KEY) === id) lsRemove(ACTIVE_KEY);
    return true;
  }

  /* ── Active-project shortcuts ─────────────────────────────────────────────── */

  function getActiveProject() {
    var id = lsGet(ACTIVE_KEY);
    if (!id) return null;
    return getProject(id);
  }

  function setActiveProject(id) {
    lsSet(ACTIVE_KEY, id);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * RECORD MANAGEMENT  (per project + category)
   * Records are plain objects; the only required field is `.id` (set on upsert).
   * ════════════════════════════════════════════════════════════════════════════ */

  function loadRecords(projectId, category) {
    var data = lsGet(storeKey(projectId, category));
    return Array.isArray(data) ? data : [];
  }

  function saveRecords(projectId, category, list) {
    lsSet(storeKey(projectId, category), list);
  }

  /** Return all records for a project+category. */
  function listRecords(projectId, category) {
    return loadRecords(projectId, category);
  }

  /** Find a single record by ID. */
  function getRecord(projectId, category, recordId) {
    return loadRecords(projectId, category)
      .find(function (r) { return r.id === recordId; }) || null;
  }

  /**
   * Upsert a record.
   * • If record.id exists and matches a stored record → update it (merge).
   * • Otherwise → insert as new (assigns a fresh id if missing).
   * Always stamps updatedAt; stamps createdAt on insert.
   * Returns the saved record.
   */
  function saveRecord(projectId, category, record) {
    var list = loadRecords(projectId, category);
    var now  = nowISO();
    var rec  = Object.assign({}, record);

    if (rec.id) {
      var idx = list.findIndex(function (r) { return r.id === rec.id; });
      if (idx !== -1) {
        list[idx] = Object.assign({}, list[idx], rec, { updatedAt: now });
        saveRecords(projectId, category, list);
        return list[idx];
      }
    } else {
      rec.id = uid();
    }
    // INSERT new
    rec.createdAt = rec.createdAt || now;
    rec.updatedAt = now;
    list.push(rec);
    saveRecords(projectId, category, list);
    return rec;
  }

  /** Delete a single record by ID. Returns true if found and removed. */
  function deleteRecord(projectId, category, recordId) {
    var list = loadRecords(projectId, category);
    var idx  = list.findIndex(function (r) { return r.id === recordId; });
    if (idx === -1) return false;
    list.splice(idx, 1);
    saveRecords(projectId, category, list);
    return true;
  }

  /**
   * Sort records in-place for a project+category using the given compareFn.
   * Returns the sorted array.
   */
  function sortRecords(projectId, category, compareFn) {
    var list = loadRecords(projectId, category);
    list.sort(compareFn);
    saveRecords(projectId, category, list);
    return list;
  }

  /** Delete all records in a category for a given project. */
  function clearCategory(projectId, category) {
    lsRemove(storeKey(projectId, category));
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * PUBLIC API
   * ════════════════════════════════════════════════════════════════════════════ */

  var _storage = Object.freeze({
    // Projects
    listProjects:     listProjects,
    getProject:       getProject,
    createProject:    createProject,
    updateProject:    updateProject,
    deleteProject:    deleteProject,
    getActiveProject: getActiveProject,
    setActiveProject: setActiveProject,

    // Records
    listRecords:   listRecords,
    getRecord:     getRecord,
    saveRecord:    saveRecord,
    deleteRecord:  deleteRecord,
    sortRecords:   sortRecords,
    clearCategory: clearCategory,

    // Utility
    uid:        uid,
    nowISO:     nowISO,
    categories:  Object.freeze(CATEGORIES.slice()),

    // Event (no-op for localStorage — project change is handled by AlignProjects)
    onProjectChange: function(fn) { /* localStorage — use AlignProjects.onProjectChange instead */ }
  });

  global.AlignStorage = _storage;
  global.__AlignLocalEngine = { storage: _storage };

})(window);
