/*
 * punchlist-crop-renderer.js
 * Server-side rasterizer: turns a punchlist crop (normalized polygon on a
 * drawing) into a standalone high-quality PNG "document" with a white
 * background and a punchlist-name header.
 *
 * Pipeline: source file (PDF page via pdftocairo, or image via sharp)
 *   -> normalized full-sheet PNG -> normalized vertices to pixels -> bbox
 *   -> SVG alpha mask (dest-in) -> clipped RGBA crop -> white framed document
 *   with list-name header -> flattened opaque PNG.
 */
'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const execFileAsync = promisify(execFile);

const MIN_CROP_SIDE_PX = 32;

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
  });
}

async function pdfPageSize(pdfPath, pageNum) {
  const { stdout } = await execFileAsync(
    '/usr/bin/pdfinfo', ['-f', String(pageNum), '-l', String(pageNum), pdfPath],
    { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
  );
  const m = String(stdout).match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/i);
  if (!m) return null;
  return { widthPts: parseFloat(m[1]), heightPts: parseFloat(m[2]) };
}

function adaptiveDpi(widthPts, heightPts) {
  const preferred = 300, min = 144, maxSide = 10000, maxPixels = 50000000;
  const dpiSide = Math.min(maxSide * 72 / widthPts, maxSide * 72 / heightPts);
  const dpiArea = Math.sqrt(maxPixels * 72 * 72 / (widthPts * heightPts));
  return Math.max(min, Math.floor(Math.min(preferred, dpiSide, dpiArea)));
}

// Render the source (PDF page or image) into a normalized full-sheet PNG.
// Returns { normPath, tmpDir }.
async function renderSheetToPng(drawingFilePath, drawingMimeType, sheetNumber) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'align-crop-'));
  const norm = path.join(tmp, 'normalized.png');

  if (drawingMimeType === 'application/pdf') {
    const pdfPage = (Number(sheetNumber) || 0) + 1; // 0-based sheet -> 1-based page
    let size = null;
    try { size = await pdfPageSize(drawingFilePath, pdfPage); } catch (e) { size = null; }
    const dpi = size ? adaptiveDpi(size.widthPts, size.heightPts) : 200;
    const prefix = path.join(tmp, 'page');
    await execFileAsync(
      '/usr/bin/pdftocairo',
      ['-png', '-singlefile', '-f', String(pdfPage), '-l', String(pdfPage), '-r', String(dpi), '-antialias', 'best', drawingFilePath, prefix],
      { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }
    );
    await sharp(prefix + '.png')
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .png({ compressionLevel: 6 })
      .toFile(norm);
  } else {
    await sharp(drawingFilePath, { failOn: 'error', limitInputPixels: 100000000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .png({ compressionLevel: 6 })
      .toFile(norm);
  }

  return { normPath: norm, tmpDir: tmp };
}

async function renderPunchlistCrop({ drawingFilePath, drawingMimeType, sheetNumber, vertices, listName, outputPath }) {
  if (!vertices || vertices.length < 3) throw new Error('At least 3 crop vertices required');
  for (const v of vertices) {
    if (!isFinite(v.x) || !isFinite(v.y) || v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1) {
      throw new Error('Crop vertices must be within 0..1');
    }
  }

  const { normPath, tmpDir } = await renderSheetToPng(drawingFilePath, drawingMimeType, sheetNumber);
  try {
    const meta = await sharp(normPath).metadata();
    const sheetW = meta.width, sheetH = meta.height;
    if (!sheetW || !sheetH) throw new Error('Could not read drawing dimensions');

    // Normalized -> full-sheet pixels.
    const px = vertices.map(v => ({ x: v.x * sheetW, y: v.y * sheetH }));

    // Integer bounding box fully containing the polygon.
    const x0 = Math.max(0, Math.floor(Math.min(...px.map(p => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...px.map(p => p.y))));
    const x1 = Math.min(sheetW, Math.ceil(Math.max(...px.map(p => p.x))));
    const y1 = Math.min(sheetH, Math.ceil(Math.max(...px.map(p => p.y))));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < MIN_CROP_SIDE_PX || bh < MIN_CROP_SIDE_PX) throw new Error('Crop area is too small');

    const local = px.map(p => ({ x: p.x - x0, y: p.y - y0 }));

    // Extract the polygon bbox from the full sheet.
    const extracted = await sharp(normPath)
      .extract({ left: x0, top: y0, width: bw, height: bh })
      .ensureAlpha()
      .png()
      .toBuffer();

    // Alpha mask: white polygon on transparent background, applied with dest-in.
    const pts = local.map(p => p.x.toFixed(3) + ',' + p.y.toFixed(3)).join(' ');
    const maskSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}">` +
      `<polygon points="${pts}" fill="#ffffff" fill-rule="evenodd"/></svg>`
    );
    const clipped = await sharp(extracted)
      .composite([{ input: maskSvg, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // Document layout.
    const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
    const margin = clamp(Math.round(bw * 0.025), 24, 96);
    const fontSize = clamp(Math.round(bw * 0.035), 32, 96);
    const headerPadY = clamp(Math.round(fontSize * 0.55), 16, 52);
    const lineHeight = Math.round(fontSize * 1.2);
    const headerHeight = headerPadY * 2 + lineHeight;
    const headerGap = clamp(Math.round(margin * 0.5), 12, 48);
    const docW = bw + margin * 2;
    const drawLeft = margin;
    const drawTop = headerHeight + headerGap;
    const docH = drawTop + bh + margin;

    const headerSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${docW}" height="${docH}" viewBox="0 0 ${docW} ${docH}">` +
      `<text x="${margin}" y="${headerPadY + fontSize}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#172033">${xmlEscape(listName)}</text>` +
      `<line x1="${margin}" y1="${headerHeight - 1}" x2="${docW - margin}" y2="${headerHeight - 1}" stroke="#d9dee7" stroke-width="2"/>` +
      `</svg>`
    );

    await sharp({
      create: { width: docW, height: docH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
    })
      .composite([
        { input: clipped, left: drawLeft, top: drawTop },
        { input: headerSvg, left: 0, top: 0 }
      ])
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outputPath);

    return {
      mimeType: 'image/png',
      sheetWidth: sheetW,
      sheetHeight: sheetH,
      bbox: { x: x0, y: y0, width: bw, height: bh },
      document: { width: docW, height: docH, drawingLeft: drawLeft, drawingTop: drawTop }
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { renderPunchlistCrop };
