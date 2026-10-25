"use client";

import { CircleCheck, CircleX, LoaderCircle, RotateCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Address } from "@/components/ui/address";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Stepper, type Step, type StepStatus as UiStepStatus } from "@/components/ui/stepper";
import type { ConfigResponse, RegistryDetailResponse } from "@/lib/types/api";

import { fetchJson } from "./api-client";
import { ChainUnavailableError } from "./chain-errors";
import type { Groth16Verifier, ProofCheckDeps, ProofCheckResult, StepStatus } from "./proof-check";
import { PROOF_CHECK_STEPS, VERIFICATION_KEY_URL, type ProofCheckStep } from "./proof-steps";

type StepState = { status: StepStatus | "idle"; ms?: number; detail?: string };
type StepStates = Record<ProofCheckStep, StepState>;
type VerifyState =
  | { phase: "idle" }
  | { phase: "running"; steps: StepStates }
  | { phase: "done"; steps: StepStates; result: ProofCheckResult };

const initialSteps = (): StepStates => ({
  verifier: { status: "active" },
  key: { status: "idle" },
  chain: { status: "idle" },
  signals: { status: "idle" },
  proof: { status: "idle" },
  pairing: { status: "idle" },
});

/** "412 ms", "1.24 s". */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What the check needs in the browser: snarkjs, the published key, and Stellar via the deployment's RPC. */
function browserDeps(noteId: number): ProofCheckDeps {
  return {
    loadVerifier: async () => (await import("snarkjs")).groth16 as Groth16Verifier,
    loadVerificationKey: async () => {
      // Default cache mode: revalidates, so a new trusted setup is picked up at once.
      const res = await fetch(VERIFICATION_KEY_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    readChain: async () => {
      let config: ConfigResponse;
      try {
        config = await fetchJson<ConfigResponse>("/api/config");
      } catch (err) {
        throw new ChainUnavailableError(`the deployment's contract ids aren't available: ${message(err)}`);
      }
      if (!config.deployment) throw new ChainUnavailableError("no contracts are deployed yet");
      const { readChainSnapshot, rpcView } = await import("./chain-note");
      return readChainSnapshot(rpcView(config.deployment), noteId, config.deployment.cpcvNote);
    },
  };
}

const wrap = (text: string) => <span className="break-words [overflow-wrap:anywhere]">{text}</span>;

function ResultPanel({ result }: { result: ProofCheckResult }) {
  let tone: "ok" | "warn" | "fail";
  let title: string;
  let body: ReactNode;
  if (!result.valid) {
    const index = PROOF_CHECK_STEPS.findIndex((s) => s.id === result.failedStep);
    tone = "fail";
    title = "Proof not verified";
    body = (
      <>
        Stopped at step {index + 1} of {PROOF_CHECK_STEPS.length}: {PROOF_CHECK_STEPS[index]?.label.toLowerCase()}.
        <span className="sr-only"> {result.reason}</span>
      </>
    );
  } else if (result.source === "chain") {
    tone = "ok";
    title = "Proof verified on Stellar data";
    body = (
      <>
        Pairing check passed in {formatMs(result.verifyMs)} ({formatMs(result.totalMs)} in total), on the note as stored in{" "}
        <Address address={result.contractId} label="note contract" copy={false} /> and the attester key registered there. This proof is
        explorador&apos;s attestation of exactly these public fields.
      </>
    );
  } else {
    tone = "warn";
    title = "The math checks out, but not against Stellar";
    body = (
      <>
        Pairing check passed in {formatMs(result.verifyMs)} on the registry&apos;s copy. Stellar couldn&apos;t be read, so this doesn&apos;t confirm the
        attester key or that these bytes are the ones on-chain. Reason: {wrap(result.chainSkipped)}.
      </>
    );
  }
  const styles = {
    ok: {
      box: "border-emerald-600/20 bg-emerald-50 dark:border-emerald-400/25 dark:bg-emerald-500/10",
      icon: "text-emerald-600 dark:text-emerald-400",
      title: "text-emerald-800 dark:text-emerald-300",
      body: "text-emerald-950/80 dark:text-emerald-100/85",
    },
    warn: {
      box: "border-amber-600/25 bg-amber-50 dark:border-amber-400/25 dark:bg-amber-500/10",
      icon: "text-amber-600 dark:text-amber-400",
      title: "text-amber-900 dark:text-amber-300",
      body: "text-amber-950/80 dark:text-amber-100/85",
    },
    fail: {
      box: "border-red-600/20 bg-red-50 dark:border-red-400/25 dark:bg-red-500/10",
      icon: "text-red-600 dark:text-red-400",
      title: "text-red-800 dark:text-red-300",
      body: "text-red-950/80 dark:text-red-100/85",
    },
  }[tone];
  const Icon = tone === "ok" ? CircleCheck : tone === "warn" ? TriangleAlert : CircleX;
  return (
    <div className={cn("flex items-start gap-3 rounded-card border p-4", styles.box)}>
      <Icon aria-hidden className={cn("mt-0.5 size-6 shrink-0", styles.icon)} />
      <div className="min-w-0">
        <p className={cn("font-semibold", styles.title)}>{title}</p>
        <p className={cn("mt-0.5 text-sm leading-relaxed", styles.body)}>{body}</p>
      </div>
    </div>
  );
}

/**
 * "Verify proof in your browser" (spec §8.5, §10.2): on click, loads snarkjs,
 * the published verification key and the note as stored on Stellar, rebuilds
 * the public signals, matches the registry's copy against the chain's, and runs
 * groth16.verify. Shows each step, how long the pairing check took, and
 * whether the result rests on Stellar or only on the registry's copy.
 */
export function ProofVerifier({ detail, className }: { detail: Pick<RegistryDetailResponse, "note" | "publicSignals" | "snarkjsProof">; className?: string }) {
  const [state, setState] = useState<VerifyState>({ phase: "idle" });
  const runId = useRef(0);
  const running = state.phase === "running";

  async function verify() {
    // aria-disabled (not disabled) while running, so keyboard focus stays on the button.
    if (running) return;
    const id = ++runId.current;
    const live = () => id === runId.current;
    setState({ phase: "running", steps: initialSteps() });
    const update = (step: ProofCheckStep, status: StepStatus, ms?: number, detailText?: string) => {
      if (!live()) return;
      setState((s) => (s.phase === "idle" ? s : { ...s, steps: { ...s.steps, [step]: { status, ms, detail: detailText } } }));
    };
    let result: ProofCheckResult;
    try {
      const { checkNoteProof } = await import("./proof-check");
      result = await checkNoteProof(detail, browserDeps(detail.note.id), update);
    } catch (err) {
      update("verifier", "error");
      result = { valid: false, failedStep: "verifier", reason: `Couldn't load the verifier: ${message(err)}`, totalMs: 0 };
    }
    if (live()) setState((s) => (s.phase === "idle" ? s : { phase: "done", steps: s.steps, result }));
  }

  const failure = state.phase === "done" && !state.result.valid ? state.result : null;
  const chainSkipped = state.phase !== "idle" && state.steps.chain.status === "skipped";
  const steps: Step[] = PROOF_CHECK_STEPS.map((s) => {
    const st: StepState = state.phase === "idle" ? { status: "idle" } : state.steps[s.id];
    const status: UiStepStatus = st.status === "skipped" ? "idle" : st.status;
    let description: ReactNode = s.description;
    if (failure?.failedStep === s.id) description = wrap(failure.reason);
    else if (st.status === "skipped") description = wrap(`Skipped: ${st.detail || "Stellar couldn't be read"}. Using the registry's copy instead.`);
    else if (s.id === "signals" && chainSkipped) description = "From the registry's copy of the note, with the attester key from its public signals.";
    else if (s.id === "proof" && chainSkipped) description = "Un-negate A from the registry's copy of the stored bytes and compare with its snarkjs proof.";
    return {
      id: s.id,
      label: s.label,
      status,
      description,
      meta: st.status === "done" && st.ms !== undefined ? formatMs(st.ms) : st.status === "skipped" ? "skipped" : undefined,
    };
  });

  return (
    <section
      aria-labelledby="verify-title"
      className={cn("rounded-panel border border-primary/20 bg-gradient-to-b from-primary-tint to-card p-5 shadow-card sm:p-7", className)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-cta">
          <ShieldCheck aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="verify-title" className="text-lg font-bold text-heading sm:text-xl">
            Verify proof in your browser
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Re-run the zero-knowledge check on your own device. Your browser reads the note from Stellar, fetches explorador&apos;s verification key and
            checks the proof with snarkjs. Nothing is sent anywhere.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <Button
          size={state.phase === "idle" ? "lg" : "md"}
          variant={state.phase === "idle" ? "primary" : "secondary"}
          icon={
            running ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
            ) : state.phase === "idle" ? (
              <ShieldCheck aria-hidden className="size-5" />
            ) : (
              <RotateCw aria-hidden className="size-4" />
            )
          }
          aria-disabled={running || undefined}
          onClick={verify}
          fullWidth
          className="sm:w-auto"
        >
          {running ? "Verifying…" : state.phase === "idle" ? "Verify proof" : "Verify again"}
        </Button>
      </div>

      <Stepper steps={steps} label={state.phase === "idle" ? "What the check does" : "Proof verification"} className="mt-6" />

      <div aria-live="polite" className={cn(state.phase === "done" && "mt-5")}>
        {state.phase === "done" && <ResultPanel result={state.result} />}
      </div>
    </section>
  );
}
