// punchlist-export-service.js
// Server-side punchlist list export: renders a clean PDF (location map + pins at top,
// then one card per item with a large photo) via headless Chromium.
//
// generatePunchlistPdf({ db, projectId, listId, filterUserId, uploadsDir, outputPath })
//   -> { itemCount, filteredForUserId, hasMap }

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const execFileAsync = promisify(execFile);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeJson(s, fallback) {
  try { return JSON.parse(s || 'null'); } catch (e) { return fallback; }
}

function fileToDataUrl(filePath, mimeType) {
  const buf = fs.readFileSync(filePath);
  return 'data:' + (mimeType || 'image/jpeg') + ';base64,' + buf.toString('base64');
}

// Resize an image file to a bounded JPEG data URL (keeps exports small + crisp).
async function imageToDataUrl(filePath, maxDim) {
  try {
    const buf = await sharp(filePath)
      .rotate()
      .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch (e) {
    return null;
  }
}

// Rasterize the crop PDF (or return the crop PNG directly) to a PNG for the map.
async function rasterizeMap(cropFile, tmpDir) {
  const mapPath = path.join(tmpDir, 'map');
  if (cropFile.mime_type === 'application/pdf') {
    await execFileAsync('/usr/bin/pdftocairo', ['-png', '-r', '150', '-singlefile', cropFile.stored_path, mapPath], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    return mapPath + '.png';
  }
  // Image crop: normalize to PNG via sharp.
  const out = mapPath + '.png';
  await sharp(cropFile.stored_path).rotate().png().toFile(out);
  return out;
}

async function generatePunchlistPdf(opts) {
  const { db, projectId, listId, filterUserId, uploadsDir, outputPath } = opts;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'plexp-'));

  try {
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
    const list = db.prepare('SELECT name FROM punchlist_lists WHERE id = ?').get(listId);
    if (!list) throw new Error('List not found');

    const crop = db.prepare('SELECT crop_image_file_id, crop_render_meta, drawing_id, sheet_number FROM punchlist_list_crops WHERE list_id = ?').get(listId);
    const meta = crop && crop.crop_render_meta ? safeJson(crop.crop_render_meta, null) : null;

    // Items in this list (stable order).
    const itemRows = db.prepare(
      "SELECT id, data FROM records WHERE project_id = ? AND category = 'punchlist' AND json_extract(data, '$.listId') = ? ORDER BY created_at ASC, id ASC"
    ).all(projectId, listId);

    // Assignments for every item in this list.
    const assignStmt = db.prepare(
      'SELECT pa.punch_item_id, u.name, u.email FROM punchlist_assignments pa JOIN users u ON u.id = pa.user_id WHERE pa.punch_item_id = ? ORDER BY pa.assigned_at ASC'
    );
    const assignmentsByItem = {};
    itemRows.forEach(function (r) { assignmentsByItem[r.id] = assignStmt.all(r.id); });

    // Pins (item -> normalized x,y) for the map, using the crop's drawing/sheet.
    const pinsByItem = {};
    if (crop && crop.drawing_id) {
      const pinRows = db.prepare(
        'SELECT punch_item_id, x, y FROM punch_item_locations WHERE drawing_id = ? AND sheet_number = ?'
      ).all(crop.drawing_id, crop.sheet_number || 0);
      pinRows.forEach(function (p) { pinsByItem[p.punch_item_id] = { x: p.x, y: p.y }; });
    }

    // Decorate items.
    const items = [];
    itemRows.forEach(function (r, idx) {
      const d = safeJson(r.data, {});
      const assigns = assignmentsByItem[r.id] || [];
      if (filterUserId) {
        const hit = assigns.some(function (a) { return a.user_id === filterUserId; });
        if (!hit) return; // filtered out
      }
      const firstImg = Array.isArray(d.images) ? d.images.find(function (i) { return i && i.fileId && String(i.mimeType || '').indexOf('image/') === 0; }) : null;
      items.push({
        id: r.id,
        stableNumber: idx + 1,
        title: d.title || 'Untitled',
        description: d.description || '',
        priority: d.priority || '',
        status: d.status || '',
        assignedNames: assigns.map(function (a) { return a.name; }),
        firstImg: firstImg,
        pin: pinsByItem[r.id] || null
      });
    });

    // Build the map image + pin positions.
    let mapDataUrl = null;
    let mapPins = [];
    if (crop && crop.crop_image_file_id) {
      const cropFile = db.prepare('SELECT stored_path, mime_type FROM files WHERE id = ?').get(crop.crop_image_file_id);
      if (cropFile && fs.existsSync(cropFile.stored_path)) {
        const mapPng = await rasterizeMap(cropFile, tmpDir);
        mapDataUrl = 'data:image/png;base64,' + fs.readFileSync(mapPng).toString('base64');
        if (meta) {
          const shW = meta.sheetWidth || 1, shH = meta.sheetHeight || 1;
          const bx = (meta.bbox && meta.bbox.x) || 0, by = (meta.bbox && meta.bbox.y) || 0;
          const doc = meta.document || { width: 1, height: 1, drawingLeft: 0, drawingTop: 0 };
          items.forEach(function (it) {
            if (!it.pin) return;
            const sheetX = it.pin.x * shW, sheetY = it.pin.y * shH;
            const docX = (doc.drawingLeft || 0) + (sheetX - bx);
            const docY = (doc.drawingTop || 0) + (sheetY - by);
            const leftPct = docX / (doc.width || 1) * 100;
            const topPct = docY / (doc.height || 1) * 100;
            if (leftPct >= -0.2 && leftPct <= 100.2 && topPct >= -0.2 && topPct <= 100.2) {
              mapPins.push({ number: it.stableNumber, left: leftPct.toFixed(2), top: topPct.toFixed(2) });
            }
          });
        }
      }
    }

    // Item photo data URLs.
    for (const it of items) {
      if (it.firstImg) {
        const f = db.prepare('SELECT stored_path, mime_type FROM files WHERE id = ?').get(it.firstImg.fileId);
        if (f && fs.existsSync(f.stored_path)) {
          it.photoDataUrl = await imageToDataUrl(f.stored_path, 1200);
        }
      }
    }

    // Build HTML.
    const projectName = project ? project.name : 'Project';
    const listName = list.name || 'List';
    const nowLabel = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    let html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css() + '</style></head><body>';
    html += '<header class="document-header"><div><h1>Punchlist: ' + esc(listName) + '</h1><p class="project-name">' + esc(projectName) + '</p></div>' +
      '<div class="document-meta"><div>Exported ' + esc(nowLabel) + '</div><div>' + items.length + ' item' + (items.length === 1 ? '' : 's') + '</div></div></header>';

    if (mapDataUrl) {
      html += '<section class="map-section"><h2>Location Map</h2><div class="map-frame"><img class="map-image" src="' + mapDataUrl + '" alt="">';
      mapPins.forEach(function (p) {
        html += '<div class="map-pin" style="left:' + p.left + '%;top:' + p.top + '%"><span>' + p.number + '</span></div>';
      });
      html += '</div></section>';
    }

    html += '<main class="items">';
    items.forEach(function (it) {
      const prio = (it.priority || '') ? (it.priority.charAt(0).toUpperCase() + it.priority.slice(1)) : '';
      const status = (it.status || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      html += '<article class="item-card"><div class="item-heading"><div class="item-number">Item ' + it.stableNumber + '</div>' +
        (prio ? '<div class="priority priority--' + esc(it.priority) + '">' + esc(prio) + '</div>' : '') +
        '</div><h2 class="item-title">' + esc(it.title) + '</h2>';
      if (it.photoDataUrl) {
        html += '<div class="item-photo-wrap"><img class="item-photo" src="' + it.photoDataUrl + '" alt=""></div>';
      } else {
        html += '<div class="item-photo-placeholder">No photo attached</div>';
      }
      html += '<dl class="item-details">' +
        '<div><dt>Description</dt><dd>' + esc(it.description || 'No description') + '</dd></div>' +
        '<div><dt>Priority</dt><dd>' + esc(prio || 'Not specified') + '</dd></div>' +
        '<div><dt>Assigned To</dt><dd>' + esc(it.assignedNames.length ? it.assignedNames.join(', ') : 'Unassigned') + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + esc(status || 'Open') + '</dd></div>' +
        '</dl></article>';
    });
    html += '</main><footer class="document-footer">Generated by Align PM</footer></body></html>';

    // Render to PDF via Playwright.
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      executablePath: '/usr/bin/chromium',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader']
    });
    let pdfBuffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.evaluate(async () => {
        await Promise.all([...document.images].map(img => img.complete ? Promise.resolve() : new Promise(res => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); })));
      });
      pdfBuffer = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0.55in', right: '0.55in', bottom: '0.55in', left: '0.55in' } });
    } finally {
      await browser.close();
    }

    await fsp.writeFile(outputPath, pdfBuffer);
    return { itemCount: items.length, filteredForUserId: filterUserId || null, hasMap: !!mapDataUrl };
  } finally {
    try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

function css() {
  return `
@page { size: Letter; margin: 0.55in; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #17212b; background: #fff; font: 12px/1.45 Arial, Helvetica, sans-serif; }
.document-header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #1f4f73; }
.document-header h1 { margin: 0 0 4px; color: #173f5f; font-size: 24px; }
.project-name, .document-meta { margin: 0; color: #52606d; }
.document-meta { text-align: right; }
.map-section { margin-top: 20px; break-after: page; }
.map-section h2 { margin: 0 0 10px; font-size: 18px; color: #173f5f; }
.map-frame { position: relative; display: inline-block; overflow: hidden; border: 1px solid #c9d2da; border-radius: 6px; background: #f5f7f9; }
.map-image { display: block; max-height: 7.2in; max-width: 100%; width: auto; }
.map-pin { position: absolute; width: 22px; height: 22px; transform: translate(-50%, -50%); border: 2px solid #fff; border-radius: 50%; color: #fff; background: #d62828; box-shadow: 0 1px 4px rgba(0,0,0,.45); font-size: 10px; font-weight: 700; line-height: 18px; text-align: center; }
.item-card { margin: 0 0 20px; padding: 16px; break-inside: avoid; page-break-inside: avoid; border: 1px solid #cfd8df; border-radius: 8px; background: #fff; }
.item-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.item-number { color: #52606d; font-weight: 700; text-transform: uppercase; }
.item-title { margin: 6px 0 12px; color: #17212b; font-size: 19px; }
.item-photo-wrap { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 220px; max-height: 520px; overflow: hidden; border-radius: 6px; background: #eef2f5; }
.item-photo { display: block; width: 100%; max-height: 520px; object-fit: contain; }
.item-photo-placeholder { display: flex; min-height: 220px; align-items: center; justify-content: center; color: #6b7785; background: #eef2f5; }
.item-details { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin: 14px 0 0; }
.item-details div { min-width: 0; }
.item-details dt { color: #607080; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.item-details dd { margin: 2px 0 0; overflow-wrap: anywhere; }
.priority { padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.priority--high { color: #821c1c; background: #fde8e8; }
.priority--medium { color: #7a4a0b; background: #fdf0dd; }
.priority--low { color: #1c5b2e; background: #e2f4e8; }
.document-footer { margin-top: 20px; color: #718096; font-size: 9px; text-align: center; }
`;
}

module.exports = { generatePunchlistPdf };
