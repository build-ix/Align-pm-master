/* thumbs.js — on-demand thumbnail generation via ImageMagick
 * Generates WebP thumbnails to /srv/align/files/thumbs/
 * Called after file upload or on first thumbnail request.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

function thumbPath(fileId, size) {
  return path.join(config.THUMBS_DIR, `${fileId}_${size}.webp`);
}

function generate(filePath, fileId, size) {
  var dest = thumbPath(fileId, size);
  if (fs.existsSync(dest)) return Promise.resolve(dest);

  return new Promise(function (resolve, reject) {
    execFile('convert', [
      filePath + '[0]',
      '-auto-orient',
      '-resize', size + 'x' + size + '>',
      '-quality', '80',
      '-strip',
      '-interlace', 'Plane',
      dest
    ], { timeout: 30000 }, function (err) {
      if (err) return reject(err);
      resolve(dest);
    });
  });
}

module.exports = { generate, thumbPath };
