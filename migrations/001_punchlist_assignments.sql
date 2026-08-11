-- migrations/001_punchlist_assignments.sql

-- Users need company scoping for assignment picker filtering
-- Safely check if column exists before adding
-- SQLite doesn't support IF NOT EXISTS for columns, so we use a pragmatic approach:
-- try to add it; if it fails due to duplicate, that's OK — the column already exists.

-- Punchlist assignment tracking (many-to-many between punch items and users)
-- NOTE: records has a composite primary key (id, project_id, category)
-- We do NOT use FK constraint here to avoid composite key issues.
-- Punchlist assignment tracking (Phase 1)
CREATE TABLE IF NOT EXISTS punchlist_assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  punch_item_id   TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  assigned_by     TEXT,
  assigned_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(punch_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pa_punch_item ON punchlist_assignments(punch_item_id);
CREATE INDEX IF NOT EXISTS idx_pa_user       ON punchlist_assignments(user_id);

-- Notification queue for punchlist assignments (Phase 2)
CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  punch_item_id   TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  notify_error    TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notif_pending ON notifications(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at);
