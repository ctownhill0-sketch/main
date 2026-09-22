-- Initial schema.
--
-- Compliance note (see CLAUDE.md): `places.place_id` rows are kept forever
-- (Google Maps Platform ToS §3.2.3(b) exempts place IDs from caching limits).
-- `cached_lat`/`cached_lng`/`cached_at` are purged after 30 days by the
-- startup cleanup job in src-tauri/src/db.rs. Other Google Maps Content
-- (name, address, phone, website, rating, hours) is treated as transient
-- display data, re-fetched live via Place Details when shown/exported, and
-- is not covered by a long-lived cache column here.

CREATE TABLE IF NOT EXISTS places (
  place_id TEXT PRIMARY KEY,
  display_name TEXT,
  formatted_address TEXT,
  primary_type TEXT,
  business_status TEXT,
  cached_lat REAL,
  cached_lng REAL,
  cached_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_details_refreshed_at TEXT
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id TEXT NOT NULL UNIQUE REFERENCES places(place_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'New',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS lead_tags (
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, tag_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  params_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_at TEXT
);

-- Tracks which places have already been surfaced for a saved search, so a
-- re-run can highlight only the place IDs seen for the first time.
CREATE TABLE IF NOT EXISTS saved_search_seen_places (
  saved_search_id INTEGER NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(place_id) ON DELETE CASCADE,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (saved_search_id, place_id)
);

CREATE TABLE IF NOT EXISTS api_call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  called_at TEXT NOT NULL DEFAULT (datetime('now')),
  endpoint TEXT NOT NULL,
  mask_name TEXT NOT NULL,
  tier TEXT NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  success INTEGER NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_api_call_log_called_at ON api_call_log(called_at);
CREATE INDEX IF NOT EXISTS idx_places_cached_at ON places(cached_at);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('monthly_spend_cap_usd', '50'),
  ('per_run_call_cap', '200'),
  ('rate_limit_qps', '5');
