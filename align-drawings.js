/* align-drawings.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Align — Drawings section with drag-and-drop + file upload.
 * Depends on: align-storage.js (window.AlignStorage)
 *             align-files.js   (window.AlignFiles, for per-project storage)
 *
 * Public API  (window.AlignDrawings)
 * ─────────────────────────────────
 *   .render(container)  → mount the drawings UI inside the section modal
 */

(function (global) {
  'use strict';

  /* ── Live references (re-resolved on every call via window directly) ── */
  function Storage() { return window.AlignStorage; }
  function Files()   { return window.AlignFiles; }

  /* ── Constants ──────────────────────────────────────────────────────────── */
  var DRAWINGS_FOLDER_NAME = 'Drawings';
  var MAX_FILE_SIZE = Infinity; // no size limit — IndexedDB handles any size
  var ALLOWED_TYPES = [
    'application/pdf'
  ];
  // Canvas size limits (iOS Safari ~16MP, iPad ~32MP — use 12MP for safety margin)
  var MAX_CANVAS_PIXELS = 12000000;
  var MAX_CANVAS_DIM    = 4096;  // iOS single-dimension cap
  // Zoom limits
  var MV_ZOOM_MIN = 0.25;
  var MV_ZOOM_MAX = 5;
  var _mvWheelTimer = 0;  // debounce wheel re-renders

  // Phase 1: tile overlay constants (crisp high-zoom)
  var MV_TILE_CSS = 512;           // tile size in bucket-zoom CSS px
  var MV_TILE_BLEED = 1;           // CSS px overlap on right/bottom to hide seams
  var MV_TILE_CACHE_MAX = 24;      // hard cap on live tiles
  var MV_TILE_POOL_MAX = 8;        // detached canvases kept warm for reuse
  var MV_TILE_MARGIN = 1;          // extra ring of tiles around viewport
  var MV_TILE_CONCURRENCY = 2;     // simultaneous PDF.js tile renders
  var MV_TILE_EPS = 0.999;         // clamp-binding detection epsilon

  // Sheet number → category mapping for auto-classification
  var SHEET_CATEGORIES = {
    A:  'Architectural',
    S:  'Structural',
    E:  'Electrical',
    M:  'Mechanical',
    P:  'Plumbing',
    C:  'Civil',
    FP: 'Fire Protection',
    L:  'Landscape',
    T:  'Telecommunications'
  };

  // Fixed display order for category filter chips (A,S,E,M,P,C,FP,L,T).
  var SHEET_CAT_ORDER = ['A', 'S', 'E', 'M', 'P', 'C', 'FP', 'L', 'T'];

  // Derive the discipline code + label from a drawing name via its sheet-number prefix.
  function drawingCategory(name) {
    var m = /^(FP|A|S|E|M|P|C|L|T)-?(\d+)/i.exec(name || '');
    if (!m) return null;
    var code = m[1].toUpperCase();
    return { code: code, label: SHEET_CATEGORIES[code] || code };
  }

  // Metadata record shape per scanned page:
  // { pageIndex, sheetNumber, basePrefix, baseNumber, revision, title, category, status, reviewReason, labeledManually }
  function _blankPageMeta(pageIndex) {
    return {
      pageIndex: pageIndex,
      sheetNumber: null,
      basePrefix: null,
      baseNumber: null,
      revision: 0,
      title: null,
      category: null,
      status: 'needs_review',
      reviewReason: null,
      labeledManually: false
    };
  }

  /* ── Internal state ─────────────────────────────────────────────────────── */
  var state = {
    container: null,
    projectId: null,
    drawingsFolderId: null,
    showAddModal: false,
    dragOver: false,
    pendingFiles: [],       // array of { name, type, size, dataUrl }
    uploadName: '',
    uploadError: null,
    uploading: false,
    pdfSplitInfo: null,     // { pageCount, pages } when splitting a PDF
    selectMode: false,      // true when checkboxes are visible for bulk actions
    selectedIds: {},        // set-like object: { drawingId: true }
    drawingType: '',        // selected drawing type (plan, section, elevation, detail, 3d)
    activeCategory: 'all',  // category filter: 'all' | 'other' | a discipline code (A,S,E,...)
    maxVisible: 20,         // how many cards to render before "Load More"
    drawingsCache: null     // last-fetched drawings list (avoids re-fetch on filter)
  };

  /** Always-fresh project-id lookup — never stale. Tries multiple paths. */
  function _resolveProjectId() {
    var s = Storage();
    if (!s) { state.projectId = null; return null; }

    // Path 1: getActiveProject (reads align.active-project → looks up in align.projects.v1)
    var active = s.getActiveProject();
    if (active && active.id) {
      state.projectId = active.id;
      return state.projectId;
    }

    // Path 2: the active-project key might point to a stale project — check if ANY project exists
    var all = s.listProjects();
    if (all.length === 1) {
      // Exactly one project exists — auto-activate it
      s.setActiveProject(all[0].id);
      state.projectId = all[0].id;
      return state.projectId;
    }

    // Path 3: read the raw localStorage key directly (might be set but project deleted)
    try {
      var rawId = window.localStorage.getItem('align.active-project');
      if (rawId) {
        // The key exists but getProject didn't find it — the project was likely deleted
        // Clear the stale reference so we don't keep trying
        window.localStorage.removeItem('align.active-project');
      }
    } catch(e) { /* silent */ }

    state.projectId = null;
    return null;
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtSize(b) { if (b==null) return ''; if (b<1024) return b+' B'; if (b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(2)+' MB'; }
  function fmtDate(iso) { try { var d=new Date(iso); return isNaN(d.getTime())?'':d.toLocaleDateString(void 0,{month:'short',day:'numeric',year:'numeric'}); } catch(e){return '';} }

  // Clamp render scale to stay within device canvas limits (iOS Safari ~16MP)
  function _clampRenderScale(scale, pageW, pageH, dpr) {
    // Min-of-caps form: once clamped, the result is a constant independent of
    // the input scale, so the render size (and thus renderKey) pins exactly —
    // the base layer becomes a free no-op at high zoom.
    return Math.min(
      scale,
      Math.sqrt(MAX_CANVAS_PIXELS / (pageW * pageH)) / dpr,
      MAX_CANVAS_DIM / (Math.max(pageW, pageH) * dpr)
    );
  }

  function _mvDpr() {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  function mimeIcon(mime) {
    if (!mime) return '📄';
    if (mime.indexOf('pdf') !== -1) return '📕';
    if (mime.indexOf('image/') === 0) return '🖼️';
    return '📄';
  }

  function ensureDrawingsFolder() {
    if (!state.projectId || !Files()) return null;
    var tree = Files().getTree(state.projectId);
    if (!tree || !tree.children) return null;

    // Check if Drawings folder already exists
    var existing = tree.children[DRAWINGS_FOLDER_NAME];
    if (existing && existing.type === 'folder') {
      state.drawingsFolderId = existing.id;
      return existing.id;
    }

    // Create it
    try {
      var folder = Files().createFolder(state.projectId, 'root', DRAWINGS_FOLDER_NAME);
      state.drawingsFolderId = folder.id;
      return folder.id;
    } catch (e) {
      console.warn('[AlignDrawings] Could not create drawings folder:', e);
      return null;
    }
  }

  /**
   * Get the full drawings list from our standalone IndexedDB-backed store.
   * Falls back to the Files module tree-walk ONLY if our index is empty
   * (migration path for drawings saved before this update).
   */
  function getDrawingsList() {
    if (!state.projectId) return Promise.resolve([]);

    // 1) Fetch from server (source of truth)
    var token = localStorage.getItem('align-token') || '';
    console.log('[DRAWINGS] Fetching from /api/projects/' + state.projectId + '/files');
    
    // Create a timeout promise
    var timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() {
        reject(new Error('API call timed out after 10 seconds'));
      }, 10000);
    });
    
    var fetchPromise = fetch('/api/projects/' + encodeURIComponent(state.projectId) + '/files', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) {
      console.log('[DRAWINGS] Server response:', r.status, r.ok);
      if (!r.ok) throw new Error('Server returned ' + r.status);
      return r.json();
    }).then(function (data) {
      console.log('[DRAWINGS] Got data:', data);
      var files = (data.files || []).filter(function (f) { return f.type === 'file' && f.trashed === 0; });
      var index = files.map(function (f) {
        return { id: f.id, name: f.original_name, mimeType: f.mime_type, size: f.size_bytes, createdAt: f.created_at, updatedAt: f.created_at };
      });
      if (index.length > 0) _saveDrawingsIndex(state.projectId, index);
      return index;
    });
    
    // Race between fetch and timeout
    return Promise.race([fetchPromise, timeoutPromise]).catch(function (err) {
      console.error('[DRAWINGS] API error:', err.message);
      var cached = _loadDrawingsIndex(state.projectId);
      if (!cached || cached.length === 0) {
        if (state.container) {
          state.container.innerHTML = '<div class="dr-empty"><strong>Error loading drawings</strong><p>' + (err.message || 'Unknown error') + '</p><p style="font-size:12px;color:#999;"><button id="dr-retry-btn" style="padding:8px 12px;background:#666;color:#fff;border:none;cursor:pointer;">Retry</button></p></div>';
          document.getElementById('dr-retry-btn').addEventListener('click', function() {
            state.container.innerHTML = '<div class="dr-empty">Loading drawings…</div>';
            _paint();
          });
        }
        return [];
      }
      return cached;
    });
  }

  function _walkForDrawings(node) {
    var results = [];
    if (!node) return results;
    if (node.type === 'file' && node.category === 'drawings') {
      results.push(node);
    }
    if (node.children) {
      var keys = Object.keys(node.children);
      for (var i = 0; i < keys.length; i++) {
        results = results.concat(_walkForDrawings(node.children[keys[i]]));
      }
    }
    return results;
  }

  /* ── PDF.js bootstrap ──────────────────────────────────────────────────── */
  var pdfjsLib = null;
  function _ensurePdfJs() {
    if (pdfjsLib) return pdfjsLib;
    if (typeof global.pdfjsLib !== 'undefined') {
      pdfjsLib = global.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      return pdfjsLib;
    }
    return null;
  }

  /* ── File reading ───────────────────────────────────────────────────────── */
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Failed to read file.')); };
      reader.readAsDataURL(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Failed to read file.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function validateFile(file) {
    if (!file) return 'No file selected.';
    // Only PDFs are supported
    if (file.type && file.type !== 'application/pdf') {
      // Also check by extension for browsers that don't set MIME correctly
      var name = (file.name || '').toLowerCase();
      if (!name.endsWith('.pdf')) {
        return 'Only PDF files are supported.';
      }
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File is too large. Maximum size is ' + fmtSize(MAX_FILE_SIZE) + '.';
    }
    return null;
  }

  /* ── PDF page splitting & bottom-right text extraction ─────────────────── */

  /* ── PDF page splitting & bottom-right text extraction ─────────────────── */
  /**
   * Detects if file is a multi-page PDF and splits it into individual pages.
   * Returns an array of { name, dataUrl, pageNum } for each page.
   * Tries to name pages from bottom-right text (title block convention).
   **/

  /* ── Sheet number scanner — text extraction + pattern matching ──────────── */

  // Extract metadata from a pdf.js page object (async, returns Promise<meta>)
  function _extractSheetMetadata(page, pageIndex) {
    var meta = _blankPageMeta(pageIndex);
    try {
      var viewport = page.getViewport({ scale: 1.0 });
      return page.getTextContent().then(function (textContent) {
        var items = textContent.items || [];
        // Raster / scanned PDF detection
        if (items.length < 5) {
          meta.reviewReason = 'no_text_layer';
          return meta;
        }
        // Title block region: bottom-right quadrant
        var region = { xMin: viewport.width * 0.75, yMax: viewport.height * 0.30 };
        var blockItems = items.filter(function (it) {
          var x = it.transform[4], y = it.transform[5];
          return x >= region.xMin && y <= region.yMax;
        });
        // Fallback: entire right-edge strip
        if (!blockItems.length) {
          blockItems = items.filter(function (it) {
            return it.transform[4] >= viewport.width * 0.85;
          });
        }
        // Fallback: entire bottom strip
        if (!blockItems.length) {
          blockItems = items.filter(function (it) {
            return it.transform[5] <= viewport.height * 0.30;
          });
        }
        if (!blockItems.length) {
          meta.reviewReason = 'no_match';
          return meta;
        }
        var lines = _groupTextLines(blockItems);
        var matchResult = _matchSheetNumber(lines, viewport);
        if (matchResult) {
          meta.sheetNumber  = matchResult.sheetNumber;
          meta.basePrefix   = matchResult.basePrefix;
          meta.baseNumber   = matchResult.baseNumber;
          meta.revision     = matchResult.revision;
          meta.category     = SHEET_CATEGORIES[meta.basePrefix] || null;
          meta.status       = matchResult.needsReview ? 'needs_review' : 'active';
          meta.reviewReason = matchResult.reviewReason || null;
        } else {
          meta.reviewReason = 'no_match';
        }
        var title = _extractTitle(lines, matchResult);
        if (title) meta.title = title;
        return meta;
      }).catch(function () {
        meta.reviewReason = 'extraction_error';
        return meta;
      });
    } catch (e) {
      meta.reviewReason = 'extraction_error';
      return Promise.resolve(meta);
    }
  }

  function _groupTextLines(items) {
    var sorted = items.slice().sort(function (a, b) {
      var ya = a.transform[5], yb = b.transform[5];
      if (Math.abs(ya - yb) > 4) return yb - ya;
      return a.transform[4] - b.transform[4];
    });
    var lines = [], currentLine = null, lastY = null;
    sorted.forEach(function (it) {
      var y = it.transform[5];
      if (!currentLine || Math.abs(y - lastY) > 4) {
        currentLine = { y: y, text: '', items: [] };
        lines.push(currentLine);
      }
      currentLine.items.push(it);
      lastY = y;
    });
    lines.forEach(function (l) {
      l.text = l.items.map(function (it) { return it.str; }).join(' ').trim();
      l.fontSize = Math.max.apply(null, l.items.map(function (it) {
        return Math.abs(it.transform[3]) || 0;
      }));
      l.x = Math.min.apply(null, l.items.map(function (it) { return it.transform[4]; }));
    });
    return lines;
  }

  function _matchSheetNumber(lines, viewport) {
    var tokens = [];
    lines.forEach(function (line) {
      line.text.split(/[\s]+/).forEach(function (tok) {
        tok = tok.replace(/[^A-Za-z0-9.\-]/g, '').trim();
        if (tok.length >= 2) tokens.push({ text: tok, line: line, x: line.x, fontSize: line.fontSize });
      });
      var joined = line.text.replace(/\s+/g, '');
      if (joined.length >= 2 && joined !== line.text) {
        tokens.push({ text: joined, line: line, x: line.x, fontSize: line.fontSize });
      }
    });
    // Tier 1: strict
    var STRICT = /^(FP|A|S|E|M|P|C|L|T)-(\d{2,3})(\.(\d{1,2}))?$/i;
    var strictMatches = [];
    tokens.forEach(function (t) {
      var m = t.text.match(STRICT);
      if (m) strictMatches.push({
        sheetNumber: t.text.toUpperCase(),
        basePrefix: m[1].toUpperCase(),
        baseNumber: (m[1] + '-' + m[2]).toUpperCase(),
        revision: m[4] ? parseInt(m[4], 10) : 0,
        fontSize: t.fontSize,
        x: t.x,
        needsReview: false
      });
    });
    if (strictMatches.length) {
      strictMatches.sort(function (a, b) {
        if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
        return b.x - a.x;
      });
      return strictMatches[0];
    }
    // Tier 2: loose
    var LOOSE = /^([A-Z]{1,3})[.\-]?(\d{1,3})([.\-](\d{1,2}))?$/i;
    var looseMatches = [];
    tokens.forEach(function (t) {
      var m = t.text.match(LOOSE);
      if (m) looseMatches.push({
        sheetNumber: t.text.toUpperCase(),
        basePrefix: m[1].toUpperCase(),
        baseNumber: (m[1] + '-' + m[2]).toUpperCase(),
        revision: m[4] ? parseInt(m[4], 10) : 0,
        fontSize: t.fontSize,
        x: t.x,
        needsReview: true,
        reviewReason: 'loose_match'
      });
    });
    if (looseMatches.length) {
      looseMatches.sort(function (a, b) {
        if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
        return b.x - a.x;
      });
      return looseMatches[0];
    }
    return null;
  }

  function _extractTitle(lines, matchResult) {
    if (!matchResult) return null;
    var sheetLine = matchResult.sheetNumber ? lines.find(function (l) {
      return l.text.toUpperCase().indexOf(matchResult.sheetNumber.toUpperCase()) !== -1;
    }) : null;
    var sheetY = sheetLine ? sheetLine.y : 0;
    var candidates = lines.filter(function (l) {
      if (!l.text || l.text.length < 3) return false;
      if (Math.abs(l.y - sheetY) < 10) return false;
      if (l.y < sheetY - 5) return false;
      var t = l.text.toLowerCase();
      if (/^(date|scale|drawn|checked|project|rev(ision)?|no\.?|sheet|page|of|\d+)$/i.test(t)) return false;
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t)) return false;
      return true;
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
      return Math.abs(a.y - sheetY) - Math.abs(b.y - sheetY);
    });
    var title = candidates[0].text.trim().replace(/\s+/g, ' ');
    if (title === title.toUpperCase() && title.length > 6) {
      title = title.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    return title;
  }


  function _splitPdfPages(file, dataUrl) {
    var lib = _ensurePdfJs();
    if (!lib) return null;          // PDF.js not loaded → fall back to whole file
    if (!file.type || file.type.indexOf('pdf') === -1) return null; // not a PDF

    return readFileAsArrayBuffer(file).then(function (buffer) {
      return lib.getDocument({ data: buffer.slice(0) }).promise.then(function (pdfDoc) {
        var numPages = pdfDoc.numPages;
        if (numPages <= 1) return null; // single page — no split needed
        return { pdfDoc: pdfDoc, numPages: numPages, buffer: buffer };
      });
    }).then(function (info) {
      if (!info) return null;

      var pdfDoc = info.pdfDoc;
      var numPages = info.numPages;

      // 1) Extract text for naming each page using pdf.js.
      //    CRITICAL: getTextContent() coordinates are in unscaled PDF user
      //    space — the viewport used for region math MUST be scale 1.0.
      //    (A 1.5x viewport made the bottom-right filter reject everything,
      //    so every page fell back to "Page N".)
      //    Also render a small PNG thumbnail per page for the preview list —
      //    <img> tags cannot display application/pdf data URLs.
      var textPromises = [];
      for (var i = 1; i <= numPages; i++) {
        (function (pn) {
          textPromises.push(
            pdfDoc.getPage(pn).then(function (page) {
              return page.getTextContent().then(function (tc) {
                var vp1 = page.getViewport({ scale: 1.0 });
                var thumbScale = Math.min(180 / vp1.width, 180 / vp1.height, 1);
                var tvp = page.getViewport({ scale: thumbScale });
                var canvas = document.createElement('canvas');
                canvas.width = Math.ceil(tvp.width);
                canvas.height = Math.ceil(tvp.height);
                return page.render({ canvasContext: canvas.getContext('2d'), viewport: tvp }).promise.then(function () {
                  var thumbUrl = null;
                  try { thumbUrl = canvas.toDataURL('image/png'); } catch (e) { /* tainted/oom — icon fallback */ }
                  return { pageNum: pn, items: tc.items, viewport: vp1, thumbUrl: thumbUrl };
                }).catch(function () {
                  return { pageNum: pn, items: tc.items, viewport: vp1, thumbUrl: null };
                });
              });
            })
          );
        })(i);
      }

      return Promise.all(textPromises).then(function (textResults) {
        // 2) Use pdf-lib to extract each page as a standalone PDF
        if (typeof PDFLib === 'undefined') {
          console.warn('[AlignDrawings] pdf-lib not loaded, falling back to whole file');
          return null;
        }
        return PDFLib.PDFDocument.load(info.buffer).then(function (srcDoc) {
          var pages = [];
          var splitPromises = [];
          for (var j = 0; j < textResults.length; j++) {
            (function (tr) {
              var pageName = _extractBottomRightText(tr.items, tr.viewport);
              if (!pageName) pageName = 'Page ' + tr.pageNum;
              pageName = _sanitizePageName(pageName, tr.pageNum);

              splitPromises.push(
                PDFLib.PDFDocument.create().then(function (newDoc) {
                  return newDoc.copyPages(srcDoc, [tr.pageNum - 1]).then(function (copied) {
                    newDoc.addPage(copied[0]);
                    return newDoc.save();
                  });
                }).then(function (pdfBytes) {
                  // Proper Uint8Array → base64 (btoa chokes on raw binary)
                  var bytes = new Uint8Array(pdfBytes);
                  var chunks = [];
                  var chunkSize = 0x8000; // 32KB chunks
                  for (var b = 0; b < bytes.length; b += chunkSize) {
                    var chunk = bytes.subarray(b, Math.min(b + chunkSize, bytes.length));
                    var bin = '';
                    for (var c = 0; c < chunk.length; c++) {
                      bin += String.fromCharCode(chunk[c]);
                    }
                    chunks.push(btoa(bin));
                  }
                  var dataUrl = 'data:application/pdf;base64,' + chunks.join('');
                  pages.push({
                    name: pageName,
                    dataUrl: dataUrl,
                    thumbUrl: tr.thumbUrl || null,
                    pageNum: tr.pageNum
                  });
                })
              );
            })(textResults[j]);
          }

          return Promise.all(splitPromises).then(function () {
            pages.sort(function (a, b) {
              return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });
            return pages;
          });
        });
      });
    }).catch(function (err) {
      console.warn('[AlignDrawings] PDF split failed, falling back to whole file:', err);
      return null;
    });
  }

  /**
   * Extract text from the bottom-right quadrant of a page.
   * Architectural drawings follow the convention: title block is in
   * the bottom-right corner containing sheet number, title, etc.
   **/

  /* ── Supersede logic ───────────────────────────────────────────────────── */
  // Run after drawings are saved — marks older revisions as superseded
  function _resolveSupersedes(projectId) {
    if (!projectId) return;
    try {
      var drawings = Storage().listRecords(projectId, 'drawings');
      var groups = {};
      drawings.forEach(function (d) {
        var meta = d.meta || {};
        var bn = meta.baseNumber || (d.name || '').split(':')[0].trim();
        if (!bn) return;
        if (!groups[bn]) groups[bn] = [];
        groups[bn].push(d);
      });
      Object.keys(groups).forEach(function (bn) {
        var group = groups[bn];
        group.sort(function (a, b) {
          return ((b.meta && b.meta.revision) || 0) - ((a.meta && a.meta.revision) || 0);
        });
        for (var i = 0; i < group.length; i++) {
          var newStatus = (i === 0) ? 'active' : 'superseded';
          var meta = group[i].meta;
          if (!meta) { meta = {}; group[i].meta = meta; }
          if (meta.status !== newStatus) {
            meta.status = newStatus;
            Storage().saveRecord(projectId, 'drawings', group[i]);
          }
        }
      });
    } catch (e) {
      console.warn('[AlignDrawings] Supersede resolution failed:', e);
    }
  }

  function _extractBottomRightText(textItems, viewport) {

    if (!textItems || textItems.length === 0) return null;

    var vw = viewport.width;
    var vh = viewport.height;

    // Bottom-right region: rightmost 35% of width, bottom 20% of height
    var leftBound = vw * 0.65;
    var topBound  = vh * 0.80;

    var candidates = [];

    for (var i = 0; i < textItems.length; i++) {
      var item = textItems[i];
      if (!item.str || !item.transform) continue;
      var tx = item.transform[4];
      var ty = item.transform[5];
      var str = item.str.trim();

      if (!str) continue;

      // Bottom-right region
      if (tx >= leftBound && ty <= (vh * 0.20) && str.length >= 1) {
        if (/^[\d.,\s\-]+$/.test(str) && str.length < 8) continue;
        if (str.length < 2) continue;

        candidates.push({
          text: str,
          x: tx,
          y: ty,
          fontSize: item.height || (item.transform ? Math.abs(item.transform[3]) : 8)
        });
      }
    }

    if (candidates.length === 0) return null;

    // Sort by Y (bottom-to-top), then X (left-to-right)
    candidates.sort(function (a, b) {
      var yDiff = a.y - b.y;
      if (Math.abs(yDiff) < 5) return a.x - b.x;
      return yDiff;
    });

    // ── Smart extraction: look for sheet number pattern (A-101, S-201, etc.) ──
    var sheetPattern = /^[A-Z]\d*[-.]?\d+[A-Za-z]?$/;  // e.g. A-101, S201, M-2.1, E001a
    var sheetNum = null;
    var otherParts = [];

    for (var j = 0; j < candidates.length; j++) {
      var t = candidates[j].text;
      if (!sheetNum && sheetPattern.test(t)) {
        sheetNum = t;
      } else if (t.length >= 3) {
        otherParts.push(t);
      }
    }

    // Build name: SHEET NUMBER: Title
    var name = '';
    if (sheetNum) {
      name = sheetNum;
      if (otherParts.length > 0) {
        // Take first meaningful title piece (skip scale, revision, dates)
        var title = otherParts.filter(function (p) {
          return !/^(SCALE|REV|DATE|DWG|CHK|APPR|\d{1,2}\/\d{1,2}\/\d{2,4}|NTS|NOT TO SCALE)$/i.test(p);
        });
        if (title.length > 0) {
          name += ' — ' + title.slice(0, 3).join(' ');
        }
      }
    } else {
      // No sheet number found — use the best text we have
      var seen = {};
      var parts = [];
      for (var k = 0; k < candidates.length; k++) {
        var ct = candidates[k].text;
        var key = ct.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        if (ct.length < 3 && candidates.length > 3) continue;
        parts.push(ct);
      }
      name = parts.join(' — ');
    }

    return name || null;
  }

  function _sanitizePageName(raw, fallbackNum) {
    var s = String(raw || '').trim();
    // Remove characters unsafe for filenames
    s = s.replace(/[\\/:*?"<>|]/g, '-');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/\.{2,}/g, '.');
    s = s.slice(0, 200);
    return s || ('Page ' + fallbackNum);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * STANDALONE DRAWING STORE  (IndexedDB-backed, no Files module dependency)
   * ════════════════════════════════════════════════════════════════════════════
   * Drawings are stored directly in IndexedDB keyed by projectId + drawingId.
   * A lightweight index (array of {id, name, type, size, updatedAt}) lives in
   * localStorage so we can list drawings without scanning the whole DB.
   *
   * If window.AlignFiles is available, we ALSO save through it for the
   * unified file browser. The standalone store is the source of truth for
   * the drawings panel itself — the Files module save is a best-effort bonus.
   */

  var DRAWING_INDEX_KEY = 'align.drawings.index.';  // + projectId

  function _drawingsIndexKey(pid) { return DRAWING_INDEX_KEY + pid; }

  /* ── Server upload (source of truth) ──────────────────────────────────── */

  function _uploadToServer(pid, drawingId, name, mime, dataUrl, folderId) {
    return new Promise(function (resolve, reject) {
      var parts = dataUrl.split(',');
      var byteString = atob(parts[1]);
      var ab = new ArrayBuffer(byteString.length);
      var ia = new Uint8Array(ab);
      for (var i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      var blob = new Blob([ab], { type: mime });

      var fd = new FormData();
      fd.append('file', blob, name);
      fd.append('project_id', pid);
      if (folderId) fd.append('folder_id', folderId);

      var token = localStorage.getItem('align-token') || '';
      fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) { reject(new Error(d.error || 'Upload failed')); });
        return r.json();
      }).then(function (data) {
        resolve(data.file || { id: drawingId });
      }).catch(reject);
    });
  }

  function _loadDrawingsIndex(pid) {
    try {
      var raw = window.localStorage.getItem(_drawingsIndexKey(pid));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function _saveDrawingsIndex(pid, list) {
    try {
      window.localStorage.setItem(_drawingsIndexKey(pid), JSON.stringify(list));
    } catch (e) { console.warn('[AlignDrawings] Index write failed:', e); }
  }

  /** Direct IndexedDB blob store — identical pattern to align-files.js. */
  var _idb = null;
  function _idbOpen() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('align-drawings', 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('blobs')) {
          req.result.createObjectStore('blobs', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { _idb = req.result; resolve(_idb); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
    });
  }

  function _drawingBlobKey(projectId, drawingId) {
    return projectId + '.' + drawingId;
  }

  function _saveDrawingBlob(projectId, drawingId, content) {
    return _idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('blobs', 'readwrite');
        var store = tx.objectStore('blobs');
        var req = store.put({ key: _drawingBlobKey(projectId, drawingId), value: content });
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error || new Error('IndexedDB write failed')); };
      });
    });
  }

  function _loadDrawingBlob(projectId, drawingId) {
    return _idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('blobs', 'readonly');
        var store = tx.objectStore('blobs');
        var req = store.get(_drawingBlobKey(projectId, drawingId));
        req.onsuccess = function () { resolve(req.result ? req.result.value : null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function _deleteDrawingBlob(projectId, drawingId) {
    return _idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('blobs', 'readwrite');
        var store = tx.objectStore('blobs');
        var req = store.delete(_drawingBlobKey(projectId, drawingId));
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function _drawingUid() {
    return 'dr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function _drawingNowISO() {
    return new Date().toISOString();
  }

  /**
   * Save one or more drawings.  COMPLETELY SELF-CONTAINED.
   * Uses direct IndexedDB + localStorage index.  Does NOT require
   * window.AlignFiles — if it's available we save there too as a
   * best-effort bonus (for the unified file browser).
   *
   * Accepts: addDrawing(file, dataUrl, customName) — single
   *          addDrawing([{name,type,size,dataUrl}], null, baseName) — bulk
   * Returns: Promise<array of saved drawing entries>
   */
  function addDrawing(fileOrArray, dataUrl, customName) {
    var pid = _resolveProjectId();
    if (!pid) {
      var allProjects = Storage() ? Storage().listProjects() : [];
      if (allProjects.length === 0) {
        return Promise.reject(new Error('No projects exist. Create a project in Settings first.'));
      }
      return Promise.reject(new Error('No active project selected. Please select a project from the header.'));
    }

    // Build the file list
    var files = [];
    if (Array.isArray(fileOrArray)) {
      files = fileOrArray;
    } else {
      files = [{ name: fileOrArray.name, type: fileOrArray.type, size: fileOrArray.size, dataUrl: dataUrl, customName: customName }];
    }

    var index = _loadDrawingsIndex(pid);
    var now = _drawingNowISO();

    // Also save through AlignFiles if available (best-effort, for file browser)
    var filesAPI = window.AlignFiles || null;
    var filesFolderId = null;
    if (filesAPI) {
      try { filesFolderId = ensureDrawingsFolder(); } catch (e) { /* best effort */ }
    }

    var promises = [];
    for (var i = 0; i < files.length; i++) {
      (function (f) {
        var name = f.customName || customName || f.name || 'drawing';
        var mime = f.type || 'application/octet-stream';
        var content = f.dataUrl || '';
        var drawingId = _drawingUid();
        var entry = {
          id: drawingId,
          name: name,
          mimeType: mime,
          size: content.length,
          createdAt: now,
          updatedAt: now,
          drawingType: f.drawingType || ''
        };

        // 1) Upload to server (source of truth — shared across all users)
        var p = _uploadToServer(pid, drawingId, name, mime, content, filesFolderId).then(function (serverFile) {
          entry.id = serverFile.id || drawingId;
          index.push(entry);
          _saveDrawingsIndex(pid, index);
          // Also cache in IndexedDB for offline access
          _saveDrawingBlob(pid, entry.id, content).catch(function(){});
          return entry;
        });

        promises.push(p);
      })(files[i]);
    }

    return Promise.all(promises);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * RENDER — Main Drawings View
   * ════════════════════════════════════════════════════════════════════════════ */

  function render(container) {
    if (!container) return;

    state.container = container;
    state.projectId = null;
    state.drawingsFolderId = null;
    state.showAddModal = false;
    state.pendingFiles = [];
    state.uploadName = '';
    state.uploadError = null;
    state.pdfSplitInfo = null;
    state.selectMode = false;
    state.selectedIds = {};
    state.drawingType = '';
    state.activeCategory = 'all';
    state.maxVisible = 20;
    state.drawingsCache = null;
    _resolveProjectId();

    try { _paint(); } catch(e) {
      container.innerHTML = '<div class="pm-empty"><strong>Error</strong><p>' + e.message + '</p></div>';
      fetch('https://ntfy.sh/alfr-hermes-tasks', { method:'POST', body: 'Drawings crash: ' + e.message + '\\n' + (e.stack||''), headers:{'Title':'Align Crash','Priority':'high'} }).catch(function(){});
    }
  }

  function _paint() {
    var c = state.container;
    if (!c) return;

    // Always refresh the active project — never trust a stale cache
    _resolveProjectId();

    if (state.showAddModal) {
      c.innerHTML = _addModalHtml();
      _bindAddModal();
      return;
    }

    if (!state.projectId) {
      c.innerHTML = '<div class="dr-empty"><strong>No active project</strong><p>Select a project from the header to view drawings.</p></div>';
      return;
    }

    // Show loading state
    c.innerHTML = '<div class="dr-empty">Loading drawings…</div>';
    
    getDrawingsList().then(function (drawings) {
      state.drawingsCache = drawings;
      _renderView(drawings);
    }).catch(function(err) {
      console.error('[DRAWINGS] getDrawingsList error:', err);
      c.innerHTML = '<div class="dr-empty"><strong>Error loading drawings</strong><p>' + (err.message || 'Unknown error') + '</p><button id="dr-retry">Retry</button></div>';
      document.getElementById('dr-retry').addEventListener('click', _paint);
    });
  }

  // Render the main list from an in-memory drawings array + rebind (no re-fetch).
  function _renderView(drawings) {
    var c = state.container;
    if (!c) return;
    c.innerHTML = _mainViewHtml(drawings);
    try { _bindMainView(); } catch(e) {
      fetch('https://ntfy.sh/alfr-hermes-tasks', { method:'POST', body: 'bindMainView crash: ' + e.message + '\n' + (e.stack||'').slice(0,500), headers:{'Title':'Align Crash','Priority':'high'} }).catch(function(){});
    }
  }

  /* ── Main View HTML ─────────────────────────────────────────────────────── */
  function _mainViewHtml(drawings) {
    var h = [];
    h.push('<div class="dr-wrap">');

    // Header with Add button + Select Multiple toggle
    h.push('<div class="dr-header">');
    h.push('<h3 class="dr-title">Project drawings</h3>');
    h.push('<div class="dr-header-actions">');
    h.push('<button class="pm-btn primary" id="dr-add-btn">+ Add drawing</button>');
    // Select Multiple toggle (only when there are drawings)
    if (drawings.length > 0) {
      var selActive = state.selectMode ? ' active' : '';
      h.push('<button class="dr-select-toggle-btn' + selActive + '" id="dr-select-toggle-btn">☑ Select multiple</button>');
    }
    h.push('</div>');
    h.push('</div>');

    // ── Category filter (chips + count line + filtered list) ──
    var counts = {};
    var otherCount = 0;
    var ci, cc;
    for (ci = 0; ci < drawings.length; ci++) {
      cc = drawingCategory(drawings[ci].name);
      if (cc) { counts[cc.code] = (counts[cc.code] || 0) + 1; }
      else { otherCount++; }
    }
    // safety: if the active category vanished (e.g. file deleted), fall back to All
    if (state.activeCategory !== 'all' && state.activeCategory !== 'other' && !counts[state.activeCategory]) {
      state.activeCategory = 'all';
    }
    if (state.activeCategory === 'other' && otherCount === 0) {
      state.activeCategory = 'all';
    }
    if (drawings.length > 0) {
      h.push('<div class="dwg-filter" id="dwg-filter">');
      h.push('<button type="button" class="dwg-chip' + (state.activeCategory === 'all' ? ' active' : '') + '" data-cat="all">All (' + drawings.length + ')</button>');
      for (ci = 0; ci < SHEET_CAT_ORDER.length; ci++) {
        var code = SHEET_CAT_ORDER[ci];
        if (!counts[code]) continue;
        h.push('<button type="button" class="dwg-chip' + (state.activeCategory === code ? ' active' : '') + '" data-cat="' + code + '">' + esc(SHEET_CATEGORIES[code]) + ' (' + counts[code] + ')</button>');
      }
      if (otherCount > 0) {
        h.push('<button type="button" class="dwg-chip' + (state.activeCategory === 'other' ? ' active' : '') + '" data-cat="other">Other (' + otherCount + ')</button>');
      }
      h.push('</div>');
    }
    // filtered list (used by the card loop AND Load More)
    var filtered = drawings;
    if (state.activeCategory !== 'all') {
      filtered = [];
      for (ci = 0; ci < drawings.length; ci++) {
        cc = drawingCategory(drawings[ci].name);
        var fcode = cc ? cc.code : 'other';
        if (fcode === state.activeCategory) filtered.push(drawings[ci]);
      }
    }
    if (drawings.length > 0) {
      h.push('<div class="dwg-count">Showing ' + Math.min(filtered.length, state.maxVisible) + ' of ' + filtered.length + ' drawing' + (filtered.length === 1 ? '' : 's') + '</div>');
    }

    // Selection bar (only in select mode with drawings)
    if (state.selectMode && drawings.length > 0) {
      var selCount = Object.keys(state.selectedIds).length;
      h.push('<div class="dr-selection-bar" id="dr-selection-bar">');
      h.push('<span class="dr-selection-count">' + selCount + ' selected</span>');
      h.push('<div class="dr-selection-actions">');
      if (selCount === 0) {
        h.push('<button class="pm-btn small" id="dr-select-all-btn">Select All</button>');
      } else {
        h.push('<button class="pm-btn small" id="dr-select-all-btn">Select All (' + drawings.length + ')</button>');
        h.push('<button class="pm-btn small" id="dr-deselect-btn">Deselect</button>');
        h.push('<button class="pm-btn small primary" id="dr-export-sel-btn">⬇ Export</button>');
        h.push('<button class="pm-btn small danger" id="dr-delete-sel-btn">🗑 Delete</button>');
      }
      h.push('<button class="pm-btn small" id="dr-cancel-select-btn">Done</button>');
      h.push('</div>');
      h.push('</div>');
    }

    // Drawings grid or empty state
    if (drawings.length === 0) {
      h.push('<div class="dr-empty">');
      h.push('<div class="dr-empty-icon">📐</div>');
      h.push('<strong>No drawings yet</strong>');
      h.push('<p>Drag & drop a drawing file here or click "Add Drawing" to upload one.</p>');
      h.push('</div>');
    } else {
      h.push('<div class="dwg-grid" id="dr-grid">');
      for (var i = 0; i < filtered.length && i < state.maxVisible; i++) {
        var d = filtered[i];
        var icon = mimeIcon(d.mimeType);
        var isImage = d.mimeType && d.mimeType.indexOf('image/') === 0;
        var isSelected = state.selectedIds[d.id];
        var selClass = state.selectMode ? ' select-mode' : '';
        if (isSelected) selClass += ' selected';
        var cat = drawingCategory(d.name);
        var catCode = cat ? cat.code : 'other';

        h.push('<div class="dwg-card' + selClass + '" data-file-id="' + esc(d.id) + '" data-cat="' + catCode + '">');
        h.push('<div class="dr-card-check" data-check-id="' + esc(d.id) + '"></div>');
        h.push('<div class="dwg-thumb">');
        h.push('<span class="dwg-icon">' + icon + '</span>');
        h.push('<img src="/api/files/' + encodeURIComponent(d.id) + '?thumb=1" alt="' + esc(d.name) + '" loading="lazy" onerror="this.style.display=\'none\'">');
        if (cat) {
          h.push('<span class="dwg-tag"><span class="dwg-dot" data-cat="' + cat.code + '"></span>' + esc(cat.label) + '</span>');
        }
        h.push('</div>'); // .dwg-thumb
        h.push('<div class="dwg-body">');
        h.push('<div class="dwg-name" title="' + esc(d.name) + '">' + esc(d.name) + '</div>');
        h.push('<div class="dwg-meta">' + fmtSize(d.size) + ' · ' + fmtDate(d.updatedAt) + '</div>');
        h.push('</div>'); // .dwg-body
        h.push('</div>'); // .dwg-card
      }
      h.push('</div>');
      if (filtered.length > state.maxVisible) {
        var remaining = filtered.length - state.maxVisible;
        h.push('<button class="pm-btn" id="dr-load-more">Load More (' + remaining + ' more)</button>');
      }
    }

    h.push('</div>');
    return h.join('');
  }

  function _bindMainView() {
    var addBtn = document.getElementById('dr-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        state.showAddModal = true;
        state.pendingFiles = [];
        state.pdfSplitInfo = null;
        state.uploadName = '';
        state.uploadError = null;
        state.dragOver = false;
        _paint();
      });
    }

    // ── Category filter chips ─────────────────────────────────────────────
    var filterBar = document.getElementById('dwg-filter');
    if (filterBar) {
      filterBar.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== filterBar && String(t.className || '').indexOf('dwg-chip') === -1) {
          t = t.parentNode;
        }
        if (!t || t === filterBar) return;
        var cat = t.getAttribute('data-cat');
        if (cat && cat !== state.activeCategory) {
          state.activeCategory = cat;
          state.maxVisible = 20;
          if (state.drawingsCache) _renderView(state.drawingsCache);
        }
      });
    }

    // ── Load More button ──────────────────────────────────────────────────
    var loadMoreBtn = document.getElementById('dr-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        state.maxVisible = 100000; // show all
        if (state.drawingsCache) _renderView(state.drawingsCache);
      });
    }

    // ── Select Multiple toggle ────────────────────────────────────────────
    var toggleBtn = document.getElementById('dr-select-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (state.selectMode) {
          // Exit select mode
          state.selectMode = false;
          state.selectedIds = {};
        } else {
          // Enter select mode
          state.selectMode = true;
          state.selectedIds = {};
        }
        _paint();
      });
    }

    // ── Selection bar buttons ──────────────────────────────────────────────
    var selectAllBtn = document.getElementById('dr-select-all-btn');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function () {
        getDrawingsList().then(function (drawings) {
          for (var i = 0; i < drawings.length; i++) {
            state.selectedIds[drawings[i].id] = true;
          }
          _paint();
        });
      });
    }

    var deselectBtn = document.getElementById('dr-deselect-btn');
    if (deselectBtn) {
      deselectBtn.addEventListener('click', function () {
        state.selectedIds = {};
        _paint();
      });
    }

    var exportSelBtn = document.getElementById('dr-export-sel-btn');
    if (exportSelBtn) {
      exportSelBtn.addEventListener('click', function () {
        _exportSelectedDrawings(false);
      });
    }

    var deleteSelBtn = document.getElementById('dr-delete-sel-btn');
    if (deleteSelBtn) {
      deleteSelBtn.addEventListener('click', function () {
        _deleteSelectedDrawings(false);
      });
    }

    var cancelSelectBtn = document.getElementById('dr-cancel-select-btn');
    if (cancelSelectBtn) {
      cancelSelectBtn.addEventListener('click', function () {
        state.selectMode = false;
        state.selectedIds = {};
        _paint();
      });
    }

    // ── Card clicks ────────────────────────────────────────────────────────
    var cards = document.querySelectorAll('.dwg-card');
    cards.forEach(function (card) {
      var fileId = card.getAttribute('data-file-id');

      // Checkbox click
      var checkEl = card.querySelector('.dr-card-check');
      if (checkEl && state.selectMode) {
        checkEl.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state.selectedIds[fileId]) {
            delete state.selectedIds[fileId];
          } else {
            state.selectedIds[fileId] = true;
          }
          _paint();
        });
      }

      // Card body click
      card.addEventListener('click', function (e) {
        // Don't open viewer if we clicked the checkbox in select mode
        if (state.selectMode) {
          // Toggle selection
          if (state.selectedIds[fileId]) {
            delete state.selectedIds[fileId];
          } else {
            state.selectedIds[fileId] = true;
          }
          _paint();
          return;
        }

        if (fileId) {
          _resolveProjectId();
          var timedOut = false;
          var timeout = setTimeout(function() {
            timedOut = true;
            alert('Drawing load timed out. Please refresh and try again.');
          }, 8000);
          _loadDrawingForViewer(state.projectId, fileId).then(function (viewData) {
            if (timedOut) return;
            clearTimeout(timeout);
            if (viewData) _viewDrawing(viewData);
            else alert('Could not load this drawing. Try re-uploading it.');
          }).catch(function(err) {
            if (timedOut) return;
            clearTimeout(timeout);
            alert('Failed to load drawing: ' + (err && err.message || err));
          });
        }
      });
    });

  }

  /**
   * Load a drawing for viewing. Tries standalone store first, then Files module.
   * Returns { meta: {name, mimeType, size, updatedAt}, content: <dataUrl> }
   */
  function _loadDrawingForViewer(projectId, drawingId) {
    // 1) Fetch from server (source of truth)
    var token = localStorage.getItem('align-token') || '';
    return fetch('/api/files/' + encodeURIComponent(drawingId) + '?download=1', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) {
      if (!r.ok) throw new Error('Server returned ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () {
          resolve({
            meta: { id: drawingId, name: 'Drawing', mimeType: blob.type || 'application/pdf', size: blob.size },
            content: reader.result
          });
        };
        reader.readAsDataURL(blob);
      });
    }).catch(function () {
      // Fallback: IndexedDB
      return _loadFromIndexedDB(projectId, drawingId);
    });
  }

  function _loadFromIndexedDB(projectId, drawingId) {
    var index = _loadDrawingsIndex(projectId);
    var entry = null;
    for (var i = 0; i < index.length; i++) {
      if (index[i].id === drawingId) { entry = index[i]; break; }
    }
    if (entry) {
      return _loadDrawingBlob(projectId, drawingId).then(function (content) {
        return { meta: entry, content: content };
      });
    }
    return Promise.resolve(null);
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * INTERACTIVE MARKUP VIEWER
   * ════════════════════════════════════════════════════════════════════════════
   * Canvas overlay with pen, highlighter, text, rect, ellipse, arrow, eraser.
   * Markups saved per-drawing in IndexedDB store 'align-markups'.
   * Clean-view toggle shows/hides all annotation layers.
   */

  var _mv = null; // markup-viewer live state (null when viewer closed)

  // ── List-map mode state (crop authoring + pin placement), driven from Punchlist ──
  var _mvModeArgs = null; // { mode, projectId, drawingId, sheet, listId, itemId, cropMode, vertices, onSaved, onPlaced, onCancel }
  var _cropTool = null;   // active DrawingCropTool instance (crop mode)
  var _mvPinDown = null;  // { x, y, moved, lastX, lastY } — pin tap-vs-pan gesture state

  // Transform-change subscription (crop tool re-sizes markers on zoom/pan)
  var _mvTransformListeners = new Set();
  function _mvOnTransformChanged(callback) {
    _mvTransformListeners.add(callback);
    return function unsubscribe() { _mvTransformListeners.delete(callback); };
  }
  function _mvNotifyTransformChanged(reason) {
    var ev = { reason: reason, zoom: (_mv && _mv.zoom) || 1, panX: (_mv && _mv.panX) || 0, panY: (_mv && _mv.panY) || 0 };
    _mvTransformListeners.forEach(function (cb) {
      try { cb(ev); } catch (err) { console.error('[AlignDrawings] transform listener failed:', err); }
    });
    _mvPersistState();
  }

  /* ── Viewer state persistence (survives WKWebView content-process kill) ── */
  var MV_STATE_KEY = 'alignpm.mv.state.v1';
  var MV_OPEN_MARKER = 'alignpm.mv.open';   // sessionStorage: survives reload, not cold launch
  var MV_STATE_MAX_AGE_MS = 10 * 60 * 1000;
  var _mvStateTimer = null;

  function _mvWriteStateNow() {
    try {
      if (!_mv || !_mv._pdfDoc) { localStorage.removeItem(MV_STATE_KEY); return; }
      localStorage.setItem(MV_STATE_KEY, JSON.stringify({
        projectId: _mv.projectId,
        drawingId: _mv.drawingId,
        page: _mv._pdfPageNum,
        zoom: _mv.zoom,
        panX: _mv.panX,
        panY: _mv.panY,
        ts: Date.now()
      }));
    } catch (e) {}
  }
  function _mvPersistState() {
    if (_mvStateTimer) return;
    _mvStateTimer = setTimeout(function () { _mvStateTimer = null; _mvWriteStateNow(); }, 400);
  }
  window.addEventListener('pagehide', _mvWriteStateNow);
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') _mvWriteStateNow();
  });
  var _mvRestoreOpts = null;

  // Best-effort restore after a WKWebView content-process kill. Call from app boot.
  function _mvTryRestoreState() {
    // Only restore if the viewer was OPEN when the process died. sessionStorage
    // survives Capacitor's webView.reload() but NOT a cold relaunch, so it
    // distinguishes "killed mid-view" from "normal relaunch".
    var wasOpen = false;
    try { wasOpen = sessionStorage.getItem(MV_OPEN_MARKER) === '1'; } catch (e) {}
    if (!wasOpen) return false;

    var raw = null;
    try { raw = localStorage.getItem(MV_STATE_KEY); } catch (e) {}
    if (!raw) return false;
    var st = null;
    try { st = JSON.parse(raw); } catch (e) { return false; }
    if (!st || !st.drawingId || !st.projectId || (Date.now() - st.ts) > MV_STATE_MAX_AGE_MS) {
      try { localStorage.removeItem(MV_STATE_KEY); } catch (e) {}
      return false;
    }
    try { localStorage.removeItem(MV_STATE_KEY); } catch (e) {}
    state.projectId = st.projectId;
    _loadDrawingForViewer(st.projectId, st.drawingId).then(function (file) {
      if (file) _viewDrawing(file, { restore: st });
    }).catch(function () {});
    return true;
  }

  function _mvScreenToNormalized(clientX, clientY) {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return { x: 0, y: 0 };
    var rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    };
  }

  function _mvNormalizedToClient(nx, ny) {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return { x: 0, y: 0 };
    var rect = canvas.getBoundingClientRect();
    return { x: rect.left + nx * rect.width, y: rect.top + ny * rect.height };
  }

  function _mvPanByClientDelta(dx, dy) {
    if (!_mv) return;
    _mv.panX += dx;
    _mv.panY += dy;
    _mvApplyTransform();
  }

  function _pointInPolygon(x, y, vertices) {
    var inside = false;
    for (var i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      var a = vertices[j], b = vertices[i];
      if (((a.y > y) !== (b.y > y)) && (x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
  }

  /* ── Markup IndexedDB store ────────────────────────────────────────────── */
  var _markupDB = null;
  function _markupOpen() {
    if (_markupDB) return Promise.resolve(_markupDB);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('align-markups', 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains('strokes')) {
          req.result.createObjectStore('strokes', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { _markupDB = req.result; resolve(_markupDB); };
      req.onerror = function () { reject(req.error || new Error('Markup DB open failed')); };
    });
  }
  function _markupKey(projectId, drawingId) { return projectId + '::' + drawingId; }
  function _loadMarkups(projectId, drawingId) {
    var token = localStorage.getItem('align-token') || '';
    return fetch('/api/projects/' + encodeURIComponent(projectId) + '/drawings/' + encodeURIComponent(drawingId) + '/markups', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (d) {
      return (d && d.strokes) || [];
    }).catch(function () {
      return [];
    });
  }

  function _saveMarkups(projectId, drawingId, strokes) {
    var token = localStorage.getItem('align-token') || '';
    return fetch('/api/projects/' + encodeURIComponent(projectId) + '/drawings/' + encodeURIComponent(drawingId) + '/markups', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ strokes: strokes })
    }).catch(function () {});
  }

  /* ── Viewer entry point ────────────────────────────────────────────────── */
  function _viewDrawing(file, opts) {
    var isImage = file.meta.mimeType && file.meta.mimeType.indexOf('image/') === 0;
    var isPdf = file.meta.mimeType && file.meta.mimeType === 'application/pdf';
    var content = file.content || '';
    var pid = state.projectId;
    var did = file.meta.id;

    // Restore opts (from a content-process kill) get applied after the viewer is ready
    _mvRestoreOpts = (opts && opts.restore) || null;

    // Capture any pending list-map mode (crop / pin) set by openListCrop/openListPin
    var modeArgs = _mvModeArgs || null;
    _mvModeArgs = null;

    // Close any previous viewer + remove old overlay if any
    _mvClose();
    try { sessionStorage.setItem(MV_OPEN_MARKER, '1'); } catch (e) {}

    var h = [];

    // ── Full-screen overlay ──
    h.push('<div class="dr-mv-overlay" id="dr-mv-overlay">');

    // ── Top bar ──
    h.push('<div class="dr-mv-topbar">');
    h.push('<button class="pm-btn small dr-mv-back-btn" id="dr-mv-back">← Back to Drawings</button>');
    h.push('<h3 class="dr-mv-title">' + esc(file.meta.name) + '</h3>');
    h.push('<span class="dr-mv-meta">' + fmtSize(file.meta.size) + ' · ' + fmtDate(file.meta.updatedAt) + '</span>');
    h.push('</div>');

    // ── Toolbar (hidden by default; slides in when "Markup Drawing" clicked) ──
    h.push(_mvToolbarHtml());

    if (isImage) {
      h.push('<div class="dr-mv-viewport" id="dr-mv-viewport">');
      h.push('<div class="dr-mv-stage" id="dr-mv-stage">');
      h.push('<img class="dr-mv-image" id="dr-mv-image" src="' + esc(content) + '" draggable="false">');
      h.push('<canvas class="dr-mv-canvas" id="dr-mv-canvas"></canvas>');
      h.push('</div>');
      h.push('</div>');
    } else if (isPdf) {
      // Render PDF inline via pdf.js canvas
      h.push('<div class="dr-mv-viewport" id="dr-mv-viewport">');
      h.push('<div class="dr-mv-stage" id="dr-mv-stage">');
      h.push('<canvas class="dr-mv-image" id="dr-mv-image" style="display:block;"></canvas>');
      h.push('<canvas class="dr-mv-canvas" id="dr-mv-canvas"></canvas>');
      h.push('</div>');
      h.push('</div>');
      // Page index strip (populated after PDF loads)
      h.push('<div class="dr-mv-page-strip" id="dr-mv-page-strip"></div>');
    } else {
      h.push('<div style="flex:1;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);flex-direction:column;gap:10px;">');
      h.push('<p style="font-size:1.1rem;">Interactive markup is available for image-based drawings.</p>');
      h.push('<p style="font-size:0.85rem;">Upload drawings as individual pages for full markup support.</p>');
      h.push('<a class="pm-btn small" href="' + esc(content) + '" download="' + esc(file.meta.name) + '">⬇ Download</a>');
      h.push('</div>');
    }

    h.push('</div>'); // .dr-mv-overlay

    // Append to body as a full-screen overlay (not inside container)
    var div = document.createElement('div');
    div.id = 'dr-mv-overlay-host';
    div.innerHTML = h.join('');
    document.body.appendChild(div);

    // Scroll lock — prevent background page from scrolling.
    // Save full body state (overflow, position, top, width, touchAction, overscrollBehavior)
    var prevBody = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      touchAction: document.body.style.touchAction,
      overscrollBehavior: document.body.style.overscrollBehavior
    };
    var hadSectionOpen = document.body.classList.contains('section-open');
    var sectionScrollY = hadSectionOpen ? _readSectionScrollY() : 0;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = '0px';
    // IMPORTANT: Do NOT remove section-open class.  The home page is hidden
    // via inline display:none (set by _openSection in script.js), which
    // survives any class changes.  Removing section-open would strip the
    // CSS scroll-lock (touch-action:none + overscroll-behavior:none), letting
    // the home page rubber-band through the viewer on mobile.  So we keep
    // section-open AND layer the viewer's own lock on top.
    // Also ensure touch-action is locked at the inline level:
    document.body.style.touchAction = 'none';
    document.body.style.overscrollBehavior = 'none';

    // Helper: read the saved scroll offset from body.style.top
    function _readSectionScrollY() {
      var t = document.body.style.top;
      if (t && t.charAt(0) === '-') {
        var n = parseFloat(t);
        if (!isNaN(n)) return Math.abs(n);
      }
      return 0;
    }

    // Hide any open section modal so the background is clean
    var sectionModal = document.getElementById('section-modal');
    var sectionModalWasOpen = sectionModal && !sectionModal.classList.contains('hidden');
    if (sectionModalWasOpen) {
      sectionModal.classList.add('hidden');
    }

    // Back button
    var backBtn = document.getElementById('dr-mv-back');
    if (backBtn) backBtn.addEventListener('click', function () {
      if (modeArgs && modeArgs.mode) {
        _mvEndMode();
        return;
      }
      _mvClose();
      // Re-open the drawings section modal if it was closed
      if (sectionModalWasOpen && sectionModal) {
        sectionModal.classList.remove('hidden');
      }
      _paint();
    });

    // Escape key closes
    var escHandler = function (e) {
      if (e.key === 'Escape') {
        if (modeArgs && modeArgs.mode) {
          _mvEndMode();
          return;
        }
        _mvClose();
        if (sectionModalWasOpen && sectionModal) {
          sectionModal.classList.remove('hidden');
        }
        _paint();
      }
    };
    document.addEventListener('keydown', escHandler, { signal: window._sectionSignal });

    if (isPdf) {
      // Render PDF first page into the canvas, then init viewer state
      _mvRenderPdf(content, did, pid, div, hadSectionOpen, prevBody, sectionScrollY, escHandler, modeArgs);
      return;
    }

    if (!isImage) return;

    // ── Init markup viewer state ──
    _mv = {
      overlayHost: div,
      projectId: pid,
      drawingId: did,
      sourceDrawingId: (modeArgs && modeArgs.drawingId) || did,
      strokes: [],
      undoStack: [],
      redoStack: [],
      tool: 'pen',
      color: '#e03e3e',
      lineWidth: 3,
      showMarkups: true,
      markupMode: false,  // toolbar hidden until "Markup Drawing" clicked
      zoom: 1,
      panX: 0,
      panY: 0,
      drawing: false,
      startX: 0,
      startY: 0,
      currentStroke: null,
      panning: false,
      panStartX: 0,
      panStartY: 0,
      panOrigX: 0,
      panOrigY: 0,
      textInputActive: false,
      hadSectionOpen: hadSectionOpen,
      _prevBody: prevBody,
      _sectionScrollY: sectionScrollY,
      _escHandler: escHandler,
      mode: modeArgs ? modeArgs.mode : null,
      modeArgs: modeArgs
    };

    _mvLoadAndBind();
  }

  /* ── Toolbar HTML ──────────────────────────────────────────────────────── */
  function _mvToolbarHtml() {
    var tools = [
      { id: 'pen',        icon: '✏️', label: 'Pen' },
      { id: 'highlighter',icon: '🖍️', label: 'Highlighter' },
      { id: 'text',       icon: '💬', label: 'Text' },
      { id: 'rect',       icon: '▭',  label: 'Rectangle' },
      { id: 'ellipse',    icon: '◯',  label: 'Ellipse' },
      { id: 'arrow',      icon: '➤',  label: 'Arrow' },
      { id: 'eraser',     icon: '🧹', label: 'Eraser' }
    ];
    var colors = ['#e03e3e','#f59e0b','#facc15','#22c55e','#3b82f6','#8b5cf6','#1b1f24','#ffffff'];
    var widths = [2, 4, 6, 10];

    var h = [];
    h.push('<div class="dr-mv-toolbar" id="dr-mv-toolbar">');

    // Tool buttons
    h.push('<div class="dr-mv-tool-group" id="dr-mv-tools">');
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      h.push('<button class="dr-mv-tool-btn" data-tool="' + t.id + '" title="' + t.label + '">' + t.icon + '</button>');
    }
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // Colors
    h.push('<div class="dr-mv-tool-group" id="dr-mv-colors">');
    for (var j = 0; j < colors.length; j++) {
      var c = colors[j];
      var outline = c === '#ffffff' ? ' dr-mv-color-outline' : '';
      h.push('<button class="dr-mv-color-btn' + outline + '" data-color="' + c + '" style="background:' + c + ';" title="' + c + '"></button>');
    }
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // Line widths
    h.push('<div class="dr-mv-tool-group" id="dr-mv-widths">');
    for (var k = 0; k < widths.length; k++) {
      var w = widths[k];
      h.push('<button class="dr-mv-width-btn" data-width="' + w + '" title="' + w + 'px"><span class="dr-mv-width-dot" style="width:' + (w+4) + 'px;height:' + (w+4) + 'px;"></span></button>');
    }
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // Undo / Redo
    h.push('<div class="dr-mv-tool-group">');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-undo" title="Undo (Ctrl+Z)">↩</button>');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-redo" title="Redo (Ctrl+Y)">↪</button>');
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // Clean view toggle
    h.push('<div class="dr-mv-tool-group">');
    h.push('<button class="dr-mv-tool-btn dr-mv-toggle-on" id="dr-mv-toggle" title="Toggle markups on/off">👁️ Markups</button>');
    h.push('</div>');

    // ── Zoom controls ──
    h.push('<div class="dr-mv-tool-group" id="dr-mv-zoom-controls">');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-zoomout" title="Zoom Out">🔍−</button>');
    h.push('<div class="dr-mv-zoom-info" id="dr-mv-zoom-label">100%</div>');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-zoomin" title="Zoom In">🔍+</button>');
    h.push('</div>');

    h.push('<div class="dr-mv-sep"></div>');

    // ── Fit mode toggle ──
    h.push('<div class="dr-mv-tool-group">');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-fitmode" title="Fit Mode (Width/Page)">📐 Fit Width</button>');
    h.push('<button class="dr-mv-tool-btn" id="dr-mv-zoomfit" title="Fit to Viewport">↔️ Fit</button>');
    h.push('</div>');

    h.push('</div>');
    return h.join('');
  }

  /* ── Render PDF into the viewer canvas, then init state ───────────────── */
  function _mvRenderPdf(content, did, pid, div, hadSectionOpen, prevBody, sectionScrollY, escHandler, modeArgs) {
    var lib = _ensurePdfJs();
    if (!lib) {
      console.warn('[AlignDrawings] pdf.js not loaded, cannot render PDF');
      return;
    }

    // content is a data URL — convert to arraybuffer
    var parts = content.split(',');
    if (parts.length < 2) {
      console.warn('[AlignDrawings] Invalid data URL for drawing');
      return;
    }
    try {
      var byteString = atob(parts[1]);
    } catch(e) {
      console.warn('[AlignDrawings] Invalid base64 in drawing data:', e.message);
      return;
    }
    var bytes = new Uint8Array(byteString.length);
    for (var i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }

    // Check cache — reuse pdfDoc if same drawing already loaded
    if (_mv && _mv._pdfDoc && _mv._pdfDocId === did) {
      _mv._pdfPageNum = 1;
      _mvRerenderPdf();
      return;
    }

    // Destroy any previous doc before loading a new one
    if (_mv && _mv._pdfDoc) { _mv._pdfDoc.destroy(); _mv._pdfDoc = null; }

    lib.getDocument({ data: bytes.buffer.slice(0) }).promise.then(function (pdfDoc) {
      // Store for reuse
      if (_mv) { _mv._pdfDoc = pdfDoc; _mv._pdfDocId = did; }
      var numPages = pdfDoc.numPages;
      _mvBuildPageStrip(numPages);
      return pdfDoc.getPage(1).then(function (page) {
        var canvas = document.getElementById('dr-mv-image');
        if (!canvas) return;
        var viewportEl = document.getElementById('dr-mv-viewport');
        var viewW = viewportEl ? viewportEl.clientWidth : (canvas.parentElement ? canvas.parentElement.clientWidth : 0);
        var viewH = viewportEl ? viewportEl.clientHeight : (canvas.parentElement ? canvas.parentElement.clientHeight : 0);
        // Guard against hidden viewport (element has no layout yet)
        if (viewW <= 0) {
          console.warn('[AlignDrawings] viewport has zero width, deferring render');
          // Retry after layout
          var retryEl = viewportEl || canvas.parentElement;
          if (retryEl) {
            var retryDiv = document.createElement('div');
            retryDiv.style.cssText = 'color:var(--muted);text-align:center;padding:40px;';
            retryDiv.textContent = 'Loading drawing...';
            retryEl.appendChild(retryDiv);
            setTimeout(function() {
              if (retryDiv.parentNode) retryDiv.parentNode.removeChild(retryDiv);
              _mvRenderPdf(content, did, pid, div, hadSectionOpen, prevBody, sectionScrollY, escHandler);
            }, 200);
          }
          return;
        }
        var baseScale = viewW / page.getViewport({ scale: 1 }).width;
        var dpr = _mvDpr();
        // Clamp scale to stay within iOS canvas limits (4096px, 14MP)
        var pageW = page.getViewport({ scale: 1 }).width;
        var pageH = page.getViewport({ scale: 1 }).height;
        baseScale = _clampRenderScale(baseScale, pageW, pageH, dpr);
        // Render at retina resolution using a scaled viewport
        var viewport = page.getViewport({ scale: baseScale * dpr });
        var logW = viewport.width / dpr;
        var logH = viewport.height / dpr;

        // Set canvas backing store to retina resolution
        canvas.width  = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        // CSS size at logical (1x) dimensions
        canvas.style.width  = Math.round(logW) + 'px';
        canvas.style.height = Math.round(logH) + 'px';
        // Sync annotation canvas to same dimensions
        var annCanvas = document.getElementById('dr-mv-canvas');
        if (annCanvas) {
          annCanvas.width  = canvas.width;
          annCanvas.height = canvas.height;
          annCanvas.style.width  = canvas.style.width;
          annCanvas.style.height = canvas.style.height;
        }

        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Cancel any in-flight render before starting new one
        var task = page.render({ canvasContext: ctx, viewport: viewport });
        return task.promise.then(function () {
          // Initialize viewer state
          _mv = {
            _renderTask: task,  // track for cancellation
            overlayHost: div,
            projectId: pid,
            drawingId: did,
            sourceDrawingId: (modeArgs && modeArgs.drawingId) || did,
            strokes: [],
            undoStack: [],
            redoStack: [],
            tool: 'pen',
            color: '#e03e3e',
            lineWidth: 3,
            showMarkups: true,
            markupMode: false,
            zoom: 1,
            _committedZoom: 1,     // zoom at which canvas CSS size was last committed
            panX: 0,
            panY: 0,
            drawing: false,
            startX: 0,
            startY: 0,
            currentStroke: null,
            panning: false,
            panStartX: 0,
            panStartY: 0,
            panOrigX: 0,
            panOrigY: 0,
            textInputActive: false,
            hadSectionOpen: hadSectionOpen,
            _prevBody: prevBody,
            _sectionScrollY: sectionScrollY,
            _escHandler: escHandler,
            // PDF-specific state for crisp zoom re-renders
            _pdfDoc: pdfDoc,
            _pdfPageNum: 1,
            _pdfTargetPageNum: 1,   // synchronous target (avoids page-switch race)
            _pdfNumPages: numPages,
            _pdfBaseScale: baseScale,
            _pdfLogW: logW,
            _pdfLogH: logH,
            _pdfContent: content,
            _fitMode: 'width',  // 'width' or 'page'
            mode: modeArgs ? modeArgs.mode : null,
            modeArgs: modeArgs,
            // Phase 0 viewer state
            _renderedKey: null,     // pageNum@WxH of the last committed backing store
            _rafPending: false,     // touchmove rAF coalescing flag
            _pendingTouches: null,  // latest touch snapshot awaiting rAF
            _specTimer: null,       // debounced mid-gesture speculative render timer
            // Phase 1 tile overlay state
            _tiles: {},             // key -> { canvas, col, row, bucketIdx, rendered, task, lastUse }
            _tileCount: 0,
            _tilePool: [],          // detached canvases for reuse
            _tileUseSeq: 0,         // LRU counter
            _tileEpoch: 0,          // invalidation counter (per-tile render guard)
            _tilesActive: false,
            _tileBucketIdx: -1,
            _tilePageNum: 0,
            _tileQueue: [],
            _tileRendering: 0,
            _tileUpdateTimer: null
          };

          _loadMarkups(pid, did).then(function (strokes) {
            _mv.strokes = strokes || [];
            _mv.undoStack = [];
            _mv.redoStack = [];
            _mvBindAll();
            requestAnimationFrame(function () {
              _mvFitToViewport();
              _mvSyncCanvas();
              // Apply restore opts (reopening after a content-process kill)
              if (_mvRestoreOpts) {
                var r = _mvRestoreOpts;
                _mvRestoreOpts = null;
                if (_mv._pdfDoc && r.page && r.page >= 1 && r.page <= _mv._pdfNumPages) {
                  _mv._pdfPageNum = r.page;
                  _mv._pdfTargetPageNum = r.page;
                }
                if (r.zoom) _mv.zoom = Math.max(MV_ZOOM_MIN, Math.min(MV_ZOOM_MAX, r.zoom));
                if (typeof r.panX === 'number') _mv.panX = r.panX;
                if (typeof r.panY === 'number') _mv.panY = r.panY;
                _mvApplyTransform();
                _mvUpdateToolbarUI();
                if (_mv._pdfDoc) _mvRerenderPdf();
              }
              // Pre-render adjacent pages for instant page turning
              _mvStartMode();
            });
          });
        });
      });
    }).catch(function (err) {
      console.warn('[AlignDrawings] PDF render failed:', err);
      // Show error in the viewer so user knows what happened
      var canvas = document.getElementById('dr-mv-image');
      if (canvas && canvas.parentElement) {
        canvas.style.display = 'none';
        var errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:var(--danger);text-align:center;padding:40px;';
        errDiv.textContent = 'Failed to render PDF: ' + (err.message || 'Unknown error');
        canvas.parentElement.appendChild(errDiv);
      }
    });
  }

  /* ── Load markups + bind all events ────────────────────────────────────── */
  function _mvLoadAndBind() {
    _loadMarkups(_mv.projectId, _mv.drawingId).then(function (strokes) {
      _mv.strokes = strokes || [];
      _mv.undoStack = [];
      _mv.redoStack = [];
      _mvBindAll();
      // Wait for image to load, then fit-to-viewport + sync canvas
      var img = document.getElementById('dr-mv-image');
      function _onImgReady() {
        // Use rAF so the browser has laid out the viewport (clientWidth/Height > 0)
        requestAnimationFrame(function () {
          _mvFitToViewport();
          _mvSyncCanvas();
          _mvStartMode();
        });
      }
      if (img) {
        if (img.complete && img.naturalWidth > 0) {
          // Already loaded and decoded
          _onImgReady();
        } else if (img.decode) {
          // Modern browsers: decode() handles data URIs correctly
          // (img.complete may be true for data URIs but naturalWidth still 0)
          img.decode().then(_onImgReady).catch(function () {
            // Fallback: if decode fails, poll then try load event
            if (img.complete && img.naturalWidth) _onImgReady();
            else img.addEventListener('load', _onImgReady, { once: true });
          });
        } else {
          // Older browsers: fallback to load event
          img.addEventListener('load', _onImgReady, { once: true });
        }
      }
    });
  }

  /* ── List-map mode: crop authoring + pin placement (driven from Punchlist) ── */
  var _mvPinOverlaySubscribed = false;
  function _mvInitPinOverlay() {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas || !_mv || !window.PinOverlay) return;
    try {
      var stage = document.getElementById('dr-mv-stage');
      var overlayHost = (stage && stage.parentElement) ? stage.parentElement : canvas.parentElement;
      window.PinOverlay.init(canvas, _mv.sourceDrawingId || _mv.drawingId, overlayHost);
      if (_mv._pdfDoc) window.PinOverlay.updateSheet(Math.max(0, (_mv._pdfPageNum || 1) - 1));
      if (!_mvPinOverlaySubscribed) {
        _mvPinOverlaySubscribed = true;
        _mvOnTransformChanged(function () { if (window.PinOverlay) window.PinOverlay.updateTransform(); });
      }
      window.PinOverlay.updateTransform();
    } catch (e) {
      console.warn('[AlignDrawings] Pin overlay init failed:', e);
    }
  }

  function _mvSyncPinOverlaySize() {
    if (!window.PinOverlay || !window.PinOverlay.overlay) return;
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return;
    window.PinOverlay.overlay.style.width = canvas.style.width || (canvas.width + 'px');
    window.PinOverlay.overlay.style.height = canvas.style.height || (canvas.height + 'px');
  }

  function _mvStartMode() {
    if (!_mv) return;
    if (_mv.mode === 'list-crop') { _mvStartCrop(); return; }
    if (_mv.mode === 'list-pin' || _mv.mode === 'list-layout') { _mvStartPin(); return; }
    // Normal viewing: show pins read-only
    _mvInitPinOverlay();
  }

  function _mvStartCrop() {
    var args = _mv.modeArgs || {};
    var stage = document.getElementById('dr-mv-stage');
    var canvas = document.getElementById('dr-mv-canvas');
    if (!stage || !canvas || !window.DrawingCropTool) return;

    var markupToggle = document.getElementById('dr-mv-markup-toggle');
    if (markupToggle) markupToggle.style.display = 'none';
    var backBtn = document.getElementById('dr-mv-back');
    if (backBtn) backBtn.textContent = '← Cancel';

    _cropTool = window.DrawingCropTool.create({
      overlayHost: stage,
      getCanvas: function () { return document.getElementById('dr-mv-canvas'); },
      controlsHost: document.body,
      clientToNormalized: _mvScreenToNormalized,
      normalizedToClient: _mvNormalizedToClient,
      requestPan: _mvPanByClientDelta,
      onTransformChanged: _mvOnTransformChanged,
      onComplete: _mvSaveCrop,
      onCancel: _mvEndMode
    });
  }

  function _mvSaveCrop(vertices) {
    var args = _mv.modeArgs || {};
    var token = localStorage.getItem('align-token') || '';
    var body = {
      drawingId: args.drawingId,
      sheetNumber: args.sheet || 0,
      cropMode: 'polygon',
      vertices: vertices
    };
    fetch('/api/projects/' + encodeURIComponent(args.projectId) + '/punchlist-lists/' + encodeURIComponent(args.listId) + '/crop', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.data && res.data.error || 'Save failed');
      _mvClose();
      if (args.onSaved) args.onSaved(res.data.crop);
    }).catch(function (err) {
      _mvFlashBoundary('Failed to save crop: ' + (err && err.message || err));
    });
  }

  function _mvStartPin() {
    var args = _mv.modeArgs || {};
    var isCropImage = !!(args.cropRenderStatus === 'ready' && args.cropImage && args.cropRenderMeta);
    if (isCropImage) {
      // Rendered crop document (white bg + header): no clip, no zoom-to-crop —
      // the image already IS the cropped document.
      _mv.cropDocMeta = args.cropRenderMeta;
      _mvApplyWhiteBackground();
    } else {
      var hasCrop = args.cropMode === 'polygon' && Array.isArray(args.vertices) && args.vertices.length >= 3;
      if (hasCrop) {
        _mvApplyListClip(args.vertices);
        _mvZoomToCrop(args.vertices);
      }
    }
    // Set the pin-overlay coordinate mapper (full-sheet normalized -> document normalized).
    if (window.PinOverlay) {
      window.PinOverlay.coordMapper = _mv.cropDocMeta
        ? function (nx, ny) { return _mvSheetToDocNormalized(nx, ny); }
        : null;
    }
    _mvInitPinOverlay();
    var markupToggle = document.getElementById('dr-mv-markup-toggle');
    if (markupToggle) markupToggle.style.display = 'none';
    var backBtn = document.getElementById('dr-mv-back');
    if (backBtn) backBtn.textContent = (_mv.mode === 'list-layout') ? '← Back' : '← Cancel';
  }

  // Convert a full-sheet normalized point to crop-document normalized (0-1).
  function _mvSheetToDocNormalized(nx, ny) {
    var m = _mv && _mv.cropDocMeta;
    if (!m) return { x: nx, y: ny };
    var sheetX = nx * m.sheetWidth, sheetY = ny * m.sheetHeight;
    var docX = m.document.drawingLeft + (sheetX - m.bbox.x);
    var docY = m.document.drawingTop + (sheetY - m.bbox.y);
    return { x: docX / m.document.width, y: docY / m.document.height };
  }

  function _mvApplyWhiteBackground() {
    ['dr-mv-overlay-host', 'dr-mv-viewport', 'dr-mv-stage'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.background = '#ffffff';
    });
  }

  function _mvApplyListClip(vertices) {
    var stage = document.getElementById('dr-mv-stage');
    if (!stage) return;
    var css = vertices.map(function (p) { return (p.x * 100) + '% ' + (p.y * 100) + '%'; }).join(', ');
    stage.style.clipPath = 'polygon(' + css + ')';
    stage.style.webkitClipPath = 'polygon(' + css + ')';
  }

  // Normalized bounding box of a crop polygon (rejects invalid/degenerate).
  function _mvCropBounds(vertices) {
    if (!vertices || vertices.length < 3) return null;
    var minX = 1, minY = 1, maxX = 0, maxY = 0, count = 0;
    for (var i = 0; i < vertices.length; i++) {
      var x = Number(vertices[i].x), y = Number(vertices[i].y);
      if (!isFinite(x) || !isFinite(y)) continue;
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      count++;
    }
    if (count < 3 || maxX <= minX || maxY <= minY) return null;
    return {
      minX: minX, minY: minY, maxX: maxX, maxY: maxY,
      width: maxX - minX, height: maxY - minY,
      centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2
    };
  }

  // Zoom + center the view on the crop polygon's bounding box (high-quality).
  function _mvZoomToCrop(vertices) {
    var bounds = _mvCropBounds(vertices);
    if (!bounds) return false;
    var vp = document.getElementById('dr-mv-viewport');
    if (!vp) return false;
    var vw = vp.clientWidth, vh = vp.clientHeight;
    if (!vw || !vh) return false;

    var isPdf = !!_mv._pdfDoc;
    var sheetW, sheetH;
    if (isPdf) {
      sheetW = _mv._pdfLogW; sheetH = _mv._pdfLogH;
    } else {
      var img = document.getElementById('dr-mv-image');
      if (!img) return false;
      sheetW = img.naturalWidth || img.clientWidth;
      sheetH = img.naturalHeight || img.clientHeight;
    }
    if (!sheetW || !sheetH) return false;

    var cropW = bounds.width * sheetW;
    var cropH = bounds.height * sheetH;
    if (cropW <= 0 || cropH <= 0) return false;

    var pad = 0.05;
    var usableW = vw * (1 - pad * 2);
    var usableH = vh * (1 - pad * 2);
    var wantedZoom = Math.min(usableW / cropW, usableH / cropH);
    var zoom = Math.max(MV_ZOOM_MIN, Math.min(MV_ZOOM_MAX, wantedZoom));

    var cropCenterSheetX = bounds.centerX * sheetW;
    var cropCenterSheetY = bounds.centerY * sheetH;

    _mv.zoom = zoom;
    _mv.panX = vw / 2 - cropCenterSheetX * zoom;
    _mv.panY = vh / 2 - cropCenterSheetY * zoom;

    // Make the stage's border box match the drawing so clip-path percentages
    // resolve against the drawing, not the viewport width. (Without this the
    // stage collapses to viewport width and the crop clip is misaligned.)
    var stage = document.getElementById('dr-mv-stage');
    if (stage) {
      stage.style.width = (isPdf ? sheetW * zoom : sheetW) + 'px';
      stage.style.height = (isPdf ? sheetH * zoom : sheetH) + 'px';
    }

    if (isPdf) {
      _mvCommitZoomCss();
      _mvRerenderPdf();
    } else {
      _mvApplyTransform();
    }
    _mvUpdateToolbarUI();
    return true;
  }

  function _mvPlacePin(clientX, clientY) {
    var args = _mv.modeArgs || {};
    var p = _mvScreenToNormalized(clientX, clientY);
    // When showing the rendered crop document, convert document-normalized
    // back to full-sheet normalized (the storage/API coordinate space).
    if (_mv.cropDocMeta) {
      var m = _mv.cropDocMeta;
      var docX = p.x * m.document.width, docY = p.y * m.document.height;
      var sheetX = m.bbox.x + (docX - m.document.drawingLeft);
      var sheetY = m.bbox.y + (docY - m.document.drawingTop);
      p = { x: sheetX / m.sheetWidth, y: sheetY / m.sheetHeight };
    }
    if (args.cropMode === 'polygon' && args.vertices && args.vertices.length >= 3) {
      if (!_pointInPolygon(p.x, p.y, args.vertices)) {
        _mvFlashBoundary('Place the pin inside the mapped area.');
        return;
      }
    }
    var token = localStorage.getItem('align-token') || '';
    var uid = 'system';
    try {
      if (window.AlignAuth && window.AlignAuth.getActiveUser) uid = window.AlignAuth.getActiveUser().id || 'system';
    } catch (e) {}
    var body = { sheet: args.sheet || 0, x: p.x, y: p.y, projectId: args.projectId, userId: uid };
    fetch('/api/drawings/' + encodeURIComponent(args.drawingId) + '/punch-items/' + encodeURIComponent(args.itemId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.data && res.data.error || 'Pin failed');
      _mvClose();
      if (args.onPlaced) args.onPlaced({ x: p.x, y: p.y });
    }).catch(function (err) {
      _mvFlashBoundary(err && err.message || 'Failed to place pin');
    });
  }

  function _mvFlashBoundary(msg) {
    var stage = document.getElementById('dr-mv-stage');
    if (stage) {
      stage.style.outline = '3px solid #ef4444';
      setTimeout(function () { if (stage) stage.style.outline = ''; }, 600);
    }
    var ghost = document.createElement('div');
    ghost.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;z-index:99999;pointer-events:none;';
    ghost.textContent = msg;
    document.body.appendChild(ghost);
    setTimeout(function () { ghost.remove(); }, 1800);
  }

  function _mvEndMode() {
    if (_cropTool) { try { _cropTool.destroy(); } catch (e) {} _cropTool = null; }
    _mvPinDown = null;
    var args = _mv && _mv.modeArgs;
    _mvClose();
    if (args && args.onCancel) args.onCancel();
  }

  function _mvBindAll() {
    // Tool selection
    var toolBtns = document.querySelectorAll('#dr-mv-tools .dr-mv-tool-btn');
    toolBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _mv.tool = btn.getAttribute('data-tool');
        _mvUpdateToolbarUI();

        // If eraser is selected, clear text-input flag
        if (_mv.tool === 'eraser') { _mv.textInputActive = false; }

        // Change cursor (only matters when markup mode is active)
        var canvas = document.getElementById('dr-mv-canvas');
        if (canvas && _mv.markupMode) {
          if (_mv.tool === 'eraser') canvas.style.cursor = 'crosshair';
          else if (_mv.tool === 'text') canvas.style.cursor = 'text';
          else canvas.style.cursor = 'crosshair';
        }
      });
    });

    // Color selection
    var colorBtns = document.querySelectorAll('#dr-mv-colors .dr-mv-color-btn');
    colorBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _mv.color = btn.getAttribute('data-color');
        _mvUpdateToolbarUI();
      });
    });

    // Width selection
    var widthBtns = document.querySelectorAll('#dr-mv-widths .dr-mv-width-btn');
    widthBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        _mv.lineWidth = parseInt(btn.getAttribute('data-width'), 10);
        _mvUpdateToolbarUI();
      });
    });

    // Undo / Redo
    var undoBtn = document.getElementById('dr-mv-undo');
    var redoBtn = document.getElementById('dr-mv-redo');
    if (undoBtn) undoBtn.addEventListener('click', function () { _mvUndo(); });
    if (redoBtn) redoBtn.addEventListener('click', function () { _mvRedo(); });

    // Keyboard: Ctrl+Z, Ctrl+Y
    document.addEventListener('keydown', _mvKeyHandler, { signal: window._sectionSignal });

    // ── Zoom buttons ──
    var zoomIn  = document.getElementById('dr-mv-zoomin');
    var zoomOut = document.getElementById('dr-mv-zoomout');
    var zoomFit = document.getElementById('dr-mv-zoomfit');
    var fitMode = document.getElementById('dr-mv-fitmode');
    if (zoomIn) zoomIn.addEventListener('click', function () {
      _mv.zoom = Math.min(MV_ZOOM_MAX, _mv.zoom * 1.2);
      _mvApplyTransform();
      _mvUpdateToolbarUI();
      _mvRerenderPdf();
    });
    if (zoomOut) zoomOut.addEventListener('click', function () {
      _mv.zoom = Math.max(MV_ZOOM_MIN, _mv.zoom / 1.2);
      _mvApplyTransform();
      _mvUpdateToolbarUI();
      _mvRerenderPdf();
    });
    if (zoomFit) zoomFit.addEventListener('click', function () {
      _mvFitToViewport();
    });
    if (fitMode) fitMode.addEventListener('click', function () {
      _mv._fitMode = (_mv._fitMode === 'width') ? 'page' : 'width';
      fitMode.textContent = (_mv._fitMode === 'width') ? '📐 Fit Width' : '📐 Fit Page';
      _mvFitToViewport();
    });

    // ── "Markup Drawing" toggle button (shows/hides toolbar with animation) ──
    var markupToggle = document.getElementById('dr-mv-markup-toggle');
    if (markupToggle) {
      markupToggle.addEventListener('click', function () {
        _mv.markupMode = !_mv.markupMode;
        var toolbar = document.getElementById('dr-mv-toolbar');
        var canvas = document.getElementById('dr-mv-canvas');
        if (toolbar) {
          if (_mv.markupMode) {
            toolbar.classList.add('open');
            markupToggle.classList.add('active');
            markupToggle.innerHTML = '✏️ Hide Tools';
            if (canvas) canvas.style.cursor = 'crosshair';
          } else {
            toolbar.classList.remove('open');
            markupToggle.classList.remove('active');
            markupToggle.innerHTML = '✏️ Markup Drawing';
            if (canvas) canvas.style.cursor = 'grab';
            // Cancel any in-progress drawing
            _mv.drawing = false;
            _mv.currentStroke = null;
          }
        }
        _mvSyncCanvas();
      });
    }

    // Clean view toggle
    var toggleBtn = document.getElementById('dr-mv-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        _mv.showMarkups = !_mv.showMarkups;
        _mvUpdateToolbarUI();
        _mvRedraw();
      });
    }

    // Canvas mouse/touch events
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return;

    canvas.addEventListener('mousedown', _mvMouseDown);
    canvas.addEventListener('mousemove', _mvMouseMove);
    canvas.addEventListener('mouseup', _mvMouseUp);
    canvas.addEventListener('mouseleave', _mvMouseUp);
    canvas.addEventListener('wheel', _mvWheel, { passive: false });

    canvas.addEventListener('touchstart', _mvTouchStart, { passive: false });
    canvas.addEventListener('touchmove', _mvTouchMove, { passive: false });
    canvas.addEventListener('touchend', _mvTouchEnd, { passive: false });

    // Also bind wheel + touch to viewport so zoom/pan work on the whole area
    var viewport = document.getElementById('dr-mv-viewport');
    if (viewport) {
      viewport.addEventListener('wheel', _mvWheel, { passive: false });
      viewport.addEventListener('touchstart', _mvTouchStart, { passive: false });
      viewport.addEventListener('touchmove', _mvTouchMove, { passive: false });
      viewport.addEventListener('touchend', _mvTouchEnd, { passive: false });
    }

    // Also bind wheel to the overlay host so zoom works everywhere in the viewer
    var host = document.getElementById('dr-mv-overlay-host');
    if (host) {
      host.addEventListener('wheel', _mvWheel, { passive: false });
    }

    // Initial toolbar UI
    _mvUpdateToolbarUI();

    // ── Inject annotation tools (Link, Image Stamp, Punchlist Pin, RFI Pin) ──
    var toolbar = document.getElementById('dr-mv-toolbar');
    if (toolbar && window.AlignDrawingAnnotations) {
      window.AlignDrawingAnnotations.init(_mv.projectId, _mv.drawingId);
      window.AlignDrawingAnnotations.injectToolbarButtons(toolbar);
    }

    // Resize observer
    _mvSyncCanvas();
    window.addEventListener('resize', _mvSyncCanvas, { signal: window._sectionSignal });
  }

  /* ── Fit image to viewport on first open ───────────────────────────────── */
  function _mvFitToViewport(attempt) {
    attempt = attempt || 0;
    var vp = document.getElementById('dr-mv-viewport');
    if (!vp) return;

    // For PDF: use stored logical dimensions
    var iw, ih;
    if (_mv._pdfDoc) {
      iw = _mv._pdfLogW;
      ih = _mv._pdfLogH;
    } else {
      var img = document.getElementById('dr-mv-image');
      if (!img) return;
      iw = img.naturalWidth || img.clientWidth;
      ih = img.naturalHeight || img.clientHeight;
    }

    if (!iw || !ih) return;
    var vw = vp.clientWidth;
    var vh = vp.clientHeight;
    // If viewport still has no size, retry after layout (up to 5 attempts)
    if ((!vw || !vh) && attempt < 5) {
      requestAnimationFrame(function () { _mvFitToViewport(attempt + 1); });
      return;
    }
    if (!vw || !vh) return;
    // Fit with 4% padding so the drawing is fully visible
    var scale;
    if (_mv._fitMode === 'page') {
      scale = Math.min((vw * 0.96) / iw, (vh * 0.96) / ih);
    } else {
      // 'width' mode: fit to width
      scale = (vw * 0.96) / iw;
    }
    _mv.zoom = Math.max(MV_ZOOM_MIN, Math.min(MV_ZOOM_MAX, scale));
    _mv.panX = (vw - iw * _mv.zoom) / 2;
    _mv.panY = (vh - ih * _mv.zoom) / 2;
    _mvApplyTransform();
    _mvUpdateToolbarUI();
    // Initial render already fills the canvas at fit width — no need to re-render
    if (_mv._pdfDoc && _mv.zoom !== scale) _mvRerenderPdf();
  }

  /* ── Canvas sizing ─────────────────────────────────────────────────────── */
  function _mvSyncCanvas() {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return;

    // PDF: the render pipeline owns the annotation canvas backing + CSS size.
    // Do NOT touch them here (a manual write would desync _committedZoom and
    // cause double-scaling). Delegate to the commit path.
    if (_mv._pdfDoc) {
      _mvCommitZoomCss();
      _mvRedraw();
      return;
    }

    // Image: use natural dimensions
    var img = document.getElementById('dr-mv-image');
    if (!img) return;
    var w = img.naturalWidth || img.clientWidth;
    var h = img.naturalHeight || img.clientHeight;

    if (w && h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    _mvRedraw();
  }

  /* ── Redraw all strokes onto canvas ────────────────────────────────────── */
  function _mvRedraw() {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!_mv.showMarkups) return; // clean view

    var strokes = _mv.strokes;
    for (var i = 0; i < strokes.length; i++) {
      _mvDrawStroke(ctx, strokes[i]);
    }

    // Also draw current in-progress stroke
    if (_mv.currentStroke) {
      _mvDrawStroke(ctx, _mv.currentStroke);
    }

    // ── Render annotations (links, images, punchlist pins, RFI pins) ──
    if (window.AlignDrawingAnnotations) {
      window.AlignDrawingAnnotations.renderAnnotations(ctx, _mv.zoom, _mv.panX, _mv.panY, canvas.width, canvas.height);
    }
  }

  function _mvDrawStroke(ctx, s) {
    if (!s || !s.points || s.points.length === 0) return;

    ctx.save();

    if (s.tool === 'highlighter') {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = s.color || '#facc15';
      ctx.lineWidth = (s.lineWidth || 4) * 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      _mvStrokePath(ctx, s.points);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (s.tool === 'eraser') {
      // Eraser strokes are rendered as white/background to visually "remove"
      // When toggling markups off/on, erased strokes reappear clean
      // They're stored as tool:'eraser' and only used when showMarkups is on
      ctx.globalAlpha = 0.01; // effectively invisible — eraser tool deletes, not covers
      return;
    }

    if (s.tool === 'text') {
      ctx.restore();
      if (s.text && s.points.length >= 1) {
        var p0 = s.points[0];
        ctx.font = 'bold ' + Math.max(14, (s.lineWidth || 3) * 5) + 'px system-ui, sans-serif';
        ctx.fillStyle = s.color || '#1b1f24';
        ctx.fillText(s.text, p0.x, p0.y);
      }
      return;
    }

    if (s.tool === 'rect') {
      ctx.restore();
      if (s.points.length >= 2) {
        var a = s.points[0], b = s.points[s.points.length - 1];
        var rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y);
        var rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
        ctx.strokeStyle = s.color || '#e03e3e';
        ctx.lineWidth = s.lineWidth || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeRect(rx, ry, rw, rh);
      }
      return;
    }

    if (s.tool === 'ellipse') {
      ctx.restore();
      if (s.points.length >= 2) {
        var ea = s.points[0], eb = s.points[s.points.length - 1];
        var cx = (ea.x + eb.x) / 2, cy = (ea.y + eb.y) / 2;
        var rxx = Math.abs(eb.x - ea.x) / 2, ryy = Math.abs(eb.y - ea.y) / 2;
        ctx.strokeStyle = s.color || '#3b82f6';
        ctx.lineWidth = s.lineWidth || 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(rxx, 0.5), Math.max(ryy, 0.5), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }

    if (s.tool === 'arrow') {
      ctx.restore();
      if (s.points.length >= 2) {
        var aa = s.points[0], ab = s.points[s.points.length - 1];
        ctx.strokeStyle = s.color || '#1b1f24';
        ctx.lineWidth = s.lineWidth || 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(aa.x, aa.y);
        ctx.lineTo(ab.x, ab.y);
        ctx.stroke();
        // Arrowhead
        var angle = Math.atan2(ab.y - aa.y, ab.x - aa.x);
        var headLen = (s.lineWidth || 3) * 5 + 6;
        ctx.fillStyle = s.color || '#1b1f24';
        ctx.beginPath();
        ctx.moveTo(ab.x, ab.y);
        ctx.lineTo(ab.x - headLen * Math.cos(angle - 0.5), ab.y - headLen * Math.sin(angle - 0.5));
        ctx.lineTo(ab.x - headLen * Math.cos(angle + 0.5), ab.y - headLen * Math.sin(angle + 0.5));
        ctx.closePath();
        ctx.fill();
      }
      return;
    }

    // Default: pen (freehand)
    ctx.strokeStyle = s.color || '#e03e3e';
    ctx.lineWidth = s.lineWidth || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    _mvStrokePath(ctx, s.points);
    ctx.stroke();
    ctx.restore();
  }

  function _mvStrokePath(ctx, points) {
    if (points.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
  }

  /* ── Update toolbar active states ──────────────────────────────────────── */
  function _mvUpdateToolbarUI() {
    // Active tool
    var toolBtns = document.querySelectorAll('#dr-mv-tools .dr-mv-tool-btn');
    toolBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === _mv.tool);
    });

    // Active color
    var colorBtns = document.querySelectorAll('#dr-mv-colors .dr-mv-color-btn');
    colorBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-color') === _mv.color);
    });

    // Active width
    var widthBtns = document.querySelectorAll('#dr-mv-widths .dr-mv-width-btn');
    widthBtns.forEach(function (b) {
      b.classList.toggle('active', parseInt(b.getAttribute('data-width'), 10) === _mv.lineWidth);
    });

    // Toggle button
    var toggleBtn = document.getElementById('dr-mv-toggle');
    if (toggleBtn) {
      if (_mv.showMarkups) {
        toggleBtn.textContent = '👁️ Markups';
        toggleBtn.classList.add('dr-mv-toggle-on');
        toggleBtn.classList.remove('dr-mv-toggle-off');
      } else {
        toggleBtn.textContent = '🚫 Clean';
        toggleBtn.classList.add('dr-mv-toggle-off');
        toggleBtn.classList.remove('dr-mv-toggle-on');
      }
    }

    // Zoom label
    var zoomLabel = document.getElementById('dr-mv-zoom-label');
    if (zoomLabel) {
      zoomLabel.textContent = Math.round(_mv.zoom * 100) + '%';
    }
  }

  /* ── Mouse handlers ────────────────────────────────────────────────────── */
  function _mvGetPos(e) {
    var canvas = document.getElementById('dr-mv-canvas');
    if (!canvas) return { x: 0, y: 0 };
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / _mv.zoom,
      y: (e.clientY - rect.top) / _mv.zoom
    };
  }

  function _mvMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle-click or Alt+Left = pan (always works)
      _mv.panning = true;
      _mv.panStartX = e.clientX;
      _mv.panStartY = e.clientY;
      _mv.panOrigX = _mv.panX;
      _mv.panOrigY = _mv.panY;
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    // ── List-map mode routing (crop authoring / pin placement) ──
    if (_mv.mode === 'list-crop' && _cropTool) {
      e.preventDefault();
      _cropTool.pointerDown(e.clientX, e.clientY);
      return;
    }
    if (_mv.mode === 'list-pin' || _mv.mode === 'list-layout') {
      e.preventDefault();
      _mvPinDown = { x: e.clientX, y: e.clientY, moved: false, lastX: e.clientX, lastY: e.clientY };
      return;
    }

    // ── Annotation tool handling (place pins, links, images) ──
    if (window.AlignDrawingAnnotations && window.AlignDrawingAnnotations.isAnnotationToolActive()) {
      e.preventDefault();
      var annoPos = _mvGetPos(e);
      window.AlignDrawingAnnotations.placeAnnotation(annoPos.x, annoPos.y, function () {
        _mvRedraw();
      });
      return;
    }

    // ── Annotation click detection (when NOT in markup mode or annotation tool) ──
    if (!_mv.markupMode && window.AlignDrawingAnnotations) {
      var clickPos = _mvGetPos(e);
      var hit = window.AlignDrawingAnnotations.hitTest(
        e.clientX - document.getElementById('dr-mv-canvas').getBoundingClientRect().left,
        e.clientY - document.getElementById('dr-mv-canvas').getBoundingClientRect().top,
        _mv.zoom, _mv.panX, _mv.panY
      );
      if (hit) {
        e.preventDefault();
        window.AlignDrawingAnnotations.handleClick(hit);
        return;
      }
    }

    // Drawing tools only work when markup mode is active
    if (!_mv.markupMode) return;

    var pos = _mvGetPos(e);

    if (_mv.tool === 'text') {
      // Place a text annotation
      _mvPushUndo();
      _mvPlaceText(pos);
      return;
    }

    if (_mv.tool === 'eraser') {
      _mvEraseAt(pos);
      return;
    }

    // Start drawing
    _mv.drawing = true;
    _mv.startX = pos.x;
    _mv.startY = pos.y;

    // For rect/ellipse/arrow, we keep just start+current; for pen, multiple points
    if (_mv.tool === 'rect' || _mv.tool === 'ellipse' || _mv.tool === 'arrow') {
      _mvPushUndo();
      _mv.currentStroke = { tool: _mv.tool, color: _mv.color, lineWidth: _mv.lineWidth, points: [{ x: pos.x, y: pos.y }] };
    }
  }

  function _mvMouseMove(e) {
    if (_mv.panning) {
      _mv.panX = _mv.panOrigX + (e.clientX - _mv.panStartX);
      _mv.panY = _mv.panOrigY + (e.clientY - _mv.panStartY);
      _mvApplyTransform();
      return;
    }
    if (_mv.mode === 'list-crop' && _cropTool) {
      _cropTool.pointerMove(e.clientX, e.clientY);
      return;
    }
    if (_mv.mode === 'list-pin' || _mv.mode === 'list-layout') {
      if (_mvPinDown) {
        var pdx = e.clientX - _mvPinDown.x, pdy = e.clientY - _mvPinDown.y;
        if (!_mvPinDown.moved && Math.sqrt(pdx * pdx + pdy * pdy) > 10) {
          _mvPinDown.moved = true;
          _mvPinDown.lastX = e.clientX;
          _mvPinDown.lastY = e.clientY;
          return;
        }
        if (_mvPinDown.moved) {
          var mdx = e.clientX - _mvPinDown.lastX, mdy = e.clientY - _mvPinDown.lastY;
          _mvPinDown.lastX = e.clientX;
          _mvPinDown.lastY = e.clientY;
          _mvPanByClientDelta(mdx, mdy);
        }
      }
      return;
    }
    if (!_mv.drawing || !_mv.markupMode) return;

    var pos = _mvGetPos(e);

    if (_mv.tool === 'pen' || _mv.tool === 'highlighter') {
      if (!_mv.currentStroke) {
        _mvPushUndo();
        _mv.currentStroke = { tool: _mv.tool, color: _mv.color, lineWidth: _mv.lineWidth, points: [] };
      }
      _mv.currentStroke.points.push({ x: pos.x, y: pos.y });
    } else if (_mv.tool === 'rect' || _mv.tool === 'ellipse' || _mv.tool === 'arrow') {
      // Update end point
      if (_mv.currentStroke) {
        if (_mv.currentStroke.points.length > 1) _mv.currentStroke.points.pop();
        _mv.currentStroke.points.push({ x: pos.x, y: pos.y });
      }
    } else if (_mv.tool === 'eraser') {
      _mvEraseAt(pos);
    }

    _mvRedraw();
  }

  function _mvMouseUp(e) {
    if (_mv.panning) {
      _mv.panning = false;
      return;
    }
    if (_mv.mode === 'list-crop' && _cropTool) {
      _cropTool.pointerUp(e.clientX, e.clientY);
      return;
    }
    if (_mv.mode === 'list-pin' || _mv.mode === 'list-layout') {
      if (_mvPinDown) {
        if (!_mvPinDown.moved && _mv.mode === 'list-pin') {
          _mvPlacePin(e.clientX, e.clientY);
        }
        _mvPinDown = null;
      }
      return;
    }
    if (!_mv.drawing) return;
    _mv.drawing = false;

    if (_mv.currentStroke && _mv.currentStroke.points.length > 0) {
      _mv.strokes.push(_mv.currentStroke);
      _mv.currentStroke = null;
      _mvPersist();
      _mvRedraw();
    } else {
      _mv.currentStroke = null;
    }
  }

  /* ── Touch handlers (single-finger draw, two-finger pan + pinch-zoom) ─── */
  function _mvTouchStart(e) {
    e.stopPropagation();
    if (e.touches.length === 2) {
      // A second finger landed — cancel any in-flight crop/pin gesture.
      _mvPinDown = null;
      if (_mv.mode === 'list-crop' && _cropTool) { try { _cropTool.pointerCancel(); } catch (err) {} }
      // Two-finger: record center + initial distance for pan/pinch detection
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      _mv._pinchDist0 = Math.sqrt(dx * dx + dy * dy);
      _mv._pinchZoom0 = _mv.zoom;
      _mv._pinchPanX0 = _mv.panX;
      _mv._pinchPanY0 = _mv.panY;
      _mv._pinchCX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      _mv._pinchCY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      _mv._pinching = false;   // undecided yet
      _mv._twoFinger = true;
      _mv.panning = true;
      _mv.panStartX = _mv._pinchCX;
      _mv.panStartY = _mv._pinchCY;
      _mv.panOrigX = _mv.panX;
      _mv.panOrigY = _mv.panY;
      if (e.cancelable) e.preventDefault();
      return;
    }
    if (e.touches.length === 1) {
      var fake = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, button: 0, preventDefault: function () {}, stopPropagation: function () {} };
      _mvMouseDown(fake);
      if (e.cancelable) e.preventDefault();
    }
  }

  function _mvTouchMove(e) {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    var snap = [];
    for (var i = 0; i < e.touches.length; i++) {
      snap.push({ clientX: e.touches[i].clientX, clientY: e.touches[i].clientY });
    }
    _mv._pendingTouches = snap;
    if (_mv._rafPending) return;   // coalesce to one per frame
    _mv._rafPending = true;
    requestAnimationFrame(function () {
      _mv._rafPending = false;
      if (_mv._pendingTouches) _mvProcessTouchMove(_mv._pendingTouches);
    });
  }

  function _mvProcessTouchMove(touches) {
    if (touches.length === 2 && _mv._twoFinger) {
      var cx = (touches[0].clientX + touches[1].clientX) / 2;
      var cy = (touches[0].clientY + touches[1].clientY) / 2;
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var distRatio = _mv._pinchDist0 > 0 ? dist / _mv._pinchDist0 : 1;

      // Decide pinch vs pan: if distance changed > 8%, it's a pinch
      if (!_mv._pinching && Math.abs(distRatio - 1) > 0.08) {
        _mv._pinching = true;
        // When switching to pinch, freeze the pan offset at current position
        _mv._pinchPanX0 = _mv.panX;
        _mv._pinchPanY0 = _mv.panY;
      }

      if (_mv._pinching) {
        // Pinch-zoom: scale around the CURRENT midpoint of the two fingers
        var newZoom = Math.min(MV_ZOOM_MAX, Math.max(MV_ZOOM_MIN, _mv._pinchZoom0 * distRatio));
        var scale = newZoom / _mv.zoom;
        // Use the current (live) midpoint, not the initial one
        var vp = document.getElementById('dr-mv-viewport');
        if (vp) {
          var vr = vp.getBoundingClientRect();
          var mx = cx - vr.left;
          var my = cy - vr.top;
          _mv.panX = mx - scale * (mx - _mv.panX);
          _mv.panY = my - scale * (my - _mv.panY);
        }
        _mv.zoom = newZoom;
        _mvScheduleSpeculativeRender();   // Step 4: render early if zoom stabilizes
      } else {
        // Two-finger pan (no significant pinch)
        _mv.panX = _mv.panOrigX + (cx - _mv.panStartX);
        _mv.panY = _mv.panOrigY + (cy - _mv.panStartY);
      }
      _mvApplyTransform();
      _mvUpdateToolbarUI();
      return;
    }
    if (touches.length === 1 && !_mv._twoFinger) {
      var fake = { clientX: touches[0].clientX, clientY: touches[0].clientY, preventDefault: function () {}, stopPropagation: function () {} };
      _mvMouseMove(fake);
    }
  }

  function _mvTouchEnd(e) {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault(); // suppress synthetic mouse events after touch (prevents duplicate crop points)
    if (_mv._specTimer) { clearTimeout(_mv._specTimer); _mv._specTimer = null; }
    _mv._pendingTouches = null;
    if (_mv._twoFinger) {
      _mv._twoFinger = false;
      _mv._pinching = false;
      _mv.panning = false;
      // Re-render at final zoom after pinch ends
      _mvRerenderPdf();
      // 2→1 transition: if one finger remains, re-seed the single-finger pan
      // origin so pan continues smoothly from the remaining finger's position.
      if (e.touches && e.touches.length === 1) {
        _mv.panning = true;
        _mv.panStartX = e.touches[0].clientX;
        _mv.panStartY = e.touches[0].clientY;
        _mv.panOrigX = _mv.panX;
        _mv.panOrigY = _mv.panY;
      }
      return;
    }
    var t = e.changedTouches && e.changedTouches[0];
    _mvMouseUp(t ? { clientX: t.clientX, clientY: t.clientY } : {});
  }

  /* ── Page index strip ──────────────────────────────────────────────────── */

  function _mvBuildPageStrip(numPages) {
    var strip = document.getElementById('dr-mv-page-strip');
    if (!strip || numPages <= 1) {
      if (strip) strip.style.display = 'none';
      return;
    }
    strip.style.display = '';
    var h = '';
    for (var i = 1; i <= numPages; i++) {
      h += '<button class="dr-mv-page-btn" data-page="' + i + '">' + i + '</button>';
    }
    strip.innerHTML = h;

    // Delegate click
    strip.addEventListener('click', function(e) {
      var btn = e.target.closest('.dr-mv-page-btn');
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-page'), 10);
      if (!isNaN(n)) _mvRenderPage(n);
    });

    _mvHighlightPage(1);
  }

  function _mvHighlightPage(pageNum) {
    var strip = document.getElementById('dr-mv-page-strip');
    if (!strip) return;
    var btns = strip.querySelectorAll('.dr-mv-page-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', parseInt(btns[i].getAttribute('data-page'), 10) === pageNum);
    }
    // Scroll active into view
    var active = strip.querySelector('.active');
    if (active) {
      active.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    }
  }

  /* ── Zoom (wheel) ──────────────────────────────────────────────────────── */
  function _mvWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!_mv) return;
    // Smooth multiplicative zoom — feels linear
    _mv.zoom = Math.min(MV_ZOOM_MAX, Math.max(MV_ZOOM_MIN,
      _mv.zoom * Math.pow(1.0015, -e.deltaY)));
    // Zoom toward cursor
    var vp = document.getElementById('dr-mv-viewport');
    if (vp) {
      var rect = vp.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var scale = _mv.zoom / (_mv._zoomBeforeWheel || _mv.zoom);
      _mv.panX = mx - scale * (mx - _mv.panX);
      _mv.panY = my - scale * (my - _mv.panY);
    }
    _mv._zoomBeforeWheel = _mv.zoom;
    _mvApplyTransform();
    _mvUpdateToolbarUI();
    // Debounce re-render — only fire after scrolling stops
    clearTimeout(_mvWheelTimer);
    _mvWheelTimer = setTimeout(function() { _mvRerenderPdf(); }, 200);
  }

  function _mvApplyTransform() {
    var stage = document.getElementById('dr-mv-stage');
    if (!stage) return;
    var s;
    if (_mv._pdfDoc) {
      // CSS size is baked at _committedZoom; stage scales the delta only.
      s = _mv.zoom / (_mv._committedZoom || _mv.zoom || 1);
    } else {
      s = _mv.zoom;
    }
    stage.style.transformOrigin = '0 0';
    stage.style.transform = 'translate3d(' + _mv.panX + 'px,' + _mv.panY + 'px,0) scale(' + s + ')';
    _mvNotifyTransformChanged('transform');
    _mvScheduleTiles(100);   // debounced tile refresh on pan/zoom stability
  }

  /* ── Commit canvas CSS size at a zoom point (PDF only). Call ONLY at
     commit points (render complete / gesture end), never per frame. ─────── */
  function _mvCommitZoomCss() {
    if (!_mv._pdfDoc) return;
    var pdfCanvas = document.getElementById('dr-mv-image');
    var markupCanvas = document.getElementById('dr-mv-canvas');
    var cssW = Math.round(_mv._pdfLogW * _mv.zoom) + 'px';
    var cssH = Math.round(_mv._pdfLogH * _mv.zoom) + 'px';
    if (pdfCanvas)    { pdfCanvas.style.width = cssW;    pdfCanvas.style.height = cssH; }
    if (markupCanvas) { markupCanvas.style.width = cssW; markupCanvas.style.height = cssH; }
    _mv._committedZoom = _mv.zoom;
    _mvApplyTransform(); // stage scale collapses back to 1 in the same JS turn
    _mvScheduleTiles(0); // tiles settle immediately at the committed zoom
  }

  /* ── Guarded single-canvas render (prevents races) ──────────────────── */
  var _mvRenderSeq = 0;
  var _mvBackCanvas = null;

  function _mvGetBackCanvas() {
    if (!_mvBackCanvas) _mvBackCanvas = document.createElement('canvas');
    return _mvBackCanvas;
  }

  // Quantize zoom to powers of sqrt(2) so re-renders only fire on bucket crossing.
  // Index-based so tiles have a stable integer cache key.
  function _mvBucketIndex(z) {
    var HALF_LN2 = Math.LN2 / 2;
    var idx = Math.round(Math.log(z) / HALF_LN2);
    var minIdx = Math.ceil(Math.log(MV_ZOOM_MIN) / HALF_LN2 - 1e-9);
    var maxIdx = Math.floor(Math.log(MV_ZOOM_MAX) / HALF_LN2 + 1e-9);
    if (idx < minIdx) idx = minIdx;
    if (idx > maxIdx) idx = maxIdx;
    return idx;
  }
  function _mvBucketFromIndex(idx) { return Math.pow(2, idx / 2); }
  function _mvBucketZoom(z) { return _mvBucketFromIndex(_mvBucketIndex(z)); }

  function _mvRenderPage(pageNum) {
    var seq = ++_mvRenderSeq;
    _mv._pdfTargetPageNum = pageNum; // synchronous target — pinch can't revert a switch
    if (pageNum !== _mv._pdfPageNum) _mvTilesTeardown(); // page change: tiles are per-page
    if (_mv._renderTask) {
      _mv._renderTask.cancel();
      _mv._renderTask.promise.catch(function() {}); // swallow cancel
    }
    _mvHighlightPage(pageNum); // keep thumbnail highlight snappy

    var bucketZoom = _mvBucketZoom(_mv.zoom);

    return _mv._pdfDoc.getPage(pageNum).then(function (page) {
      if (seq !== _mvRenderSeq) return; // superseded
      _mv._pdfPage = page; // cache current page object for the tile renderer

      var dpr = _mvDpr();
      var pageW = _mv._pdfLogW / _mv._pdfBaseScale;
      var pageH = _mv._pdfLogH / _mv._pdfBaseScale;
      var clampedScale = _clampRenderScale(_mv._pdfBaseScale * bucketZoom, pageW, pageH, dpr);
      var renderScale = clampedScale * dpr;
      var w = Math.round(pageW * renderScale);
      var h = Math.round(pageH * renderScale);

      var renderKey = pageNum + '@' + w + 'x' + h;
      if (renderKey === _mv._renderedKey) {
        // Backing store already sharp at this bucket; just re-commit CSS at new zoom.
        _mv._pdfPageNum = pageNum;
        _mvCommitZoomCss();
        _mvRedraw();
        _mvNotifyTransformChanged('pdf-canvas-resize');
        return;
      }

      // Render into the reused offscreen back canvas — the visible canvas
      // keeps its old bitmap until the sharp one is ready (no blank flash).
      var back = _mvGetBackCanvas();
      back.width = w; back.height = h;
      var bctx = back.getContext('2d');
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'high';
      var viewport = page.getViewport({ scale: renderScale });

      var task = page.render({ canvasContext: bctx, viewport: viewport });
      _mv._renderTask = task;

      return task.promise.then(function () {
        if (seq !== _mvRenderSeq) return; // superseded — old bitmap stays visible
        var pdfCanvas = document.getElementById('dr-mv-image');
        if (!pdfCanvas) return;

        // ATOMIC COMMIT (single JS turn = single paint): resize clears the
        // visible canvas, then drawImage refills it before the browser paints.
        _mv._pdfPageNum = pageNum;
        pdfCanvas.width = w; pdfCanvas.height = h;
        pdfCanvas.getContext('2d').drawImage(back, 0, 0);
        // Free the back canvas backing store (avoid holding two full-size buffers
        // simultaneously — iOS has a hard total canvas-memory budget).
        back.width = 0; back.height = 0;

        var annCanvas = document.getElementById('dr-mv-canvas');
        if (annCanvas && (annCanvas.width !== w || annCanvas.height !== h)) {
          annCanvas.width = w; annCanvas.height = h;
        }
        _mvRedraw(); // always redraw — clears the previous page's markups

        _mv._renderedKey = renderKey;
        _mvCommitZoomCss();                       // CSS size + transform rebase
        _mvNotifyTransformChanged('pdf-canvas-resize');
      }).catch(function (e) {
        if (e && e.name !== 'RenderingCancelledException') throw e;
      }).finally(function () {
        if (_mv._renderTask === task) _mv._renderTask = null;
      });
    });
  }

  /* ── Re-render PDF canvas at current zoom level (crisp at any zoom) ────── */
  function _mvRerenderPdf() {
    var pdfCanvas = document.getElementById('dr-mv-image');
    if (!pdfCanvas || !_mv._pdfDoc) return;
    _mvRenderPage(_mv._pdfTargetPageNum);
  }

  /* ── Speculative mid-gesture render: if pinch zoom is stable ~100ms,
     render sharp into the back buffer early so release feels instant. ──── */
  var MV_SPECULATE_MS = 100;
  function _mvScheduleSpeculativeRender() {
    if (!_mv._pdfDoc) return;
    if (_mv._specTimer) clearTimeout(_mv._specTimer);
    _mv._specTimer = setTimeout(function () {
      _mv._specTimer = null;
      if (!_mv._twoFinger) return;      // gesture already ended; touchend handled it
      _mvRerenderPdf();                 // double-buffered + bucketed => cheap & safe
    }, MV_SPECULATE_MS);
  }

  /* ═══════════════════════════════════════════════════════════════════
     Phase 1: hybrid tile overlay (crisp high-zoom)
     Base layer (#dr-mv-image) stays permanently; tiles sharpen on top
     only when the 12MP/4096px clamp binds.
     ═══════════════════════════════════════════════════════════════════ */

  // Tile layer DOM (between #dr-mv-image and #dr-mv-canvas)
  function _mvEnsureTileLayer() {
    var layer = document.getElementById('dr-mv-tiles');
    if (layer) return layer;
    var stage = document.getElementById('dr-mv-stage');
    var annCanvas = document.getElementById('dr-mv-canvas');
    if (!stage || !annCanvas) return null;
    layer = document.createElement('div');
    layer.id = 'dr-mv-tiles';
    layer.style.position = 'absolute';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.transformOrigin = '0 0';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    layer.style.display = 'none';
    stage.insertBefore(layer, annCanvas);
    return layer;
  }

  // Activation check: does the clamp bind at this bucket?
  function _mvTilesNeeded(bucket) {
    if (!_mv._pdfDoc || !_mv._pdfLogW) return false;
    var dpr = _mvDpr();
    var pageW = _mv._pdfLogW / _mv._pdfBaseScale;
    var pageH = _mv._pdfLogH / _mv._pdfBaseScale;
    var want = _mv._pdfBaseScale * bucket;
    var clamped = _clampRenderScale(want, pageW, pageH, dpr);
    return clamped < want * MV_TILE_EPS;
  }

  // Visible tile keys (grid math in bucket space)
  function _mvVisibleTileKeys(bucketIdx) {
    var bucket = _mvBucketFromIndex(bucketIdx);
    var z = _mv.zoom;
    var vp = document.getElementById('dr-mv-viewport');
    var vw = vp ? vp.clientWidth : 0;
    var vh = vp ? vp.clientHeight : 0;

    // Visible page-logical rect (clamped to page)
    var lx0 = Math.max(0, (0 - _mv.panX) / z);
    var ly0 = Math.max(0, (0 - _mv.panY) / z);
    var lx1 = Math.min(_mv._pdfLogW, (vw - _mv.panX) / z);
    var ly1 = Math.min(_mv._pdfLogH, (vh - _mv.panY) / z);
    if (lx1 <= lx0 || ly1 <= ly0) return [];

    var maxCol = Math.max(0, Math.ceil(_mv._pdfLogW * bucket / MV_TILE_CSS) - 1);
    var maxRow = Math.max(0, Math.ceil(_mv._pdfLogH * bucket / MV_TILE_CSS) - 1);

    var c0 = Math.max(0, Math.floor(lx0 * bucket / MV_TILE_CSS) - MV_TILE_MARGIN);
    var c1 = Math.min(maxCol, Math.floor((lx1 * bucket - 1e-6) / MV_TILE_CSS) + MV_TILE_MARGIN);
    var r0 = Math.max(0, Math.floor(ly0 * bucket / MV_TILE_CSS) - MV_TILE_MARGIN);
    var r1 = Math.min(maxRow, Math.floor((ly1 * bucket - 1e-6) / MV_TILE_CSS) + MV_TILE_MARGIN);

    // Center-out ordering: the tile under the viewport center renders first
    var cc = ((lx0 + lx1) / 2) * bucket / MV_TILE_CSS;
    var cr = ((ly0 + ly1) / 2) * bucket / MV_TILE_CSS;

    var out = [];
    for (var row = r0; row <= r1; row++)
      for (var col = c0; col <= c1; col++)
        out.push({ key: bucketIdx + ':' + col + ':' + row, col: col, row: row,
                   d: Math.abs(col + 0.5 - cc) + Math.abs(row + 0.5 - cr) });
    out.sort(function (a, b) { return a.d - b.d; });
    return out;
  }

  // Pool + LRU
  function _mvTileCanvasAcquire() {
    var cv = _mv._tilePool.pop();
    if (!cv) {
      cv = document.createElement('canvas');
      cv.style.position = 'absolute';
    }
    return cv;
  }
  function _mvTileCanvasRelease(cv) {
    if (cv.parentNode) cv.remove();
    if (_mv._tilePool.length < MV_TILE_POOL_MAX) {
      _mv._tilePool.push(cv);
    } else {
      cv.width = cv.height = 1;   // force the browser to free the bitmap
    }
  }
  function _mvTileEvict(visibleSet) {
    if (_mv._tileCount <= MV_TILE_CACHE_MAX) return;
    var victims = [];
    for (var k in _mv._tiles) {
      if (!visibleSet.has(k)) victims.push([k, _mv._tiles[k]]);
    }
    victims.sort(function (a, b) { return a[1].lastUse - b[1].lastUse; });
    while (_mv._tileCount > MV_TILE_CACHE_MAX && victims.length) {
      var pair = victims.shift();
      var t = pair[1];
      if (t.task) { try { t.task.cancel(); } catch (e) {} }
      _mvTileCanvasRelease(t.canvas);
      delete _mv._tiles[pair[0]];
      _mv._tileCount--;
    }
  }

  // Render one tile (PDF.js transform into a small canvas)
  async function _mvRenderTile(page, col, row, bucketIdx) {
    var ep = _mv._tileEpoch;
    var key = bucketIdx + ':' + col + ':' + row;
    var t = _mv._tiles[key];
    if (!t) return;

    var bucket = _mvBucketFromIndex(bucketIdx);
    var dpr = _mvDpr();
    var cssSize = MV_TILE_CSS + MV_TILE_BLEED;
    var backing = Math.round(cssSize * dpr);
    var cv = t.canvas;

    if (cv.width !== backing) { cv.width = backing; cv.height = backing; }
    cv.style.width = cssSize + 'px';
    cv.style.height = cssSize + 'px';
    cv.style.left = (col * MV_TILE_CSS) + 'px';
    cv.style.top = (row * MV_TILE_CSS) + 'px';

    var ctx = cv.getContext('2d', { alpha: false });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, backing, backing);   // PDF pages assume white paper

    if (t.task) { try { t.task.cancel(); } catch (e) {} }
    var task = page.render({
      canvasContext: ctx,
      viewport: page.getViewport({ scale: bucket }),
      transform: [dpr, 0, 0, dpr, -col * MV_TILE_CSS * dpr, -row * MV_TILE_CSS * dpr]
    });
    t.task = task;
    try { await task.promise; } catch (e) { t.task = null; return; }   // cancelled — fine
    t.task = null;
    if (ep !== _mv._tileEpoch || !_mv._tiles[key]) return;            // stale result
    t.rendered = true;
  }

  // Orchestrator
  function _mvScheduleTiles(delay) {
    clearTimeout(_mv._tileUpdateTimer);
    _mv._tileUpdateTimer = setTimeout(_mvUpdateTiles, delay == null ? 100 : delay);
  }
  function _mvUpdateTiles() {
    if (!_mv || !_mv._pdfDoc || !_mv._pdfPage) return;
    var layer = _mvEnsureTileLayer();
    if (!layer) return;

    var bucketIdx = _mvBucketIndex(_mv._committedZoom);   // settled zoom, not live gesture zoom
    var bucket = _mvBucketFromIndex(bucketIdx);

    if (!_mvTilesNeeded(bucket)) {                        // clamp not binding → base is crisp
      if (_mv._tilesActive) _mvTilesDeactivate();
      return;
    }

    _mv._tilesActive = true;
    _mv._tilePageNum = _mv._pdfPageNum;
    layer.style.transform = 'scale(' + (_mv._committedZoom / bucket) + ')';
    layer.style.display = 'block';

    // Bucket switch: detach (keep cached) tiles from other buckets
    if (bucketIdx !== _mv._tileBucketIdx) {
      for (var k in _mv._tiles) {
        var t = _mv._tiles[k];
        if (t.bucketIdx !== bucketIdx && t.canvas.parentNode) t.canvas.remove();
      }
      _mv._tileBucketIdx = bucketIdx;
    }

    var vis = _mvVisibleTileKeys(bucketIdx);
    var visSet = new Set();
    var queue = [];
    for (var i = 0; i < vis.length; i++) visSet.add(vis[i].key);

    for (var j = 0; j < vis.length; j++) {
      var v = vis[j];
      var t = _mv._tiles[v.key];
      if (!t) {
        t = { canvas: _mvTileCanvasAcquire(), col: v.col, row: v.row,
              bucketIdx: bucketIdx, rendered: false, task: null, lastUse: 0 };
        _mv._tiles[v.key] = t;
        _mv._tileCount++;
        queue.push(v.key);
      } else if (!t.rendered && !t.task) {
        queue.push(v.key);                                 // re-queue interrupted tile
      }
      t.lastUse = ++_mv._tileUseSeq;
      if (!t.canvas.parentNode) {                          // reattach cached tile
        t.canvas.style.left = (t.col * MV_TILE_CSS) + 'px';
        t.canvas.style.top = (t.row * MV_TILE_CSS) + 'px';
        layer.appendChild(t.canvas);
      }
    }

    _mvTileEvict(visSet);
    _mv._tileQueue = queue;                                // already center-out
    _mvPumpTileQueue();
  }
  function _mvPumpTileQueue() {
    while (_mv._tileRendering < MV_TILE_CONCURRENCY && _mv._tileQueue.length) {
      var key = _mv._tileQueue.shift();
      var t = _mv._tiles[key];
      if (!t || t.rendered || t.task || t.bucketIdx !== _mv._tileBucketIdx) continue;
      _mv._tileRendering++;
      _mvRenderTile(_mv._pdfPage, t.col, t.row, t.bucketIdx)
        .finally(function () { _mv._tileRendering--; _mvPumpTileQueue(); })
        .catch(function () {});
    }
  }

  // Cleanup
  function _mvTilesDeactivate() {
    _mv._tileEpoch++;                    // invalidate all in-flight tile renders
    _mv._tileQueue.length = 0;
    _mv._tileRendering = 0;
    var layer = document.getElementById('dr-mv-tiles');
    if (layer) layer.style.display = 'none';
    _mv._tilesActive = false;
  }
  function _mvTilesTeardown() {          // page change, doc change, _mvClose
    _mvTilesDeactivate();
    clearTimeout(_mv._tileUpdateTimer);
    _mv._tileUpdateTimer = null;
    for (var k in _mv._tiles) {
      var t = _mv._tiles[k];
      if (t.task) { try { t.task.cancel(); } catch (e) {} }
      _mvTileCanvasRelease(t.canvas);
    }
    _mv._tiles = {};
    _mv._tileCount = 0;
    _mv._tileBucketIdx = -1;
    _mv._tilePageNum = 0;
    var layer = document.getElementById('dr-mv-tiles');
    if (layer) layer.innerHTML = '';
  }

  /* ── Text placement ────────────────────────────────────────────────────── */
  function _mvPlaceText(pos) {
    // Create a temporary input at the click position
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dr-mv-text-input';
    input.style.position = 'absolute';
    // Position relative to viewport
    var viewport = document.getElementById('dr-mv-viewport');
    if (viewport) {
      var rect = viewport.getBoundingClientRect();
      input.style.left = (pos.x * _mv.zoom + _mv.panX + 20) + 'px';
      input.style.top  = (pos.y * _mv.zoom + _mv.panY) + 'px';
    }
    viewport.appendChild(input);
    input.focus();

    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var text = input.value.trim();
      input.remove();
      if (text) {
        _mv.strokes.push({
          tool: 'text',
          color: _mv.color,
          lineWidth: _mv.lineWidth,
          points: [{ x: pos.x, y: pos.y }],
          text: text
        });
        _mvPersist();
        _mvRedraw();
      }
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') commit();
      if (ev.key === 'Escape') { input.value = ''; commit(); }
    });
  }

  /* ── Eraser ────────────────────────────────────────────────────────────── */
  function _mvEraseAt(pos) {
    var threshold = 18 / _mv.zoom; // hit-test radius in image coordinates
    var hits = [];
    for (var i = _mv.strokes.length - 1; i >= 0; i--) {
      var s = _mv.strokes[i];
      if (_mvStrokeHitTest(s, pos, threshold)) {
        hits.push(i);
      }
    }
    if (hits.length > 0) {
      _mvPushUndo();
      // Remove hit strokes (closest first)
      for (var j = 0; j < hits.length; j++) {
        _mv.strokes.splice(hits[j], 1);
      }
      _mvPersist();
      _mvRedraw();
    }
  }

  function _mvStrokeHitTest(s, pos, threshold) {
    if (!s || !s.points) return false;
    for (var i = 0; i < s.points.length; i++) {
      var p = s.points[i];
      var dx = p.x - pos.x, dy = p.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return true;
    }
    // For rect/ellipse: check if pos is inside the bounding box
    if ((s.tool === 'rect' || s.tool === 'ellipse') && s.points.length >= 2) {
      var a = s.points[0], b = s.points[s.points.length - 1];
      var minX = Math.min(a.x, b.x) - threshold, maxX = Math.max(a.x, b.x) + threshold;
      var minY = Math.min(a.y, b.y) - threshold, maxY = Math.max(a.y, b.y) + threshold;
      if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) return true;
    }
    return false;
  }

  /* ── Undo / Redo ───────────────────────────────────────────────────────── */
  function _mvPushUndo() {
    _mv.undoStack.push(JSON.parse(JSON.stringify(_mv.strokes)));
    _mv.redoStack = [];
  }

  function _mvUndo() {
    if (_mv.undoStack.length === 0) return;
    _mv.redoStack.push(JSON.parse(JSON.stringify(_mv.strokes)));
    _mv.strokes = _mv.undoStack.pop();
    _mvPersist();
    _mvRedraw();
  }

  function _mvRedo() {
    if (_mv.redoStack.length === 0) return;
    _mv.undoStack.push(JSON.parse(JSON.stringify(_mv.strokes)));
    _mv.strokes = _mv.redoStack.pop();
    _mvPersist();
    _mvRedraw();
  }

  /* ── Keyboard handler ──────────────────────────────────────────────────── */
  function _mvKeyHandler(e) {
    if (!_mv) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); _mvUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); _mvRedo(); }
  }

  /* ── Persist markups to IndexedDB (debounced) ──────────────────────────── */
  var _mvPersistTimer = null;
  function _mvPersist() {
    if (_mvPersistTimer) clearTimeout(_mvPersistTimer);
    _mvPersistTimer = setTimeout(function () {
      if (!_mv) return;
      _saveMarkups(_mv.projectId, _mv.drawingId, _mv.strokes).catch(function (err) {
        console.warn('[AlignDrawings] Markup save failed:', err);
      });
    }, 400);
  }

  /* ── Cleanup viewer ────────────────────────────────────────────────────── */
  function _mvClose() {
    if (_mvPersistTimer) { clearTimeout(_mvPersistTimer); _mvPersistTimer = null; }
    if (_mvStateTimer) { clearTimeout(_mvStateTimer); _mvStateTimer = null; }
    try { localStorage.removeItem(MV_STATE_KEY); } catch (e) {}
    try { sessionStorage.removeItem(MV_OPEN_MARKER); } catch (e) {}
    if (_mv) _mvTilesTeardown(); // release tile canvases + cancel in-flight tile renders
    // Flush any pending save
    if (_mv && _mv.strokes && _mv.strokes.length > 0) {
      _saveMarkups(_mv.projectId, _mv.drawingId, _mv.strokes).catch(function () {});
    }
    // Remove escape handler
    if (_mv && _mv._escHandler) {
      document.removeEventListener('keydown', _mv._escHandler);
    }
    document.removeEventListener('keydown', _mvKeyHandler);
    window.removeEventListener('resize', _mvSyncCanvas);

    // Cancel in-flight render and release canvas memory (iOS fix)
    if (_mv && _mv._renderTask) { try { _mv._renderTask.cancel(); } catch(e) {} }
    _mvRenderSeq++;  // invalidate any pending renders
    if (_mv && _mv._pdfDoc) { _mv._pdfDoc.destroy(); _mv._pdfDoc = null; _mv._pdfDocId = null; }
    var pdfCanvas = document.getElementById('dr-mv-image');
    var annCanvas = document.getElementById('dr-mv-canvas');
    if (pdfCanvas) pdfCanvas.width = 0;
    if (annCanvas) annCanvas.width = 0;

    // Restore body state to what it was before the viewer opened.
    // IMPORTANT: we never remove section-open (the home page is hidden via
    // inline display:none on tileGrid+appHeader, not the CSS class), so
    // we don't need to restore it — it was never touched.
    if (_mv && _mv._prevBody) {
      document.body.style.overflow = _mv._prevBody.overflow;
      document.body.style.position = _mv._prevBody.position;
      document.body.style.top = _mv._prevBody.top;
      document.body.style.width = _mv._prevBody.width;
      document.body.style.touchAction = _mv._prevBody.touchAction || '';
      document.body.style.overscrollBehavior = _mv._prevBody.overscrollBehavior || '';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.touchAction = '';
      document.body.style.overscrollBehavior = '';
    }

    // Cancel any in-flight PDF render task
    if (_mv && _mv._renderTask) {
      try { _mv._renderTask.cancel(); } catch(e) {}
      _mv._renderTask = null;
    }
    // Free PDF document memory
    if (_mv && _mv._pdfDoc) {
      try { _mv._pdfDoc.destroy(); } catch(e) {}
      _mv._pdfDoc = null;
    }
    // Remove overlay host from DOM
    var host = document.getElementById('dr-mv-overlay-host');
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }

    _mv = null;
  }

  /* ════════════════════════════════════════════════════════════════════════════
   * ADD DRAWING MODAL  (supports multi-file drops, PDF page splitting)
   * ════════════════════════════════════════════════════════════════════════════ */

  function _addModalHtml() {
    var h = [];
    h.push('<div class="dr-modal-overlay" id="dr-modal-overlay">');
    h.push('<div class="dr-modal">');

    // Header
    h.push('<div class="dr-modal-header">');
    h.push('<h3>Add Drawings</h3>');
    h.push('<button class="dr-modal-close" id="dr-modal-close">✕</button>');
    h.push('</div>');

    // ── Drawing Type: auto-detected from title block — no manual selection needed ──
    h.push('<p class="dr-type-auto-note">Sheet names and disciplines are automatically detected from the title block.</p>');

    var dropClass = state.dragOver ? ' dr-drop-active' : '';
    var pdfInfo = state.pdfSplitInfo;
    var hasPages = pdfInfo && pdfInfo.pages && pdfInfo.pages.length > 0;
    var hasFiles = state.pendingFiles.length > 0 || hasPages;

    if (!hasFiles) {
      // ── Drop zone (no files yet) ──
      h.push('<div class="dr-drop-zone' + dropClass + '" id="dr-drop-zone">');
      h.push('<div class="dr-drop-icon">📂</div>');
      h.push('<div class="dr-drop-label">Drag & drop drawing files here</div>');
      h.push('<div class="dr-drop-or">— or —</div>');
      h.push('<button class="pm-btn" id="dr-browse-btn">📁 Upload from drive</button>');
      h.push('<input type="file" id="dr-file-input" hidden multiple accept=".pdf">');
      h.push('<div class="dr-drop-hint">Supports PDF files only — no size limit</div>');
      h.push('<div class="dr-drop-hint" style="margin-top:4px;">📕 Multi-page PDFs are automatically split into individual pages</div>');
      h.push('</div>');
    } else {
      // ── File preview ──
      h.push('<div class="dr-preview-list">');

      if (pdfInfo) {
        // PDF splitting info
        h.push('<div class="dr-pdf-banner">');
        h.push('<span class="dr-pdf-icon">📕</span>');
        h.push('<span><strong>' + esc(pdfInfo.fileName) + '</strong> — ' + pdfInfo.totalPages + ' pages detected</span>');
        h.push('</div>');
        h.push('<div class="dr-pdf-pages-label">Each page will be saved as a separate drawing, named by its title block:</div>');

        for (var p = 0; p < pdfInfo.pages.length; p++) {
          var pg = pdfInfo.pages[p];
          h.push('<div class="dr-preview dr-preview-page">');
          h.push('<div class="dr-preview-thumb">');
          if (pg.thumbUrl) {
            // PNG thumbnail rendered via pdf.js — <img> cannot show PDF data URLs
            h.push('<img src="' + esc(pg.thumbUrl) + '" alt="Page preview">');
          } else {
            h.push('<span class="dr-preview-icon">📕</span>');
          }
          h.push('</div>');
          h.push('<div class="dr-preview-info">');
          h.push('<strong>' + esc(pg.name) + '</strong>');
          h.push('<span>Page ' + pg.pageNum + ' of ' + pdfInfo.totalPages + '</span>');
          h.push('</div>');
          h.push('</div>');
        }
      } else {
        // Regular file(s) preview
        for (var i = 0; i < state.pendingFiles.length; i++) {
          var f = state.pendingFiles[i];
          var isImg = f.type && f.type.indexOf('image/') === 0;
          h.push('<div class="dr-preview">');
          h.push('<div class="dr-preview-thumb">');
          if (isImg && f.dataUrl) {
            h.push('<img src="' + esc(f.dataUrl) + '" alt="Preview">');
          } else {
            h.push('<span class="dr-preview-icon">' + mimeIcon(f.type) + '</span>');
          }
          h.push('</div>');
          h.push('<div class="dr-preview-info">');
          h.push('<strong>' + esc(f.name) + '</strong>');
          h.push('<span>' + fmtSize(f.size) + '</span>');
          h.push('</div>');
          h.push('</div>');
        }
      }

      h.push('<button class="dr-preview-change" id="dr-change-file">Change files</button>');
      h.push('</div>');
    }

    // Error message
    if (state.uploadError) {
      h.push('<div class="dr-error">' + esc(state.uploadError) + '</div>');
    }

    // Upload progress
    if (state.uploading) {
      var label = pdfInfo ? 'Splitting PDF & saving ' + pdfInfo.pages.length + ' pages…' : 'Saving ' + state.pendingFiles.length + ' drawing(s)…';
      h.push('<div class="dr-uploading">');
      h.push('<div class="dr-spinner"></div>');
      h.push('<span>' + label + '</span>');
      h.push('</div>');
    }

    // Actions
    h.push('<div class="dr-modal-actions">');
    h.push('<button class="pm-btn" id="dr-cancel-btn">Cancel</button>');
    if (hasFiles && !state.uploading) {
      var saveLabel = pdfInfo ? 'Save ' + pdfInfo.pages.length + ' Pages' : 'Save ' + state.pendingFiles.length + ' Drawing(s)';
      h.push('<button class="pm-btn primary" id="dr-save-btn">' + saveLabel + '</button>');
    }
    h.push('</div>');

    h.push('</div>'); // dr-modal
    h.push('</div>'); // dr-modal-overlay
    return h.join('');
  }

  function _bindAddModal() {
    var fileInput = document.getElementById('dr-file-input');

    // Close button
    var closeBtn = document.getElementById('dr-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', _closeModal);

    // Cancel
    var cancelBtn = document.getElementById('dr-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', _closeModal);

    // Overlay click to close
    var overlay = document.getElementById('dr-modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) _closeModal();
      });
    }

    // Browse button → file input
    var browseBtn = document.getElementById('dr-browse-btn');
    if (browseBtn && fileInput) {
      browseBtn.addEventListener('click', function () { fileInput.click(); });
    }

    // File input change → handle ALL selected files
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) {
          _handleFilesSelected(fileInput.files);
        }
      });
    }

    // Drop zone events → handle ALL dropped files
    var dropZone = document.getElementById('dr-drop-zone');
    function _wireDrop(el) {
      if (!el) return;
      el.addEventListener('dragover', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = true;
        if (dropZone) dropZone.classList.add('dr-drop-active');
      });
      el.addEventListener('dragleave', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = false;
        if (dropZone) dropZone.classList.remove('dr-drop-active');
      });
      el.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = false;
        if (dropZone) dropZone.classList.remove('dr-drop-active');
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
          _handleFilesSelected(e.dataTransfer.files);
        }
      });
    }
    _wireDrop(dropZone);

    // Also handle drag on whole modal
    var modal = document.querySelector('.dr-modal');
    if (modal) {
      modal.addEventListener('dragover', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = true;
        if (dropZone) dropZone.classList.add('dr-drop-active');
      });
      modal.addEventListener('dragleave', function (e) {
        // Only clear if leaving to outside the modal
      });
      modal.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        state.dragOver = false;
        if (dropZone) dropZone.classList.remove('dr-drop-active');
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
          _handleFilesSelected(e.dataTransfer.files);
        }
      });
    }

    // Change files button
    var changeBtn = document.getElementById('dr-change-file');
    if (changeBtn) {
      changeBtn.addEventListener('click', function () {
        state.pendingFiles = [];
        state.pdfSplitInfo = null;
        state.uploadName = '';
        state.uploadError = null;
        _paint();
      });
    }

    // Save button
    var saveBtn = document.getElementById('dr-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', _saveDrawing);

    // Escape key
    var escHandler = function (e) {
      if (e.key === 'Escape') {
        _closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler, { signal: window._sectionSignal });
  }

  /**
   * Handle one or more selected files (from drop or file input).
   * Reads them all, then checks for multi-page PDFs.
   */
  function _handleFilesSelected(fileList) {
    var files = [];
    for (var i = 0; i < fileList.length; i++) files.push(fileList[i]);

    // Validate all files first
    for (var j = 0; j < files.length; j++) {
      var err = validateFile(files[j]);
      if (err) {
        state.uploadError = files[j].name + ': ' + err;
        state.pendingFiles = [];
        state.pdfSplitInfo = null;
        _paint();
        return;
      }
    }

    state.uploadError = null;
    state.pendingFiles = [];
    state.pdfSplitInfo = null;
    state.uploadName = '';

    // Read all files as data URLs
    var reads = [];
    for (var k = 0; k < files.length; k++) {
      (function (file) {
        reads.push(
          readFileAsDataURL(file).then(function (dataUrl) {
            return { name: file.name, type: file.type, size: file.size, dataUrl: dataUrl };
          })
        );
      })(files[k]);
    }

    Promise.all(reads).then(function (results) {
      // Check if the first (or only) file is a multi-page PDF
      if (results.length === 1 && results[0].type && results[0].type.indexOf('pdf') !== -1) {
        var file = files[0];
        // Try to split PDF pages
        var splitPromise = _splitPdfPages(file, results[0].dataUrl);
        if (splitPromise) {
          splitPromise.then(function (pages) {
            if (pages && pages.length > 1) {
              // Successfully split! Show page previews
              state.pdfSplitInfo = {
                fileName: file.name,
                totalPages: pages.length,
                pages: pages
              };
            } else {
              // Single page or split failed — treat as regular file
              state.pendingFiles = results;
            }
            _paint();
          }).catch(function () {
            // Split failed — treat as regular file
            state.pendingFiles = results;
            _paint();
          });
          return;
        }
      }
      // No PDF splitting — store all files normally
      state.pendingFiles = results;
      _paint();
    }).catch(function (err) {
      state.uploadError = 'Could not read one or more files. Please try again.';
      state.pendingFiles = [];
      state.pdfSplitInfo = null;
      _paint();
    });
  }

  /** Save the pending drawing(s). Handles PDF-split pages and bulk files. */
  function _saveDrawing() {
    var hasPages = state.pdfSplitInfo && state.pdfSplitInfo.pages && state.pdfSplitInfo.pages.length > 0;
    if ((state.pendingFiles.length === 0 && !hasPages) || state.uploading) return;

    state.uploading = true;
    state.uploadError = null;
    _paint();

    // Determine what to save: PDF-split pages or raw files
    var itemsToSave = [];
    if (state.pdfSplitInfo && state.pdfSplitInfo.pages.length) {
      // PDF-split pages — each is a standalone PDF (from pdf-lib)
      for (var p = 0; p < state.pdfSplitInfo.pages.length; p++) {
        var pg = state.pdfSplitInfo.pages[p];
        itemsToSave.push({
          name: pg.name + '.pdf',
          type: 'application/pdf',
          size: pg.dataUrl.length,
          dataUrl: pg.dataUrl,
          customName: pg.name + '.pdf'
        });
      }
    } else {
      // Regular files
      for (var f = 0; f < state.pendingFiles.length; f++) {
        var file = state.pendingFiles[f];
        itemsToSave.push(file);
      }
    }

    addDrawing(itemsToSave).then(function () {
      // Success
      state.showAddModal = false;
      state.pendingFiles = [];
      state.pdfSplitInfo = null;
      state.uploadName = '';
      state.uploadError = null;
      state.uploading = false;
      _paint();
    }).catch(function (err) {
      state.uploadError = err.message || 'Failed to save.';
      state.uploading = false;
      _paint();
    });
  }

  function _closeModal() {
    state.showAddModal = false;
    state.pendingFiles = [];
    state.pdfSplitInfo = null;
    state.uploadName = '';
    state.uploadError = null;
    state.dragOver = false;
    state.uploading = false;
    _paint();
  }

  /* ── Bulk actions: export & delete ──────────────────────────────────────── */

  /** Get array of selected drawing IDs. If selectAll is true, returns all IDs. */
  function _getSelectedIds(selectAll) {
    if (selectAll) {
      return getDrawingsList().then(function (all) {
        var ids = [];
        for (var i = 0; i < all.length; i++) ids.push(all[i].id);
        return ids;
      });
    }
    return Promise.resolve(Object.keys(state.selectedIds));
  }

  function _exportSelectedDrawings(selectAll) {
    _getSelectedIds(selectAll).then(function (ids) {
    if (ids.length === 0) return;

    var pid = state.projectId;
    var index = _loadDrawingsIndex(pid);
    var idxMap = {};
    for (var i = 0; i < index.length; i++) idxMap[index[i].id] = index[i];

    var promises = [];
    for (var j = 0; j < ids.length; j++) {
      (function (did) {
        promises.push(_loadDrawingBlob(pid, did).then(function (content) {
          return { id: did, meta: idxMap[did], content: content };
        }));
      })(ids[j]);
    }

    Promise.all(promises).then(function (results) {
      var valid = [];
      for (var k = 0; k < results.length; k++) {
        if (results[k].content && results[k].meta) valid.push(results[k]);
      }
      if (valid.length === 0) return;

      // Stagger downloads by 300ms so browsers don't block rapid-fire clicks
      function downloadOne(idx) {
        if (idx >= valid.length) return;
        var r = valid[idx];
        var name = r.meta.name || 'drawing';
        if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);
        name = name + '.pdf';

        // Use a Blob + object URL for reliability across browsers
        try {
          var byteString = atob(r.content.split(',')[1] || '');
          var ab = new ArrayBuffer(byteString.length);
          var ia = new Uint8Array(ab);
          for (var b = 0; b < byteString.length; b++) ia[b] = byteString.charCodeAt(b);
          var blob = new Blob([ab], { type: 'application/pdf' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // Revoke after a short delay to let the download begin
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) {
          // Fallback: direct data URL (works for single-file)
          var a2 = document.createElement('a');
          a2.href = r.content;
          a2.download = name;
          document.body.appendChild(a2);
          a2.click();
          document.body.removeChild(a2);
        }

        setTimeout(function () { downloadOne(idx + 1); }, 300);
      }
      downloadOne(0);
    }).catch(function (err) {
      console.warn('[AlignDrawings] Export failed:', err);
    });
    });  // close _getSelectedIds().then()
  }

  /** Delete selected drawings. Prompts confirmation first. */
  function _deleteSelectedDrawings(selectAll) {
    _getSelectedIds(selectAll).then(function (ids) {
    if (ids.length === 0) return;

    var label = ids.length === 1 ? 'this drawing' : ids.length + ' drawings';
    if (!confirm('Delete ' + label + '? This cannot be undone.')) return;

    var pid = state.projectId;
    var index = _loadDrawingsIndex(pid);

    // Remove from IndexedDB
    var delPromises = [];
    for (var i = 0; i < ids.length; i++) {
      delPromises.push(_deleteDrawingBlob(pid, ids[i]));
    }

    Promise.all(delPromises).then(function () {
      // Remove from index
      var keep = [];
      var deletedSet = {};
      for (var d = 0; d < ids.length; d++) deletedSet[ids[d]] = true;
      for (var j = 0; j < index.length; j++) {
        if (!deletedSet[index[j].id]) keep.push(index[j]);
      }
      _saveDrawingsIndex(pid, keep);

      // Also remove from AlignFiles if present
      var filesAPI = window.AlignFiles || null;
      if (filesAPI) {
        for (var k = 0; k < ids.length; k++) {
          try { filesAPI.deleteFile(pid, ids[k]); } catch(e) { /* best effort */ }
        }
      }

      // Clear selection and re-render
      state.selectMode = false;
      state.selectedIds = {};
      _paint();
    }).catch(function (err) {
      console.warn('[AlignDrawings] Delete failed:', err);
    });
    });  // close _getSelectedIds().then()
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  function openListCrop(opts) {
    if (!opts || !opts.projectId || !opts.drawingId || !opts.listId) return Promise.reject(new Error('missing crop args'));
    state.projectId = opts.projectId;
    _mvModeArgs = {
      mode: 'list-crop',
      projectId: opts.projectId,
      drawingId: opts.drawingId,
      sheet: opts.sheet || 0,
      listId: opts.listId,
      onSaved: opts.onSaved,
      onCancel: opts.onCancel
    };
    return _loadDrawingForViewer(opts.projectId, opts.drawingId).then(function (file) {
      if (!file) throw new Error('Drawing not found');
      _viewDrawing(file);
    });
  }

  function openListPin(opts) {
    if (!opts || !opts.projectId || !opts.drawingId || !opts.itemId) return Promise.reject(new Error('missing pin args'));
    state.projectId = opts.projectId;
    _mvModeArgs = {
      mode: 'list-pin',
      projectId: opts.projectId,
      drawingId: opts.drawingId,
      sheet: opts.sheet || 0,
      listId: opts.listId,
      itemId: opts.itemId,
      cropMode: opts.cropMode,
      vertices: opts.vertices,
      cropRenderStatus: opts.cropRenderStatus,
      cropImage: opts.cropImage,
      cropRenderMeta: opts.cropRenderMeta,
      onPlaced: opts.onPlaced,
      onCancel: opts.onCancel
    };
    // When a rendered crop document exists, show it directly (no full-drawing flash).
    var hasRenderedCrop = opts.cropRenderStatus === 'ready' && opts.cropImage && opts.cropImage.fileId;
    var loadId = hasRenderedCrop ? opts.cropImage.fileId : opts.drawingId;
    return _loadDrawingForViewer(opts.projectId, loadId).then(function (file) {
      if (!file) throw new Error('Drawing not found');
      if (hasRenderedCrop) {
        // Let the blob's real mime type drive image-vs-PDF routing (crop PDFs
        // reuse the pdf.js viewer; crop PNGs reuse the image viewer).
        file.meta._isCropImage = true;
      }
      _viewDrawing(file);
    });
  }

  function listDrawingsForProject(projectId) {
    if (projectId) state.projectId = projectId;
    return getDrawingsList();
  }

  // Read-only "View Layout": show the list's map (rendered crop or full drawing)
  // with pins; no placement, pins are tappable.
  function openLayoutView(opts) {
    if (!opts || !opts.projectId || !opts.drawingId || !opts.listId) return Promise.reject(new Error('missing layout args'));
    state.projectId = opts.projectId;
    _mvModeArgs = {
      mode: 'list-layout',
      projectId: opts.projectId,
      drawingId: opts.drawingId,
      sheet: opts.sheet || 0,
      listId: opts.listId,
      cropMode: opts.cropMode,
      vertices: opts.vertices,
      cropRenderStatus: opts.cropRenderStatus,
      cropImage: opts.cropImage,
      cropRenderMeta: opts.cropRenderMeta,
      onCancel: opts.onCancel,
      onOpenItem: opts.onOpenItem
    };
    var hasRenderedCrop = opts.cropRenderStatus === 'ready' && opts.cropImage && opts.cropImage.fileId;
    var loadId = hasRenderedCrop ? opts.cropImage.fileId : opts.drawingId;
    return _loadDrawingForViewer(opts.projectId, loadId).then(function (file) {
      if (!file) throw new Error('Drawing not found');
      if (hasRenderedCrop) file.meta._isCropImage = true;
      _viewDrawing(file);
    });
  }

  global.AlignDrawings = {
    render: render,
    listDrawings: listDrawingsForProject,
    openListCrop: openListCrop,
    openListPin: openListPin,
    openLayoutView: openLayoutView,
    tryRestoreViewerState: _mvTryRestoreState
  };

  if (window.TileRegistry) window.TileRegistry.register({ id: 'drawings', title: 'Drawings', icon: '#', route: 'drawings', roles: ['user','admin'], order: 3 });
})(window);
