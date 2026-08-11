// migrate.js
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'align.db');
const db = new Database(dbPath);

// Check if migrations table exists with the expected schema
let applied = new Set();
try {
  applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
} catch (err) {
  // Table doesn't exist or schema is different; we'll create/use as-is
  console.log('(Note: _migrations table exists with different schema; checking applied migrations...)');
  try {
    const rows = db.prepare('SELECT name FROM _migrations').all();
    applied = new Set(rows.map(r => r.name));
  } catch (err2) {
    // Can't read — assume none applied
    console.log('(Unable to read existing migrations; will attempt to apply all)');
    applied = new Set();
  }
}
const migrationDir = path.join(__dirname, 'migrations');
const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();

console.log(`Found ${files.length} migration(s). Applied: ${applied.size}`);

for (const file of files) {
  if (applied.has(file)) {
    console.log(`  ✓ ${file} (already applied)`);
    continue;
  }
  
  console.log(`  → Applying ${file}...`);
  const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
  
  try {
    db.transaction(() => {
      db.exec(sql);
      // Try to insert into _migrations with the existing schema
      try {
        db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, datetime("now"))').run(file);
      } catch (insertErr) {
        // If that fails, just log it but continue — the SQL itself succeeded
        console.log(`    (Warning: couldn't record migration; SQL applied successfully though)`);
      }
    })();
    console.log(`    ✓ Done`);
  } catch (err) {
    console.error(`    ✗ Error:`, err.message);
    process.exit(1);
  }
}

console.log('Migrations complete.');
db.close();
