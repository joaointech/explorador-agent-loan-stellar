import Link from "next/link";
import { ArrowRight, Banknote, Building2, Coins, CreditCard, FileCheck2, Landmark, Layers, Lock, ShieldCheck, Sparkles, Stamp } from "lucide-react";
import { CardVisual } from "@/components/card-visual";
import { Eyebrow, TwoTone } from "@/components/common";
import { LiveStats } from "@/components/landing/live-stats";
import { TrustModel } from "@/components/trust-model";
import { Button } from "@/components/ui/button";

// Worked example (§5.6) — the exact numbers used in the contract tests.
const EX = {
  price: "€300,000",
  rate: "5%",
  total: "€15,000",
  agentHalf: "€7,500",
  exploradorHalf: "€7,500",
  creditLimit: "€3,750",
  spend: "€3,000",
  interest: "€88.77",
  fee: "€8.88",
  toTranches: "€79.89",
  repaid: "€3,088.77",
  payout: "€4,411.23",
};

const steps = [
  { icon: FileCheck2, title: "CPCV signed", text: "Buyer and seller sign the promissory contract. The agent has closed the deal." },
  { icon: Sparkles, title: "Zero-knowledge proof", text: "explorador attests the deal and proves it on Stellar — without revealing who, what or where." },
  { icon: Stamp, title: "CPCV Note minted", text: "A soulbound note lands in the agent's account and opens a credit line of 25% of the commission." },
  { icon: CreditCard, title: "Spend by card", text: "Every purchase uses the card balance first, then borrows from investors against the note." },
  { icon: Landmark, title: "Escritura", text: "The commission is paid into the pool: debt and interest repaid, the rest lands on the agent's card." },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-warm">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-10 sm:py-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div className="animate-fade-in-up">
            <Eyebrow>explorador advance</Eyebrow>
            <TwoTone as="h1" first="Close the deal." second="Get paid today." className="mt-3" />
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
              Agents wait months between the CPCV and the escritura to receive their commission. explorador advance lets them spend part of
              it right away with a card — and lets investors earn the interest, protected by explorador&apos;s first-loss capital.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg">
                <Link href="/agent">I&apos;m an agent →</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/invest">Invest →</Link>
              </Button>
            </div>
            <Link href="/registry" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
              See every deal on-chain <ArrowRight className="size-4" />
            </Link>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="relative mx-auto w-full max-w-[380px]">
              <CardVisual last4="4242" holder="Ana Costa" className="rotate-[-3deg]" />
              <div className="absolute -bottom-8 -right-2 w-[230px] rounded-2xl border border-line bg-glass px-4 py-3 shadow-[0_4px_16px_-8px_rgba(15,23,42,0.18)] backdrop-blur-md sm:-right-8">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Available to spend</div>
                <div className="mt-0.5 text-2xl font-bold tabular-nums text-ink">{EX.creditLimit}</div>
                <div className="text-xs text-muted">against a {EX.total} commission</div>
              </div>
            </div>
          </div>
        </div>
        <div className="relative mx-auto max-w-7xl px-4 pb-10 sm:pb-14">
          <LiveStats />
        </div>
      </section>

      {/* Flow */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:py-20">
        <Eyebrow>What is explorador advance</Eyebrow>
        <TwoTone first="Your commission," second="before the escritura." className="mt-2" />
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <s.icon className="size-4" />
                </span>
                <span className="text-xs font-semibold tabular-nums text-muted">0{i + 1}</span>
              </div>
              <h3 className="mt-3 font-bold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* How it works — worked example */}
      <section className="relative overflow-hidden bg-warm">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:py-20">
          <Eyebrow>How it works</Eyebrow>
          <TwoTone first="One deal," second="three winners." className="mt-2" />
          <p className="mt-4 max-w-2xl text-ink-soft">
            A {EX.price} sale at {EX.rate} commission pays {EX.total}: {EX.agentHalf} to the agent and {EX.exploradorHalf} to explorador. The escritura
            is 90 days after the CPCV.
          </p>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            <HowCard
              icon={Building2}
              who="Agents"
              title={`Spend up to ${EX.creditLimit} today`}
              rows={[
                ["Your half of the commission", EX.agentHalf],
                ["Credit limit (50% of your half)", EX.creditLimit],
                ["Spent by card on day 0", EX.spend],
                ["Interest after 90 days (12% APR)", EX.interest],
                ["Repaid automatically at the escritura", EX.repaid],
                ["Lands on your card balance", EX.payout],
              ]}
              cta={{ href: "/agent", label: "I'm an agent →" }}
            />
            <HowCard
              icon={Coins}
              who="Investors"
              title="Earn agents' interest first"
              rows={[
                ["Interest paid by the agent", EX.interest],
                ["Protocol fee (10% of interest)", EX.fee],
                ["To the tranches", EX.toTranches],
                ["Senior (you) gets paid first, up to", "8% APY"],
                ["Losses hit first", "explorador"],
                ["Share token", "eaSR (SEP-56)"],
              ]}
              cta={{ href: "/invest", label: "Invest →" }}
            />
            <HowCard
              icon={ShieldCheck}
              who="explorador"
              title="Skin in the game on every deal"
              rows={[
                ["Attests the CPCV with a ZK proof", "on-chain"],
                ["explorador's half of the commission", EX.exploradorHalf],
                ["…goes into the first-loss tranche", EX.exploradorHalf],
                ["Junior seed at launch", "€10,000"],
                ["Max debt vs first-loss capital", "10×"],
                ["Absorbs write-offs first", "always"],
              ]}
              cta={{ href: "/registry", label: "See the registry →" }}
            />
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:py-20">
        <Eyebrow>Trust</Eyebrow>
        <TwoTone first="Every deal on-chain." second="No personal data." className="mt-2" />
        <TrustModel className="mt-8" />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center gap-2 font-bold">
              <Layers className="size-5 text-primary" /> First-loss protection
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              If a buyer walks away, the debt moves to the agent&apos;s future deals with a 180-day grace period. If it is still unpaid, it is
              written off against explorador&apos;s junior tranche first — senior investors only lose after the first-loss capital is gone. Total
              debt can never exceed 10× the first-loss capital.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center gap-2 font-bold">
              <Lock className="size-5 text-primary" /> Built on Stellar standards
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                "SEP-41 tokens (tEURC, eaSR)",
                "SEP-50 soulbound CPCV Notes",
                "SEP-56 tokenized vault",
                "Passkey smart accounts",
                "Protocol 25 BN254 + Poseidon",
                "Groth16 verified on-chain",
              ].map((t) => (
                <span key={t} className="rounded-full bg-primary-faint px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted">Agents sign with a passkey — no seed phrase, nothing to install.</p>
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="bg-nav text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-5 px-4 py-10 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-bold sm:text-3xl">Ready when the CPCV is.</h2>
            <p className="mt-1 text-white/80">Testnet demo — every number is real on Stellar testnet.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="onPrimary">
              <Link href="/agent">I&apos;m an agent →</Link>
            </Button>
            <Button asChild variant="glass">
              <Link href="/invest">
                <Banknote /> Invest →
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function HowCard({
  icon: Icon,
  who,
  title,
  rows,
  cta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  who: string;
  title: string;
  rows: [string, string][];
  cta: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col rounded-3xl border border-line bg-glass p-6 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white">
          <Icon className="size-5" />
        </span>
        <span className="eyebrow">{who}</span>
      </div>
      <h3 className="h3 mt-4">{title}</h3>
      <dl className="mt-4 flex-1 divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="shrink-0 font-semibold tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <Link href={cta.href} className="mt-4 text-sm font-semibold text-primary hover:underline">
        {cta.label}
      </Link>
    </div>
  );
}
