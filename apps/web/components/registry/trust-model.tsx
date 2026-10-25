import { Check, FileSignature, Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";

import { ATTESTER_NOTE, AUDIT_NOTE, HIDDEN_SUMMARY, PROOF_SHOWS } from "./trust-content";

function Column({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary-text ring-1 ring-primary/15 [&_svg]:size-[18px]">
          {icon}
        </span>
        <h3 className="text-base font-bold text-heading">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/**
 * The trust model of spec §8.1, as the registry states it: what explorador
 * attests, what the zero-knowledge proof shows, and what stays hidden.
 */
export function TrustModel({ className }: { className?: string }) {
  return (
    <section aria-labelledby="trust-model-title" className={cn("rounded-panel border border-line bg-card p-5 shadow-card sm:p-8", className)}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="trust-model-title" className="text-lg font-bold text-heading sm:text-xl">
          How to read this registry
        </h2>
        <p className="text-sm text-muted">The trust model behind every note.</p>
      </div>
      <div className="mt-6 grid gap-8 lg:grid-cols-[0.9fr_1.3fr_0.9fr] lg:gap-10">
        <Column icon={<FileSignature />} title="explorador attests">
          <p className="text-sm leading-relaxed text-muted">{ATTESTER_NOTE}</p>
        </Column>
        <Column icon={<ShieldCheck />} title="The proof shows, publicly">
          <ul className="flex flex-col gap-2 text-sm leading-relaxed text-fg">
            {PROOF_SHOWS.map((item) => (
              <li key={item} className="flex gap-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                {item}
              </li>
            ))}
          </ul>
        </Column>
        <Column icon={<Lock />} title="Hidden, never on-chain">
          <ul className="flex flex-wrap gap-2">
            {HIDDEN_SUMMARY.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5 rounded-full bg-card-muted px-3 py-1 text-xs font-medium text-fg ring-1 ring-line">
                <Lock aria-hidden className="size-3 text-muted" />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-sm leading-relaxed text-muted">{AUDIT_NOTE}</p>
        </Column>
      </div>
    </section>
  );
}
