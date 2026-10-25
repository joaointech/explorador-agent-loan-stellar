import { ArrowDown, Banknote, Landmark, Percent, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Eyebrow, Lead, TwoToneHeadline } from "@/components/ui/typography";
import { formatBps, formatEur, formatPercent } from "@/lib/format";
import { DAY_SECS, PARAMS } from "@/lib/units";

import { DEFAULT_YIELD_PARAMS, ILLUSTRATION, applyLoss, yieldScenario, type YieldParams } from "./yield-math";

interface Step {
  icon: ReactNode;
  title: string;
  text: string;
  /** Swatch tying the step to the illustration bars. */
  swatch?: string;
  accent?: boolean;
}

function Waterfall({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => (
        <li key={step.title} className="flex flex-col">
          <div className={cn("flex gap-4 rounded-2xl p-4 ring-1", step.accent ? "bg-primary-tint ring-primary/25" : "bg-card-muted ring-line")}>
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 [&_svg]:size-5",
                step.accent ? "bg-primary text-white ring-primary" : "bg-card text-primary-text ring-line",
              )}
            >
              {step.icon}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold text-heading">
                {step.swatch && <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", step.swatch)} />}
                {step.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{step.text}</p>
            </div>
          </div>
          {i < steps.length - 1 && (
            <span aria-hidden className="flex h-8 items-center pl-8 text-subtle">
              <ArrowDown className="size-4" />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Segment({ value, max, className }: { value: bigint; max: bigint; className: string }) {
  if (value <= 0n || max <= 0n) return null;
  const pct = Number((value * 10_000n) / max) / 100;
  return <div className={cn("h-full", className)} style={{ width: `${pct}%` }} />;
}

function ScenarioBars({ params }: { params: YieldParams }) {
  const scenarios = ILLUSTRATION.debts.map((debt) =>
    yieldScenario({ debt, seniorAssets: ILLUSTRATION.seniorAssets, juniorAssets: ILLUSTRATION.juniorAssets }, params),
  );
  const max = scenarios.reduce((m, s) => (s.grossInterest > m ? s.grossInterest : m), 0n);
  return (
    <div>
      <ul aria-hidden className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-muted">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-slate-400 dark:bg-slate-500" /> Protocol fee
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-chart-1" /> Senior (you)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-chart-2" /> Junior (explorador)
        </li>
      </ul>
      <ul className="flex flex-col gap-5">
        {scenarios.map((s) => (
          <li key={String(s.debt)}>
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-semibold text-heading">Agents owe {formatEur(s.debt, { decimals: 0 })}</span>
              <span className="text-muted">{formatEur(s.grossInterest, { decimals: 0 })} interest a year</span>
            </p>
            <div
              role="img"
              aria-label={`Of ${formatEur(s.grossInterest, { decimals: 0 })} interest: protocol fee ${formatEur(s.fee, { decimals: 0 })}, senior ${formatEur(s.toSenior, { decimals: 0 })}, junior ${formatEur(s.toJunior, { decimals: 0 })}`}
              className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-full"
            >
              <Segment value={s.fee} max={max} className="bg-slate-400 dark:bg-slate-500" />
              <Segment value={s.toSenior} max={max} className="bg-chart-1" />
              <Segment value={s.toJunior} max={max} className="bg-chart-2" />
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted">Fee</dt>
                <dd className="font-semibold text-heading">{formatEur(s.fee, { decimals: 0 })}</dd>
              </div>
              <div>
                <dt className="text-muted">Senior</dt>
                <dd className="font-semibold text-heading">
                  {formatEur(s.toSenior, { decimals: 0 })} · {formatPercent(s.seniorApy)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Junior</dt>
                <dd className="font-semibold text-heading">
                  {formatEur(s.toJunior, { decimals: 0 })} · {formatPercent(s.juniorApy, { decimals: 1 })}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LossIllustration() {
  const after = applyLoss(ILLUSTRATION.seniorAssets, ILLUSTRATION.juniorAssets, ILLUSTRATION.loss);
  const max = ILLUSTRATION.juniorAssets;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="flex justify-between gap-3">
          <span className="font-medium text-heading">Junior (explorador)</span>
          <span className="text-muted">
            {formatEur(ILLUSTRATION.juniorAssets, { decimals: 0 })} → <span className="font-semibold text-heading">{formatEur(after.juniorAssets, { decimals: 0 })}</span>
          </span>
        </p>
        <div
          role="img"
          aria-label={`Junior falls from ${formatEur(ILLUSTRATION.juniorAssets, { decimals: 0 })} to ${formatEur(after.juniorAssets, { decimals: 0 })}`}
          className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-full"
        >
          <Segment value={after.juniorAssets} max={max} className="bg-chart-2" />
          <Segment value={after.juniorLoss} max={max} className="bg-red-500/80" />
        </div>
      </div>
      <div>
        <p className="flex justify-between gap-3">
          <span className="font-medium text-heading">Senior (you)</span>
          <span className="text-muted">
            {formatEur(ILLUSTRATION.seniorAssets, { decimals: 0 })} → <span className="font-semibold text-heading">{formatEur(after.seniorAssets, { decimals: 0 })}</span>, untouched
          </span>
        </p>
        <div role="img" aria-label="Senior unchanged" className="mt-2 h-3 overflow-hidden rounded-full">
          <div className="h-full w-full bg-chart-1" />
        </div>
      </div>
    </div>
  );
}

/**
 * "How your yield works" (spec §10.2): the waterfall interest → protocol fee
 * → senior up to the target → junior, losses junior-first, with the §5.6
 * yield and loss illustrations. Uses the live pool params when known.
 */
export function YieldExplainer({ params = DEFAULT_YIELD_PARAMS, gracePeriodSecs = PARAMS.gracePeriodSecs }: { params?: YieldParams; gracePeriodSecs?: number }) {
  const graceDays = Math.round(gracePeriodSecs / DAY_SECS);
  const steps: Step[] = [
    {
      icon: <Banknote />,
      title: "Agents pay interest",
      text: `${formatBps(params.agentAprBps)} APR, only on what they have drawn, accrued continuously and repaid at the escritura.`,
    },
    {
      icon: <Percent />,
      title: `${formatBps(params.protocolFeeBps)} protocol fee`,
      text: "Goes to explorador before anything is split between the tranches.",
      swatch: "bg-slate-400 dark:bg-slate-500",
    },
    {
      icon: <ShieldCheck />,
      title: "Senior tranche: you",
      text: `Paid first, up to the ${formatBps(params.seniorTargetBps)} APY target, pro rata to your eaSR shares. Your share price rises as it accrues.`,
      swatch: "bg-chart-1",
      accent: true,
    },
    {
      icon: <Landmark />,
      title: "Junior tranche: explorador",
      text: "Keeps whatever is left above the target, as payment for taking losses first. explorador's half of every commission tops it up.",
      swatch: "bg-chart-2",
    },
  ];

  return (
    <section aria-labelledby="yield-explainer" className="flex flex-col gap-6">
      <div className="max-w-3xl">
        <Eyebrow>How your yield works</Eyebrow>
        <div id="yield-explainer" className="mt-3">
          <TwoToneHeadline as="h2" lead="Interest flows down." accent="Losses hit explorador first." />
        </div>
        <Lead className="mt-4">
          Your deposit funds agents&apos; card spending against signed CPCVs. The interest they pay runs down a waterfall; a deal that falls through is
          absorbed by explorador&apos;s first-loss capital before it can reach you.
        </Lead>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg">
          <h3 className="text-base font-bold text-heading sm:text-lg">The waterfall</h3>
          <p className="mt-1 mb-5 text-sm text-muted">Every interest payment, in order.</p>
          <Waterfall steps={steps} />
          <div className="mt-5 flex gap-3 rounded-2xl bg-red-50 p-4 ring-1 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/30">
            <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" />
            <div className="text-sm">
              <p className="font-semibold text-heading">If a buyer walks away</p>
              <p className="mt-1 leading-relaxed text-muted">
                The agent&apos;s debt moves to their next deals with a {graceDays}-day grace period, still earning interest. If it&apos;s unpaid after that, it is
                written off: junior assets absorb the loss first, and senior only loses money once junior is used up.
              </p>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card padding="lg">
            <h3 className="text-base font-bold text-heading sm:text-lg">Yield illustration</h3>
            <p className="mt-1 mb-5 text-sm text-muted">
              Senior {formatEur(ILLUSTRATION.seniorAssets, { decimals: 0 })} · junior {formatEur(ILLUSTRATION.juniorAssets, { decimals: 0 })} · one year of
              interest.
            </p>
            <ScenarioBars params={params} />
          </Card>
          <Card padding="lg">
            <h3 className="text-base font-bold text-heading sm:text-lg">Loss illustration</h3>
            <p className="mt-1 mb-5 text-sm text-muted">A cancelled deal with {formatEur(ILLUSTRATION.loss, { decimals: 0 })} of carried debt is written off.</p>
            <LossIllustration />
          </Card>
        </div>
      </div>
    </section>
  );
}
