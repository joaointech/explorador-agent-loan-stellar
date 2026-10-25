import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * Friendly empty or zero-data state: icon tile, title, one line of help and an
 * optional action.
 *
 *   <EmptyState icon={<Inbox />} title="No deals yet" description="Your CPCV Notes appear here once explorador mints them." />
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "dashed",
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** `dashed` = standalone dashed box; `plain` = inside a card or table. */
  variant?: "dashed" | "plain";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-10 text-center",
        variant === "dashed" && "rounded-card border border-dashed border-slate-300 bg-card-muted/60 dark:border-slate-700",
        className,
      )}
    >
      {icon && (
        <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary-tint text-primary-text ring-1 ring-primary/15 [&_svg]:size-6">
          {icon}
        </span>
      )}
      <p className="text-base font-semibold text-heading">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
