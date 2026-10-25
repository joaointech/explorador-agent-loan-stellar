// "Verify proof in your browser" (spec §8.5, §10.2). Re-checks a note's Groth16
// proof with snarkjs, trusting as little as possible of the registry API:
//   1. reads the note, the attester parameters and the verification key from
//      the cpcv_note contract over Soroban RPC (when it can), and requires the
//      registry's copy and the published key to match them;
//   2. rebuilds all 9 public signals from those on-chain values (public inputs
//      6–8 come from the contract, so a proof made under any other attester key
//      fails) and requires the registry's `publicSignals` to match;
//   3. un-negates A from the on-chain proof bytes and requires the registry's
//      snarkjs proof to match;
//   4. runs groth16.verify on the rebuilt signals and the on-chain proof.
// When Stellar can't be reached it falls back to the registry's copy and says
// so (`source: "registry"`): the math still runs, but the attester key and the
// bytes are then only as trustworthy as the API.
//
// Loaded lazily by the verifier component (it pulls in snarkjs and the Stellar
// SDK); tested in Node against the committed fixture proofs.

import type { RegistryDetailResponse, SnarkjsProof } from "@/lib/types/api";
import { sorobanToProof, vkToSorobanHex, type SnarkjsVerificationKey, type SorobanVerificationKeyHex } from "@/lib/zk/format";
import { buildPublicSignals, type AttesterParams, type NotePublicData } from "@/lib/zk/public-signals";

import { ChainRejectedError, ChainUnavailableError } from "./chain-errors";
import type { ChainSnapshot } from "./chain-note";
import type { ProofCheckStep } from "./proof-steps";
import { PUBLIC_SIGNALS, signalHex } from "./public-signals";

export { PROOF_CHECK_STEPS, type ProofCheckStep } from "./proof-steps";

export interface Groth16Verifier {
  verify(vk: unknown, publicSignals: string[], proof: SnarkjsProof): Promise<boolean>;
}

export interface ProofCheckDeps {
  loadVerifier: () => Promise<Groth16Verifier>;
  loadVerificationKey: () => Promise<SnarkjsVerificationKey>;
  /**
   * Reads the note from the cpcv_note contract. Throw ChainUnavailableError
   * when Stellar can't be asked (the check falls back to the registry's copy);
   * any other failure fails the check. Omitted: treated as unavailable.
   */
  readChain?: () => Promise<ChainSnapshot>;
  /** Milliseconds clock; `performance.now` by default. */
  now?: () => number;
}

export type ProofCheckInput = Pick<RegistryDetailResponse, "note" | "publicSignals" | "snarkjsProof">;

export type ProofCheckResult =
  | { valid: true; source: "chain"; contractId: string; verifyMs: number; totalMs: number }
  | { valid: true; source: "registry"; chainSkipped: string; verifyMs: number; totalMs: number }
  | { valid: false; failedStep: ProofCheckStep; reason: string; totalMs: number };

export type StepStatus = "active" | "done" | "skipped" | "error";
/** `detail` carries the reason for "skipped". */
export type StepListener = (step: ProofCheckStep, status: StepStatus, ms?: number, detail?: string) => void;

class StepFailure extends Error {
  constructor(
    readonly step: ProofCheckStep,
    message: string,
  ) {
    super(message);
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Affine coordinates plus z (snarkjs' projective flag), a missing z read as the affine "1". */
function g1(p: readonly string[]): bigint[] {
  return [p[0], p[1], p[2] ?? "1"].map((v) => BigInt(v));
}
function g2(p: readonly (readonly string[])[]): bigint[] {
  return [p[0]?.[0], p[0]?.[1], p[1]?.[0], p[1]?.[1], p[2]?.[0] ?? "1", p[2]?.[1] ?? "0"].map((v) => BigInt(v ?? "x"));
}
const sameInts = (a: bigint[], b: bigint[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Same points, coordinate by coordinate (z included: 0 would be the point at infinity). */
export function sameProof(a: SnarkjsProof, b: SnarkjsProof): boolean {
  try {
    return sameInts(g1(a.pi_a), g1(b.pi_a)) && sameInts(g2(a.pi_b), g2(b.pi_b)) && sameInts(g1(a.pi_c), g1(b.pi_c));
  } catch {
    return false;
  }
}

function isVerificationKey(v: unknown): v is SnarkjsVerificationKey {
  if (!v || typeof v !== "object") return false;
  const k = v as Partial<SnarkjsVerificationKey>;
  return k.protocol === "groth16" && k.curve === "bn128" && k.nPublic === PUBLIC_SIGNALS.length && Array.isArray(k.IC);
}

const sameVk = (a: SorobanVerificationKeyHex, b: SorobanVerificationKeyHex) =>
  a.alpha === b.alpha && a.beta === b.beta && a.gamma === b.gamma && a.delta === b.delta && a.ic.length === b.ic.length && a.ic.every((p, i) => p === b.ic[i]);

const normHex = (h: string) => h.toLowerCase().replace(/^0x/, "");

/** Fields of the registry's note that differ from the on-chain note. */
function noteMismatches(served: ProofCheckInput["note"], chain: ChainSnapshot["note"]): string[] {
  const out: string[] = [];
  if (served.id !== chain.id) out.push("note id");
  if (served.agent !== chain.agent) out.push("agent");
  if (BigInt(served.totalCommission) !== chain.totalCommission) out.push("total commission");
  if (BigInt(served.agentCommission) !== chain.agentCommission) out.push("agent commission");
  if (served.escrituraDay !== chain.escrituraDay) out.push("escritura date");
  if (normHex(served.commitment) !== chain.commitment) out.push("commitment");
  if (normHex(served.nullifier) !== chain.nullifier) out.push("nullifier");
  if (normHex(served.proof.a) !== chain.proof.a || normHex(served.proof.b) !== chain.proof.b || normHex(served.proof.c) !== chain.proof.c) {
    out.push("proof bytes");
  }
  return out;
}

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

    // 1. Stellar's copy of the note, or the reason we can't have it.
    current = "chain";
    onStep?.("chain", "active");
    const t0 = now();
    let chain: ChainSnapshot | null = null;
    let chainSkipped = "";
    try {
      if (!deps.readChain) throw new ChainUnavailableError("reading Stellar isn't set up on this page");
      chain = await deps.readChain();
    } catch (err) {
      if (err instanceof ChainUnavailableError) chainSkipped = err.message;
      else if (err instanceof ChainRejectedError) throw new StepFailure("chain", err.message);
      else throw new StepFailure("chain", `Couldn't read the note from Stellar: ${message(err)}`);
    }
    if (chain) {
      const diff = noteMismatches(input.note, chain.note);
      if (diff.length > 0) throw new StepFailure("chain", `The registry's copy differs from the note on Stellar (${diff.join(", ")}).`);
      if (!sameVk(vkToSorobanHex(vk), chain.vk)) throw new StepFailure("chain", "The published verification key isn't the one the note contract checks proofs with.");
      onStep?.("chain", "done", now() - t0);
    } else {
      onStep?.("chain", "skipped", undefined, chainSkipped);
    }

    // 2. The 9 public signals, from on-chain values when we have them.
    const signals = await step("signals", () => {
      const served = input.publicSignals ?? [];
      const hasServed = served.length === PUBLIC_SIGNALS.length;
      let attester: AttesterParams;
      if (chain) attester = chain.attester;
      else if (hasServed) attester = { attesterAx: signalHex(served[6]), attesterAy: signalHex(served[7]), nullifierSecretCommitment: signalHex(served[8]) };
      else throw new StepFailure("signals", "Without Stellar or the registry's public signals there is nothing to check against.");

      const note: NotePublicData = chain ? chain.note : input.note;
      let rebuilt: string[];
      try {
        rebuilt = buildPublicSignals(note, attester);
      } catch (err) {
        throw new StepFailure("signals", `This note's public data can't be encoded as circuit inputs: ${message(err)}`);
      }
      if (hasServed) {
        const mismatched = rebuilt.flatMap((value, i) => (BigInt(value) === BigInt(served[i]) ? [] : [PUBLIC_SIGNALS[i].label.toLowerCase()]));
        if (mismatched.length > 0) {
          throw new StepFailure("signals", `The registry's public signals don't match the note's ${chain ? "on-chain " : ""}data (${mismatched.join(", ")}).`);
        }
      }
      return rebuilt;
    });

    // 3. The proof as stored, A un-negated.
    const proof = await step("proof", () => {
      let stored: SnarkjsProof;
      try {
        stored = sorobanToProof((chain ? chain.note : input.note).proof);
      } catch (err) {
        throw new StepFailure("proof", `The stored proof bytes are malformed: ${message(err)}`);
      }
      if (input.snarkjsProof && !sameProof(input.snarkjsProof, stored)) {
        throw new StepFailure("proof", `The registry's snarkjs proof differs from the proof stored ${chain ? "on Stellar" : "with the note"}.`);
      }
      return stored;
    });

    // 4. The pairing check.
    current = "pairing";
    onStep?.("pairing", "active");
    const t1 = now();
    let valid: boolean;
    try {
      valid = await verifier.verify(vk, signals, proof);
    } catch (err) {
      throw new StepFailure("pairing", `snarkjs couldn't run the check: ${message(err)}`);
    }
    const verifyMs = now() - t1;
    if (!valid) throw new StepFailure("pairing", "The pairing check failed: this proof doesn't prove these public signals.");
    onStep?.("pairing", "done", verifyMs);
    const totalMs = now() - started;
    return chain
      ? { valid: true, source: "chain", contractId: chain.contractId, verifyMs, totalMs }
      : { valid: true, source: "registry", chainSkipped, verifyMs, totalMs };
  } catch (err) {
    const failedStep = err instanceof StepFailure ? err.step : current;
    onStep?.(failedStep, "error");
    return { valid: false, failedStep, reason: message(err), totalMs: now() - started };
  }
}
