-- Emails collected from a lead's own website (never from Google Maps
-- Content — Places has no email field at any tier). This is our data, not
-- subject to the Google caching-terms considerations that govern `places`.
CREATE TABLE IF NOT EXISTS lead_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(lead_id, email)
);
