import type { ElementType, HTMLAttributes } from "react";

import { cn } from "./cn";

const WIDTHS = {
  "7xl": "max-w-7xl",
  "5xl": "max-w-5xl",
  "3xl": "max-w-3xl",
} as const;

/** Page-width wrapper: max-w-7xl with the 16 px gutter used by the header and footer. */
export function Container({
  size = "7xl",
  as: Tag = "div",
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { size?: keyof typeof WIDTHS; as?: ElementType }) {
  return <Tag className={cn("mx-auto w-full px-4", WIDTHS[size], className)} {...rest} />;
}

export type SectionTone = "plain" | "warm" | "warm-alt" | "brand";

const TONES: Record<SectionTone, string> = {
  plain: "bg-bg",
  // explorador.pt warm off-white bands (stone-50 / stone-100; slate-900 in dark).
  warm: "bg-section",
  "warm-alt": "bg-section-alt",
  brand: "bg-gradient-to-br from-primary to-blue-800 text-white",
};

const SPACING = {
  sm: "py-6 sm:py-8",
  md: "py-8 sm:py-12",
  lg: "py-12 sm:py-16",
} as const;

/**
 * Full-bleed page band with a contained inner column.
 *
 *   <Section tone="warm" dots>…hero…</Section>
 */
export function Section({
  tone = "plain",
  spacing = "md",
  size = "7xl",
  dots = false,
  as: Tag = "section",
  className,
  innerClassName,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  tone?: SectionTone;
  spacing?: keyof typeof SPACING;
  size?: keyof typeof WIDTHS;
  /** explorador.pt dotted-grid texture (for heroes). */
  dots?: boolean;
  as?: ElementType;
  innerClassName?: string;
}) {
  return (
    // overflow-clip (not hidden) clips decorations without creating a scroll container, so sticky children still work.
    <Tag className={cn("relative overflow-clip", TONES[tone], SPACING[spacing], className)} {...rest}>
      {dots && <div aria-hidden className="bg-dot-grid pointer-events-none absolute inset-0 opacity-60" />}
      <Container size={size} className={cn("relative", innerClassName)}>
        {children}
      </Container>
    </Tag>
  );
}
