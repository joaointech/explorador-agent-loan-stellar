import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

export type CardVariant = "default" | "glass" | "muted" | "brand";
export type CardPadding = "none" | "sm" | "md" | "lg";

const VARIANTS: Record<CardVariant, string> = {
  // White, 1px slate-200/70 border, barely-there shadow (spec §10.1).
  default: "border border-line bg-card shadow-card",
  // Over coloured / warm sections: bg-white/60 + border (spec glass variant).
  glass: "border border-slate-200/70 bg-white/60 shadow-pill backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/60",
  // Inset panel inside another card or on a white page.
  muted: "border border-line bg-card-muted",
  // The blue gradient tile from explorador.pt (hero bento, agent card).
  brand: "bg-gradient-to-br from-primary to-blue-700 text-white shadow-brand dark:to-blue-800",
};

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  /** 2xl = 16px (default), 3xl = 24px for large feature panels. */
  radius?: "2xl" | "3xl";
  padding?: CardPadding;
  /** Hover affordance for clickable cards (wrap in a Link or add onClick). */
  interactive?: boolean;
  as?: ElementType;
}

/** Rounded white card (16 or 24 px radius), 1px border, no heavy shadow; `glass` for coloured sections. */
export function Card({
  variant = "default",
  radius = "2xl",
  padding = "md",
  interactive = false,
  as: Tag = "div",
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        radius === "3xl" ? "rounded-panel" : "rounded-card",
        VARIANTS[variant],
        PADDING[padding],
        interactive &&
          "transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_12px_32px_-12px_rgb(15_23_42/0.18)]",
        className,
      )}
      {...rest}
    />
  );
}

/** Title row for a card: optional eyebrow, title, description and a right-aligned action. */
export function CardHeader({
  title,
  description,
  eyebrow,
  action,
  className,
  titleAs: TitleTag = "h3",
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
  titleAs?: ElementType;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">{eyebrow}</p>}
        <TitleTag className={cn("text-base font-bold text-heading sm:text-lg", eyebrow ? "mt-1" : undefined)}>{title}</TitleTag>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** A label / value row inside a card ("Credit limit · €3,750.00"). */
export function CardRow({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 border-b border-line py-2.5 text-sm last:border-0", className)}>
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium text-heading">{value}</span>
    </div>
  );
}
