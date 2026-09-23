-- `regularOpeningHours` was always requested inside MASK_DETAILS_ENTERPRISE
-- but never actually parsed or stored — this column fixes that so the
-- Refine bar's "open now" facet has real data to filter on. Raw JSON
-- (Google's `regularOpeningHours.periods` shape); no compliance-rule change
-- versus the other Enterprise-tier fields already in this table (transient,
-- re-fetched live via Place Details, never permanently warehoused as if it
-- were current without a "last refreshed" timestamp check).
ALTER TABLE places ADD COLUMN regular_opening_hours_json TEXT;
