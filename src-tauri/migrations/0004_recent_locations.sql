-- Recently-geocoded locations, for the search surface's "recent locations"
-- dropdown (instant re-selection without a repeat Geocoding call). The
-- lat/lng columns here are a resolved area's bounding-box corners for UI
-- convenience, not per-place Google Maps Content, so the existing 30-day
-- cache-purge job for `places.cached_lat/cached_lng` does NOT apply to this
-- table — nothing here is subject to that compliance rule.
CREATE TABLE IF NOT EXISTS recent_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  formatted_address TEXT NOT NULL UNIQUE,
  low_lat REAL NOT NULL,
  low_lng REAL NOT NULL,
  high_lat REAL NOT NULL,
  high_lng REAL NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  use_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_recent_locations_last_used_at ON recent_locations(last_used_at);
