/*
 * punchlist-crop-renderer.js
 * Server-side crop "document" generator for punchlist location maps.
 *
 * PDF sources  -> VECTOR single-page PDF (crisp text at any zoom):
 *     pdftocairo -eps -> PostScript wrapper (white bg + polygon clip + header)
 *     -> Ghostscript pdfwrite.
 * Image sources -> raster PNG (white bg + header), via sharp (no vector exists).
 *
 * Returns unified metadata (top-left origin) used by the client for pin mapping:
 *   { mimeType, sheetWidth, sheetHeight, bbox:{x,y,width,height},
 *     document:{width,height,drawingLeft,drawingTop} }
 */
'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const execFileAsync = promisify(execFile);

const MIN_CROP_SIDE = 1;        // PDF points (vector: even tiny crops are valid)
const MIN_RASTER_SIDE_PX = 32;
const HEADER_HEIGHT = 42;       // PDF points
const HEADER_FONT_SIZE = 16;

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
  });
}

function psNumber(value) {
  if (!Number.isFinite(value)) throw new Error('Non-finite PostScript number');
  return Number(value.toFixed(4)).toString();
}

function psHexString(value) {
  const ascii = String(value)
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '?');
  return '<' + Buffer.from(ascii, 'ascii').toString('hex') + '>';
}

function polygonPath(points) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('Crop polygon must have at least three vertices');
  }
  const first = points[0];
  const lines = ['newpath', `${psNumber(first.x)} ${psNumber(first.y)} moveto`];
  for (let i = 1; i < points.length; i++) {
    lines.push(`${psNumber(points[i].x)} ${psNumber(points[i].y)} lineto`);
  }
  lines.push('closepath');
  return lines.join('\n');
}

function parseEpsBoundingBox(epsBuffer) {
  const head = epsBuffer.subarray(0, Math.min(epsBuffer.length, 256 * 1024)).toString('latin1');
  const hiRes = head.match(/^%%HiResBoundingBox:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/m);
  const normal = head.match(/^%%BoundingBox:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/m);
  const match = hiRes || normal;
  if (!match) throw new Error('pdftocairo EPS has no bounding box');
  const [llx, lly, urx, ury] = match.slice(1).map(Number);
  if (![llx, lly, urx, ury].every(Number.isFinite) || urx <= llx || ury <= lly) {
    throw new Error('Invalid EPS bounding box');
  }
  return { llx, lly, urx, ury, width: urx - llx, height: ury - lly };
}

// ── PDF source → raster PNG (pdftoppm applies /Rotate, full page, top-left origin) ──
async function renderPdfCrop({ drawingFilePath, sheetNumber, vertices, listName, outputPath }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'align-map-'));
  const pdfPage = (Number(sheetNumber) || 0) + 1; // 0-based sheet -> 1-based page
  const pngBase = path.join(workDir, 'page');
  try {
    // Rasterize the full page. pdftoppm honors /Rotate and emits a top-left-origin
    // PNG whose aspect ratio matches the client's pdf.js viewport (e.g. 1.5 for
    // this 1728x2592 /Rotate-270 page -> 2592x1728). This keeps the server's crop
    // coordinate space identical to the client's normalized (0..1) coords.
    await execFileAsync('/usr/bin/pdftoppm', [
      '-f', String(pdfPage), '-l', String(pdfPage),
      '-singlefile', '-r', '200', '-png',
      drawingFilePath, pngBase
    ], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });

    const pngPath = pngBase + '.png';
    if (!fs.existsSync(pngPath)) throw new Error('pdftoppm produced no raster');

    // Reuse the raster crop path (extract + polygon mask + white header).
    // Must await so the temp dir (holding the raster) survives until it finishes.
    return await renderImageCrop({ drawingFilePath: pngPath, vertices, listName, outputPath });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Image source → raster PNG (no vector exists) ───────────────────────
async function renderImageCrop({ drawingFilePath, vertices, listName, outputPath }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'align-map-'));
  const norm = path.join(workDir, 'normalized.png');
  try {
    await sharp(drawingFilePath, { failOn: 'error', limitInputPixels: 100000000 })
      .rotate().flatten({ background: '#ffffff' }).toColourspace('srgb')
      .png({ compressionLevel: 6 }).toFile(norm);

    const meta = await sharp(norm).metadata();
    const sheetW = meta.width, sheetH = meta.height;
    const px = vertices.map(v => ({ x: v.x * sheetW, y: v.y * sheetH }));

    const x0 = Math.max(0, Math.floor(Math.min(...px.map(p => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...px.map(p => p.y))));
    const x1 = Math.min(sheetW, Math.ceil(Math.max(...px.map(p => p.x))));
    const y1 = Math.min(sheetH, Math.ceil(Math.max(...px.map(p => p.y))));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < MIN_RASTER_SIDE_PX || bh < MIN_RASTER_SIDE_PX) throw new Error('Crop area is too small');

    const local = px.map(p => ({ x: p.x - x0, y: p.y - y0 }));
    const extracted = await sharp(norm).extract({ left: x0, top: y0, width: bw, height: bh }).ensureAlpha().png().toBuffer();
    const pts = local.map(p => p.x.toFixed(3) + ',' + p.y.toFixed(3)).join(' ');
    const maskSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}"><polygon points="${pts}" fill="#ffffff" fill-rule="evenodd"/></svg>`);
    const clipped = await sharp(extracted).composite([{ input: maskSvg, blend: 'dest-in' }]).png().toBuffer();

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

    await sharp({ create: { width: docW, height: docH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .composite([{ input: clipped, left: drawLeft, top: drawTop }, { input: headerSvg, left: 0, top: 0 }])
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
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function renderPunchlistCrop({ drawingFilePath, drawingMimeType, sheetNumber, vertices, listName, outputPath }) {
  if (!vertices || vertices.length < 3) throw new Error('At least 3 crop vertices required');
  for (const v of vertices) {
    if (!isFinite(v.x) || !isFinite(v.y) || v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1) {
      throw new Error('Crop vertices must be within 0..1');
    }
  }
  if (drawingMimeType === 'application/pdf') {
    return renderPdfCrop({ drawingFilePath, sheetNumber, vertices, listName, outputPath });
  }
  return renderImageCrop({ drawingFilePath, vertices, listName, outputPath });
}

module.exports = { renderPunchlistCrop };
