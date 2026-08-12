/* align-rfis.js — Align RFI module v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Request for Information tracking: card list + create/edit form.
 * Statuses: draft → submitted → answered → closed.
 * Records are FLAT objects (same shape as tasks/punchlist):
 *   { id, number, subject, description, status, assignedTo,
 *     dueDate, answeredDate, answer, createdBy, createdAt, updatedAt }
 * Depends on: align-storage.js (window.AlignStorage), align-auth.js (window.AlignAuth)
 * Styles: align-rfis.css (rf- namespace) — no inline <style> injection (CSP).
 */
(function (global) {
  'use strict';

  function S() { return window.AlignStorage; }
  function A() { return window.AlignAuth; }

  var CATEGORY = 'rfis';
  var STATUSES = ['draft', 'submitted', 'answered', 'closed'];

  var state = {
    container: null,
    projectId: null,
    filter: 'all',       // 'all' | 'draft' | 'submitted' | 'answered' | 'closed'
    editing: null,       // record being edited (or new record stub)
    viewMode: 'list',    // 'list' | 'form'
    people: []           // Directory contacts for the assigned-to dropdown
  };

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function uid() { return 'rf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowISO() { return new Date().toISOString(); }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      // Date-only strings: parse as local midnight to avoid UTC day-shift
      var d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : new Date(iso);
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString(void 0, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return ''; }
  }

  function getUser() {
    try {
      var u = A() && A().getActiveUser ? A().getActiveUser() : null;
      return u ? (u.name || u.username || 'Unknown') : 'Unknown';
    } catch (e) { return 'Unknown'; }
  }

  /* Normalize legacy records (old module used status 'open' and nested .data) */
  function normalize(r) {
    if (r && r.data && typeof r.data === 'object' && r.data.subject !== undefined) {
      r = Object.assign({ id: r.id }, r.data);
    }
    if (r.status === 'open' || !r.status) r.status = 'submitted';
    if (STATUSES.indexOf(r.status) === -1) r.status = 'submitted';
    if (!r.answeredDate && r.answeredAt) r.answeredDate = String(r.answeredAt).slice(0, 10);
    return r;
  }

  function getItems() {
    if (!state.projectId) return [];
    return S().listRecords(state.projectId, CATEGORY).map(normalize);
  }

  function getNextNumber() {
    var max = 0;
    getItems().forEach(function (r) {
      var n = parseInt(r.number, 10) || 0;
      if (n > max) max = n;
    });
    return max + 1;
  }

  function rfiNo(r) {
    var n = parseInt(r.number, 10) || 0;
    return 'RFI-' + (n < 100 ? ('00' + n).slice(-3) : n);
  }

  function statusLabel(s) {
    var m = { draft: 'Draft', submitted: 'Submitted', answered: 'Answered', closed: 'Closed' };
    return m[s] || s;
  }

  function isOverdue(r) {
    return r.dueDate && r.status !== 'answered' && r.status !== 'closed' &&
      new Date(r.dueDate + 'T23:59:59') < new Date();
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/);
    var out = (parts[0] || '')[0] || '';
    if (parts.length > 1) out += (parts[parts.length - 1][0] || '');
    return out.toUpperCase() || '?';
  }

  /* ── Directory contacts (assigned-to source) ────────────────────────── */
  function _loadPeople() {
    var token = '';
    try { token = localStorage.getItem('align-token') || ''; } catch (e) {}
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch('/api/people?status=active', { headers: headers, credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : { people: [] }; })
      .then(function (d) {
        state.people = (d.people || []).filter(function (p) { return p.status === 'active'; });
      })
      .catch(function () { state.people = []; });
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function render(container) {
    if (!container) return;
    state.container = container;
    state.projectId = null;
    state.filter = 'all';
    state.viewMode = 'list';
    state.editing = null;
    state.people = [];
    _resolveProjectId();
    _paint();
  }

  function _resolveProjectId() {
    var s = S();
    var active = s && s.getActiveProject ? s.getActiveProject() : null;
    state.projectId = active ? active.id : null;
  }

  function _paint() {
    var c = state.container;
    if (!c) return;
    _resolveProjectId();
    if (!state.projectId) {
      c.innerHTML = '<div class="rf-empty"><strong>No active project</strong><p>Select a project from the header.</p></div>';
      return;
    }
    if (state.viewMode === 'form' && state.editing) {
      c.innerHTML = _formHtml(state.editing);
      _bindForm();
      return;
    }
    c.innerHTML = _listHtml();
    _bindList();
  }

  /* ── List view ──────────────────────────────────────────────────────── */
  function _listHtml() {
    var items = getItems();
    var h = [];

    // Stats / filter bar
    var counts = { all: items.length, draft: 0, submitted: 0, answered: 0, closed: 0 };
    items.forEach(function (r) { if (counts[r.status] !== undefined) counts[r.status]++; });

    h.push('<div class="rf-stats">');
    ['all'].concat(STATUSES).forEach(function (s) {
      var active = state.filter === s ? ' active' : '';
      h.push('<button class="rf-stat-btn' + active + '" data-rf-filter="' + s + '">');
      h.push('<span class="rf-stat-count">' + counts[s] + '</span>');
      h.push('<span class="rf-stat-label">' + (s === 'all' ? 'Total' : statusLabel(s)) + '</span>');
      h.push('</button>');
    });
    h.push('</div>');

    // Header
    var filtered = state.filter === 'all' ? items : items.filter(function (r) { return r.status === state.filter; });
    filtered.sort(function (a, b) { return (parseInt(b.number, 10) || 0) - (parseInt(a.number, 10) || 0); });

    h.push('<div class="rf-header">');
    h.push('<h3 class="rf-title">RFIs<span class="rf-count">' + filtered.length + (state.filter === 'all' ? '' : ' ' + statusLabel(state.filter).toLowerCase()) + '</span></h3>');
    h.push('<button class="pm-btn primary" id="rf-new-btn">+ New RFI</button>');
    h.push('</div>');

    // Card grid
    if (filtered.length === 0) {
      h.push('<div class="rf-empty"><strong>No RFIs</strong><p>' +
        (items.length === 0 ? 'Create your first request for information.' : 'No RFIs match this filter.') + '</p></div>');
    } else {
      h.push('<div class="rf-list">');
      filtered.forEach(function (r) {
        var overdue = isOverdue(r);
        h.push('<div class="rf-card' + (overdue ? ' rf-overdue' : '') + '" data-rf-id="' + esc(r.id) + '" role="button" tabindex="0">');

        h.push('<div class="rf-card-top">');
        h.push('<span class="rf-card-number">' + rfiNo(r) + '</span>');
        h.push('<span class="rf-pill rf-pill-' + esc(r.status) + '">' + statusLabel(r.status) + '</span>');
        h.push('</div>');

        h.push('<div class="rf-card-subject">' + esc(r.subject || 'Untitled') + '</div>');
        if (r.description) h.push('<div class="rf-card-desc">' + esc(r.description) + '</div>');

        h.push('<div class="rf-card-foot">');
        if (r.assignedTo) {
          h.push('<div class="rf-assignee"><span class="rf-avatar">' + esc(initials(r.assignedTo)) + '</span><span class="rf-assignee-name">' + esc(r.assignedTo) + '</span></div>');
        } else {
          h.push('<div class="rf-assignee"><span class="rf-avatar rf-avatar-empty">?</span><span class="rf-assignee-name rf-unassigned">Unassigned</span></div>');
        }
        h.push('<div class="rf-card-dates">');
        if (r.status === 'answered' || r.status === 'closed') {
          if (r.answeredDate) h.push('<span class="rf-date">Answered ' + fmtDate(r.answeredDate) + '</span>');
        } else if (r.dueDate) {
          h.push('<span class="rf-date' + (overdue ? ' rf-date-over' : '') + '">Due ' + fmtDate(r.dueDate) + '</span>');
        }
        if (r.createdAt) h.push('<span class="rf-date">Created ' + fmtDate(r.createdAt) + '</span>');
        h.push('</div>');
        h.push('</div>');

        h.push('</div>');
      });
      h.push('</div>');
    }

    return '<div class="rf-wrap">' + h.join('') + '</div>';
  }

  function _bindList() {
    var c = state.container;
    var wrap = c.querySelector('.rf-wrap');
    if (!wrap) return;

    var newBtn = c.querySelector('#rf-new-btn');
    if (newBtn) newBtn.addEventListener('click', function () {
      state.editing = {
        id: '',
        number: getNextNumber(),
        subject: '',
        description: '',
        status: 'draft',
        assignedTo: '',
        dueDate: '',
        answeredDate: '',
        answer: '',
        createdBy: getUser(),
        createdAt: '',
        updatedAt: ''
      };
      state.viewMode = 'form';
      _paint();
    });

    wrap.addEventListener('click', function (e) {
      // Filter chips
      var chip = e.target.closest('[data-rf-filter]');
      if (chip) {
        state.filter = chip.getAttribute('data-rf-filter');
        _paint();
        return;
      }
      // Card → open edit form
      var card = e.target.closest('.rf-card');
      if (card) {
        var id = card.getAttribute('data-rf-id');
        var item = getItems().find(function (r) { return r.id === id; });
        if (item) {
          state.editing = JSON.parse(JSON.stringify(item));
          state.viewMode = 'form';
          _paint();
        }
      }
    });

    // Keyboard access for cards
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest('.rf-card');
      if (card) { e.preventDefault(); card.click(); }
    });
  }

  /* ── Form view ──────────────────────────────────────────────────────── */
  function _formHtml(r) {
    var h = [];
    h.push('<div class="rf-form-wrap">');

    h.push('<div class="rf-form-header">');
    h.push('<button class="pm-btn" id="rf-form-back">← Back</button>');
    h.push('<h3 class="rf-form-title">' + (r.id ? 'Edit ' + rfiNo(r) : 'New RFI') + '</h3>');
    h.push('<button class="pm-btn primary" id="rf-form-save">Save</button>');
    h.push('</div>');

    if (r.id && r.createdAt) {
      h.push('<p class="rf-form-meta">Created ' + fmtDate(r.createdAt) + (r.createdBy ? ' by ' + esc(r.createdBy) : '') + '</p>');
    } else {
      h.push('<p class="rf-form-meta">' + rfiNo(r) + ' · will be created by ' + esc(getUser()) + '</p>');
    }

    // Subject
    h.push('<div class="rf-form-s"><label class="rf-fl" for="rf-subject">Subject</label>');
    h.push('<input type="text" class="rf-inp" id="rf-subject" value="' + esc(r.subject || '') + '" placeholder="e.g. Clarification on door hardware schedule"></div>');

    // Description
    h.push('<div class="rf-form-s"><label class="rf-fl" for="rf-desc">Description</label>');
    h.push('<textarea class="rf-txa" id="rf-desc" rows="5" placeholder="Describe the information needed, referencing drawings or specs where possible…">' + esc(r.description || '') + '</textarea></div>');

    // Status + Assigned To
    h.push('<div class="rf-form-r">');
    h.push('<div class="rf-form-f"><label class="rf-fl" for="rf-status">Status</label><select class="rf-sel" id="rf-status">');
    STATUSES.forEach(function (s) {
      h.push('<option value="' + s + '"' + (r.status === s ? ' selected' : '') + '>' + statusLabel(s) + '</option>');
    });
    h.push('</select></div>');
    h.push('<div class="rf-form-f"><label class="rf-fl" for="rf-assigned">Assigned To</label><select class="rf-sel" id="rf-assigned">');
    h.push('<option value="">— Unassigned —</option>');
    if (r.assignedTo) h.push('<option value="' + esc(r.assignedTo) + '" selected>' + esc(r.assignedTo) + '</option>');
    h.push('</select></div>');
    h.push('</div>');

    // Due date + Answered date
    h.push('<div class="rf-form-r">');
    h.push('<div class="rf-form-f"><label class="rf-fl" for="rf-due">Due Date</label><input type="date" class="rf-inp" id="rf-due" value="' + esc(r.dueDate || '') + '"></div>');
    h.push('<div class="rf-form-f"><label class="rf-fl" for="rf-answered">Answered Date</label><input type="date" class="rf-inp" id="rf-answered" value="' + esc(r.answeredDate || '') + '"></div>');
    h.push('</div>');

    // Answer (existing RFIs only)
    if (r.id) {
      h.push('<div class="rf-form-s"><label class="rf-fl" for="rf-answer">Answer</label>');
      h.push('<textarea class="rf-txa" id="rf-answer" rows="4" placeholder="Response to this RFI…">' + esc(r.answer || '') + '</textarea></div>');
    }

    // Danger zone
    if (r.id) {
      h.push('<div class="rf-form-danger"><button class="pm-btn danger" id="rf-form-delete">Delete RFI</button></div>');
    }

    h.push('</div>');
    return h.join('');
  }

  function _bindForm() {
    var c = state.container;

    // Populate assigned-to from the project Directory (people API)
    var assignSel = c.querySelector('#rf-assigned');
    if (assignSel) {
      _loadPeople().then(function () {
        if (!document.body.contains(assignSel)) return; // view changed meanwhile
        var current = state.editing ? (state.editing.assignedTo || '') : '';
        var html = '<option value="">— Unassigned —</option>';
        var seen = false;
        state.people.forEach(function (p) {
          var name = p.name || p.username || p.email || '';
          if (!name) return;
          if (name === current) seen = true;
          var label = name + (p.role && p.role !== 'member' ? ' · ' + p.role : '');
          html += '<option value="' + esc(name) + '"' + (name === current ? ' selected' : '') + '>' + esc(label) + '</option>';
        });
        // Preserve a previously-assigned name that's no longer in the directory
        if (current && !seen) {
          html += '<option value="' + esc(current) + '" selected>' + esc(current) + '</option>';
        }
        assignSel.innerHTML = html;
      });
    }

    var back = c.querySelector('#rf-form-back');
    if (back) back.addEventListener('click', function () {
      state.viewMode = 'list';
      state.editing = null;
      _paint();
    });

    // Auto-fill answered date when status flips to answered
    var statusSel = c.querySelector('#rf-status');
    if (statusSel) statusSel.addEventListener('change', function () {
      var ansInp = c.querySelector('#rf-answered');
      if (this.value === 'answered' && ansInp && !ansInp.value) {
        ansInp.value = new Date().toISOString().slice(0, 10);
      }
    });

    var save = c.querySelector('#rf-form-save');
    if (save) save.addEventListener('click', function () {
      var r = state.editing;
      if (!r) return;

      r.subject = (c.querySelector('#rf-subject') ? c.querySelector('#rf-subject').value : '').trim();
      if (!r.subject) {
        var subj = c.querySelector('#rf-subject');
        if (subj) { subj.focus(); subj.style.borderColor = 'var(--danger)'; }
        return;
      }
      r.description = (c.querySelector('#rf-desc') ? c.querySelector('#rf-desc').value : '').trim();
      r.status = c.querySelector('#rf-status') ? c.querySelector('#rf-status').value : 'draft';
      r.assignedTo = c.querySelector('#rf-assigned') ? c.querySelector('#rf-assigned').value : '';
      r.dueDate = c.querySelector('#rf-due') ? c.querySelector('#rf-due').value : '';
      r.answeredDate = c.querySelector('#rf-answered') ? c.querySelector('#rf-answered').value : '';
      var answerEl = c.querySelector('#rf-answer');
      if (answerEl) r.answer = answerEl.value.trim();

      if ((r.status === 'answered' || r.status === 'closed') && !r.answeredDate) {
        r.answeredDate = new Date().toISOString().slice(0, 10);
      }
      r.updatedAt = nowISO();
      if (!r.createdAt) r.createdAt = nowISO();
      if (!r.createdBy) r.createdBy = getUser();
      if (!r.id) { r.id = uid(); r.number = getNextNumber(); }

      S().saveRecord(state.projectId, CATEGORY, r);
      state.viewMode = 'list';
      state.editing = null;
      _paint();
    });

    var del = c.querySelector('#rf-form-delete');
    if (del) del.addEventListener('click', function () {
      var r = state.editing;
      if (!r || !r.id) return;
      if (!confirm('Delete ' + rfiNo(r) + '? This cannot be undone.')) return;
      S().deleteRecord(state.projectId, CATEGORY, r.id);
      state.viewMode = 'list';
      state.editing = null;
      _paint();
    });
  }

  /* ── Public API ─────────────────────────────────────────────────────── */
  global.AlignRfis = Object.freeze({
    render: render,
    CATEGORY: CATEGORY
  });
  if (window.TileRegistry) window.TileRegistry.register({ id: 'rfis', title: 'RFIs', icon: '[]', route: 'rfis', roles: ['user','admin'], order: 12 });
})(window);
