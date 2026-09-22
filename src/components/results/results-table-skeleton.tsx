import { Skeleton } from "@/components/ui/skeleton";

/** Structural placeholder shown while the initial place list loads —
 * mirrors the real grid's column proportions so the layout doesn't shift
 * once data arrives. A paint-only animate-pulse on a small area is fine
 * per fixing-motion-performance's rules. */
export function ResultsTableSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2">
          <Skeleton className="size-4 shrink-0" />
          <Skeleton className="h-4 w-40 shrink-0" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-5 w-24 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}
