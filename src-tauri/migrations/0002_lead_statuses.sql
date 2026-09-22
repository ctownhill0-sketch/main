-- Editable pipeline statuses, stored as a JSON array so Settings can
-- add/rename/remove them without a schema change.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('lead_statuses', '["New","Contacted","Qualified","Won","Lost"]');
