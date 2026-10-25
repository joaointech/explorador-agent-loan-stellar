import { Binary, Blocks, Check, Coins, Fingerprint, Lock, ShieldCheck, ShieldHalf, Vault } from "lucide-react";
import type { ReactNode } from "react";

import { HIDDEN_SUMMARY, PUBLIC_FIELDS } from "@/components/registry/trust-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Container } from "@/components/ui/layout";
import { formatEur } from "@/lib/format";
import { PARAMS } from "@/lib/units";

import { SectionHeading } from "./section-heading";
import { DEAL, LOSS, eur } from "./worked-example";

const GRACE_DAYS = PARAMS.gracePeriodSecs / 86_400;

function ZkPrivacyCard({ className }: { className?: string }) {
  return (
    <article className={cn("relative overflow-hidden rounded-panel bg-gradient-to-br from-blue-600 to-blue-800 p-5 text-white shadow-brand sm:p-8", className)}>
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-white/10 blur-3xl" />
      <div className="relative">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm">
          <ShieldCheck aria-hidden className="size-5" />
        </span>
        <h3 className="mt-4 text-lg font-bold sm:text-2xl">Zero-knowledge privacy</h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-blue-50 sm:text-base">
          Every CPCV Note carries a Groth16 proof that Stellar verifies before it mints. The proof shows the deal is real and the numbers add
          up, and reveals nothing personal.
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold tracking-[0.2em] text-blue-50 uppercase">Public, on-chain</h4>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {PUBLIC_FIELDS.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold tracking-[0.2em] text-blue-50 uppercase">Hidden, never on-chain</h4>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {HIDDEN_SUMMARY.map((f) => (
                <li key={f} className="flex gap-2">
                  <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-blue-100" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-7">
          <Button href="/registry" variant="onPrimary" arrow className="focus-visible:outline-white">
            See every deal on-chain
          </Button>
        </div>
      </div>
    </article>
  );
}

function TrancheBar({ label, before, after, note }: { label: string; before: bigint; after: bigint; note: string }) {
  const kept = Number((after * 1000n) / before) / 10;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <span className="font-semibold text-heading">{label}</span>
        <span className="tabular-nums text-muted">
          {eur(before)} → <span className="font-semibold text-heading">{eur(after)}</span>
        </span>
      </div>
      <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/70">
        <span className="h-full bg-primary" style={{ width: `${kept}%` }} />
        {kept < 100 && (
          <span
            className="h-full bg-red-500/80 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(255_255_255/0.35)_4px_7px)]"
            style={{ width: `${100 - kept}%` }}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function FirstLossCard({ className }: { className?: string }) {
  return (
    <article className={cn("flex flex-col rounded-panel border border-line bg-card p-5 shadow-card sm:p-8", className)}>
      <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
        <ShieldHalf aria-hidden className="size-5" />
      </span>
      <h3 className="mt-4 text-lg font-bold text-heading sm:text-2xl">First-loss protection</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
        explorador&apos;s capital stands in front of investors. Losses hit the first-loss tranche, and senior only once it is used up.
      </p>
      <figure className="mt-6 flex flex-col gap-4">
        <figcaption className="text-sm leading-relaxed text-fg">
          A buyer walks away and leaves {formatEur(LOSS.loss)} of carried debt. After the {GRACE_DAYS}-day grace period it is written off:
        </figcaption>
        <TrancheBar label="First-loss (explorador)" before={LOSS.juniorBefore} after={LOSS.juniorAfter} note={`Absorbs the full ${eur(LOSS.loss)}.`} />
        <TrancheBar label="Senior (investors)" before={LOSS.seniorBefore} after={LOSS.seniorAfter} note="Untouched." />
      </figure>
      <p className="mt-auto pt-6 text-xs leading-relaxed text-muted">
        Every escritura adds explorador&apos;s half ({formatEur(DEAL.juniorDeposit)} in the example) to the first-loss tranche, and outstanding
        debt can never exceed {PARAMS.maxLeverage}× its size.
      </p>
    </article>
  );
}

const STANDARDS: { code: string; title: string; body: string; icon: ReactNode }[] = [
  { code: "SEP-41", title: "Tokens", body: "tEURC, the test euro, and eaSR, the share token of the senior vault.", icon: <Coins /> },
  { code: "SEP-50", title: "NFTs", body: "The CPCV Note: minted to the agent and soulbound, so every transfer fails.", icon: <Blocks /> },
  { code: "SEP-56", title: "Tokenized vault", body: "The senior tranche: deposit tEURC, receive eaSR shares, withdraw any time liquidity allows.", icon: <Vault /> },
  {
    code: "Passkeys",
    title: "Smart accounts",
    body: "OpenZeppelin smart accounts signed with a passkey (WebAuthn, secp256r1). Agents never see a seed phrase or a fee.",
    icon: <Fingerprint />,
  },
  {
    code: "Protocol 25",
    title: "BN254 + Poseidon",
    body: "Native host functions verify every Groth16 proof on-chain, in the transaction that mints the note.",
    icon: <Binary />,
  },
];

function Standards() {
  return (
    <article className="mt-4 rounded-panel border border-line bg-card p-5 shadow-card sm:mt-5 sm:p-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="text-lg font-bold text-heading sm:text-2xl">Built on Stellar standards</h3>
        <p className="text-sm text-muted">Soroban contracts on testnet. No custom token formats.</p>
      </div>
      <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
        {STANDARDS.map((s) => (
          <li key={s.code} className="flex gap-3 lg:flex-col">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary-text ring-1 ring-primary/15 [&_svg]:size-5">
              {s.icon}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-card-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-heading ring-1 ring-line">{s.code}</code>
                <span className="text-sm font-semibold text-heading">{s.title}</span>
              </span>
              <span className="mt-1.5 block text-sm leading-relaxed text-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Trust section (spec §10.2): ZK privacy, first-loss protection, Stellar standards. */
export function TrustSection() {
  return (
    <section aria-labelledby="trust-title" className="bg-section-alt py-12 sm:py-16">
      <Container>
        <SectionHeading
          id="trust-title"
          eyebrow="Why it holds up"
          lead="Private by design."
          accent="Verifiable by anyone."
          description="Every advance is backed by a deal proven on Stellar, and by explorador's own capital standing in front of investors."
        />
        <div className="mt-8 grid gap-4 sm:mt-12 sm:gap-5 lg:grid-cols-5">
          <ZkPrivacyCard className="lg:col-span-3" />
          <FirstLossCard className="lg:col-span-2" />
        </div>
        <Standards />
      </Container>
    </section>
  );
}
