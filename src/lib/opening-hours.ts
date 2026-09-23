/**
 * Google's Places API (New) `regularOpeningHours` object already includes a
 * computed `openNow` boolean (Google handles the timezone math) — this just
 * reads it back out of the raw JSON stored in `PlaceRow.regularOpeningHoursJson`,
 * rather than re-deriving open/closed from `periods` ourselves.
 *
 * Returns `null` when unknown — a place with no Details fetch yet, or a
 * malformed/missing field — so callers can show "hours unknown" instead of
 * a false "closed", matching the existing WebsiteBadge convention for
 * not-yet-checked state.
 */
export function isOpenNow(regularOpeningHoursJson: string | null): boolean | null {
  if (!regularOpeningHoursJson) return null;
  try {
    const parsed: unknown = JSON.parse(regularOpeningHoursJson);
    if (
      parsed &&
      typeof parsed === "object" &&
      "openNow" in parsed &&
      typeof (parsed as { openNow: unknown }).openNow === "boolean"
    ) {
      return (parsed as { openNow: boolean }).openNow;
    }
    return null;
  } catch {
    return null;
  }
}
