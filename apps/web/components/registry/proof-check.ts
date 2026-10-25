// "Verify proof in your browser" (spec §8.5, §10.2): re-checks a note's
// Groth16 proof with snarkjs and the published verification key, plus two
// cheap consistency checks so the result is about the data on the page, not
// just whatever the API sent:
//   1. the public signals 0–5 rebuilt from the note's on-chain fields equal the
//      API's `publicSignals` (6–8 are the contract's attester constants);
//   2. the API's snarkjs proof is the on-chain proof with A un-negated.
// Loaded lazily by the verifier component (it pulls in snarkjs and the Stellar
// SDK); tested in Node against the committed fixture proof.

import type { RegistryDetailResponse, SnarkjsProof } from "@/lib/types/api";
import { sorobanToProof, type SnarkjsVerificationKey } from "@/lib/zk/format";
import { buildPublicSignals } from "@/lib/zk/public-signals";

import type { ProofCheckStep } from "./proof-steps";
import { PUBLIC_SIGNALS, signalHex } from "./public-signals";

export { PROOF_CHECK_STEPS, type ProofCheckStep } from "./proof-steps";

export interface Groth16Verifier {
  verify(vk: unknown, publicSignals: string[], proof: SnarkjsProof): Promise<boolean>;
}

export interface ProofCheckDeps {
  loadVerifier: () => Promise<Groth16Verifier>;
  loadVerificationKey: () => Promise<SnarkjsVerificationKey>;
  /** Milliseconds clock; `performance.now` by default. */
  now?: () => number;
}

export type ProofCheckInput = Pick<RegistryDetailResponse, "note" | "publicSignals" | "snarkjsProof">;

export type ProofCheckResult =
  | { valid: true; verifyMs: number; totalMs: number }
  | { valid: false; failedStep: ProofCheckStep; reason: string; totalMs: number };

export type StepListener = (step: ProofCheckStep, status: "active" | "done" | "error", ms?: number) => void;

class StepFailure extends Error {
  constructor(
    readonly step: ProofCheckStep,
    message: string,
  ) {
    super(message);
  }
}

const sameCoords = (a: readonly string[], b: readonly string[], n: number) =>
  a.length >= n && b.length >= n && a.slice(0, n).every((v, i) => BigInt(v) === BigInt(b[i]));

/** Same affine points, ignoring the projective z coordinate snarkjs appends. */
export function sameProof(a: SnarkjsProof, b: SnarkjsProof): boolean {
  try {
    return (
      sameCoords(a.pi_a, b.pi_a, 2) &&
      a.pi_b.length >= 2 &&
      b.pi_b.length >= 2 &&
      sameCoords(a.pi_b[0], b.pi_b[0], 2) &&
      sameCoords(a.pi_b[1], b.pi_b[1], 2) &&
      sameCoords(a.pi_c, b.pi_c, 2)
    );
  } catch {
    return false;
  }
}

function isVerificationKey(v: unknown): v is SnarkjsVerificationKey {
  if (!v || typeof v !== "object") return false;
  const k = v as Partial<SnarkjsVerificationKey>;
  return k.protocol === "groth16" && k.curve === "bn128" && k.nPublic === PUBLIC_SIGNALS.length && Array.isArray(k.IC);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs every step; never throws (failures come back as `{ valid: false }`). */
export async function checkNoteProof(input: ProofCheckInput, deps: ProofCheckDeps, onStep?: StepListener): Promise<ProofCheckResult> {
  const now = deps.now ?? (() => performance.now());
  const started = now();
  let current: ProofCheckStep = "verifier";

  async function step<T>(id: ProofCheckStep, run: () => Promise<T> | T): Promise<T> {
    current = id;
    onStep?.(id, "active");
    const t0 = now();
    const value = await run();
    onStep?.(id, "done", now() - t0);
    return value;
  }

  try {
    const verifier = await step("verifier", async () => {
      try {
        return await deps.loadVerifier();
      } catch (err) {
        throw new StepFailure("verifier", `Couldn't load snarkjs: ${message(err)}`);
      }
    });

    const vk = await step("key", async () => {
      let key: unknown;
      try {
        key = await deps.loadVerificationKey();
      } catch (err) {
        throw new StepFailure("key", `Couldn't fetch the verification key: ${message(err)}`);
      }
      if (!isVerificationKey(key)) throw new StepFailure("key", "The verification key isn't a Groth16 BN254 key for 9 public signals.");
      return key;
    });

    const signals = await step("signals", () => {
      const served = input.publicSignals ?? [];
      if (served.length !== PUBLIC_SIGNALS.length) {
        throw new StepFailure("signals", "The registry didn't return this note's public signals, so there is nothing to check against.");
      }
      let rebuilt: string[];
      try {
        rebuilt = buildPublicSignals(input.note, {
          attesterAx: signalHex(served[6]),
          attesterAy: signalHex(served[7]),
          nullifierSecretCommitment: signalHex(served[8]),
        });
      } catch (err) {
        throw new StepFailure("signals", `This note's public data can't be encoded as circuit inputs: ${message(err)}`);
      }
      const mismatched = rebuilt.flatMap((value, i) => (BigInt(value) === BigInt(served[i]) ? [] : [PUBLIC_SIGNALS[i].label.toLowerCase()]));
      if (mismatched.length > 0) {
        throw new StepFailure("signals", `The public signals don't match this note's on-chain data (${mismatched.join(", ")}).`);
      }
      return served.map(String);
    });

    const proof = await step("proof", () => {
      let onChain: SnarkjsProof;
      try {
        onChain = sorobanToProof(input.note.proof);
      } catch (err) {
        throw new StepFailure("proof", `The on-chain proof bytes are malformed: ${message(err)}`);
      }
      if (input.snarkjsProof && !sameProof(input.snarkjsProof, onChain)) {
        throw new StepFailure("proof", "The proof the registry served differs from the proof stored on Stellar.");
      }
      return input.snarkjsProof ?? onChain;
    });

    current = "pairing";
    onStep?.("pairing", "active");
    const t0 = now();
    let valid: boolean;
    try {
      valid = await verifier.verify(vk, signals, proof);
    } catch (err) {
      throw new StepFailure("pairing", `snarkjs couldn't run the check: ${message(err)}`);
    }
    const verifyMs = now() - t0;
    if (!valid) throw new StepFailure("pairing", "The pairing check failed: this proof doesn't prove these public signals.");
    onStep?.("pairing", "done", verifyMs);
    return { valid: true, verifyMs, totalMs: now() - started };
  } catch (err) {
    const failedStep = err instanceof StepFailure ? err.step : current;
    onStep?.(failedStep, "error");
    return { valid: false, failedStep, reason: message(err), totalMs: now() - started };
  }
}
