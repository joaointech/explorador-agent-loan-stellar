import * as React from "react";
import { ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { Badge } from "@/components/ui/badge";
import { addressExplorerUrl, explorerUrl, truncateAddress, truncateHex } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgentDealDto, NoteStatusDto } from "@/lib/api-types";

export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("eyebrow", className)} {...props} />;
}

/** Two-tone headline: dark first line, key phrase in blue-600. */
export function TwoTone({ first, second, as: Tag = "h2", className }: { first: React.ReactNode; second: React.ReactNode; as?: "h1" | "h2" | "h3"; className?: string }) {
  return (
    <Tag className={cn(Tag === "h1" ? "h1" : Tag === "h2" ? "h2" : "h3", "text-ink", className)}>
      <span className="block">{first}</span>
      <span className="block text-primary">{second}</span>
    </Tag>
  );
}

export function PageHeader({
  eyebrow,
  first,
  second,
  children,
  className,
}: {
  eyebrow: string;
  first: React.ReactNode;
  second?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("relative overflow-hidden bg-warm", className)}>
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:py-10">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 text-[30px] font-bold leading-[1.08] tracking-tight text-ink sm:text-[40px]">
          <span>{first}</span> {second && <span className="text-primary">{second}</span>}
        </h1>
        {children}
      </div>
    </section>
  );
}

/** Small white card with a tiny uppercase label above a big tabular number (§10.1). */
export function StatPill({ label, value, hint, className, loading }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string; loading?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_4px_16px_-8px_rgba(15,23,42,0.18)]", className)}>
      <span className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">{label}</span>
      <span className={cn("mt-1 truncate text-xl font-bold tabular-nums text-ink sm:text-2xl", loading && "animate-pulse text-muted")}>{value}</span>
      {hint && <span className="mt-0.5 truncate text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function Address({ value, className, head = 4, tail = 4, link = true }: { value: string; className?: string; head?: number; tail?: number; link?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-[13px] tabular-nums", className)}>
      {link ? (
        <a href={addressExplorerUrl(value)} target="_blank" rel="noopener noreferrer" className="truncate hover:text-primary hover:underline" title={value}>
          {truncateAddress(value, head, tail)}
        </a>
      ) : (
        <span className="truncate" title={value}>
          {truncateAddress(value, head, tail)}
        </span>
      )}
      <CopyButton value={value} label="Copy address" />
    </span>
  );
}

export function TxLink({ hash, className, label }: { hash: string | null | undefined; className?: string; label?: string }) {
  if (!hash) return <span className={cn("text-muted", className)}>—</span>;
  return (
    <a
      href={explorerUrl("tx", hash)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 font-mono text-[13px] text-primary hover:underline", className)}
      title={hash}
    >
      {label ?? truncateHex(hash, 6)}
      <ExternalLink className="size-3" />
    </a>
  );
}

export function HexValue({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-[13px]", className)}>
      <span className="truncate" title={value}>
        {truncateHex(value, 10)}
      </span>
      <CopyButton value={value} />
    </span>
  );
}

const noteTone: Record<NoteStatusDto, "blue" | "emerald" | "amber" | "red"> = {
  Active: "blue",
  Settled: "emerald",
  Cancelled: "amber",
  WrittenOff: "red",
};

export function NoteStatusBadge({ status, className }: { status: NoteStatusDto; className?: string }) {
  return (
    <Badge tone={noteTone[status]} className={className}>
      {status === "WrittenOff" ? "Written off" : status}
    </Badge>
  );
}

export function DealStatusBadge({ status, className }: { status: AgentDealDto["status"]; className?: string }) {
  const map: Record<AgentDealDto["status"], { tone: "blue" | "emerald" | "amber" | "red" | "slate" | "violet"; label: string }> = {
    DRAFT: { tone: "slate", label: "Draft" },
    PROVING: { tone: "violet", label: "Proving" },
    MINTED: { tone: "blue", label: "Active" },
    SETTLED: { tone: "emerald", label: "Settled" },
    CANCELLED: { tone: "amber", label: "Cancelled" },
    WRITTEN_OFF: { tone: "red", label: "Written off" },
    FAILED: { tone: "red", label: "Failed" },
  };
  const m = map[status];
  return (
    <Badge tone={m.tone} className={className}>
      {m.label}
    </Badge>
  );
}

export function OverdueBadge({ className }: { className?: string }) {
  return (
    <Badge tone="orange" className={className}>
      Overdue
    </Badge>
  );
}

export function ErrorNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300", className)}>{children}</div>;
}

export function InfoNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl bg-primary-faint px-3.5 py-2.5 text-sm text-ink-soft", className)}>{children}</div>;
}

export function EmptyState({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-10 text-center", className)}>
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}
