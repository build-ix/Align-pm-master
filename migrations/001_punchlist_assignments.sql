-- migrations/001_punchlist_assignments.sql

-- Users need company scoping for assignment picker filtering
-- Safely check if column exists before adding
-- SQLite doesn't support IF NOT EXISTS for columns, so we use a pragmatic approach:
-- try to add it; if it fails due to duplicate, that's OK — the column already exists.

-- Punchlist assignment tracking (many-to-many between punch items and users)
-- NOTE: records has a composite primary key (id, project_id, category)
-- We do NOT use FK constraint here to avoid composite key issues.
-- App-layer validation: check record exists before creating assignment.
CREATE TABLE IF NOT EXISTS punchlist_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  punch_item_id TEXT NOT NULL,
  user_id       INTEGER NOT NULL,
  assigned_by   INTEGER NOT NULL,
  assigned_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (punch_item_id, user_id),
  FOREIGN KEY (user_id)       REFERENCES users(id),
  FOREIGN KEY (assigned_by)   REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pa_punch_item ON punchlist_assignments(punch_item_id);
CREATE INDEX IF NOT EXISTS idx_pa_user       ON punchlist_assignments(user_id);

-- Notification queue (Phase 1: queue only, email sending in Phase 2)
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
