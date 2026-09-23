import { cn } from "@/lib/utils";

/**
 * The LeadScout mark — kept in sync by hand with
 * src-tauri/icons/source/leadscout-mark.svg (the source used to generate
 * the app icon). `currentColor` only; never a hardcoded hex, so it always
 * renders in whatever ink color the caller sets (`text-primary`,
 * `text-foreground`, etc.) — see DESIGN.md's Logo & Branding section.
 */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g strokeLinecap="round">
        <g fill="none" stroke="currentColor" strokeWidth="48">
          <polyline points="200,604 256.9,611.5 310,633.5 355.6,668.4 390.5,714 412.5,767.1 420,824" />
          <polyline points="200,424 303.5,437.6 400,477.6 482.8,541.2 546.4,624 586.4,720.5 600,824" />
          <polyline points="200,244 350.1,263.8 490,321.7 610.1,413.9 702.3,534 760.2,673.9 780,824" />
        </g>
        <circle fill="currentColor" cx="200" cy="824" r="45" />
        <circle fill="currentColor" cx="610.1" cy="413.9" r="58" />
      </g>
    </svg>
  );
}

export function Wordmark({
  variant = "full",
  className,
}: {
  variant?: "full" | "mark";
  className?: string;
}) {
  if (variant === "mark") {
    return <LogoMark className={cn("size-5", className)} />;
  }

  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark className="size-5 shrink-0" />
      <span className="text-sm font-semibold tracking-tight">LeadScout</span>
    </span>
  );
}
