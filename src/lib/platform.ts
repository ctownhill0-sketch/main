/**
 * Best-effort OS detection for chrome-only visual differences (e.g. macOS
 * traffic-light inset padding). Never gate actual functionality on this —
 * only cosmetics that degrade gracefully if detection is wrong.
 */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  return /Mac/.test(platform) || /Macintosh/.test(userAgent);
}
