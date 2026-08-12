-- Migration: Add punch_item_locations table for punchlist-drawing integration
-- Purpose: Link punchlist items to specific drawing pages with normalized coordinates
-- Created: Aug 11 2026

CREATE TABLE IF NOT EXISTS punch_item_locations (
  id TEXT PRIMARY KEY,
  punch_item_id TEXT NOT NULL,
  drawing_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sheet_number INTEGER NOT NULL,      -- page index within the PDF
  x REAL NOT NULL,                     -- normalized 0-1, relative to sheet width
  y REAL NOT NULL,                     -- normalized 0-1, relative to sheet height
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  
  UNIQUE(punch_item_id, drawing_id, sheet_number),
  
  -- Foreign key constraints (app-layer validation, SQLite doesn't enforce FKs by default)
  CHECK(x >= 0 AND x <= 1),
  CHECK(y >= 0 AND y <= 1),
  CHECK(sheet_number >= 0)
);

-- Index for fast lookup of pins on a specific drawing/sheet
CREATE INDEX IF NOT EXISTS idx_punch_locations_drawing 
  ON punch_item_locations(drawing_id, sheet_number);

-- Index for finding all drawings a punch item appears on
CREATE INDEX IF NOT EXISTS idx_punch_locations_item 
  ON punch_item_locations(punch_item_id);

-- Index for project scope queries
CREATE INDEX IF NOT EXISTS idx_punch_locations_project 
  ON punch_item_locations(project_id);
