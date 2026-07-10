/* config.js — single source of truth for paths and settings
 * Every module imports from here. No hardcoded paths anywhere else.
 */

const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  DATA_DIR: '/srv/align/data',
  DB_PATH: '/srv/align/data/align.db',
  FILES_DIR: '/srv/align/files',
  THUMBS_DIR: '/srv/align/files/thumbs',
  BACKUP_DIR: '/srv/align/backups',
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
  TOKEN_TTL_DAYS: 30,
  SESSION_TTL_DAYS: 30,
  APP_VERSION: '2.0.0',
  API_VERSION: 1,
  DEV_MODE: process.env.DEV_MODE === 'true' || process.env.NODE_ENV !== 'production',
};
