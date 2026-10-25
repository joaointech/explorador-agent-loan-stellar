import { CreditCard, Landmark, PiggyBank } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";
import { Container } from "@/components/ui/layout";
import { formatBps, formatEur } from "@/lib/format";
import { PARAMS } from "@/lib/units";

import { SectionHeading } from "./section-heading";
import { DEAL, POOL, YIELD_HIGH, YIELD_LOW, eur, juniorPct, ratePct, seniorPct } from "./worked-example";

const APR = formatBps(PARAMS.agentAprBps);
const FEE = formatBps(PARAMS.protocolFeeBps);
const TARGET = formatBps(PARAMS.seniorTargetBps);

function Row({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0", strong && "pt-3")}>
      <dt className={cn("text-sm", strong ? "font-semibold text-heading" : "text-muted")}>{label}</dt>
      <dd className={cn("shrink-0 text-right tabular-nums", strong ? "text-lg font-bold text-emerald-600 dark:text-emerald-400" : "text-sm font-semibold text-heading")}>
        {value}
      </dd>
    </div>
  );
}

function AudienceCard({
  icon,
  iconClass,
  eyebrow,
  title,
  intro,
  cta,
  children,
}: {
  icon: ReactNode;
  iconClass: string;
  eyebrow: string;
  title: string;
  intro: ReactNode;
  cta: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col rounded-panel border border-line bg-card p-5 shadow-card sm:p-7">
      <div className="flex items-center gap-3">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm [&_svg]:size-5", iconClass)}>{icon}</span>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">{eyebrow}</p>
      </div>
      <h3 className="mt-4 text-lg leading-snug font-bold text-heading sm:text-xl">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{intro}</p>
      <div className="mt-4">{children}</div>
      <p className="mt-auto pt-5">
        <Link href={cta.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-text underline-offset-4 hover:underline">
          {cta.label} <span aria-hidden>→</span>
        </Link>
      </p>
    </article>
  );
}

/** Day 90: the €15,000 commission split by the pool contract in one transaction. */
function SettlementSplit() {
  const parts = [
    { label: "repays the debt", detail: `${formatEur(DEAL.spent)} spent + ${formatEur(DEAL.interest)} interest`, value: DEAL.debtRepaid, color: "bg-chart-1" },
    { label: "to the agent's card balance", detail: "the rest of their half, spendable at once", value: DEAL.agentPayout, color: "bg-chart-3" },
    { label: "to the first-loss tranche", detail: "explorador's half, protecting investors", value: DEAL.juniorDeposit, color: "bg-chart-2" },
  ];
  const width = (v: bigint) => `${Number((v * 10_000n) / DEAL.totalCommission) / 100}%`;
  return (
    <div className="mt-4 rounded-panel border border-line bg-card p-5 shadow-card sm:mt-5 sm:p-7">
      <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">Day {DEAL.days} · escritura</p>
      <h3 className="mt-1 text-lg font-bold text-heading sm:text-xl">
        explorador pays the {formatEur(DEAL.totalCommission)} commission into the pool. One transaction splits it.
      </h3>
      <div aria-hidden className="mt-5 flex h-4 gap-0.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <span key={p.label} className={cn("h-full first:rounded-l-full last:rounded-r-full", p.color)} style={{ width: width(p.value) }} />
        ))}
      </div>
      <ul className="mt-5 grid gap-4 sm:grid-cols-3">
        {parts.map((p) => (
          <li key={p.label} className="flex gap-3">
            <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", p.color)} />
            <span className="min-w-0">
              <span className="block text-lg font-bold text-heading tabular-nums">{formatEur(p.value)}</span>
              <span className="block text-sm font-medium text-fg">{p.label}</span>
              <span className="block text-xs text-muted">{p.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "How it works" (spec §10.2): Agents / Investors / explorador, with the spec §5.6 worked example. */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="bg-gradient-to-b from-bg via-bg to-section py-12 sm:py-16">
      <Container>
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          lead={`A ${eur(DEAL.salePrice)} sale,`}
          accent="start to finish."
          description={`Follow one deal: a ${ratePct(DEAL.rateBps)} commission split 50/50, an agent who spends ${eur(DEAL.spent)} by card the day the CPCV is signed, and an escritura ${DEAL.days} days later.`}
        />

        <div className="mt-8 grid gap-4 sm:mt-12 sm:gap-5 lg:grid-cols-3">
          <AudienceCard
            icon={<CreditCard />}
            iconClass="bg-gradient-to-br from-blue-500 to-indigo-600"
            eyebrow="Agents"
            title="Spend your commission before the escritura"
            intro={`Credit on a virtual card the day the CPCV is signed. ${APR} APR, charged only on what you spend; card balance first, then credit.`}
            cta={{ href: "/agent", label: "I'm an agent" }}
          >
            <dl>
              <Row label={`Total commission (${ratePct(DEAL.rateBps)} of ${eur(DEAL.salePrice)})`} value={formatEur(DEAL.totalCommission)} />
              <Row label="Your half" value={formatEur(DEAL.agentCommission)} />
              <Row label="Credit limit the same day" value={formatEur(DEAL.creditLimit)} />
              <Row label="Spent by card" value={formatEur(DEAL.spent)} />
              <Row label={`Interest after ${DEAL.days} days`} value={formatEur(DEAL.interest)} />
              <Row strong label="To your card balance at the escritura" value={formatEur(DEAL.agentPayout)} />
            </dl>
          </AudienceCard>

          <AudienceCard
            icon={<PiggyBank />}
            iconClass="bg-gradient-to-br from-emerald-400 to-teal-500"
            eyebrow="Investors"
            title="Earn the interest, take losses last"
            intro={`Deposit tEURC into the senior vault for eaSR shares. After a ${FEE} protocol fee, interest pays senior first, up to a ${TARGET} APY; the first-loss tranche keeps the rest.`}
            cta={{ href: "/invest", label: "Invest" }}
          >
            <table className="w-full text-sm tabular-nums">
              <caption className="pb-2 text-left text-xs text-muted">
                Senior {eur(POOL.senior)}, first-loss {eur(POOL.junior)}
              </caption>
              <thead>
                <tr className="text-[11px] tracking-[0.12em] text-muted uppercase">
                  <th scope="col" className="pb-2 text-left font-semibold">
                    Lent out
                  </th>
                  <th scope="col" className="pb-2 text-right font-semibold">
                    Senior
                  </th>
                  <th scope="col" className="pb-2 text-right font-semibold">
                    First-loss
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line border-t border-line">
                {[YIELD_LOW, YIELD_HIGH].map((y) => (
                  <tr key={String(y.debt)}>
                    <th scope="row" className="py-2.5 text-left font-semibold text-heading">
                      {eur(y.debt)}
                      <span className="block text-xs font-normal text-muted">{eur(y.netInterestPerYear)} net a year</span>
                    </th>
                    <td className="py-2.5 text-right text-lg font-bold text-primary-text">{seniorPct(y.seniorApy)}</td>
                    <td className="py-2.5 text-right text-lg font-bold text-heading">{juniorPct(y.juniorApy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AudienceCard>

          <AudienceCard
            icon={<Landmark />}
            iconClass="bg-gradient-to-br from-amber-400 to-orange-500"
            eyebrow="explorador"
            title="Proves the deal, takes the first loss"
            intro="explorador attests each CPCV with a zero-knowledge proof verified on Stellar, and keeps its own capital in front of investors."
            cta={{ href: "/registry", label: "See every deal on-chain" }}
          >
            <dl>
              <Row label="explorador's half of the commission" value={formatEur(DEAL.exploradorCommission)} />
              <Row label={`Protocol fee (${FEE} of the interest)`} value={formatEur(DEAL.protocolFee)} />
              <Row label="Interest to the tranches" value={formatEur(DEAL.toTranches)} />
              <Row strong label="Into the first-loss tranche at the escritura" value={formatEur(DEAL.juniorDeposit)} />
            </dl>
          </AudienceCard>
        </div>

        <SettlementSplit />
      </Container>
    </section>
  );
}
