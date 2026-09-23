/**
 * Small decorative illustrations for empty states, built from the same
 * geometric language as the app mark (thin single-weight strokes, one
 * color via `currentColor` — never a hardcoded hex or a new hue).
 */
export function EmptyStateIllustration({
  kind,
  className,
}: {
  kind: "results" | "pipeline";
  className?: string;
}) {
  if (kind === "pipeline") {
    return (
      <svg viewBox="0 0 200 200" fill="none" className={className} aria-hidden="true">
        <rect
          x="40"
          y="32"
          width="120"
          height="136"
          rx="14"
          stroke="currentColor"
          strokeWidth="6"
        />
        <line x1="62" y1="70" x2="138" y2="70" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <line x1="62" y1="100" x2="120" y2="100" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <line x1="62" y1="130" x2="106" y2="130" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 200 200" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray="2 14">
        <circle cx="40" cy="160" r="46" />
        <circle cx="40" cy="160" r="80" />
        <circle cx="40" cy="160" r="114" />
      </g>
      <circle cx="40" cy="160" r="9" fill="currentColor" />
    </svg>
  );
}
