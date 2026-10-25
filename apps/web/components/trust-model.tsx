import { CheckCircle, EyeOff, FileSignature, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export const PROVEN = [
  "explorador's attester key signed this exact deal record",
  "the commission was computed correctly from a hidden sale price and a 1–10% commission rate",
  "the agent gets exactly half",
  "the escritura date is after the CPCV date",
  "the record is bound to this agent's account, so the note can only go to them",
  "the deal has a unique nullifier, so the same CPCV can never be financed twice",
];

export const HIDDEN = ["Buyer", "Seller", "Buyer and seller NIFs", "Sale price", "Commission rate", "Property address", "CPCV date"];

export const PUBLIC = ["Agent address (never their name)", "Total commission", "Agent commission (50%)", "Escritura date", "Commitment and nullifier", "The Groth16 proof"];

/** The trust-model explainer (§8.1), shown on the landing page and the registry. */
export function TrustModel({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("grid gap-4 lg:grid-cols-3", className)}>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center gap-2 font-bold">
          <FileSignature className="size-5 text-primary" /> explorador is the attester
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          explorador signs that a real CPCV exists with these terms. The proof does not remove that trust — it protects privacy and
          enforces internal consistency and uniqueness. The commitment lets explorador open a record to an auditor later without changing
          anything on-chain.
        </p>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center gap-2 font-bold">
          <ShieldCheck className="size-5 text-emerald-600" /> The proof shows publicly
        </div>
        <ul className={cn("mt-2 space-y-1.5 text-sm text-ink-soft", compact && "text-[13px]")}>
          {PROVEN.map((p) => (
            <li key={p} className="flex gap-2">
              <CheckCircle className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center gap-2 font-bold">
          <EyeOff className="size-5 text-amber-600" /> Hidden — never on-chain
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {HIDDEN.map((h) => (
            <span key={h} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
              {h}
            </span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm font-bold">
          <Fingerprint className="size-4 text-primary" /> Public
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PUBLIC.map((h) => (
            <span key={h} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-200 dark:ring-blue-500/30">
              {h}
            </span>
          ))}
        </div>
        <p className="mt-4 flex gap-2 text-xs text-muted">
          <KeyRound className="size-4 shrink-0" />
          Personal data stays encrypted in explorador&apos;s database and is only visible to explorador staff.
        </p>
      </div>
    </div>
  );
}
