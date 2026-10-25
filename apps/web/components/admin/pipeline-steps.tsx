"use client";

import type { ReactNode } from "react";

import { Stepper, type Step, type StepStatus } from "@/components/ui/stepper";
import type { PipelineEvent, PipelineStep } from "@/lib/types/api";

// The CPCV → proof → note pipeline as the admin sees it (spec §4.3 step 2).
export const PIPELINE: readonly { id: PipelineStep; label: string; description: string }[] = [
  { id: "validating", label: "Validating", description: "Checks the CPCV, the agent's smart account and the protocol date; stores the personal data encrypted." },
  { id: "signing", label: "Signing attestation", description: "explorador's attester key (EdDSA on BabyJubJub) signs the deal record." },
  { id: "proving", label: "Generating ZK proof", description: "Groth16 over BN254 with Poseidon: hides buyer, seller, price, rate and address." },
  { id: "verifying", label: "Verifying proof locally", description: "Checks the proof against the verification key before spending a transaction." },
  { id: "minting", label: "Minting note on Stellar", description: "cpcv_note.mint verifies the proof on-chain, mints the soulbound note and opens the credit line." },
  { id: "done", label: "Done", description: "The note is in the public registry, with no personal data." },
];

export interface StepState {
  status: StepStatus;
  message?: string;
  startedAt?: number;
  endedAt?: number;
}

export type PipelineState = Record<PipelineStep, StepState>;

export const idlePipeline = (): PipelineState =>
  Object.fromEntries(PIPELINE.map((s) => [s.id, { status: "idle" as StepStatus }])) as PipelineState;

/** Applies one server event (`now` = when it arrived, ms). Reducer: returns a new state. */
export function applyPipelineEvent(state: PipelineState, event: PipelineEvent, now: number): PipelineState {
  const next = { ...state };
  const current = next[event.step];
  if (!current) return state;
  if (event.status === "started") {
    next[event.step] = { status: "active", message: event.message, startedAt: now };
  } else if (event.status === "completed") {
    next[event.step] = { status: "done", message: event.message, startedAt: current.startedAt ?? now, endedAt: now };
    if (event.step === "done") {
      // Done has no "started": every step before it is complete.
      for (const s of PIPELINE) if (next[s.id].status !== "done") next[s.id] = { ...next[s.id], status: "done" };
    }
  } else {
    next[event.step] = { status: "error", message: event.message, startedAt: current.startedAt, endedAt: now };
  }
  return next;
}

/** The step that is running (or failed): where a dropped connection is reported. */
export function currentStep(state: PipelineState): PipelineStep {
  const active = PIPELINE.find((s) => state[s.id].status === "active" || state[s.id].status === "error");
  if (active) return active.id;
  const firstIdle = PIPELINE.find((s) => state[s.id].status === "idle");
  return firstIdle?.id ?? "done";
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

/** The vertical Stepper fed by the SSE stream; `meta` per step (e.g. the tx link on minting). */
export function PipelineSteps({ state, meta = {} }: { state: PipelineState; meta?: Partial<Record<PipelineStep, ReactNode>> }) {
  const steps: Step[] = PIPELINE.map((s) => {
    const st = state[s.id];
    const duration = st.status === "done" && st.startedAt !== undefined && st.endedAt !== undefined && s.id !== "done" ? seconds(st.endedAt - st.startedAt) : undefined;
    return {
      id: s.id,
      label: s.label,
      status: st.status,
      description: st.status === "idle" ? s.description : (st.message ?? s.description),
      meta: meta[s.id] ?? duration,
    };
  });
  return <Stepper steps={steps} label="CPCV pipeline" />;
}
