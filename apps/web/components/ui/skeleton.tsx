import { cn } from "./cn";

/**
 * Shimmering placeholder block; size it with `className`. Compose several to
 * mirror the shape of loading content. Decorative (hidden from assistive tech):
 * put `aria-busy` on the region that is loading.
 *
 *   <Skeleton className="h-8 w-2/3" />
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-700/70", className)} />;
}

/** Paragraph placeholder: `lines` bars, the last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
