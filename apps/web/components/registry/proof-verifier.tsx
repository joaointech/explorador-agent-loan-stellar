"use client";

import { CircleCheck, CircleX, RotateCw, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Stepper, type Step, type StepStatus } from "@/components/ui/stepper";
import type { RegistryDetailResponse } from "@/lib/types/api";

import type { Groth16Verifier, ProofCheckDeps, ProofCheckResult } from "./proof-check";
import { PROOF_CHECK_STEPS, VERIFICATION_KEY_URL, type ProofCheckStep } from "./proof-steps";

type StepStates = Record<ProofCheckStep, { status: StepStatus; ms?: number }>;
type VerifyState =
  | { phase: "idle" }
  | { phase: "running"; steps: StepStates }
  | { phase: "done"; steps: StepStates; result: ProofCheckResult };

const initialSteps = (): StepStates => ({
  verifier: { status: "active" },
  key: { status: "idle" },
  signals: { status: "idle" },
  proof: { status: "idle" },
  pairing: { status: "idle" },
});

/** "412 ms", "1.24 s". */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const browserDeps: ProofCheckDeps = {
  loadVerifier: async () => (await import("snarkjs")).groth16 as Groth16Verifier,
  loadVerificationKey: async () => {
    const res = await fetch(VERIFICATION_KEY_URL, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
};

/**
 * "Verify proof in your browser" (spec §8.5, §10.2): loads snarkjs and the
 * published verification key on demand, rebuilds the public signals from the
 * note's public fields, checks the served proof is the on-chain one, and runs
 * groth16.verify. Shows each step and how long the pairing check took.
 */
export function ProofVerifier({ detail, className }: { detail: Pick<RegistryDetailResponse, "note" | "publicSignals" | "snarkjsProof">; className?: string }) {
  const [state, setState] = useState<VerifyState>({ phase: "idle" });
  const runId = useRef(0);
  const canVerify = detail.publicSignals.length === 9;

  async function verify() {
    const id = ++runId.current;
    const live = () => id === runId.current;
    setState({ phase: "running", steps: initialSteps() });
    const update = (step: ProofCheckStep, status: "active" | "done" | "error", ms?: number) => {
      if (!live()) return;
      setState((s) => (s.phase === "idle" ? s : { ...s, steps: { ...s.steps, [step]: { status, ms } } }));
    };
    let result: ProofCheckResult;
    try {
      const { checkNoteProof } = await import("./proof-check");
      result = await checkNoteProof(detail, browserDeps, update);
    } catch (err) {
      update("verifier", "error");
      result = { valid: false, failedStep: "verifier", reason: `Couldn't load the verifier: ${err instanceof Error ? err.message : String(err)}`, totalMs: 0 };
    }
    if (live()) setState((s) => (s.phase === "idle" ? s : { phase: "done", steps: s.steps, result }));
  }

  const running = state.phase === "running";
  const failure = state.phase === "done" && !state.result.valid ? state.result : null;
  const failedIndex = failure ? PROOF_CHECK_STEPS.findIndex((s) => s.id === failure.failedStep) : -1;
  const steps: Step[] = PROOF_CHECK_STEPS.map((s) => {
    const st = state.phase === "idle" ? { status: "idle" as const, ms: undefined } : state.steps[s.id];
    return {
      id: s.id,
      label: s.label,
      status: st.status,
      description: failure?.failedStep === s.id ? failure.reason : s.description,
      meta: st.status === "done" && st.ms !== undefined ? formatMs(st.ms) : undefined,
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
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Re-run the zero-knowledge check on your own device. snarkjs fetches explorador&apos;s verification key and checks this note&apos;s
            proof against its public data. Nothing leaves your browser.
          </p>
        </div>
      </div>

      {state.phase === "idle" && (
        <div className="mt-6">
          <Button size="lg" icon={<ShieldCheck aria-hidden className="size-5" />} onClick={verify} disabled={!canVerify} fullWidth className="sm:w-auto">
            Verify proof
          </Button>
          {!canVerify && (
            <p className="mt-3 text-sm text-muted">This note&apos;s public signals aren&apos;t available yet, so there is nothing to check against.</p>
          )}
        </div>
      )}
      <Stepper steps={steps} label={state.phase === "idle" ? "What the check does" : "Proof verification"} className="mt-6" />
      {state.phase !== "idle" && (
        <div>
          <div aria-live="polite" className="mt-5">
            {state.phase === "done" &&
              (state.result.valid ? (
                <div className="flex items-start gap-3 rounded-card border border-emerald-600/20 bg-emerald-50 p-4 dark:border-emerald-400/25 dark:bg-emerald-500/10">
                  <CircleCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className="font-semibold text-emerald-800 dark:text-emerald-300">Proof verified</p>
                    <p className="mt-0.5 text-sm text-emerald-900/80 dark:text-emerald-200/80">
                      Pairing check passed in {formatMs(state.result.verifyMs)} ({formatMs(state.result.totalMs)} in total). This note&apos;s public
                      data is exactly what explorador&apos;s attested deal proves.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-card border border-red-600/20 bg-red-50 p-4 dark:border-red-400/25 dark:bg-red-500/10">
                  <CircleX aria-hidden className="mt-0.5 size-6 shrink-0 text-red-600 dark:text-red-400" />
                  <div>
                    <p className="font-semibold text-red-800 dark:text-red-300">Proof not verified</p>
                    <p className="mt-0.5 text-sm text-red-900/80 dark:text-red-200/80">
                      Stopped at step {failedIndex + 1} of {PROOF_CHECK_STEPS.length}: {PROOF_CHECK_STEPS[failedIndex]?.label.toLowerCase()}.
                      <span className="sr-only"> {state.result.reason}</span>
                    </p>
                  </div>
                </div>
              ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            icon={<RotateCw aria-hidden className="size-4" />}
            onClick={verify}
            loading={running}
          >
            {running ? "Verifying…" : "Verify again"}
          </Button>
        </div>
      )}
    </section>
  );
}
