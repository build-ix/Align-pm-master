#!/usr/bin/env node
// Backfill missing .thumb.jpg sidecars for existing files (images + PDFs).
// Read-only on the DB (SELECT only); writes only NEW thumbnail files on disk.
'use strict';
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const DB_PATH = path.join(__dirname, 'data', 'align.db');
const db = new Database(DB_PATH, { readonly: true });

const files = db.prepare("SELECT id, stored_path, mime_type FROM files WHERE type='file' AND trashed=0").all();
db.close();

let pending = files.filter(f => {
  if (!f.stored_path || !fs.existsSync(f.stored_path)) return false;      // file gone from disk
  if (fs.existsSync(f.stored_path + '.thumb.jpg')) return false;          // already has thumb
  return (f.mime_type && (f.mime_type.startsWith('image/') || f.mime_type === 'application/pdf'));
});

console.log(`Found ${files.length} files; ${pending.length} need a thumbnail.`);

let i = 0, done = 0, errored = 0;

function next() {
  if (i >= pending.length) {
    console.log(`DONE. ${done} generated, ${errored} errored, ${pending.length - done - errored} skipped.`);
    process.exit(0);
  }
  const f = pending[i++];
  const thumbPath = f.stored_path + '.thumb.jpg';

  const finish = (ok) => {
    if (ok) { done++; console.log(`  [${done}/${pending.length}] ok ${f.id}`); }
    else { errored++; console.log(`  [error] ${f.id}`); }
    // small delay to avoid hammering the CPU with pdftoppm
    setTimeout(next, 150);
  };

  if (f.mime_type.startsWith('image/')) {
    sharp(f.stored_path).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 })
      .toFile(thumbPath).then(() => finish(true)).catch(() => finish(false));
  } else if (f.mime_type === 'application/pdf') {
    const tmpBase = f.stored_path + '.tmpthumb';
    execFile('pdftoppm', ['-f', '1', '-l', '1', '-r', '150', '-png', f.stored_path, tmpBase], { timeout: 60000 }, function (err) {
      if (err) { return finish(false); }
      const tmpPng = tmpBase + '-1.png';
      if (!fs.existsSync(tmpPng)) { return finish(false); }
      sharp(tmpPng).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 })
        .toFile(thumbPath)
        .then(() => { try { fs.unlinkSync(tmpPng); } catch (e) {} finish(true); })
        .catch(() => { try { fs.unlinkSync(tmpPng); } catch (e) {} finish(false); });
    });
  } else {
    finish(false);
  }
}

next();
