import { ArrowDown, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";

/** "How your yield works" — interest waterfall and loss order (§5). */
export function YieldWaterfall() {
  return (
    <section>
      <h2 className="text-lg font-bold">How your yield works</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Agents pay 12% APR on what they borrow against signed CPCVs. Every euro of interest flows down this waterfall when a deal settles.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <p className="eyebrow">Interest</p>
          <ol className="mt-4 flex flex-col items-stretch">
            <Step tone="ink" title="Interest paid by agents" detail="Example: €3,000 spent for 90 days → €88.77" />
            <Arrow />
            <Step tone="slate" title="10% protocol fee" detail="€8.88 to explorador's treasury" />
            <Arrow />
            <Step tone="primary" title="Senior tranche — you" detail="Paid first, up to an 8% APY on senior assets" />
            <Arrow />
            <Step tone="violet" title="Junior tranche — explorador" detail="Everything left over, plus explorador's half of each commission" />
          </ol>
        </Card>
        <Card className="p-5 sm:p-6">
          <p className="eyebrow">Losses</p>
          <ol className="mt-4 flex flex-col items-stretch">
            <Step tone="amber" title="A buyer walks away" detail="The deal is cancelled; the agent's debt carries to their next deals for 180 days" />
            <Arrow />
            <Step tone="red" title="Still unpaid after the grace period" detail="explorador writes the debt off" />
            <Arrow />
            <Step tone="violet" title="Junior absorbs it first" detail="explorador's first-loss capital takes the hit" />
            <Arrow />
            <Step tone="primary" title="Senior only after junior is gone" detail="And total debt is capped at 10× the first-loss capital" />
          </ol>
          <p className="mt-4 flex items-start gap-2 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            Every deal is attested by explorador with a zero-knowledge proof verified on Stellar — see the public registry.
          </p>
        </Card>
      </div>
    </section>
  );
}

const tones = {
  ink: "border-line bg-warm",
  slate: "border-slate-200 bg-slate-50 dark:border-slate-500/30 dark:bg-slate-500/10",
  primary: "border-primary/30 bg-primary-faint",
  violet: "border-violet-200 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/10",
  amber: "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
  red: "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
} as const;

function Step({ title, detail, tone }: { title: string; detail: string; tone: keyof typeof tones }) {
  return (
    <li className={`rounded-2xl border px-4 py-3 ${tones[tone]}`}>
      <p className="text-sm font-bold">{title}</p>
      <p className="text-xs text-muted">{detail}</p>
    </li>
  );
}

function Arrow() {
  return (
    <li aria-hidden className="flex justify-center py-1 text-muted">
      <ArrowDown className="size-4" />
    </li>
  );
}
