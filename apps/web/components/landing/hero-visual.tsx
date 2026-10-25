import { CircleCheck, ShieldCheck, Store } from "lucide-react";

import { AdvancePill, LogoMark } from "@/components/brand/logo";
import { cn } from "@/components/ui/cn";
import { formatEur } from "@/lib/format";

import { DEAL } from "./worked-example";

/**
 * Decorative hero illustration (desktop): the agent's virtual card with the
 * credit a €300,000 CPCV unlocks, the on-chain proof that backs it and the
 * first purchase. Mirrors the agent app's card (spec §10.2 /agent).
 */
export function HeroVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative mx-auto w-full max-w-[440px] select-none", className)}>
      <div className="pointer-events-none absolute -inset-10 rounded-full bg-primary/10 blur-3xl dark:bg-primary/20" />

      {/* Proof chip */}
      <div className="relative z-10 mr-[-12px] mb-[-18px] ml-auto flex w-fit items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 shadow-pop backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/80">
        <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300">
          <ShieldCheck className="size-5" />
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-heading">CPCV Note #12 · verified on Stellar</span>
          <span className="text-xs text-muted">Groth16 proof · no personal data</span>
        </span>
      </div>

      {/* Virtual card */}
      <div className="relative aspect-[1.586/1] overflow-hidden rounded-[22px] bg-gradient-to-br from-primary via-blue-600 to-blue-800 p-6 text-white shadow-brand">
        <div className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 size-48 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-start justify-between">
            <span className="inline-flex items-center gap-2">
              <LogoMark className="size-8" />
              <span className="wordmark text-[1.15rem]">explorador</span>
              <AdvancePill />
            </span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-white/25">Virtual · Sandbox</span>
          </div>
          <div>
            <span className="block h-7 w-10 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 opacity-90" />
            <p className="mt-4 font-mono text-lg tracking-[0.18em] text-white/90">•••• •••• •••• 4821</p>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.2em] text-blue-100/80 uppercase">Available to spend</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums">{formatEur(DEAL.creditLimit)}</p>
            </div>
            <p className="text-right text-[11px] leading-tight text-blue-100/80">
              CPCV signed today
              <br />
              escritura in {DEAL.days} days
            </p>
          </div>
        </div>
      </div>

      {/* First purchase */}
      <div className="relative z-10 mt-[-22px] ml-[-18px] flex w-fit items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-pop">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary-tint text-primary-text ring-1 ring-primary/15">
          <Store className="size-5" />
        </span>
        <span className="flex flex-col">
          <span className="flex items-center gap-2 text-sm font-semibold text-heading">
            Pastelaria Aloma <span className="tabular-nums">−€4.80</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            Approved · borrowed on Stellar in seconds
          </span>
        </span>
      </div>
    </div>
  );
}
