import { ArrowLeft, ChevronDown, FileCode, Lock, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Address, TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CopyButton } from "@/components/ui/copy-button";
import { DateText } from "@/components/ui/date-text";
import { Container } from "@/components/ui/layout";
import { StatPill } from "@/components/ui/stat-pill";
import { Eyebrow } from "@/components/ui/typography";
import { formatEur, formatNumber } from "@/lib/format";
import type { RegistryDetailResponse } from "@/lib/types/api";

import { NoteTimeline } from "./note-timeline";
import { ProofVerifier } from "./proof-verifier";
import { describePublicSignals } from "./public-signals";
import { registryPageHref } from "./registry-query";
import { NoteStatus } from "./registry-results";
import { AUDIT_NOTE, HIDDEN_FIELDS } from "./trust-content";

const withPrefix = (hex: string) => (hex.startsWith("0x") ? hex : `0x${hex}`);

/** Long hex (commitment, nullifier, proof points): wraps anywhere, with a copy button. */
export function HexValue({ value, label, className }: { value: string; label: string; className?: string }) {
  const hex = withPrefix(value);
  return (
    <span className={cn("flex items-start gap-1", className)}>
      <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-all text-fg">{hex}</code>
      <CopyButton value={hex} label={`Copy ${label}`} className="-mt-1" />
    </span>
  );
}

function Panel({ title, description, children, className, id }: { title: string; description?: ReactNode; children: ReactNode; className?: string; id: string }) {
  return (
    <section aria-labelledby={id} className={cn("rounded-panel border border-line bg-card p-5 shadow-card sm:p-7", className)}>
      <h2 id={id} className="text-lg font-bold text-heading sm:text-xl">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function FieldRow({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 first:pt-0 last:border-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-heading">
        {children}
        {hint && <span className="mt-0.5 block text-xs font-normal text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

function HiddenPanel({ hidden }: { hidden: string[] }) {
  const items = hidden.length > 0 ? hidden : [...HIDDEN_FIELDS];
  return (
    <Panel
      id="hidden-title"
      title="What the proof hides"
      description="The proof shows the deal is real and the numbers add up, without revealing any of this. explorador keeps it encrypted, off-chain."
    >
      <ul className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2 rounded-xl bg-card-muted px-2.5 py-2 text-[13px] font-medium text-fg ring-1 ring-line sm:gap-2.5 sm:px-3 sm:py-2.5 sm:text-sm">
            <Lock aria-hidden className="size-4 shrink-0 text-muted" />
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        The agent appears by smart-account address only, never by name. {AUDIT_NOTE}
      </p>
    </Panel>
  );
}

function PublicSignalsPanel({ signals, className }: { signals: string[]; className?: string }) {
  const rows = describePublicSignals(signals);
  return (
    <Panel
      id="signals-title"
      className={className}
      title="Public signals"
      description="The 9 public inputs of the circuit, in order: what the proof is about. The contract rebuilt them from the note when it verified the proof at mint; signals 6 to 8 are the same for every note."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">The registry didn&apos;t return this note&apos;s public signals.</p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.name} className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[15rem_1fr] md:gap-6">
              <div className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-tint font-mono text-xs font-bold text-primary-text ring-1 ring-primary/15">
                  {r.index}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-heading">{r.label}</p>
                  <p className="font-mono text-[11px] text-muted">{r.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{r.meaning}</p>
                </div>
              </div>
              <div className="min-w-0 pl-9 md:pl-0">
                {r.kind === "field" ? (
                  <HexValue value={r.reading} label={r.label.toLowerCase()} />
                ) : (
                  <p className="text-sm font-semibold text-heading">
                    {r.reading} <span className="font-mono text-xs font-normal text-muted">({r.value})</span>
                  </p>
                )}
                {r.kind === "field" && <p className="mt-1 font-mono text-[11px] break-all text-muted">{r.value}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function ProofBytesPanel({ detail }: { detail: RegistryDetailResponse }) {
  const { proof } = detail.note;
  const snarkjs = detail.snarkjsProof ? JSON.stringify({ proof: detail.snarkjsProof, publicSignals: detail.publicSignals }, null, 2) : null;
  return (
    <section aria-labelledby="proof-bytes-title" className="rounded-panel border border-line bg-card shadow-card">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-panel p-5 sm:p-7 [&::-webkit-details-marker]:hidden">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary-text ring-1 ring-primary/15">
            <FileCode aria-hidden className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span id="proof-bytes-title" className="block text-lg font-bold text-heading sm:text-xl">
              Proof (Groth16, BN254)
            </span>
            <span className="mt-0.5 block text-sm text-muted">Points A, B and C exactly as stored in the note contract.</span>
          </span>
          <ChevronDown aria-hidden className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-5 border-t border-line p-5 sm:p-7">
          <div>
            <p className="text-sm font-semibold text-heading">A <span className="font-normal text-muted">(G1, 64 bytes, stored negated: −A)</span></p>
            <HexValue value={proof.a} label="proof point A" className="mt-1.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-heading">B <span className="font-normal text-muted">(G2, 128 bytes)</span></p>
            <HexValue value={proof.b} label="proof point B" className="mt-1.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-heading">C <span className="font-normal text-muted">(G1, 64 bytes)</span></p>
            <HexValue value={proof.c} label="proof point C" className="mt-1.5" />
          </div>
          <p className="text-xs leading-relaxed text-muted">
            A is stored negated so the contract can check a single product of pairings: e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1.
            G2 coordinates are imaginary part first, as Soroban&apos;s BN254 host functions expect.
          </p>
          {snarkjs && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card-muted px-3 py-2 text-sm ring-1 ring-line">
              <span className="text-muted">snarkjs proof and public signals (A un-negated), as JSON</span>
              <CopyButton value={snarkjs} label="Copy snarkjs proof JSON" />
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

// Header pills: small type on phones so €123,456.78 fits two to a row, larger from sm up.
const PILL = { variant: "glass", size: "sm", className: "px-4 sm:px-5" } as const;
const Big = ({ children }: { children: ReactNode }) => <span className="text-lg sm:text-2xl lg:text-3xl">{children}</span>;

/** Everything public about one CPCV Note (spec §10.2 /registry/[id]). */
export function NoteDetailView({ detail, protocolNow }: { detail: RegistryDetailResponse; protocolNow?: number | null }) {
  const { note, draws } = detail;
  const drawsTotal = BigInt(draws.total);
  return (
    <>
      <section aria-labelledby="note-title" className="relative overflow-clip bg-section">
        <div aria-hidden className="bg-dot-grid pointer-events-none absolute inset-0 opacity-60" />
        <Container className="relative py-8 sm:py-12">
          <Link
            href="/registry"
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted transition-colors hover:text-primary-text"
          >
            <ArrowLeft aria-hidden className="size-4" />
            All notes
          </Link>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <Eyebrow>CPCV Note · soulbound SEP-50 token</Eyebrow>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <h1 id="note-title" className="font-display text-3xl font-bold tracking-tight text-heading sm:text-4xl">
                  Note #{note.id}
                </h1>
                <NoteStatus note={note} size="md" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                <span className="inline-flex items-center gap-1.5">
                  Agent <Address address={note.agent} label="agent smart account" />
                </span>
                <span>
                  Minted <DateText value={note.mintedAt} className="font-medium text-fg" />
                </span>
                {note.mintTxHash && <TxLink hash={note.mintTxHash}>Mint transaction</TxLink>}
              </div>
            </div>
            <Button
              href={registryPageHref({ q: note.agent })}
              variant="secondary"
              size="sm"
              icon={<Search aria-hidden className="size-4" />}
              className="self-start lg:self-auto"
            >
              This agent&apos;s notes
            </Button>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatPill {...PILL} label="Total commission" value={<Big>{formatEur(note.totalCommission)}</Big>} hint="Paid at the escritura" />
            <StatPill {...PILL} label="Agent commission" value={<Big>{formatEur(note.agentCommission)}</Big>} hint="Exactly half" />
            <StatPill {...PILL} label="Credit limit" value={<Big>{formatEur(note.creditLimit)}</Big>} hint="50% of the agent's half" tone="primary" />
            <StatPill
              {...PILL}
              label="Escritura"
              value={
                <Big>
                  <DateText value={note.escrituraDay} />
                </Big>
              }
              hint={
                note.overdue ? (
                  <span className="font-semibold text-orange-700 dark:text-orange-400">Overdue</span>
                ) : protocolNow && note.status === "Active" ? (
                  <DateText value={note.escrituraDay} format="relative" now={protocolNow} />
                ) : (
                  "Deed signing"
                )
              }
            />
          </div>
        </Container>
      </section>

      <Container className="py-8 sm:py-12">
        <div className="grid gap-5 lg:grid-cols-2">
          <ProofVerifier detail={detail} />
          <HiddenPanel hidden={detail.hidden} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <Panel id="fields-title" title="Public on-chain fields" description="Read from the note contract on Stellar testnet.">
            <dl>
              <FieldRow label="Note">#{note.id}</FieldRow>
              <FieldRow label="Status">
                <NoteStatus note={note} />
              </FieldRow>
              <FieldRow label="Agent (smart account)">
                <Address address={note.agent} full label="agent smart account" />
              </FieldRow>
              <FieldRow label="Total commission">
                <Amount value={note.totalCommission} />
              </FieldRow>
              <FieldRow label="Agent commission" hint="floor(total ÷ 2)">
                <Amount value={note.agentCommission} />
              </FieldRow>
              <FieldRow label="explorador commission" hint="To the first-loss tranche at the escritura">
                <Amount value={note.exploradorCommission} />
              </FieldRow>
              <FieldRow label="Credit limit" hint="50% of the agent commission">
                <Amount value={note.creditLimit} />
              </FieldRow>
              <FieldRow label="Escritura date" hint={`Day ${formatNumber(note.escrituraDay)} since 1 Jan 1970`}>
                <DateText value={note.escrituraDay} />
              </FieldRow>
              <FieldRow label="Minted" hint="Protocol clock">
                <DateText value={note.mintedAt} format="datetime" />
              </FieldRow>
              <FieldRow label="Borrowed on this note">
                {drawsTotal > 0n || draws.count > 0 ? (
                  <>
                    <Amount value={draws.total} />
                    <span className="font-normal text-muted">
                      {" "}
                      across {formatNumber(draws.count)} card {draws.count === 1 ? "purchase" : "purchases"}
                    </span>
                  </>
                ) : (
                  <span className="font-normal text-muted">Nothing yet</span>
                )}
              </FieldRow>
              <FieldRow label="Commitment" hint="Poseidon hash of the hidden deal record">
                <HexValue value={note.commitment} label="commitment" />
              </FieldRow>
              <FieldRow label="Nullifier" hint="Unique per CPCV: no double financing">
                <HexValue value={note.nullifier} label="nullifier" />
              </FieldRow>
            </dl>
          </Panel>
          <Panel id="timeline-title" title="Timeline" description="Contract events for this note. Dates use the protocol clock.">
            <NoteTimeline events={detail.timeline} />
          </Panel>
        </div>

        <PublicSignalsPanel signals={detail.publicSignals} className="mt-5" />
        <div className="mt-5">
          <ProofBytesPanel detail={detail} />
        </div>
      </Container>
    </>
  );
}
