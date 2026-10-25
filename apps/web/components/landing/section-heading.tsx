import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";
import { Eyebrow, Lead, TwoToneHeadline } from "@/components/ui/typography";

/**
 * Centered section intro, as on explorador.pt: eyebrow, two-tone h2, lead.
 * `id` names the heading so the section can use it as its label.
 */
export function SectionHeading({
  id,
  eyebrow,
  lead,
  accent,
  description,
  className,
}: {
  id: string;
  eyebrow: ReactNode;
  lead: ReactNode;
  accent?: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-3xl text-center", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div id={id}>
        <TwoToneHeadline as="h2" lead={lead} accent={accent} align="center" className="mt-3 sm:mt-4" />
      </div>
      {description && (
        <Lead align="center" className="mt-3 text-sm sm:mt-5 sm:text-lg">
          {description}
        </Lead>
      )}
    </div>
  );
}
