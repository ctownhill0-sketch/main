import { Skeleton } from "@/components/ui/skeleton";

export function PipelineTableSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2">
          <Skeleton className="h-4 w-36 shrink-0" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-8 w-32 shrink-0 rounded-md" />
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}
