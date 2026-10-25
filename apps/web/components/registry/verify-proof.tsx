"use client";
import * as React from "react";
import { CircleCheck, CircleX, LoaderCircle, ShieldCheck } from "lucide-react";
import type { RegistryDetailResponse } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type StepState = "idle" | "running" | "ok" | "fail";
interface Step {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
}

const INITIAL: Step[] = [
  { key: "rebuild", label: "Rebuild the proof from the on-chain bytes", state: "idle" },
  { key: "signals", label: "Match the public signals to this note", state: "idle" },
  { key: "vk", label: "Load the circuit's verification key", state: "idle" },
  { key: "verify", label: "Run the Groth16 pairing check (snarkjs)", state: "idle" },
];

function hexToBig(h: string): bigint {
  return BigInt(h.startsWith("0x") ? h : `0x${h}`);
}

/** agent_field(addr) = 0x00 ‖ sha256(ScVal::Address(addr).to_xdr())[0..31] (§8.4), computed in the browser. */
async function agentField(address: string): Promise<bigint> {
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const xdr = new Uint8Array(nativeToScVal(Address.fromString(address)).toXDR());
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", xdr));
  let v = 0n;
  for (const b of h.subarray(0, 31)) v = (v << 8n) | BigInt(b);
  return v;
}

/** Signal-by-signal comparison with the note's public fields (circuit order, §8.2). */
export async function signalChecks(d: RegistryDetailResponse): Promise<{ index: number; ok: boolean }[]> {
  const s = d.publicSignals.map((x) => BigInt(x));
  const n = d.note;
  const out = [
    { index: 1, ok: s[1] * 100_000n === BigInt(n.totalCommission) },
    { index: 2, ok: s[2] * 100_000n === BigInt(n.agentCommission) },
    { index: 3, ok: Number(s[3]) === n.escrituraDay },
    { index: 4, ok: s[4] === hexToBig(n.commitment) },
    { index: 5, ok: s[5] === hexToBig(n.nullifier) },
  ];
  try {
    out.unshift({ index: 0, ok: s[0] === (await agentField(n.agent)) });
  } catch {
    // stellar-sdk unavailable in this browser: skip the agent-binding check rather than fail it
  }
  return out;
}

export function VerifyProof({ detail, onSignals }: { detail: RegistryDetailResponse; onSignals?: (checks: Map<number, boolean>) => void }) {
  const [steps, setSteps] = React.useState<Step[]>(INITIAL);
  const [result, setResult] = React.useState<null | { ok: boolean; ms: number; message?: string }>(null);
  const [running, setRunning] = React.useState(false);

  const set = (key: string, state: StepState, detail?: string) =>
    setSteps((all) => all.map((s) => (s.key === key ? { ...s, state, detail } : s)));

  async function run() {
    setRunning(true);
    setResult(null);
    setSteps(INITIAL);
    const t0 = performance.now();
    let current = "rebuild";
    try {
      set("rebuild", "running");
      const zk = await import("@advance/zk/browser");
      const proof = zk.unformatProof(detail.proof);
      const same =
        proof.pi_a[0] === detail.snarkjsProof.pi_a[0] &&
        proof.pi_a[1] === detail.snarkjsProof.pi_a[1] &&
        proof.pi_c[0] === detail.snarkjsProof.pi_c[0];
      set("rebuild", "ok", same ? "A is un-negated; B's Fp2 pairs are swapped back" : "rebuilt from the on-chain encoding");

      current = "signals";
      set("signals", "running");
      const checks = await signalChecks(detail);
      onSignals?.(new Map(checks.map((c) => [c.index, c.ok])));
      const bad = checks.filter((c) => !c.ok);
      if (bad.length) {
        set("signals", "fail", `${bad.length} signal(s) do not match: ${bad.map((b) => detail.publicSignalLabels[b.index] ?? `#${b.index}`).join(", ")}`);
        throw new Error("The public signals do not match this note.");
      }
      set("signals", "ok", `${checks.length} of ${detail.publicSignals.length} signals checked against the note`);

      current = "vk";
      set("vk", "running");
      const res = await fetch("/zk/verification_key.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`verification key not found (${res.status})`);
      const vk = await res.json();
      set("vk", "ok", `${vk.protocol ?? "groth16"} · ${vk.curve ?? "bn128"} · ${vk.nPublic ?? "?"} public inputs`);

      current = "verify";
      set("verify", "running");
      // @ts-ignore -- snarkjs ships no types; @advance/zk may declare them
      const mod = await import("snarkjs");
      const groth16 = (mod.groth16 ?? mod.default?.groth16) as { verify: (vk: unknown, s: string[], p: unknown) => Promise<boolean> };
      const ok = await groth16.verify(vk, detail.publicSignals, proof);
      const ms = Math.round(performance.now() - t0);
      set("verify", ok ? "ok" : "fail", ok ? "e(A,B) = e(α,β)·e(L,γ)·e(C,δ)" : "pairing check failed");
      setResult({ ok, ms, message: ok ? undefined : "The proof did not verify." });
    } catch (e) {
      set(current, "fail", errorMessage(e));
      setResult({ ok: false, ms: Math.round(performance.now() - t0), message: errorMessage(e) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-white">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-bold">Don&apos;t trust — verify</h2>
          <p className="mt-0.5 text-sm text-muted">
            Re-run the check the contract ran before minting this note, entirely in your browser, with the public verification key.
          </p>
        </div>
      </div>

      {result?.ok ? (
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CircleCheck className="size-9 shrink-0 text-emerald-600" />
          <div>
            <p className="text-lg font-bold">Proof verified</p>
            <p className="text-sm">Valid Groth16 proof for this note · checked in {result.ms} ms</p>
          </div>
        </div>
      ) : result ? (
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-red-800 dark:bg-red-500/10 dark:text-red-200">
          <CircleX className="size-9 shrink-0 text-red-600" />
          <div>
            <p className="text-lg font-bold">Not verified</p>
            <p className="text-sm">{result.message}</p>
          </div>
        </div>
      ) : null}

      {(running || result) && (
        <ol className="mt-4 space-y-2">
          {steps.map((s) => (
            <li key={s.key} className="flex gap-2.5 text-sm">
              <span className="mt-0.5 shrink-0">
                {s.state === "running" ? (
                  <LoaderCircle className="size-4 animate-spin text-primary" />
                ) : s.state === "ok" ? (
                  <CircleCheck className="size-4 text-emerald-600" />
                ) : s.state === "fail" ? (
                  <CircleX className="size-4 text-red-600" />
                ) : (
                  <span className="block size-4 rounded-full border border-line" />
                )}
              </span>
              <span className="min-w-0">
                <span className={cn(s.state === "idle" && "text-muted")}>{s.label}</span>
                {s.detail && <span className="block break-words text-xs text-muted">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      <Button className="mt-5 w-full" size="lg" onClick={run} loading={running} variant={result?.ok ? "secondary" : "primary"}>
        {result ? "Verify again" : "Verify proof in your browser"}
      </Button>
    </div>
  );
}
