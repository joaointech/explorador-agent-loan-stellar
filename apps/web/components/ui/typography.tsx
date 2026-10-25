import type { ElementType, ReactNode } from "react";

import { cn } from "./cn";

/** 12px uppercase label with 0.2em tracking, slate-500 (e.g. "WHAT IS EXPLORADOR ADVANCE"). */
export function Eyebrow({
  children,
  tone = "default",
  as: Tag = "p",
  className,
}: {
  children: ReactNode;
  /** `primary` = blue; `onPrimary` = for blue/brand backgrounds. */
  tone?: "default" | "primary" | "onPrimary";
  as?: ElementType;
  className?: string;
}) {
  const tones = {
    default: "text-muted",
    primary: "text-primary-text",
    onPrimary: "text-blue-100/80",
  } as const;
  return <Tag className={cn("text-xs font-semibold tracking-[0.2em] uppercase", tones[tone], className)}>{children}</Tag>;
}

export type HeadlineSize = "display" | "section" | "card";

const SIZES: Record<HeadlineSize, string> = {
  // h1: 36 → 60 px, as on the explorador.pt hero.
  display: "text-4xl leading-[1.05] sm:text-5xl lg:text-[3.25rem] xl:text-6xl",
  // h2: 44 px at lg with −1.1 px tracking (spec §10.1).
  section: "text-[1.6rem] leading-tight tracking-tight sm:text-4xl lg:text-[2.75rem]",
  // h3: 24 px.
  card: "text-xl leading-snug sm:text-2xl",
};

/**
 * Bold two-tone headline: dark lead, key phrase in blue (spec §10.1).
 *
 *   <TwoToneHeadline as="h1" size="display" lead="Close the deal." accent="Get paid today." />
 *
 * `accentStyle="gradient"` uses the explorador.pt hero gradient (blue-700 → sky-500).
 */
export function TwoToneHeadline({
  lead,
  accent,
  as: Tag = "h2",
  size = "section",
  accentStyle = "solid",
  breakLine = true,
  align = "left",
  onPrimary = false,
  className,
}: {
  lead: ReactNode;
  accent?: ReactNode;
  as?: ElementType;
  size?: HeadlineSize;
  accentStyle?: "solid" | "gradient";
  /** Put the accent on its own line (default). */
  breakLine?: boolean;
  align?: "left" | "center";
  /** White lead + light-blue accent, for brand backgrounds. */
  onPrimary?: boolean;
  className?: string;
}) {
  const accentClass = onPrimary
    ? "text-blue-100"
    : accentStyle === "gradient"
      ? "bg-gradient-to-r from-blue-700 via-blue-500 to-sky-500 bg-clip-text text-transparent dark:from-blue-400 dark:via-blue-300 dark:to-sky-300"
      : "text-primary-text";
  return (
    <Tag
      className={cn(
        "font-display font-bold text-balance",
        SIZES[size],
        onPrimary ? "text-white" : "text-heading",
        align === "center" && "text-center",
        className,
      )}
    >
      <span className={breakLine ? "block" : undefined}>{lead}</span>
      {accent && (
        <>
          {!breakLine && " "}
          <span className={cn(breakLine && "block", accentClass)}>{accent}</span>
        </>
      )}
    </Tag>
  );
}

/** Lead paragraph under a headline. */
export function Lead({ children, className, align = "left" }: { children: ReactNode; className?: string; align?: "left" | "center" }) {
  return (
    <p
      className={cn(
        "max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Top of an app page (agent, invest, admin): eyebrow, title (optionally two-tone), description, actions. */
export function PageHeader({
  eyebrow,
  title,
  accent,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  accent?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Badges or chips shown under the title. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className={cn("font-display text-2xl leading-tight font-bold tracking-tight text-heading sm:text-3xl", eyebrow ? "mt-2" : undefined)}>
          {title}
          {accent && (
            <>
              {" "}
              <span className="text-primary-text">{accent}</span>
            </>
          )}
        </h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
