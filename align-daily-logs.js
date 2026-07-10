/* align-daily-logs.js
 * Align — Daily Logs (field reports, weather, crew, revisions, PDF export)
 * Ported from script.js with clean module structure.
 *
 * Uses dlog-* CSS classes already defined in styles.css
 */

(function (global) {
  'use strict';

  function S() { return window.AlignStorage; }

  var CATEGORY = 'daily-logs';
  var WEATHER_GEN = 0; // staleness guard for async weather fetches
  function _apiUrl(pid) { return '/api/projects/' + encodeURIComponent(pid) + '/daily-logs'; }
  function _authHeaders() {
    var token = localStorage.getItem('align-token') || '';
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
  }

  var state = { container: null, projectId: null, selectedDate: null, currentLogData: null, editing: false };

  /* ── Helpers ──────────────────────────────────────────────────────── */
  function esc(s)  { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function uid()   { return 'dlog_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function nowISO(){ return new Date().toISOString(); }
  function _toTemp(c) {
    var raw = localStorage.getItem('align.settings.tempUnit');
    var u = (function() { try { return raw ? JSON.parse(raw) : 'F'; } catch(e) { return raw || 'F'; } })();
    return u === 'F' ? Math.round(c * 9 / 5 + 32) : Math.round(c);
  }
  function _tempUnit() { return '°'; }

  function isoToDisplay(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  }
  function canGoForward(iso) { return iso < today(); }

  /* ── Public API ────────────────────────────────────────────────────── */
  function render(container) {
    if (!container) return;
    state.container = container;
    _resolveProjectId();
    if (!state.projectId) {
      container.innerHTML = '<div class="pm-empty"><strong>No active project</strong> Select a project first.</div>';
      return;
    }
    state.selectedDate = today();
    state.currentLogData = null;

    // One-time: migrate any localStorage daily-logs to server
    _migrateLocalToServer();

    // One-time fix: UTC timezone bug — late-night logs saved as tomorrow
    // Only runs if today has no records but tomorrow does (created in last 6 hours)
    try {
      var _recs = S().listRecords(state.projectId, CATEGORY) || [];
      var _td = today();
      var _tom = new Date(); _tom.setDate(_tom.getDate() + 1);
      _tom = _tom.getFullYear() + '-' + String(_tom.getMonth()+1).padStart(2,'0') + '-' + String(_tom.getDate()).padStart(2,'0');
      var _hasToday = _recs.some(function(r) { return r.date === _td; });
      if (!_hasToday) {
        for (var _i = 0; _i < _recs.length; _i++) {
          var _r = _recs[_i];
          if (_r.date === _tom && Date.now() - new Date(_r.updatedAt || _r.createdAt || 0).getTime() < 6 * 3600000) {
            _r.date = _td;
            _r._dateFixed = true;
            S().saveRecord(state.projectId, CATEGORY, _r);
            state.selectedDate = _td;
            break;
          }
        }
      }
    } catch(_e) {}

    _renderDailyLogView();
  }

  function _resolveProjectId() {
    var s = S();
    state.projectId = s && s.getActiveProject ? (s.getActiveProject()||{}).id : null;
  }

  function _migrateLocalToServer() {
    if (!state.projectId) return;
    var flag = 'align-migrated-daily-logs-' + state.projectId;
    if (localStorage.getItem(flag)) return;
    var local = S().listRecords(state.projectId, CATEGORY) || [];
    if (!local.length) { localStorage.setItem(flag, '1'); return; }
    console.log('[DailyLog] Migrating ' + local.length + ' records to server...');
    var done = 0;
    local.forEach(function(rec) {
      fetch(_apiUrl(state.projectId), {
        method: 'POST',
        headers: _authHeaders(),
        body: JSON.stringify(rec)
      }).then(function(r) {
        done++;
        if (!r.ok) console.error('[DailyLog] Migration failed for ' + rec.id, r.status);
        if (done === local.length) {
          localStorage.setItem(flag, '1');
          console.log('[DailyLog] Migration complete — ' + local.length + ' records');
        }
      }).catch(function(err) {
        done++;
        console.error('[DailyLog] Migration error:', err);
        if (done === local.length) localStorage.setItem(flag, '1');
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
   * MAIN VIEW
   * ═══════════════════════════════════════════════════════════════════ */
  function _renderDailyLogView() {
    var pid = state.projectId;
    var sel = state.selectedDate;

    function changeDay(delta) {
      var d = new Date(state.selectedDate + 'T00:00:00');
      d.setDate(d.getDate() + delta);
      var nd = d.toISOString().slice(0,10);
      if (nd > today()) return;
      state.selectedDate = nd;
      state.editing = false;
      loadDay();
    }

    function loadDay() {
      _updateNav();
      fetch(_apiUrl(pid) + '?date=' + encodeURIComponent(state.selectedDate) + '&limit=200', {
        headers: _authHeaders()
      })
        .then(function(r) { if (!r.ok) throw new Error('API error ' + r.status); return r.json(); })
        .then(function(data) {
          var records = (data.records || []).map(function(r) { return r.data || r; });
          var found = null;
          for (var i = 0; i < records.length; i++) {
            if (records[i].date === state.selectedDate) { found = records[i]; break; }
          }
          state.currentLogData = found;
          state.dayRecords = records;
          _finishLoadDay(found);
        })
        .catch(function(err) {
          console.error('[DailyLog] Load failed:', err);
          state.currentLogData = null;
          state.dayRecords = [];
          _finishLoadDay(null);
        });
    }

    function _finishLoadDay(found) {

      var weatherBox = document.getElementById('dlog-weather-box');
      var saveBtn   = document.getElementById('dlog-save-btn');
      var savedMsg  = document.getElementById('dlog-saved-msg');
      var notesEl   = document.getElementById('dlog-notes');
      var isPast    = state.selectedDate < today();
      var editBtn   = document.getElementById('dlog-edit-day-btn');
      var editable  = document.getElementById('dlog-editable');
      var readonly  = document.getElementById('dlog-readonly');

      // Weather always shows
      if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">Loading weather…</span>';
      WEATHER_GEN++;
      _dlogFetchWeather(state.selectedDate, weatherBox, WEATHER_GEN);

      // Toggle edit button
      if (editBtn) {
        if (isPast) {
          editBtn.style.display = '';
          editBtn.textContent = state.editing ? '✎ Update Log' : '✎ Edit Day';
          editBtn.className = 'dlog-edit-day-btn' + (state.editing ? ' editing' : '');
        } else {
          editBtn.style.display = 'none';
        }
      }

      // Toggle copy-text button (today only)
      var copyBtn = document.getElementById('dlog-copy-text');
      if (copyBtn) {
        copyBtn.style.display = isPast ? 'none' : '';
      }

      // Toggle read-only vs editable
      if (isPast && !state.editing) {
        // Read-only mode
        if (editable) editable.style.display = 'none';
        if (readonly) readonly.style.display = '';
        _renderReadonly(found);
      } else {
        // Editable mode
        if (readonly) readonly.style.display = 'none';
        if (editable) editable.style.display = '';
        if (saveBtn) { saveBtn.textContent = found ? 'Update Log' : 'Save Log'; saveBtn.classList.toggle('done', !!found); }
        if (found) {
          var comps = found.companies || [];
          if (!comps.length) comps = [{ name:'', count:'', description:'' }];
          _renderCompanyRows(comps);
          _setField('dlog-visitors',    found.visitors    || '');
          _setField('dlog-inspections', found.inspections || '');
          _setField('dlog-delays',      found.delays      || '');
          if (notesEl) notesEl.value = found.notes || '';
          _renderAttachments(found.attachments || []);
        } else {
          _renderCompanyRows([{ name:'', count:'', description:'' }]);
          if (savedMsg) savedMsg.style.display = 'none';
          _setField('dlog-visitors', '');
          _setField('dlog-inspections', '');
          _setField('dlog-delays', '');
          if (notesEl) notesEl.value = '';
          _renderAttachments([]);
        }
      }
      _renderList(pid, state.selectedDate);
    }

    function _updateNav() {
      var navDate = document.getElementById('dlog-nav-date');
      var navNext = document.getElementById('dlog-nav-next');
      if (navDate) navDate.textContent = isoToDisplay(state.selectedDate);
      if (navNext) {
        if (canGoForward(state.selectedDate)) { navNext.disabled=false; navNext.style.opacity='1'; }
        else { navNext.disabled=true; navNext.style.opacity='0.35'; }
      }
    }

    function _setField(id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val;
    }

    /* ── CALENDAR ──────────────────────────────────────────────────── */

    function _buildCalendar(pid, dateStr) {
      var parts = dateStr.split('-');
      var year = parseInt(parts[0], 10);
      var month = parseInt(parts[1], 10) - 1;
      var todayStr = today();

      // Fetch all log dates for this project
      fetch(_apiUrl(pid) + '?limit=500', { headers: _authHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var records = (data.records || []).map(function(r) { return r.data || r; });
          var logDates = {};
          records.forEach(function(r) { if (r.date) logDates[r.date] = true; });
          _renderCalendarGrid(year, month, dateStr, todayStr, logDates);
        })
        .catch(function() {
          _renderCalendarGrid(year, month, dateStr, todayStr, {});
        });
    }

    function _renderCalendarGrid(year, month, selectedDate, todayStr, logDates) {
      var cal = document.getElementById('dlog-calendar');
      if (!cal) return;
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var days = ['Su','Mo','Tu','We','Th','Fr','Sa'];

      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();

      var html = '<div class="dlog-cal-header">';
      html += '<button class="dlog-cal-nav" data-dir="-1">&lt;</button>';
      html += '<span class="dlog-cal-title">' + months[month] + ' ' + year + '</span>';
      html += '<button class="dlog-cal-nav" data-dir="1">&gt;</button>';
      html += '</div>';
      html += '<div class="dlog-cal-grid">';

      days.forEach(function(d) {
        html += '<div class="dlog-cal-day-header">' + d + '</div>';
      });

      for (var i = 0; i < firstDay; i++) {
        html += '<div class="dlog-cal-cell dlog-cal-empty"></div>';
      }

      for (var d = 1; d <= daysInMonth; d++) {
        var ds = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var cls = 'dlog-cal-cell';
        if (ds === selectedDate) cls += ' dlog-cal-selected';
        if (ds === todayStr) cls += ' dlog-cal-today';
        if (logDates[ds]) cls += ' dlog-cal-has-log';
        else if (ds <= todayStr) cls += ' dlog-cal-no-log';
        if (ds > todayStr) cls += ' dlog-cal-future';
        html += '<div class="dlog-cal-cell ' + cls + '" data-date="' + ds + '">' + d + '</div>';
      }

      html += '</div>';
      cal.innerHTML = html;

      // Wire month nav
      cal.querySelectorAll('.dlog-cal-nav').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var dir = parseInt(this.getAttribute('data-dir'), 10);
          var newMonth = month + dir;
          var newYear = year;
          if (newMonth < 0) { newMonth = 11; newYear--; }
          if (newMonth > 11) { newMonth = 0; newYear++; }
          var newDate = newYear + '-' + String(newMonth + 1).padStart(2, '0') + '-01';
          _renderCalendarGrid(newYear, newMonth, selectedDate, todayStr, logDates);
        });
      });

      // Wire day clicks
      cal.querySelectorAll('.dlog-cal-cell[data-date]').forEach(function(cell) {
        cell.addEventListener('click', function() {
          var ds = this.getAttribute('data-date');
          if (ds > todayStr) return;
          state.selectedDate = ds;
          state.editing = false;
          loadDay();
          cal.style.display = 'none';
        });
      });
    }

    // ── BUILD HTML ──
    var c = state.container;
    c.innerHTML =
      '<div class="dlog-nav">'+
        '<button class="dlog-nav-btn" id="dlog-nav-prev" title="Previous day">'+
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'+
        '</button>'+
        '<div class="dlog-nav-center">'+
          '<span class="dlog-nav-date" id="dlog-nav-date" title="Click to pick a date"></span>'+
          '<div class="dlog-calendar" id="dlog-calendar" style="display:none"></div>'+
        '</div>'+
        '<button class="dlog-nav-btn" id="dlog-nav-next" title="Next day">'+
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'+
        '</button>'+
      '</div>'+
      '<div class="dlog-nav-actions">'+
        '<button class="dlog-export-pdf-btn" id="dlog-export-pdf" title="Save &amp; download latest daily log as PDF">📥 Export PDF</button>'+
        '<button class="dlog-copy-text-btn" id="dlog-copy-text" title="Copy as formatted text" style="display:none">📋 Copy Text</button>'+
        '<button class="dlog-edit-day-btn" id="dlog-edit-day-btn" style="display:none">✎ Edit Day</button>'+
      '</div>'+
      '<div class="dlog-form-always" id="dlog-form-always">'+
        '<div class="dlog-section-label">Weather</div>'+
        '<div class="dlog-weather-box" id="dlog-weather-box"></div>'+
        // Editable form (hidden for read-only past days)
        '<div id="dlog-editable">'+
          '<div class="dlog-section-label">Crew</div>'+
          '<div id="dlog-companies" class="dlog-companies"></div>'+
          '<button class="dlog-add-company" id="dlog-add-company">'+
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Company'+
          '</button>'+
          '<div class="dlog-section-label">Visitors</div>'+
          '<div class="dlog-field"><textarea class="dlog-input dlog-textarea" id="dlog-visitors" rows="2" placeholder="Name, company, purpose, time in/out…"></textarea></div>'+
          '<div class="dlog-section-label">Inspections</div>'+
          '<div class="dlog-field"><textarea class="dlog-input dlog-textarea" id="dlog-inspections" rows="2" placeholder="Inspector, agency, findings…"></textarea></div>'+
          '<div class="dlog-section-label">Delays</div>'+
          '<div class="dlog-field"><textarea class="dlog-input dlog-textarea" id="dlog-delays" rows="2" placeholder="Description, hours, affected trades…"></textarea></div>'+
          '<div class="dlog-section-label">Attachments <button type="button" class="dlog-attach-btn" id="dlog-attach-btn" title="Attach project files">📎 Add Files</button></div>'+
          '<div id="dlog-attach-list" class="dlog-attach-list"></div>'+
          '<div class="dlog-section-label">Notes</div>'+
          '<div class="dlog-field"><textarea class="dlog-input dlog-textarea" id="dlog-notes" rows="3" placeholder="Additional notes, safety observations, equipment…"></textarea></div>'+
          '<div class="dlog-form-actions">'+
            '<button class="dlog-save-btn" id="dlog-save-btn">Save Log</button>'+
            '<span class="dlog-saved-msg" id="dlog-saved-msg" style="display:none">✓ Saved</span>'+
          '</div>'+
        '</div>'+
        // Read-only display (shown for past days, hidden otherwise)
        '<div id="dlog-readonly" class="dlog-readonly" style="display:none"></div>'+
      '</div>'+
      '<div class="dlog-history-header">'+
        '<span class="dlog-history-label">Change Log</span>'+
      '</div>'+
      '<div id="dlog-list" class="dlog-list"><div class="dir-loading">Loading…</div></div>';

    // Wire events
    document.getElementById('dlog-nav-prev').addEventListener('click', function(){ changeDay(-1); });
    document.getElementById('dlog-nav-next').addEventListener('click', function(){ changeDay(1); });
    // Click date to toggle calendar
    document.getElementById('dlog-nav-date').addEventListener('click', function(e){
      e.stopPropagation();
      var cal = document.getElementById('dlog-calendar');
      if (!cal) return;
      if (cal.style.display === 'none') {
        _buildCalendar(pid, state.selectedDate);
        cal.style.display = 'block';
      } else {
        cal.style.display = 'none';
      }
    });
    // Close calendar on outside click
    document.addEventListener('click', function(e) {
      var cal = document.getElementById('dlog-calendar');
      var dateEl = document.getElementById('dlog-nav-date');
      if (cal && cal.style.display !== 'none' && !cal.contains(e.target) && e.target !== dateEl) {
        cal.style.display = 'none';
      }
    });

    document.getElementById('dlog-add-company').addEventListener('click', function(){
      var container = document.getElementById('dlog-companies');
      if (!container) return;
      var row = document.createElement('div');
      row.className = 'dlog-company-row';
      row.innerHTML =
        '<div class="dlog-company-header">'+
          '<div class="dlog-field dlog-company-wrapper">'+
            '<input type="text" class="dlog-input dlog-company-name" autocomplete="off" placeholder="Company name">'+
          '</div>'+
        '</div>'+
        '<div class="dlog-company-body">'+
          '<div class="dlog-workers-row">'+
            '<button class="dlog-worker-btn dlog-worker-minus" title="Remove worker">−</button>'+
            '<div class="dlog-field dlog-workers-field">'+
              '<input type="number" class="dlog-input dlog-company-count" min="0" value="0" placeholder="Workers">'+
            '</div>'+
            '<button class="dlog-worker-btn dlog-worker-plus" title="Add worker">+</button>'+
          '</div>'+
          '<div class="dlog-field dlog-field-full">'+
            '<textarea class="dlog-input dlog-company-desc" rows="2" placeholder="Work performed"></textarea>'+
          '</div>'+
        '</div>'+
        '<button class="dlog-company-remove" title="Remove company">&times;</button>';
      row.querySelector('.dlog-company-remove').addEventListener('click', function(){ row.remove(); });
      container.appendChild(row);
      var nameInput = row.querySelector('.dlog-company-name');
      if (nameInput) _bindCompanyAutocomplete(nameInput);
      // +/- worker buttons
      var countInput = row.querySelector('.dlog-company-count');
      row.querySelector('.dlog-worker-minus').addEventListener('click', function(){
        var v = parseInt(countInput.value) || 0;
        if (v > 0) countInput.value = v - 1;
      });
      row.querySelector('.dlog-worker-plus').addEventListener('click', function(){
        var v = parseInt(countInput.value) || 0;
        countInput.value = v + 1;
      });
      nameInput.focus();
    });

    // Save button
    document.getElementById('dlog-save-btn').addEventListener('click', function(){
      var result = _saveCurrent();
      if (result === null) return; // blocked by validation
      result.then(function(record) {
        if (!record) return; // fetch failed
        var saveBtn = document.getElementById('dlog-save-btn');
        var savedMsg = document.getElementById('dlog-saved-msg');
        if (saveBtn) { saveBtn.textContent = 'Update Log'; saveBtn.classList.add('done'); }
        if (savedMsg) { savedMsg.style.display = 'inline'; setTimeout(function(){ savedMsg.style.display='none'; },2500); }
        _renderList(pid, state.selectedDate);
        if (window._refreshEssentials) window._refreshEssentials();
        var isPast = state.selectedDate < today();
        if (isPast && state.editing) {
          state.editing = false;
          loadDay();
        }
      });
    });

    // PDF export
    document.getElementById('dlog-export-pdf').addEventListener('click', function(){
      var isPast = state.selectedDate < today();
      if (isPast) {
        // Past dates: export directly from loaded data (no save needed)
        var rec = state.currentLogData;
        if (!rec) {
          var dayRecs = state.dayRecords || [];
          for (var i=0; i<dayRecs.length; i++) {
            if (dayRecs[i].date === state.selectedDate) { rec = dayRecs[i]; break; }
          }
        }
        if (rec) { _exportDay(pid, rec); }
        else { alert('No log data for this date.'); }
        return;
      }
      // Today: gather data directly (synchronous, avoids popup blocking)
      var rec = _buildExportRecord();
      if (!rec) return;
      _exportDay(pid, rec);
    });

    // Copy text export (today only)
    document.getElementById('dlog-copy-text').addEventListener('click', function(){
      var btn = this;
      var rec = state.currentLogData;
      if (!rec) {
        var comps = [];
        var rows = document.querySelectorAll('#dlog-companies .dlog-company-row');
        rows.forEach(function(row){
          var nameEl = row.querySelector('.dlog-company-name');
          var textEl = row.querySelector('.dlog-company-text');
          var name = (nameEl && nameEl.style.display !== 'none') ? (nameEl.value || '') : (textEl ? textEl.textContent : '');
          var count = parseInt((row.querySelector('.dlog-company-count')||{}).value, 10) || 0;
          var desc = (row.querySelector('.dlog-company-desc')||{}).value || '';
          name = name.trim();
          if (name || count) comps.push({ name: name, count: count, description: desc.trim() });
        });
        var total = 0;
        comps.forEach(function(c){ total += c.count; });
        _copyTextToClipboard(total, comps).then(function(){ _showCopyFeedback(btn); btn.blur(); });
        return;
      }
      var companies = rec.companies || [];
      var total = 0;
      companies.forEach(function(c){ total += parseInt(c.count,10) || 0; });
      _copyTextToClipboard(total, companies).then(function(){ _showCopyFeedback(btn); btn.blur(); });
    });

    // Edit Day button (past days only)
    var editBtn = document.getElementById('dlog-edit-day-btn');
    if (editBtn) {
      editBtn.addEventListener('click', function(){
        if (state.editing) {
          // Save and exit edit mode
          var result = _saveCurrent();
          if (result === null) return;
          result.then(function(record) {
            if (!record) return;
            state.editing = false;
            loadDay();
            _renderList(pid, state.selectedDate);
            if (window._refreshEssentials) window._refreshEssentials();
          });
        } else {
          // Enter edit mode
          state.editing = true;
          loadDay();
        }
      });
    }

    // File picker
    document.getElementById('dlog-attach-btn').addEventListener('click', _showFilePicker);

    // Delegated clicks on change log
    document.getElementById('dlog-list').addEventListener('click', function(e){
      var card = e.target.closest('.dlog-card');
      if (!card) return;
      if (e.target.tagName==='BUTTON' || e.target.closest('button')) return;
      if (card.classList.contains('dlog-card-current')) return;
      var revId = card.getAttribute('data-id');
      if (!revId) return;
      var records = S().listRecords(pid, CATEGORY)||[];
      var rev = null;
      for (var i=0; i<records.length; i++) { if (records[i].id===revId) { rev=records[i]; break; } }
      if (rev) { _populateFormFromRev(rev); var form=document.getElementById('dlog-form-always'); if (form) form.scrollIntoView({behavior:'smooth'}); }
    });

    // Initial load
    loadDay();
    _renderList(pid, state.selectedDate);
  }

  /* ── READ-ONLY DISPLAY (past days) ─────────────────────────────────── */

  function _renderReadonly(data) {
    var el = document.getElementById('dlog-readonly');
    if (!el) return;
    if (!data) { el.innerHTML = '<div class="dlog-readonly-empty">No log recorded for this date.</div>'; return; }

    var h = '';

    // Crew
    var comps = data.companies || [];
    if (comps.length) {
      h += '<div class="dlog-section-label">Crew</div>';
      h += '<div class="dlog-ro-table">';
      h += '<div class="dlog-ro-row dlog-ro-header"><span>Company</span><span>Workers</span><span>Work Performed</span></div>';
      comps.forEach(function(c){
        if (!c.name && !c.description) return;
        h += '<div class="dlog-ro-row"><span>' + esc(c.name || '—') + '</span><span>' + (c.count || '—') + '</span><span>' + esc(c.description || '—') + '</span></div>';
      });
      h += '</div>';
    }

    // Visitors
    if (data.visitors) {
      h += '<div class="dlog-section-label">Visitors</div>';
      h += '<div class="dlog-ro-text">' + esc(data.visitors).replace(/\n/g, '<br>') + '</div>';
    }

    // Inspections
    if (data.inspections) {
      h += '<div class="dlog-section-label">Inspections</div>';
      h += '<div class="dlog-ro-text">' + esc(data.inspections).replace(/\n/g, '<br>') + '</div>';
    }

    // Delays
    if (data.delays) {
      h += '<div class="dlog-section-label">Delays</div>';
      h += '<div class="dlog-ro-text">' + esc(data.delays).replace(/\n/g, '<br>') + '</div>';
    }

    // Attachments
    var atts = data.attachments || [];
    if (atts.length) {
      h += '<div class="dlog-section-label">Attachments</div>';
      h += '<div class="dlog-ro-attach">';
      atts.forEach(function(a){ h += '<span class="dlog-ro-attach-item">📎 ' + esc(a.name||a) + '</span>'; });
      h += '</div>';
    }

    // Notes
    if (data.notes) {
      h += '<div class="dlog-section-label">Notes</div>';
      h += '<div class="dlog-ro-text">' + esc(data.notes).replace(/\n/g, '<br>') + '</div>';
    }

    if (!h) h = '<div class="dlog-readonly-empty">No details recorded for this date.</div>';
    el.innerHTML = h;
  }

  /* ── COMPANY AUTOCOMPLETE ─────────────────────────────────────────── */

  function _renderCompanyRows(companies) {
    var el = document.getElementById('dlog-companies');
    if (!el) return;
    var html = '';
    for (var i=0; i<companies.length; i++) {
      var c = companies[i];
      html += '<div class="dlog-company-row">'+
        '<div class="dlog-company-header">'+
          '<div class="dlog-field dlog-company-wrapper">'+
            '<input type="text" class="dlog-input dlog-company-name" value="'+esc(c.name||'')+'" autocomplete="off" placeholder="Company name">'+
          '</div>'+
        '</div>'+
        '<div class="dlog-company-body">'+
          '<div class="dlog-workers-row">'+
            '<button class="dlog-worker-btn dlog-worker-minus" title="Remove worker">−</button>'+
            '<div class="dlog-field dlog-workers-field">'+
              '<input type="number" class="dlog-input dlog-company-count" min="0" value="'+(c.count||'0')+'" placeholder="Workers">'+
            '</div>'+
            '<button class="dlog-worker-btn dlog-worker-plus" title="Add worker">+</button>'+
          '</div>'+
          '<div class="dlog-field dlog-field-full">'+
            '<textarea class="dlog-input dlog-company-desc" rows="2" placeholder="Work performed">'+esc(c.description||'')+'</textarea>'+
          '</div>'+
        '</div>'+
        '<button class="dlog-company-remove" title="Remove company">&times;</button>'+
      '</div>';
    }
    el.innerHTML = html;

    // Bind remove buttons
    el.querySelectorAll('.dlog-company-remove').forEach(function(btn){
      btn.addEventListener('click', function(){ btn.closest('.dlog-company-row').remove(); });
    });

    // Bind autocomplete
    el.querySelectorAll('.dlog-company-name').forEach(function(input){
      _bindCompanyAutocomplete(input);
    });
    // Bind +/- worker buttons
    el.querySelectorAll('.dlog-worker-minus').forEach(function(btn){
      btn.addEventListener('click', function(){
        var row = btn.closest('.dlog-company-row');
        var input = row.querySelector('.dlog-company-count');
        var v = parseInt(input.value) || 0;
        if (v > 0) input.value = v - 1;
      });
    });
    el.querySelectorAll('.dlog-worker-plus').forEach(function(btn){
      btn.addEventListener('click', function(){
        var row = btn.closest('.dlog-company-row');
        var input = row.querySelector('.dlog-company-count');
        var v = parseInt(input.value) || 0;
        input.value = v + 1;
      });
    });
    // Lock company inputs that already have a value
    el.querySelectorAll('.dlog-company-name').forEach(function(input){
      if (input.value.trim()) _lockCompanyInput(input);
    });
  }

  function _bindCompanyAutocomplete(inputEl) {
    var wrapper = inputEl.closest('.dlog-company-wrapper');
    if (!wrapper) return;
    var old = wrapper.querySelector('.dlog-company-dropdown');
    if (old) old.remove();

    var timer;
    inputEl.addEventListener('input', function(){
      clearTimeout(timer);
      var self = this;
      timer = setTimeout(function(){ _showDropdown(self); }, 150);
    });
    inputEl.addEventListener('focus', function(){
      var self = this;
      if (self.value.trim().length>0) _showDropdown(self);
    });
    inputEl.addEventListener('blur', function(){
      setTimeout(function(){
        var dd = wrapper.querySelector('.dlog-company-dropdown');
        if (dd && !dd.matches(':hover')) dd.remove();
        // Validate against Directory on blur — case-insensitive, auto-correct casing
        var val = inputEl.value.trim();
        if (val) {
          try {
            var active = S().getActiveProject();
            if (active) {
              fetch('/api/projects/' + active.id + '/companies')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                  var companies = data.companies || [];
                  // Cache for save validation
                  window._dlogDirCompanies = companies.map(function(c) { return (c.name || '').trim(); }).filter(Boolean);
                  // Find case-insensitive match and use directory casing
                  var matched = null;
                  for (var i = 0; i < companies.length; i++) {
                    if ((companies[i].name || '').trim().toLowerCase() === val.toLowerCase()) {
                      matched = companies[i].name.trim();
                      break;
                    }
                  }
                  if (matched) {
                    inputEl.value = matched; // auto-correct casing
                    _lockCompanyInput(inputEl);
                  } else {
                    inputEl.classList.add('dlog-company-unknown');
                  }
                })
                .catch(function() { inputEl.classList.add('dlog-company-unknown'); });
            }
          } catch(e) {}
        }
      }, 200);
    });
    inputEl.addEventListener('keydown', function(e){
      var dd = wrapper.querySelector('.dlog-company-dropdown');
      if (!dd) return;
      var items = dd.querySelectorAll('li');
      if (!items.length) return;
      var idx = -1;
      for (var i=0; i<items.length; i++) { if (items[i].classList.contains('active')) { idx=i; break; } }
      if (e.key==='ArrowDown') {
        e.preventDefault();
        if (idx>=0) items[idx].classList.remove('active');
        idx = (idx+1)%items.length;
        items[idx].classList.add('active');
        items[idx].scrollIntoView({block:'nearest'});
      } else if (e.key==='ArrowUp') {
        e.preventDefault();
        if (idx>=0) items[idx].classList.remove('active');
        idx = idx<=0 ? items.length-1 : idx-1;
        items[idx].classList.add('active');
        items[idx].scrollIntoView({block:'nearest'});
      } else if (e.key==='Enter') {
        e.preventDefault();
        if (idx>=0) items[idx].click(); else items[0].click();
      } else if (e.key==='Escape') {
        dd.remove();
        inputEl.blur();
      }
    });
  }

  function _showDropdown(inputEl) {
    var wrapper = inputEl.closest('.dlog-company-wrapper');
    if (!wrapper) return;
    var old = wrapper.querySelector('.dlog-company-dropdown');
    if (old) old.remove();

    var typed = inputEl.value.trim().toLowerCase();

    // Gather companies from Directory
    var companies = [];
    try {
      // Fetch from companies API (same source as Directory module)
      fetch('/api/projects/' + (S().getActiveProject()||{}).id + '/companies')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          companies = (data.companies || []).map(function(c) { return (c.name || '').trim(); }).filter(Boolean);
          // Cache for save validation
          window._dlogDirCompanies = companies;
          _renderDropdown(wrapper, inputEl, typed, companies);
        })
        .catch(function() { _renderDropdown(wrapper, inputEl, typed, []); });
      return;
    } catch(e) {}

    _renderDropdown(wrapper, inputEl, typed, companies);
  }

  function _renderDropdown(wrapper, inputEl, typed, companies) {
    if (!companies.length) {
      // Even with no companies, show Add to Directory for typed text
      if (typed.length > 0) _toggleAddDirBtn(wrapper, inputEl, typed, false);
      return;
    }

    var filtered = companies;
    if (typed.length>0) {
      filtered = companies.filter(function(c){ return c.toLowerCase().indexOf(typed)>=0; });
    }
    if (!filtered.length) { _toggleAddDirBtn(wrapper, inputEl, typed, false); return; }

    var exactMatch = filtered.some(function(c){ return c.toLowerCase()===typed; });
    _toggleAddDirBtn(wrapper, inputEl, typed, exactMatch);

    var ul = document.createElement('ul');
    ul.className = 'dlog-company-dropdown';

    filtered.forEach(function(c, idx){
      var li = document.createElement('li');
      var matchIdx = c.toLowerCase().indexOf(typed);
      if (typed.length>0 && matchIdx>=0) {
        li.innerHTML = esc(c.slice(0,matchIdx))+'<strong>'+esc(c.slice(matchIdx,matchIdx+typed.length))+'</strong>'+esc(c.slice(matchIdx+typed.length));
      } else {
        li.textContent = c;
      }
      if (idx===0) li.classList.add('active');
      li.addEventListener('mousedown', function(e){
        e.preventDefault();
        inputEl.value = c;
        ul.remove();
        _lockCompanyInput(inputEl);
      });
      ul.appendChild(li);
    });

    wrapper.appendChild(ul);
  }

  function _lockCompanyInput(inputEl) {
    var wrapper = inputEl.closest('.dlog-company-wrapper');
    if (!wrapper) return;
    var name = inputEl.value.trim();
    if (!name) return;

    var existing = wrapper.querySelector('.dlog-company-text');
    if (existing) existing.remove();

    var textEl = document.createElement('span');
    textEl.className = 'dlog-company-text';
    textEl.textContent = name;
    textEl.title = name;

    inputEl.style.display = 'none';

    var addBtn = wrapper.querySelector('.dlog-company-add-dir-btn');
    if (addBtn) addBtn.remove();
    inputEl.classList.remove('dlog-company-unknown');

    // Insert text before the input (which is now hidden)
    wrapper.insertBefore(textEl, inputEl);
  }

  function _toggleAddDirBtn(wrapper, inputEl, typed, exactMatch) {
    var btn = wrapper.querySelector('.dlog-company-add-dir-btn');
    if (exactMatch || typed.length===0) {
      if (btn) btn.remove();
      inputEl.classList.remove('dlog-company-unknown');
      return;
    }
    inputEl.classList.add('dlog-company-unknown');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'dlog-company-add-dir-btn';
      btn.type = 'button';
      btn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        var name = inputEl.value.trim();
        if (!name) return;
        _addCompanyToDirectory(name);
        btn.remove();
        inputEl.classList.remove('dlog-company-unknown');
        _lockCompanyInput(inputEl);
      });
      wrapper.appendChild(btn);
    }
    btn.innerHTML = '<span class="dlog-add-icon">+</span> Add "<strong>'+esc(typed)+'</strong>" to Directory';
  }

  function _addCompanyToDirectory(companyName) {
    try {
      var s = S();
      var active = s.getActiveProject();
      if (!active) return;
      var pid = active.id;
      // Check if company already exists via Directory API
      fetch('/api/projects/' + pid + '/companies')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var companies = data.companies || [];
          var exists = companies.some(function(c) {
            return (c.name || '').trim().toLowerCase() === companyName.trim().toLowerCase();
          });
          if (exists) return;
          // Add via Directory API (no trade, optional field)
          return fetch('/api/projects/' + pid + '/companies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: companyName.trim(), trade: '' })
          });
        })
        .then(function() {
          // Update cache in background (no redirect)
          window._dlogDirCompanies = (window._dlogDirCompanies || []).concat([companyName.trim()]);
        })
        .catch(function(e) { console.error('Failed to add company:', e); });
    } catch(e) {}
  }

  /* ── ATTACHMENTS ───────────────────────────────────────────────────── */

  function _renderAttachments(attachments) {
    var list = document.getElementById('dlog-attach-list');
    if (!list) return;
    if (!attachments || !attachments.length) {
      list.innerHTML = '<div class="dlog-attach-empty">No files attached</div>';
      return;
    }
    list.innerHTML = attachments.map(function(a){
      return '<label class="dlog-attach-item">'+
        '<input type="checkbox" value="'+esc(a.id)+'" data-name="'+esc(a.name||a.id)+'" checked>'+
        '<span class="dlog-attach-name">📎 '+esc(a.name||a.id)+'</span>'+
      '</label>';
    }).join('');
  }

  function _showFilePicker() {
    var input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = '*/*'; input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', function(){
      var files = Array.from(input.files);
      if (!files.length) { input.remove(); return; }
      var list = document.getElementById('dlog-attach-list');
      if (list) list.innerHTML = '<div class="dlog-attach-empty">Uploading '+files.length+' file(s)…</div>';

      var existing = [];
      var boxes = document.querySelectorAll('#dlog-attach-list input[type="checkbox"]:checked');
      boxes.forEach(function(cb){ existing.push({ id:cb.value, name:cb.getAttribute('data-name')||cb.value }); });

      var uploaded = [];
      var done = 0;
      var token = localStorage.getItem('align-token') || '';

      files.forEach(function(file){
        var fd = new FormData();
        fd.append('file', file);
        fd.append('project_id', state.projectId);

        fetch('/api/files/upload', { method:'POST', headers:{'Authorization':'Bearer '+token}, body:fd })
          .then(function(r){ if (!r.ok) throw new Error('Upload failed: '+r.status); return r.json(); })
          .then(function(resp){
            if (resp.file) uploaded.push({ id:resp.file.id, name:resp.file.original_name });
            done++;
            if (done===files.length) { _renderAttachments(existing.concat(uploaded)); input.remove(); }
          })
          .catch(function(err){
            done++;
            if (done===files.length) { _renderAttachments(existing.concat(uploaded)); input.remove(); }
          });
      });
    });

    input.click();
  }

  /* ── SAVE ──────────────────────────────────────────────────────────── */

  function _saveCurrent() {
    // Use cached directory companies (populated by autocomplete/blur)
    var dirCompanies = window._dlogDirCompanies || [];

    // Gather companies
    var rows = document.querySelectorAll('#dlog-companies .dlog-company-row');
    var companies = [];
    var hasUnknown = false;
    rows.forEach(function(row){
      var nameEl = row.querySelector('.dlog-company-name');
      var textEl = row.querySelector('.dlog-company-text');
      var name = (nameEl && nameEl.style.display !== 'none') ? (nameEl.value || '') : (textEl ? textEl.textContent : '');
      var count = parseInt((row.querySelector('.dlog-company-count')||{}).value, 10);
      var desc  = (row.querySelector('.dlog-company-desc')||{}).value || '';
      name = name.trim();
      // Validate against actual Directory data, not CSS class
      if (name && dirCompanies.length > 0) {
        var found = dirCompanies.some(function(c) { return c.toLowerCase() === name.toLowerCase(); });
        if (!found) hasUnknown = true;
      }
      if (name || !isNaN(count)) {
        companies.push({ name: name, count: isNaN(count) ? 0 : count, description: desc.trim() });
      }
    });

    // Block save if any company is unknown (not in Directory)
    if (hasUnknown) {
      alert('One or more companies are not in your Directory. Please add them using the "Add to Directory" button before saving.');
      return null;
    }

    // Require at least one company or notes
    var notes = (document.getElementById('dlog-notes')||{}).value || '';
    if (!companies.length && !notes.trim()) {
      alert('Add at least one company crew entry or write notes before saving.');
      return;
    }

    // Weather
    var weather_am_temp=null, weather_am_code=null, weather_am_condition=null;
    var weather_pm_temp=null, weather_pm_code=null, weather_pm_condition=null;
    if (state.currentLogData) {
      weather_am_temp = state.currentLogData.weather_am_temp;
      weather_am_code = state.currentLogData.weather_am_code;
      weather_am_condition = state.currentLogData.weather_am_condition;
      weather_pm_temp = state.currentLogData.weather_pm_temp;
      weather_pm_code = state.currentLogData.weather_pm_code;
      weather_pm_condition = state.currentLogData.weather_pm_condition;
    } else if (window._dlogPendingWeather) {
      var w = window._dlogPendingWeather;
      weather_am_temp = w.am_temp;
      weather_am_code = w.am_code;
      weather_am_condition = w.am_condition;
      weather_pm_temp = w.pm_temp;
      weather_pm_code = w.pm_code;
      weather_pm_condition = w.pm_condition;
    }

    var visitors    = (document.getElementById('dlog-visitors')||{}).value || '';
    var inspections = (document.getElementById('dlog-inspections')||{}).value || '';
    var delays      = (document.getElementById('dlog-delays')||{}).value || '';
    var notes       = (document.getElementById('dlog-notes')||{}).value || '';

    // Attachments
    var attachments = [];
    var cbs = document.querySelectorAll('#dlog-attach-list input[type="checkbox"]:checked');
    cbs.forEach(function(cb){ attachments.push({ id:cb.value, name:cb.getAttribute('data-name')||'' }); });

    var id = uid();
    var ts = nowISO();
    var currentUser = (window.AlignAuth && window.AlignAuth.getActiveUser) ? window.AlignAuth.getActiveUser() : null;
    var userName = currentUser ? (currentUser.name || currentUser.email) : 'Unknown';

    var record = {
      id: id, date: state.selectedDate, companies: companies,
      weather_am_temp: weather_am_temp, weather_am_code: weather_am_code, weather_am_condition: weather_am_condition,
      weather_pm_temp: weather_pm_temp, weather_pm_code: weather_pm_code, weather_pm_condition: weather_pm_condition,
      delays: delays, visitors: visitors, inspections: inspections, notes: notes,
      attachments: attachments, updated_by: userName, updated_at: ts
    };

    // POST to server (disk-persistent via better-sqlite3)
    return fetch(_apiUrl(state.projectId), {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ data: record })
    }).then(function(r) {
      if (!r.ok) throw new Error('Save failed: ' + r.status);
      return r.json();
    }).then(function(saved) {
      var rec = (saved && saved.record) ? saved.record.data : saved;
      state.currentLogData = rec;
      // Update the dayRecords list so changelog refreshes immediately
      var dayRecs = state.dayRecords || [];
      var idx = -1;
      for (var i = 0; i < dayRecs.length; i++) {
        if (dayRecs[i].id === rec.id || dayRecs[i].date === rec.date) { idx = i; break; }
      }
      if (idx >= 0) dayRecs[idx] = rec;
      else dayRecs.unshift(rec);
      state.dayRecords = dayRecs;
      return rec;
    }).catch(function(err) {
      console.error('[DailyLog] Save failed:', err);
      alert('Save failed — please try again.');
      return null;
    });
  }

  /* ── POPULATE FORM FROM OLD REVISION ────────────────────────────────── */

  function _populateFormFromRev(d) {
    var comps = d.companies || [];
    if (!comps.length) comps = [{ name:'', count:'', description:'' }];
    _renderCompanyRows(comps);

    _setField('dlog-visitors',    d.visitors    || '');
    _setField('dlog-inspections', d.inspections || '');
    _setField('dlog-delays',      d.delays      || '');
    _setField('dlog-notes',       d.notes       || '');
    _renderAttachments(d.attachments || []);

    var saveBtn = document.getElementById('dlog-save-btn');
    if (saveBtn) { saveBtn.textContent = 'Save as New Revision'; saveBtn.classList.add('viewing-old'); }
  }

  /* ── CHANGE LOG RENDER ─────────────────────────────────────────────── */

  function _renderList(pid, selectedDate) {
    var list = document.getElementById('dlog-list');
    if (!list) return;

    var dateRecords = (state.dayRecords || []).slice();
    dateRecords.sort(function(a,b){ return (b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||''); });

    if (!dateRecords.length) {
      list.innerHTML = '<div class="dlog-empty">No revisions yet for this date. Save the log above to record today\'s site activity.</div>';
      return;
    }

    var latest = dateRecords[0];
    var older = dateRecords.slice(1);

    function _fmtWhen(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+
             d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    }

    function _renderCard(r, isLatest) {
      var comps = r.companies || [];
      var totalWorkers = 0;
      comps.forEach(function(c){ totalWorkers += (c.count||0); });

      var weatherStr = '';
      if (r.weather_am_condition) {
        weatherStr = '<span class="dlog-badge">🌤 AM '+r.weather_am_condition+' · '+(r.weather_am_temp!=null?_toTemp(r.weather_am_temp)+_tempUnit():'—')+'</span>'+
          '<span class="dlog-badge">🌤 PM '+r.weather_pm_condition+' · '+(r.weather_pm_temp!=null?_toTemp(r.weather_pm_temp)+_tempUnit():'—')+'</span>';
      } else if (r.weather_condition) {
        weatherStr = '<span class="dlog-badge">🌤 '+r.weather_condition+' · '+_toTemp(r.weather_temp_hi)+_tempUnit()+'/'+_toTemp(r.weather_temp_lo)+_tempUnit()+'</span>';
      }

      var companyLines = '';
      if (comps.length>0) {
        companyLines = comps.map(function(c){
          var html = '<div class="dlog-comp-line"><span class="dlog-badge">🏢 '+(c.name||'Company')+': '+(c.count||0)+'</span>';
          if (c.description) html += ' <span class="dlog-comp-desc">'+esc(c.description)+'</span>';
          html += '</div>';
          return html;
        }).join('');
      }

      var byLine = '';
      if (r.updated_by || r.updated_at) {
        byLine = '<div class="dlog-card-byline">'+
          (isLatest ? '<span class="dlog-badge dlog-badge-current">✓ Current</span> ' : '<span class="dlog-badge dlog-badge-revision">Revision '+(r._revNum||'')+'</span> ')+
          (r.updated_by ? 'by '+esc(r.updated_by) : '')+
          (r.updated_at ? ' on '+_fmtWhen(r.updated_at) : '')+
        '</div>';
      }

      return '<div class="dlog-card'+(isLatest?' dlog-card-current':' dlog-card-old')+'" data-id="'+esc(r.id)+'">'+
        '<div class="dlog-card-left">'+byLine+
          '<div class="dlog-card-meta">'+
            '<span class="dlog-badge">👷 '+totalWorkers+' total</span>'+weatherStr+
          '</div>'+
          (companyLines ? '<div class="dlog-card-companies">'+companyLines+'</div>' : '')+
        '</div>'+
        '<div class="dlog-card-actions">'+
          (isLatest ? '<button class="dlog-export-btn" data-id="'+esc(r.id)+'" title="Export / Print this version">📄</button>' : '')+
          '<button class="dlog-delete-btn" data-id="'+esc(r.id)+'" title="Delete this revision">🗑</button>'+
        '</div>'+
      '</div>';
    }

    var totalRevisions = dateRecords.length;
    var html = _renderCard(latest, true);
    older.forEach(function(r, idx){
      r._revNum = totalRevisions - 1 - idx;
      html += _renderCard(r, false);
    });
    list.innerHTML = html;

    // Bind buttons
    list.querySelectorAll('.dlog-export-btn').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = this.getAttribute('data-id');
        var rec = null;
        for (var i=0; i<dateRecords.length; i++) { if (dateRecords[i].id===id) { rec=dateRecords[i]; break; } }
        if (rec) _exportDay(pid, rec);
      });
    });

    list.querySelectorAll('.dlog-delete-btn').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var id = this.getAttribute('data-id');
        // Admin-only check
        var user = (window.AlignAuth && window.AlignAuth.getActiveUser) ? window.AlignAuth.getActiveUser() : null;
        if (!user || user.role !== 'admin') {
          alert('Only an admin can delete log revisions.');
          return;
        }
        if (confirm('Delete this revision?')) {
          // DELETE via server API
          fetch(_apiUrl(pid) + '/' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: _authHeaders()
          }).then(function(r) {
            if (!r.ok) { alert('Delete failed (' + r.status + ')'); return; }
            // Remove from in-memory state and re-render
            state.dayRecords = (state.dayRecords || []).filter(function(r) { return r.id !== id; });
            _renderList(pid, selectedDate);
            if (window._refreshEssentials) window._refreshEssentials();
          });
        }
      });
    });
  }

  /* ── WEATHER ───────────────────────────────────────────────────────── */

  function _dlogRenderWeatherBox(dateStr, weatherBox, gen, data) {
    if (gen !== WEATHER_GEN) return;
    var hourlyData = data.hourly || [];
    if (!hourlyData.length) {
      if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">No weather data for this date</span>';
      return;
    }
    var fHours = hourlyData.filter(function(h) { return (h.time || '').slice(0,10) === dateStr; });
    if (!fHours.length) {
      if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">No weather data for this date</span>';
      return;
    }
    var todayStr = today();
    var hours = fHours.map(function(h) {
      var t = new Date(h.time);
      var hr = t.getHours();
      var label = (hr===0?'12AM':hr<12?hr+'AM':hr===12?'12PM':(hr-12)+'PM');
      var hcode = h.code != null ? h.code : 2;
      return { label: label, temp: Math.round(h.temp), condition: h.shortForecast || '', code: hcode, emoji: _weatherEmoji(hcode) };
    });
    if (!hours.length) {
      if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">No hourly data available</span>';
      return;
    }
    var mid = Math.min(6, hours.length);
    var amSlice = hours.slice(0,mid);
    var pmSlice = hours.slice(mid);
    function avg(arr) { if (!arr.length) return null; var s=0; for(var x=0;x<arr.length;x++) s+=arr[x].temp; return Math.round(s/arr.length); }
    window._dlogPendingWeather = {
      am_temp: avg(amSlice), am_condition: amSlice.length ? amSlice[0].condition : null,
      pm_temp: avg(pmSlice), pm_condition: pmSlice.length ? pmSlice[0].condition : null
    };
    var nowHtml = '';
    if (dateStr === todayStr && hours.length) {
      nowHtml = '<div class="dlog-weather-hour dlog-weather-now"><span class="dlog-weather-hour-icon">'+hours[0].emoji+'</span><span class="dlog-weather-hour-temp">'+_toTemp(hours[0].temp)+_tempUnit()+'</span><span class="dlog-weather-hour-label">Now</span><span class="dlog-weather-hour-cond">'+hours[0].condition+'</span></div>';
    }
    var itemsHtml = hours.map(function(hr){
      return '<div class="dlog-weather-hour"><span class="dlog-weather-hour-icon">'+hr.emoji+'</span><span class="dlog-weather-hour-temp">'+_toTemp(hr.temp)+_tempUnit()+'</span><span class="dlog-weather-hour-label">'+hr.label+'</span><span class="dlog-weather-hour-cond">'+hr.condition+'</span></div>';
    }).join('');
    if (weatherBox) weatherBox.innerHTML = '<div class="dlog-weather-scroll">'+nowHtml+itemsHtml+'</div>';
  }

  function _dlogFetchWeather(dateStr, weatherBox, gen) {
    // Fast path: use dashboard's cached data for today (instant)
    if (dateStr === today() && window.__weatherData && window.__weatherData.hourly) {
      _dlogRenderWeatherBox(dateStr, weatherBox, gen, window.__weatherData);
      return;
    }

    var lat = window.__dashLat;
    var lon = window.__dashLon;
    // Fall back to saved location from dashboard
    if (lat==null || lon==null) {
      try { lat = parseFloat(localStorage.getItem('align_location_lat')); } catch(e) {}
      try { lon = parseFloat(localStorage.getItem('align_location_lon')); } catch(e) {}
    }
    if (lat==null || lon==null) {
      if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">Enable location on the dashboard to auto-capture weather</span>';
      return;
    }

    var todayStr = today();
    var targetDate = new Date(dateStr+'T00:00:00');
    var todayDate = new Date(todayStr+'T00:00:00');
    var daysAgo = Math.floor((todayDate-targetDate)/86400000);
    if (daysAgo>7) {
      if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">Weather data only available for the past week</span>';
      return;
    }

    // Use server proxy to avoid SSL/CSP issues with external APIs
    var url = '/api/weather?lat=' + lat + '&lon=' + lon + '&_=' + Date.now();

    fetch(url)
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (gen !== WEATHER_GEN) return;
        _dlogRenderWeatherBox(dateStr, weatherBox, gen, data);
      })
      .catch(function(){
        if (gen !== WEATHER_GEN) return;
        if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">Could not load weather</span>';
      });
  }

  function _nwsFetchLogWeather(lat, lon, dateStr, weatherBox, gen) {
    var todayStr = today();
    fetch('https://api.weather.gov/points/' + lat.toFixed(4) + ',' + lon.toFixed(4))
      .then(function(r) { return r.json(); })
      .then(function(point) {
        var props = point.properties;
        if (!props) throw new Error('No NWS grid point');
        return fetch(props.forecastHourly).then(function(r) { return r.json(); });
      })
      .then(function(data) {
        if (gen !== WEATHER_GEN) return;
        var periods = data.properties.periods || [];
        var filtered = [];
        for (var i = 0; i < periods.length; i++) {
          if ((periods[i].startTime||'').slice(0,10) === dateStr) {
            filtered.push(periods[i]);
          }
        }
        if (!filtered.length) {
          if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">No weather data for this date</span>';
          return;
        }

        var startHour = (dateStr === todayStr) ? new Date().getHours() : 6;
        var hours = [];
        for (var j = 0; j < filtered.length; j++) {
          var hp = filtered[j];
          var h = parseInt((hp.startTime||'').split('T')[1].split(':')[0], 10);
          if (h < startHour && dateStr === todayStr && hours.length === 0) continue;
          var label = (h===0?'12AM':h<12?h+'AM':h===12?'12PM':(h-12)+'PM');
          var icon = (hp.icon||'').toLowerCase();
          var code = 2;
          if (icon.indexOf('/sct')>=0||icon.indexOf('/few')>=0) code=1;
          else if (icon.indexOf('/bkn')>=0) code=2;
          else if (icon.indexOf('/ovc')>=0) code=3;
          else if (icon.indexOf('/fg')>=0) code=45;
          else if (icon.indexOf('/rain')>=0||icon.indexOf('/shower')>=0) code=61;
          else if (icon.indexOf('/ts')>=0) code=95;
          else if (icon.indexOf('/snow')>=0) code=71;
          else if (icon.indexOf('/skc')>=0||icon.indexOf('/clear')>=0) code=0;
          hours.push({ label:label, temp:Math.round(hp.temperature), code:code, emoji:_weatherEmoji(code), condition:_conditionText(code) });
          if (hours.length >= 12) break;
        }

        if (!hours.length) {
          if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">No hourly data available</span>';
          return;
        }

        var mid = Math.min(6, hours.length);
        var amSlice = hours.slice(0,mid);
        var pmSlice = hours.slice(mid);
        function avg(arr) { if (!arr.length) return null; var s=0; for(var x=0;x<arr.length;x++) s+=arr[x].temp; return Math.round(s/arr.length); }
        window._dlogPendingWeather = {
          am_temp: avg(amSlice), am_code: amSlice.length?amSlice[Math.floor(amSlice.length/2)].code:null,
          am_condition: amSlice.length?_conditionText(amSlice[Math.floor(amSlice.length/2)].code):null,
          pm_temp: avg(pmSlice), pm_code: pmSlice.length?pmSlice[Math.floor(pmSlice.length/2)].code:null,
          pm_condition: pmSlice.length?_conditionText(pmSlice[Math.floor(pmSlice.length/2)].code):null
        };

        var nowHtml = '';
        if (dateStr === todayStr && hours.length > 0) {
          var first = hours[0];
          nowHtml = '<div class="dlog-weather-hour dlog-weather-now">'+
            '<span class="dlog-weather-hour-icon">'+first.emoji+'</span>'+
            '<span class="dlog-weather-hour-temp">'+_toTemp(first.temp)+_tempUnit()+'</span>'+
            '<span class="dlog-weather-hour-label">Now</span>'+
            '<span class="dlog-weather-hour-cond">'+first.condition+'</span>'+
          '</div>';
        }

        var itemsHtml = hours.map(function(hr){
          return '<div class="dlog-weather-hour">'+
            '<span class="dlog-weather-hour-icon">'+hr.emoji+'</span>'+
            '<span class="dlog-weather-hour-temp">'+_toTemp(hr.temp)+_tempUnit()+'</span>'+
            '<span class="dlog-weather-hour-label">'+hr.label+'</span>'+
            '<span class="dlog-weather-hour-cond">'+hr.condition+'</span>'+
          '</div>';
        }).join('');

        if (weatherBox) weatherBox.innerHTML = '<div class="dlog-weather-scroll">'+nowHtml+itemsHtml+'</div>';
      })
      .catch(function() {
        if (weatherBox) weatherBox.innerHTML = '<span class="dlog-weather-na">Could not load weather</span>';
      });
  }

  function _conditionText(code) {
    var m = { 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',
      51:'Light drizzle',53:'Moderate drizzle',55:'Dense drizzle',61:'Light rain',63:'Moderate rain',65:'Heavy rain',
      71:'Light snow',73:'Moderate snow',75:'Heavy snow',80:'Rain showers',81:'Moderate rain showers',82:'Violent rain showers',
      95:'Thunderstorm',96:'Thunderstorm + hail',99:'Thunderstorm + heavy hail' };
    return m[code] || 'Code '+code;
  }

  function _weatherEmoji(code) {
    if (code<=1) return '☀️';
    if (code===2) return '⛅';
    if (code===3) return '☁️';
    if (code>=45&&code<=48) return '🌫️';
    if (code===51||code===61||code===80) return '🌦️';
    if ((code>=53&&code<=55)||(code>=63&&code<=65)||(code>=81&&code<=82)) return '🌧️';
    if (code>=71&&code<=75) return '🌨️';
    if (code>=95&&code<=96) return '⛈️';
    if (code>=99) return '🌩️';
    return '🌤️';
  }

  /* ── TEXT EXPORT ───────────────────────────────────────────────────── */

  function _copyTextToClipboard(total, companies) {
    var lines = [];
    lines.push('*Total Manpower: ' + total + '*');
    companies.forEach(function(c) {
      var name = (c.name || '').trim();
      var count = parseInt(c.count, 10) || 0;
      var desc = (c.description || '').trim();
      if (!name && !count) return;
      lines.push('*' + name + '* (*' + count + '*): ' + desc);
    });
    var text = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function() {
        _fallbackCopy(text);
      });
    } else {
      _fallbackCopy(text);
      return Promise.resolve();
    }
  }

  function _showCopyFeedback(btn) {
    var span = document.createElement('span');
    span.className = 'dlog-copy-feedback';
    span.textContent = 'Copied to clipboard';
    btn.parentNode.appendChild(span);
    // Trigger fade-out after a moment
    setTimeout(function() {
      span.classList.add('fade-out');
      setTimeout(function() {
        if (span.parentNode) span.parentNode.removeChild(span);
      }, 600);
    }, 1200);
  }

  function _fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); }
    catch(e) {}
    document.body.removeChild(ta);
  }

  /* ── PDF EXPORT ────────────────────────────────────────────────────── */

  function _buildExportRecord() {
    // Use saved data if available, otherwise gather from form
    var rec = state.currentLogData;
    if (rec && rec.companies && rec.companies.length) {
      return rec;
    }

    // Gather from form fields
    var companies = [];
    var rows = document.querySelectorAll('#dlog-companies .dlog-company-row');
    rows.forEach(function(row) {
      var nameEl = row.querySelector('.dlog-company-name');
      var textEl = row.querySelector('.dlog-company-text');
      var name = (nameEl && nameEl.style.display !== 'none') ? (nameEl.value || '') : (textEl ? textEl.textContent : '');
      var count = parseInt((row.querySelector('.dlog-company-count') || {}).value, 10) || 0;
      var desc = (row.querySelector('.dlog-company-desc') || {}).value || '';
      name = name.trim();
      if (name || count) companies.push({ name: name, count: count, description: desc.trim() });
    });

    var notes = (document.getElementById('dlog-notes') || {}).value || '';

    if (!companies.length && !notes.trim()) {
      alert('Add at least one company crew entry or write notes before exporting.');
      return null;
    }

    // Weather from pending data or currentLogData
    var w = state.currentLogData || window._dlogPendingWeather || {};
    return {
      date: state.selectedDate,
      companies: companies,
      weather_am_condition: w.weather_am_condition || null,
      weather_am_temp: w.weather_am_temp || null,
      weather_pm_condition: w.weather_pm_condition || null,
      weather_pm_temp: w.weather_pm_temp || null,
      weather_condition: w.weather_condition || null,
      weather_temp_hi: w.weather_temp_hi || null,
      weather_temp_lo: w.weather_temp_lo || null,
      visitors: (document.getElementById('dlog-visitors') || {}).value || '',
      inspections: (document.getElementById('dlog-inspections') || {}).value || '',
      delays: (document.getElementById('dlog-delays') || {}).value || '',
      notes: notes,
      description: notes,
      attachments: w.attachments || [],
      updated_by: w.updated_by || '',
      updated_at: w.updated_at || ''
    };
  }

  /* ── PDF EXPORT (window) ──────────────────────────────────────────── */

  function _exportDay(pid, rec) {
    try {
      var active = S().getActiveProject();
    } catch(e) { var active = null; }
    var projectName = esc(active ? active.name : 'Project');
    var projectAddr = esc(active ? (active.address||'') : '');

    var d = new Date(rec.date+'T00:00:00');
    var dateDisplay = d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

    var comps = rec.companies || [];
    var totalWorkers = 0;
    comps.forEach(function(c){ totalWorkers += (c.count||0); });

    var companyRows = '';
    if (comps.length>0) {
      comps.forEach(function(c){
        companyRows += '<tr><td>'+esc(c.name||'—')+'</td><td>'+(c.count||0)+'</td><td>'+esc(c.description||'—')+'</td></tr>';
      });
    }

    var weatherLine = 'Not recorded';
    if (rec.weather_am_condition) {
      weatherLine = esc(rec.weather_am_condition)+' '+(rec.weather_am_temp!=null?rec.weather_am_temp+'°':'—')+
                    ' / PM: '+esc(rec.weather_pm_condition)+' '+(rec.weather_pm_temp!=null?rec.weather_pm_temp+'°':'—');
    } else if (rec.weather_condition) {
      weatherLine = esc(rec.weather_condition)+' · '+(rec.weather_temp_hi||'—')+'°F high / '+(rec.weather_temp_lo||'—')+'°F low';
    }

    var notesText = esc(rec.notes || rec.description || '');
    var visitorsText = esc(rec.visitors || '');
    var inspectionsText = esc(rec.inspections || '');
    var delaysText = esc(rec.delays || '');

    var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'+
      '<title>Daily Log — '+rec.date+'</title>\n'+
      '<style>\n'+
      '  *{margin:0;padding:0;box-sizing:border-box;}\n'+
      '  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:800px;margin:0 auto;padding:40px 30px;}\n'+
      '  .report-header{border-bottom:3px solid #1a1a1a;padding-bottom:18px;margin-bottom:28px;}\n'+
      '  .report-header h1{font-size:1.6rem;font-weight:800;letter-spacing:-0.3px;}\n'+
      '  .report-header .project{font-size:1rem;color:#555;margin-top:2px;}\n'+
      '  .report-header .project span{font-weight:600;color:#1a1a1a;}\n'+
      '  .report-header .date{font-size:1.05rem;color:#777;margin-top:6px;}\n'+
      '  .section{margin-bottom:24px;}\n'+
      '  .section h2{font-size:0.85rem;text-transform:uppercase;letter-spacing:0.8px;color:#888;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:12px;}\n'+
      '  table{width:100%;border-collapse:collapse;}\n'+
      '  th{text-align:left;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.5px;color:#999;padding:6px 10px;border-bottom:2px solid #ddd;}\n'+
      '  td{padding:8px 10px;border-bottom:1px solid #eee;font-size:0.92rem;}\n'+
      '  .summary-row{display:flex;gap:30px;flex-wrap:wrap;}\n'+
      '  .summary-item{min-width:120px;}\n'+
      '  .summary-item .label{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.5px;color:#999;}\n'+
      '  .summary-item .value{font-size:1.1rem;font-weight:700;}\n'+
      '  .notes-box{background:#f7f7f7;border-radius:6px;padding:14px 18px;font-size:0.92rem;color:#444;min-height:40px;}\n'+
      '  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #ddd;font-size:0.75rem;color:#aaa;text-align:center;}\n'+
      '  @media print{body{padding:20px 0;}@page{margin:0.6in;size:letter;}}\n'+
      '</style>\n</head>\n<body>\n'+
      '<div class="report-header">\n'+
      '  <h1>Daily Construction Report</h1>\n'+
      '  <div class="project">Project: <span>'+projectName+'</span>'+(projectAddr?' — '+projectAddr:'')+'</div>\n'+
      '  <div class="date">'+dateDisplay+'</div>\n'+
      '</div>\n'+
      '<div class="section">\n  <h2>Summary</h2>\n  <div class="summary-row">\n'+
      '    <div class="summary-item"><div class="label">Total Workers</div><div class="value">'+totalWorkers+'</div></div>\n'+
      '    <div class="summary-item"><div class="label">Companies</div><div class="value">'+(comps.length||0)+'</div></div>\n'+
      '    <div class="summary-item"><div class="label">Weather</div><div class="value" style="font-size:0.92rem;font-weight:500;">'+weatherLine+'</div></div>\n'+
      '  </div>\n</div>\n'+
      (companyRows ? '<div class="section">\n  <h2>Crew Breakdown</h2>\n  <table><thead><tr><th>Company</th><th>Workers</th><th>Work Performed</th></tr></thead><tbody>'+companyRows+'</tbody></table>\n</div>\n' : '')+
      (visitorsText ? '<div class="section">\n  <h2>Visitors</h2>\n  <div class="notes-box">'+visitorsText+'</div>\n</div>\n' : '')+
      (inspectionsText ? '<div class="section">\n  <h2>Inspections</h2>\n  <div class="notes-box">'+inspectionsText+'</div>\n</div>\n' : '')+
      (delaysText ? '<div class="section">\n  <h2>Delays</h2>\n  <div class="notes-box">'+delaysText+'</div>\n</div>\n' : '')+
      (notesText ? '<div class="section">\n  <h2>Notes</h2>\n  <div class="notes-box">'+notesText+'</div>\n</div>\n' : '')+
      '<div class="footer">Generated by Align — '+new Date().toLocaleDateString()+'</div>\n'+
      '</body>\n</html>';

    // Open via Blob URL — bypasses popup blockers more reliably than about:blank
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var w = window.open(url, '_blank', 'width=900,height=700');
    if (!w) {
      alert('Pop-up blocked. Please allow pop-ups for this site to export PDFs.');
      console.error('[DailyLog] PDF export failed: popup blocked');
      return;
    }
    // Check if already loaded (Blob URLs load synchronously in cache)
    if (w.document.readyState === 'complete') {
      URL.revokeObjectURL(url);
      w.print();
    } else {
      w.addEventListener('load', function() {
        URL.revokeObjectURL(url);
        w.print();
      });
    }
  }

  /* ── Expose ────────────────────────────────────────────────────────── */
  global.AlignDailyLogs = { render: render, CATEGORY: CATEGORY };
})(window);
