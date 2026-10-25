import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/** Placeholder while the overview loads (first paint of /agent). */
export function AgentSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your card" className="mx-auto w-full max-w-7xl px-4 pt-6 pb-12 sm:pt-8">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-2 h-8 w-44" />
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col gap-5">
          <Skeleton className="aspect-[1.586/1] w-full rounded-[1.25rem]" />
          <Card radius="3xl" className="flex flex-col gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-11 w-48" />
            <SkeletonText lines={3} className="mt-2" />
            <Skeleton className="mt-2 h-12 w-full rounded-xl" />
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card radius="3xl" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-36 w-full rounded-2xl" />
          </Card>
          <Card radius="3xl" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-24" />
            <SkeletonText lines={4} />
          </Card>
        </div>
      </div>
    </div>
  );
}
