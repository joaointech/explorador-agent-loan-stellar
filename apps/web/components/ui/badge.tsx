import type { ReactNode } from "react";

import type { AuthDecision, ChainStatus, CpcvStatus, RegistryStatus } from "@/lib/types/api";

import { cn } from "./cn";

export type BadgeTone = "neutral" | "blue" | "emerald" | "amber" | "red" | "orange" | "violet";
export type BadgeVariant = "soft" | "outline" | "solid";

const SOFT: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/25",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/25",
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/25",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/25",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/25",
};

const OUTLINE: Record<BadgeTone, string> = {
  neutral: "text-slate-600 ring-slate-400 dark:text-slate-300 dark:ring-slate-500",
  blue: "text-blue-700 ring-blue-500 dark:text-blue-300 dark:ring-blue-400/70",
  emerald: "text-emerald-700 ring-emerald-500 dark:text-emerald-300 dark:ring-emerald-400/70",
  amber: "text-amber-700 ring-amber-500 dark:text-amber-300 dark:ring-amber-400/70",
  red: "text-red-700 ring-red-500 dark:text-red-300 dark:ring-red-400/70",
  orange: "text-orange-700 ring-orange-500 dark:text-orange-300 dark:ring-orange-400/70",
  violet: "text-violet-700 ring-violet-500 dark:text-violet-300 dark:ring-violet-400/70",
};

const SOLID: Record<BadgeTone, string> = {
  neutral: "bg-slate-700 text-white ring-transparent dark:bg-slate-600",
  blue: "bg-blue-600 text-white ring-transparent dark:bg-blue-500",
  emerald: "bg-emerald-600 text-white ring-transparent dark:bg-emerald-500",
  amber: "bg-amber-500 text-amber-950 ring-transparent",
  red: "bg-red-600 text-white ring-transparent dark:bg-red-500",
  orange: "bg-orange-500 text-white ring-transparent",
  violet: "bg-violet-600 text-white ring-transparent dark:bg-violet-500",
};

/** Small rounded label. `dot` adds a status dot; `pulse` animates it (pending states). */
export function Badge({
  tone = "neutral",
  variant = "soft",
  size = "sm",
  dot = false,
  pulse = false,
  icon,
  title,
  className,
  children,
}: {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  dot?: boolean;
  pulse?: boolean;
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const palette = variant === "outline" ? OUTLINE[tone] : variant === "solid" ? SOLID[tone] : SOFT[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ring-1 ring-inset [&_svg]:size-3.5",
        size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs leading-5",
        variant === "outline" && "bg-transparent",
        palette,
        className,
      )}
    >
      {dot && (
        <span aria-hidden className="relative flex size-1.5">
          {pulse && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {icon}
      {children}
    </span>
  );
}

/** Every status the UI shows: registry, CPCV lifecycle, on-chain tx state, card decisions, plus Overdue. */
export type StatusKind = RegistryStatus | "Overdue" | CpcvStatus | ChainStatus | AuthDecision;

const STATUS: Record<StatusKind, { label: string; tone: BadgeTone; variant?: BadgeVariant; pulse?: boolean }> = {
  // Spec §10.1: Active blue, Settled emerald, Cancelled amber, Written off red, Overdue orange outline.
  Active: { label: "Active", tone: "blue" },
  Settled: { label: "Settled", tone: "emerald" },
  Cancelled: { label: "Cancelled", tone: "amber" },
  WrittenOff: { label: "Written off", tone: "red" },
  Overdue: { label: "Overdue", tone: "orange", variant: "outline" },
  // CPCV lifecycle (admin): a minted CPCV is an active note.
  DRAFT: { label: "Draft", tone: "neutral" },
  PROVING: { label: "Proving", tone: "violet", pulse: true },
  MINTED: { label: "Active", tone: "blue" },
  SETTLED: { label: "Settled", tone: "emerald" },
  CANCELLED: { label: "Cancelled", tone: "amber" },
  WRITTEN_OFF: { label: "Written off", tone: "red" },
  FAILED: { label: "Failed", tone: "red" },
  // On-chain confirmation of card draws and other txs.
  PENDING: { label: "Pending", tone: "neutral", pulse: true },
  SUBMITTED: { label: "Submitted", tone: "blue", pulse: true },
  CONFIRMED: { label: "Confirmed", tone: "emerald" },
  // Card authorization decision.
  APPROVED: { label: "Approved", tone: "emerald" },
  DECLINED: { label: "Declined", tone: "red" },
};

/** Human label for a status (e.g. "WrittenOff" → "Written off"). */
export function statusLabel(status: StatusKind | string): string {
  return STATUS[status as StatusKind]?.label ?? status;
}

/**
 * Status badge with the spec colours.
 *
 *   <StatusBadge status={note.status} />           // Active / Settled / Cancelled / WrittenOff
 *   {note.overdue && <StatusBadge status="Overdue" />}
 *   <StatusBadge status={row.chainStatus} />       // PENDING / SUBMITTED / CONFIRMED / FAILED
 */
export function StatusBadge({
  status,
  size = "sm",
  className,
  label,
}: {
  status: StatusKind | (string & {});
  size?: "sm" | "md";
  className?: string;
  /** Override the default label. */
  label?: string;
}) {
  const def = STATUS[status as StatusKind] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={def.tone} variant={def.variant ?? "soft"} size={size} dot pulse={def.pulse} className={className}>
      {label ?? def.label}
    </Badge>
  );
}
