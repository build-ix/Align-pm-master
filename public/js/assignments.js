// public/js/assignments.js — Punchlist assignment multi-select sheet + notify
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function apiHeaders() {
    return window.AlignAPI && window.AlignAPI.authHeaders ? window.AlignAPI.authHeaders() : {};
  }

  function jsonHeaders() {
    return Object.assign({ 'Content-Type': 'application/json' }, apiHeaders());
  }

  async function fetchContacts(projectId) {
    const res = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/directory/contacts', { headers: apiHeaders() });
    if (!res.ok) throw new Error('Failed to load contacts');
    return (await res.json()).contacts || [];
  }

  async function fetchAssignments(punchItemId) {
    const res = await fetch('/api/punchlist/' + encodeURIComponent(punchItemId) + '/assignments', { headers: apiHeaders() });
    if (!res.ok) throw new Error('Failed to load assignments');
    return res.json();
  }

  async function saveAssignments(punchItemId, userIds) {
    const res = await fetch('/api/punchlist/' + encodeURIComponent(punchItemId) + '/assignments', {
      method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ userIds: userIds })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'Save failed');
    return data;
  }

  async function notifyItem(punchItemId) {
    const res = await fetch('/api/punchlist/' + encodeURIComponent(punchItemId) + '/notify', {
      method: 'POST', headers: jsonHeaders()
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.message || data.error || 'Notify failed');
    return data;
  }

  function closeAssignmentSheet() {
    const s = document.getElementById('assign-sheet');
    if (s) s.remove();
  }

  function openAssignmentSheet(opts) {
    opts = opts || {};
    closeAssignmentSheet();

    const sheet = document.createElement('div');
    sheet.className = 'assign-sheet';
    sheet.id = 'assign-sheet';
    sheet.innerHTML =
      '<button type="button" class="assign-sheet__backdrop" data-assign-act="cancel" aria-label="Close"></button>' +
      '<section class="assign-sheet__panel" role="dialog" aria-modal="true" aria-label="Assign people">' +
        '<header class="assign-sheet__header">' +
          '<button type="button" class="assign-sheet__cancel" data-assign-act="cancel">Cancel</button>' +
          '<h2>Assigned To</h2>' +
          '<button type="button" class="assign-sheet__save" data-assign-act="save">Save</button>' +
        '</header>' +
        '<div class="assign-sheet__search-wrap">' +
          '<input id="assign-search" class="assign-sheet__search" type="search" placeholder="Search name or company" autocomplete="off">' +
        '</div>' +
        '<div class="assign-sheet__body" id="assign-sheet-body"><em class="assign-sheet__loading">Loading contacts…</em></div>' +
      '</section>';
    document.body.appendChild(sheet);

    const selected = new Set();
    let contacts = [];
    let saving = false;

    sheet.addEventListener('click', function (e) {
      const act = e.target.closest('[data-assign-act]');
      if (!act) return;
      const a = act.getAttribute('data-assign-act');
      if (a === 'cancel') { closeAssignmentSheet(); return; }
      if (a === 'save') { doSave(); return; }
    });

    sheet.addEventListener('change', function (e) {
      const cb = e.target.closest('input[type=checkbox][data-assign-id]');
      if (!cb) return;
      const id = cb.getAttribute('data-assign-id');
      if (cb.checked) selected.add(id); else selected.delete(id);
    });

    const searchInput = sheet.querySelector('#assign-search');
    searchInput.addEventListener('input', function () {
      renderBody(searchInput.value.trim().toLowerCase());
    });

    function renderBody(q) {
      const body = document.getElementById('assign-sheet-body');
      if (!body) return;
      let list = contacts;
      if (q) {
        list = contacts.filter(function (c) {
          return (c.name || '').toLowerCase().indexOf(q) !== -1 ||
            (c.companyName || '').toLowerCase().indexOf(q) !== -1 ||
            (c.email || '').toLowerCase().indexOf(q) !== -1;
        });
      }
      const groups = {};
      list.forEach(function (c) {
        const key = c.companyName || 'Independent / No company';
        (groups[key] = groups[key] || []).push(c);
      });
      const keys = Object.keys(groups).sort();
      let html = '';
      if (list.length === 0) {
        html = '<em class="assign-sheet__empty">No contacts found</em>';
      }
      keys.forEach(function (k) {
        html += '<section class="assign-group"><h3 class="assign-group__title">' + esc(k) + '</h3>';
        groups[k].forEach(function (c) {
          const checked = selected.has(c.userId) ? ' checked' : '';
          html += '<label class="assign-option"><input type="checkbox" data-assign-id="' + esc(c.userId) + '"' + checked + '>' +
            '<span class="assign-option__text"><span class="assign-option__name">' + esc(c.name) + '</span>' +
            '<span class="assign-option__meta">' + esc(c.email || 'no email') + '</span></span></label>';
        });
        html += '</section>';
      });
      body.innerHTML = html;
    }

    function doSave() {
      if (saving) return;
      saving = true;
      const saveBtn = sheet.querySelector('[data-assign-act="save"]');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      saveAssignments(opts.punchItemId, Array.from(selected)).then(function (res) {
        closeAssignmentSheet();
        if (opts.onSaved) opts.onSaved(res.assignments || []);
      }).catch(function (err) {
        alert('Save failed: ' + err.message);
        saving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      });
    }

    Promise.all([
      fetchAssignments(opts.punchItemId).catch(function () { return []; }),
      fetchContacts(opts.projectId).catch(function () { return []; })
    ]).then(function (results) {
      (results[0] || []).forEach(function (a) { selected.add(a.user_id); });
      contacts = results[1] || [];
      renderBody('');
    }).catch(function (err) {
      const body = document.getElementById('assign-sheet-body');
      if (body) body.innerHTML = '<em class="assign-sheet__error">Error: ' + esc(err.message) + '</em>';
    });
  }

  global.PunchlistAssignments = {
    openAssignmentSheet: openAssignmentSheet,
    closeAssignmentSheet: closeAssignmentSheet,
    notifyItem: notifyItem,
    fetchAssignments: fetchAssignments,
    saveAssignments: saveAssignments
  };
})(window);
