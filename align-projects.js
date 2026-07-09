/* align-projects.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Project Manager UI module.
 * Depends on: align-storage.js  (window.AlignStorage)
 *
 * ANALOGY: This is the "front of the filing cabinet" — the labels on each
 * drawer. You can add a new drawer (project), rename it, delete it, or pull
 * it open to make it the active project that all other modules read from.
 *
 * Public API  (window.AlignProjects)
 * ─────────────────────────────────────
 *   .render(container)       → mount the full Project Manager UI
 *   .getActiveId()           → string | null  (current active project id)
 *   .onProjectChange(fn)     → register a listener called with (project|null)
 *                              whenever the active project changes
 */

(function (global) {
  'use strict';

  function S() { return global.AlignStorage; }

  /* ── Change listeners ────────────────────────────────────────────────────── */
  var listeners = [];

  function onProjectChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function fireChange(project) {
    listeners.forEach(function (fn) {
      try { fn(project); } catch (e) { /* silent */ }
    });
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * RENDER
   * ══════════════════════════════════════════════════════════════════════════ */

  var uiState = {
    container:    null,
    search:       '',
    showAddForm:  false,
    editingId:    null,   // project id currently being renamed
    confirmDeleteId: null // project id pending deletion confirm
  };

  function render(container) {
    if (!container) return;
    uiState.container = container;
    _paint();
  }

  function _paint() {
    var c = uiState.container;
    if (!c) return;
    var html = '<div class="pm-wrap">' + _toolbarHtml() + _bodyHtml() + '</div>';
    c.innerHTML = html;
    _wire(c);
  }

  /* ── Toolbar ─────────────────────────────────────────────────────────────── */
  function _toolbarHtml() {
    return [
      '<div class="pm-toolbar">',
        '<input type="search" class="pm-search" placeholder="Search projects…" value="', esc(uiState.search), '" aria-label="Search projects">',
        '<button type="button" class="pm-btn primary" data-act="add-project">+ New Project</button>',
      '</div>'
    ].join('');
  }

  /* ── Body: add form + project list ──────────────────────────────────────── */
  function _bodyHtml() {
    var parts = [];

    // "Add new project" inline form
    if (uiState.showAddForm) {
      parts.push(
        '<div class="pm-form" id="pm-add-form">',
          '<span class="pm-form-label">New Project Name</span>',
          '<input type="text" class="pm-form-input" id="pm-new-name" placeholder="e.g. 123 Main Street" autofocus>',
          '<button type="button" class="pm-btn primary" data-act="save-add">Save</button>',
          '<button type="button" class="pm-btn" data-act="cancel-add">Cancel</button>',
        '</div>'
      );
    }

    // Filter + render project cards
    var q = uiState.search.toLowerCase().trim();
    var projects = S().listProjects().filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) !== -1;
    });
    var activeId = S().getActiveProject() ? S().getActiveProject().id : null;

    if (!projects.length && !uiState.showAddForm) {
      parts.push(
        '<div class="pm-empty">',
          '<strong>No projects yet</strong>',
          q ? 'No projects match "' + esc(q) + '".' : 'Click <b>+ New Project</b> to create your first one.',
        '</div>'
      );
    } else if (projects.length) {
      parts.push('<ul class="pm-list">');
      projects.forEach(function (p) {
        var isActive  = p.id === activeId;
        var isEditing = p.id === uiState.editingId;
        var isConfirm = p.id === uiState.confirmDeleteId;

        parts.push('<li class="pm-card' + (isActive ? ' active' : '') + '" data-pid="' + esc(p.id) + '">');
        parts.push('<div class="pm-card-dot"></div>');

        if (isEditing) {
          // Inline rename form
          parts.push(
            '<div class="pm-card-info">',
              '<input type="text" class="pm-form-input" id="pm-edit-input" value="', esc(p.name), '">',
            '</div>',
            '<div class="pm-card-actions">',
              '<button class="pm-btn small primary" data-act="save-edit" data-pid="', esc(p.id), '">Save</button>',
              '<button class="pm-btn small" data-act="cancel-edit">Cancel</button>',
            '</div>'
          );
        } else if (isConfirm) {
          // Delete confirmation row
          parts.push(
            '<div class="pm-card-info pm-confirm-row">',
              'Delete <b>', esc(p.name), '</b>? All its data will be erased.',
              '<button class="pm-btn small danger" data-act="confirm-delete" data-pid="', esc(p.id), '">Yes, Delete</button>',
              '<button class="pm-btn small" data-act="cancel-delete">Cancel</button>',
            '</div>'
          );
        } else {
          // Normal card
          parts.push(
            '<div class="pm-card-info">',
              '<div class="pm-card-name">', esc(p.name), '</div>',
              '<div class="pm-card-meta">Created ', esc(fmtDate(p.createdAt)), '</div>',
            '</div>',
            '<div class="pm-card-actions">',
              '<button class="pm-btn small" data-act="edit" data-pid="', esc(p.id), '">Rename</button>',
              '<button class="pm-btn small danger" data-act="delete" data-pid="', esc(p.id), '">Delete</button>',
            '</div>'
          );
        }
        parts.push('</li>');
      });
      parts.push('</ul>');
    }

    return parts.join('');
  }

  /* ── Click handler (attached ONCE — never duplicates) ──────────────────── */
  var _clickWired = false;

  function _handleClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var pid = btn.getAttribute('data-pid');

    if (act === 'add-project') {
      uiState.showAddForm = !uiState.showAddForm;
      uiState.editingId = null;
      _paint();
      var ni = uiState.container && uiState.container.querySelector('#pm-new-name');
      if (ni) ni.focus();
      return;
    }

    if (act === 'cancel-add') {
      uiState.showAddForm = false;
      _paint();
      return;
    }

    if (act === 'save-add') {
      var input = uiState.container && uiState.container.querySelector('#pm-new-name');
      var name = (input ? input.value : '').trim();
      if (!name) return;
      try {
        var p = S().createProject(name);
        S().setActiveProject(p.id);
        fireChange(p);
      } catch (err) { /* ignore */ }
      uiState.showAddForm = false;
      _paint();
      return;
    }

    if (act === 'edit') {
      uiState.editingId = pid;
      uiState.showAddForm = false;
      _paint();
      var editInput = uiState.container && uiState.container.querySelector('#pm-edit-input');
      if (editInput) { editInput.focus(); editInput.select(); }
      return;
    }

    if (act === 'cancel-edit') {
      uiState.editingId = null;
      _paint();
      return;
    }

    if (act === 'save-edit') {
      var editEl = uiState.container && uiState.container.querySelector('#pm-edit-input');
      var newName = (editEl ? editEl.value : '').trim();
      if (newName && pid) {
        var updated = S().updateProject(pid, { name: newName });
        var activeId = S().getActiveProject() ? S().getActiveProject().id : null;
        if (updated && pid === activeId) fireChange(updated);
      }
      uiState.editingId = null;
      _paint();
      return;
    }

    if (act === 'delete') {
      uiState.confirmDeleteId = pid;
      uiState.editingId = null;
      _paint();
      return;
    }

    if (act === 'cancel-delete') {
      uiState.confirmDeleteId = null;
      _paint();
      return;
    }

    if (act === 'confirm-delete') {
      if (pid) {
        var wasActive = S().getActiveProject() && S().getActiveProject().id === pid;
        S().deleteProject(pid);
        if (wasActive) fireChange(null);
      }
      uiState.confirmDeleteId = null;
      _paint();
      return;
    }
  }

  /* ── Wire events (search re-wires each paint; click attaches once) ─────── */
  function _wire(c) {
    // Click delegation — attach ONCE to the container, never duplicate
    if (!_clickWired) {
      c.addEventListener('click', _handleClick);
      _clickWired = true;
    }

    // Search input is replaced on every paint, so re-wire it each time
    var searchEl = c.querySelector('.pm-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        uiState.search = this.value;
        _paint();
      });
    }
  }

  /* ── Public helpers ──────────────────────────────────────────────────────── */

  function getActiveId() {
    var p = S().getActiveProject();
    return p ? p.id : null;
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * PUBLIC API
   * ════════════════════════════════════════════════════════════════════════════ */

  global.AlignProjects = Object.freeze({
    render:          render,
    getActiveId:     getActiveId,
    onProjectChange: onProjectChange
  });

})(window);
