/*
 * migrations.js — Versioned database migration runner for Align PM
 * =================================================================
 * Uses sql.js (pure JS — no native modules). 
 * Tracks applied migrations in a _migrations meta-table.
 * Designed to work with both fresh installs and legacy databases
 * that were created before the migration runner existed.
 *
 * USAGE:  const { runMigrations } = require('./migrations');
 *         runMigrations(_db);  // pass raw sql.js Database instance
 */

const MIGRATIONS = [
  /* ── v1: users ─────────────────────────────────────────────────── */
  {
    version: 1,
    name: 'create_users',
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id              TEXT PRIMARY KEY,
          username        TEXT UNIQUE,
          email           TEXT NOT NULL UNIQUE,
          name            TEXT NOT NULL,
          pin_hash        TEXT NOT NULL,
          role            TEXT NOT NULL DEFAULT 'user',
          status          TEXT NOT NULL DEFAULT 'active',
          invite_token    TEXT,
          active_project_id TEXT,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until    TEXT,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        )
      `);
    }
  },

  /* ── v2: projects ──────────────────────────────────────────────── */
  {
    version: 2,
    name: 'create_projects',
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS projects (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          address    TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    }
  },

  /* ── v3: user_projects (junction) ──────────────────────────────── */
  {
    version: 3,
    name: 'create_user_projects',
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS user_projects (
          user_id     TEXT NOT NULL,
          project_id  TEXT NOT NULL,
          permissions TEXT NOT NULL DEFAULT '{}',
          role        TEXT NOT NULL DEFAULT 'member',
          PRIMARY KEY (user_id, project_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
    }
  },

  /* ── v4: records (polymorphic data store) ──────────────────────── */
  {
    version: 4,
    name: 'create_records',
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS records (
          id         TEXT NOT NULL,
          project_id TEXT NOT NULL,
          category   TEXT NOT NULL,
          data       TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id, project_id, category),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
    }
  },

  /* ── v5: sessions ──────────────────────────────────────────────── */
  {
    version: 5,
    name: 'create_sessions',
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    }
  },

  /* ── v6: files ─────────────────────────────────────────────────── */
  {
    version: 6,
    name: 'create_files',
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS files (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL,
          folder_id     TEXT,
          type          TEXT NOT NULL DEFAULT 'file',
          filename      TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type     TEXT NOT NULL,
          size_bytes    INTEGER NOT NULL,
          stored_path   TEXT NOT NULL,
          trashed       INTEGER NOT NULL DEFAULT 0,
          trashed_at    TEXT,
          uploaded_by   TEXT,
          created_at    TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
    }
  },

  /* ── v7: invites (standalone table for proper invite lifecycle) ── */
  {
    version: 7,
    name: 'create_invites',
    up(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS invites (
          id           TEXT PRIMARY KEY,
          code         TEXT NOT NULL UNIQUE,
          email        TEXT NOT NULL,
          name         TEXT NOT NULL,
          role         TEXT NOT NULL DEFAULT 'user',
          project_id   TEXT,
          project_role TEXT DEFAULT 'member',
          created_by   TEXT NOT NULL,
          used_by      TEXT,
          status       TEXT NOT NULL DEFAULT 'pending',
          created_at   TEXT NOT NULL,
          expires_at   TEXT,
          redeemed_at  TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
          FOREIGN KEY (created_by) REFERENCES users(id),
          FOREIGN KEY (used_by) REFERENCES users(id)
        )
      `);
    }
  },

  /* ── v8: schema hardening (legacy column additions) ────────────── */
  {
    version: 8,
    name: 'legacy_column_additions',
    up(db) {
      // These columns may already exist in databases created before the
      // migration runner. ALTER TABLE … ADD COLUMN will fail if the
      // column already exists in sql.js, so we wrap in try/catch.
      const safeAdd = (sql) => { try { db.exec(sql); } catch (e) { /* already exists */ } };

      safeAdd("ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0");
      safeAdd("ALTER TABLE users ADD COLUMN locked_until TEXT");
      safeAdd("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
      safeAdd("ALTER TABLE users ADD COLUMN invite_token TEXT");
      safeAdd("ALTER TABLE users ADD COLUMN username TEXT");
      safeAdd("ALTER TABLE sessions ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''");
      safeAdd("ALTER TABLE files ADD COLUMN folder_id TEXT");
      safeAdd("ALTER TABLE files ADD COLUMN type TEXT NOT NULL DEFAULT 'file'");
      safeAdd("ALTER TABLE files ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0");
      safeAdd("ALTER TABLE files ADD COLUMN trashed_at TEXT");
      safeAdd("ALTER TABLE files ADD COLUMN uploaded_by TEXT");
    }
  },

  /* ── v9: performance indexes ───────────────────────────────────── */
  {
    version: 9,
    name: 'add_punchlist_indexes',
    up(db) {
      const safeIdx = (sql) => { try { db.run(sql); } catch (e) { /* sql.js may not support partial indexes */ } };

      safeIdx("CREATE INDEX IF NOT EXISTS idx_rec_pl_status   ON records(json_extract(data, '$.status'))   WHERE category = 'punchlist'");
      safeIdx("CREATE INDEX IF NOT EXISTS idx_rec_pl_trade    ON records(json_extract(data, '$.trade'))    WHERE category = 'punchlist'");
      safeIdx("CREATE INDEX IF NOT EXISTS idx_rec_pl_priority ON records(json_extract(data, '$.priority')) WHERE category = 'punchlist'");
      safeIdx("CREATE INDEX IF NOT EXISTS idx_rec_pl_dueDate  ON records(json_extract(data, '$.dueDate'))  WHERE category = 'punchlist'");
      safeIdx("CREATE INDEX IF NOT EXISTS idx_rec_pl_created  ON records(json_extract(data, '$.createdAt')) WHERE category = 'punchlist'");
    }
  },

  /* ── v10: sessions expiry backfill ─────────────────────────────── */
  {
    version: 10,
    name: 'backfill_session_expiry',
    up(db) {
      // Set expiry for any legacy sessions that don't have one (30 days from now)
      var d = new Date();
      d.setDate(d.getDate() + 30);
      var expiry = d.toISOString();
      db.prepare("UPDATE sessions SET expires_at = ? WHERE expires_at = '' OR expires_at IS NULL").run(expiry);
    }
  },

  /* ── v11: scrypt password columns ──────────────────────────────── */
  {
    version: 11,
    name: 'add_scrypt_password_columns',
    up(db) {
      const safeAdd = (sql) => { try { db.exec(sql); } catch (e) { /* already exists */ } };
      safeAdd("ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''");
      safeAdd("ALTER TABLE users ADD COLUMN password_salt TEXT NOT NULL DEFAULT ''");
    }
  },

  /* ── v12: seed admin memberships (data migration) ───────────────── */
  {
    version: 12,
    name: 'seed_admin_memberships',
    up(db) {
      // Add every server admin to every project as project admin.
      // Uses INSERT OR IGNORE — safe to run multiple times.
      var admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map(function(r) { return r.id; });
      var projects = db.prepare("SELECT id FROM projects").all().map(function(r) { return r.id; });

      var seeded = 0;
      var insert = db.prepare("INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role) VALUES (?, ?, '{}', 'admin')");
      for (var ai = 0; ai < admins.length; ai++) {
        for (var pi = 0; pi < projects.length; pi++) {
          insert.run(admins[ai], projects[pi]);
          seeded++;
        }
      }
      if (seeded > 0) {
        console.log('[MIGRATIONS]  Seeded ' + admins.length + ' admin(s) into ' + projects.length + ' project(s)');
      }
    }
  },

  /* ── v13: audit log ──────────────────────────────────────────── */
  {
    version: 13,
    name: 'create_audit_log',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          record_id  TEXT NOT NULL,
          project_id TEXT NOT NULL,
          category   TEXT NOT NULL,
          action     TEXT NOT NULL,
          user_id    TEXT,
          user_name  TEXT,
          old_data   TEXT,
          new_data   TEXT,
          changed_at TEXT NOT NULL
        )
      `);
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(record_id)"); } catch(e) {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id)"); } catch(e) {}
    }
  },

  /* ── v14: clean up superadmin from user_projects ──────────────── */
  {
    version: 14,
    name: 'remove_superadmin_role',
    up(db) {
      db.prepare("UPDATE user_projects SET role = 'admin' WHERE role = 'superadmin'").run();
      db.prepare("UPDATE user_projects SET role = 'admin' WHERE role NOT IN ('admin', 'member')").run();
    }
  },

  /* ── v15: people merge (absorb invites into users) ────────────── */
  {
    version: 15,
    name: 'people_merge',
    up(db) {
      const safeAdd = (sql) => { try { db.exec(sql); } catch (e) { /* already exists */ } };

      // Add invite columns to users
      safeAdd("ALTER TABLE users ADD COLUMN invite_status TEXT DEFAULT NULL");
      safeAdd("ALTER TABLE users ADD COLUMN invite_code TEXT DEFAULT NULL");
      safeAdd("ALTER TABLE users ADD COLUMN invited_by TEXT DEFAULT NULL");
      safeAdd("ALTER TABLE users ADD COLUMN invited_at TEXT DEFAULT NULL");
      safeAdd("ALTER TABLE users ADD COLUMN invite_expires_at TEXT DEFAULT NULL");
      safeAdd("ALTER TABLE users ADD COLUMN last_invite_sent_at TEXT DEFAULT NULL");

      try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code) WHERE invite_code IS NOT NULL"); } catch(e) {}

      // Migrate pending invites into users (create shadow accounts)
      var pendingInvites = db.prepare("SELECT * FROM invites WHERE status = 'pending'").all();

      pendingInvites.forEach(function(i) {
        // Check if user already exists by email
        var existing = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").get(i.email);

        if (!existing) {
          // Create shadow user from invite
          var uid = i.id || 'u_' + Date.now().toString(36);
          var ts = i.created_at || new Date().toISOString();
          db.prepare(
            "INSERT INTO users (id, email, name, role, status, invite_code, invite_status, invited_by, invited_at, invite_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, 'pending', ?, ?, ?, ?, ?)"
          ).run(uid, i.email.toLowerCase().trim(), i.name, i.role || 'user', i.code, i.created_by, ts, i.expires_at, ts, ts);
        }

        // Assign to project if invite has one
        if (i.project_id) {
          var userId = existing ? existing.id : uid;
          db.prepare(
            "INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role) VALUES (?, ?, '{}', ?)"
          ).run(userId, i.project_id, i.project_role || 'member');
        }
      });

      // Backfill: set existing active users
      db.prepare("UPDATE users SET status = 'active' WHERE status IS NULL OR status = '' OR status = 'invited'").run();
      db.prepare("UPDATE users SET invite_status = 'accepted' WHERE invite_status IS NULL AND status = 'active' AND invite_code IS NOT NULL").run();
    }
  },

  /* ── v16: idempotency keys (sync dedup) ─────────────────────── */
  {
    version: 16,
    name: 'create_idempotency_keys',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key        TEXT PRIMARY KEY,
          response   TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency_keys(created_at)"); } catch(e) {}
    }
  },
  /* ── v17: invite brute-force protection ────────────────────────── */
  {
    version: 17,
    name: 'add_invite_failed_attempts',
    up(db) {
      const safeAdd = (sql) => { try { db.exec(sql); } catch (e) { /* already exists */ } };
      safeAdd("ALTER TABLE invites ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0");
      safeAdd("ALTER TABLE invites ADD COLUMN revoked_at TEXT");
    }
  },
  /* ── v18: punchlist companies + assignments ───────────────────── */
  {
    version: 18,
    name: 'punchlist_companies',
    up(db) {
      const safeAdd = (sql) => { try { db.exec(sql); } catch (e) { /* already exists */ } };

      // Companies table — per-project
      db.exec(`
        CREATE TABLE IF NOT EXISTS companies (
          id         TEXT NOT NULL,
          project_id TEXT NOT NULL,
          name       TEXT NOT NULL,
          trade      TEXT,
          color      TEXT DEFAULT '#6366F1',
          active     INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          PRIMARY KEY (id, project_id),
          UNIQUE (project_id, name),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);

      // Company membership on user_projects
      safeAdd("ALTER TABLE user_projects ADD COLUMN company_id TEXT");

      // Virtual generated columns on records for punchlist queries
      safeAdd("ALTER TABLE records ADD COLUMN pl_apartment TEXT GENERATED ALWAYS AS (json_extract(data, '$.apartment')) VIRTUAL");
      safeAdd("ALTER TABLE records ADD COLUMN pl_company TEXT GENERATED ALWAYS AS (json_extract(data, '$.assignedCompanyId')) VIRTUAL");

      // Partial indexes for punchlist queries
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_rec_pl_apt ON records(project_id, pl_apartment) WHERE category = 'punchlist'"); } catch(e) {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_rec_pl_co ON records(project_id, pl_company) WHERE category = 'punchlist'"); } catch(e) {}
    }
  },
  /* ── v19: auth_tokens for bearer token auth ────────────────────────── */
  {
    version: 19,
    name: 'auth_tokens',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_tokens (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL REFERENCES users(id),
          token_hash  TEXT NOT NULL UNIQUE,
          expires_at  INTEGER NOT NULL,
          created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        )
      `);
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id)"); } catch(e) {}
    }
  }
];

/* ═══════════════════════════════════════════════════════════════════
 * MIGRATION RUNNER
 * ═══════════════════════════════════════════════════════════════════ */

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function getCurrentVersion(db) {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT MAX(version) AS version FROM _migrations').get();
  return row ? (row.version || 0) : 0;
}

function detectLegacyDb(db) {
  // Returns true if all 6 base tables exist but _migrations is empty (legacy DB)
  const required = ['users', 'projects', 'user_projects', 'records', 'sessions', 'files'];
  for (const name of required) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
    if (!row) return false;
  }
  return true;
}

function seedLegacyVersion(db) {
  const ts = new Date().toISOString();
  console.log('[MIGRATIONS] Seeding legacy migration history (v1–v6)');
  const insert = db.prepare('INSERT OR IGNORE INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (const m of MIGRATIONS) {
    if (m.version <= 6) {
      insert.run(m.version, m.name + ' (legacy)', ts);
    }
  }
}

function runMigrations(db) {
  ensureMigrationsTable(db);
  let currentVersion = getCurrentVersion(db);

  console.log('[MIGRATIONS] Current database version: v' + currentVersion);

  // Detect legacy DB: tables exist but no migration records
  if (currentVersion === 0 && detectLegacyDb(db)) {
    seedLegacyVersion(db);
    currentVersion = getCurrentVersion(db);
    console.log('[MIGRATIONS] Legacy DB recognized — starting from v' + currentVersion);
  }

  const pending = MIGRATIONS
    .filter(m => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    console.log('[MIGRATIONS] Database is up to date.');
    return 0;
  }

  const targetVersion = pending[pending.length - 1].version;
  console.log('[MIGRATIONS] Applying ' + pending.length + ' migration(s): v' + currentVersion + ' → v' + targetVersion);

  for (const m of pending) {
    const ts = new Date().toISOString();
    console.log('[MIGRATIONS]  v' + m.version + ': ' + m.name);
    // Run each migration in a transaction
    db.transaction(() => m.up(db))();
    db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, ts);
  }

  console.log('[MIGRATIONS] Done. Database is now at v' + targetVersion);
  return pending.length;
}

/* ═══════════════════════════════════════════════════════════════════
 * EXPORTS
 * ═══════════════════════════════════════════════════════════════════ */

module.exports = { runMigrations, MIGRATIONS };
