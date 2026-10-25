import { cn } from "@/components/ui/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { StatPill } from "@/components/ui/stat-pill";
import { EMPTY_VALUE, formatNumber } from "@/lib/format";
import type { RegistryStatus, StatusCounts as Counts } from "@/lib/types/api";

const ITEMS: { key: RegistryStatus | "total"; label: string; dot: string }[] = [
  { key: "total", label: "Notes", dot: "bg-slate-400" },
  { key: "Active", label: "Active", dot: "bg-blue-500" },
  { key: "Settled", label: "Settled", dot: "bg-emerald-500" },
  { key: "Cancelled", label: "Cancelled", dot: "bg-amber-500" },
  { key: "WrittenOff", label: "Written off", dot: "bg-red-500" },
];

/**
 * Registry header: how many notes exist in each status (spec §10.2). Stat
 * pills from lg up; one compact glass card on phones and tablets.
 */
export function StatusCounts({ counts, loading = false, className }: { counts: Counts | null; loading?: boolean; className?: string }) {
  const value = (key: RegistryStatus | "total") => (counts ? formatNumber(counts[key] ?? 0) : EMPTY_VALUE);
  return (
    <div className={className} aria-busy={loading || undefined}>
      <h2 className="sr-only">Notes by status</h2>
      <ul className="hidden grid-cols-5 gap-3 lg:grid">
        {ITEMS.map((item) => (
          <li key={item.key} className="min-w-0">
            <StatPill
              variant="glass"
              size="sm"
              icon={<span aria-hidden className={cn("size-2 rounded-full", item.dot)} />}
              label={item.label}
              value={value(item.key)}
              loading={loading}
            />
          </li>
        ))}
      </ul>
      <ul className="grid grid-cols-3 gap-x-3 gap-y-3 rounded-card border border-slate-200/70 bg-white/60 px-4 py-3.5 shadow-pill backdrop-blur-sm md:grid-cols-5 md:px-6 lg:hidden dark:border-slate-700 dark:bg-slate-800/60">
        {ITEMS.map((item) => (
          <li key={item.key} className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", item.dot)} />
              <span className="truncate">{item.label}</span>
            </span>
            {loading ? (
              <Skeleton className="mt-1 h-6 w-10" />
            ) : (
              <span className="mt-0.5 text-xl leading-tight font-bold text-heading tabular-nums">{value(item.key)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
