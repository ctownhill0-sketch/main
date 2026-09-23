-- Auto-recorded search history (last 20 searches, oldest evicted) for the
-- search surface's "recent searches" list and one-click re-run. Distinct
-- from `saved_searches`, which is explicit/user-named/permanent — history
-- is ephemeral and capped, so conflating the two would force an awkward
-- "is this pinned" flag onto saved_searches.
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('quick', 'deep')),
  params_json TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  ran_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_history_ran_at ON search_history(ran_at);
