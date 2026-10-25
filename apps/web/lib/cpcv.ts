// CPCV → attestation → Groth16 proof → on-chain note (§4.3). Shared by the admin
// API (streamed progress) and the seed script.
import { computeCommission, hexToBytes, normalizeAddress, toHex32, type CpcvRecord } from "@advance/zk";
import type { CpcvPii, CpcvPipelineEvent, CpcvPipelineStep } from "@/lib/api-types";
import { encryptPii } from "@/lib/crypto/pii";
import { db, toJson } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { DAY, readProtocolNow } from "@/lib/pool";
import { invokeAsOperator, readContract } from "@/lib/stellar/client";
import { generateProof, signAttestation, verifyLocally } from "@/lib/zk/prove";

export interface CpcvInput {
  agentId: string;
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  salePriceCents: bigint;
  commissionRateBps: number;
  cpcvDay: number;
  escrituraDay: number;
}

export function dayToIso(day: number): string {
  return new Date(day * DAY * 1000).toISOString().slice(0, 10);
}

export function isoToDay(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) throw new HttpError(400, "VALIDATION", `Invalid date ${iso}`);
  return Math.floor(t / 1000 / DAY);
}

type Emit = (e: CpcvPipelineEvent) => void;

async function step<T>(emit: Emit, name: CpcvPipelineStep, fn: () => Promise<T>, extra: Partial<CpcvPipelineEvent> = {}): Promise<T> {
  const t0 = Date.now();
  emit({ step: name, status: "start", ...extra });
  const v = await fn();
  emit({ step: name, status: "ok", ms: Date.now() - t0, ...extra });
  return v;
}

export async function createAndMintCpcv(input: CpcvInput, emit: Emit = () => undefined) {
  let cpcvId: string | undefined;
  try {
    // 1. Validating
    const { agent, record } = await step(emit, "validating", async () => {
      const agent = await db.agent.findUnique({ where: { userId: input.agentId } });
      if (!agent) throw new HttpError(400, "UNKNOWN_AGENT", "Unknown agent");
      for (const [label, nif] of [["Buyer", input.buyerNif], ["Seller", input.sellerNif]] as const) {
        if (!/^\d{9}$/.test(nif)) throw new HttpError(400, "VALIDATION", `${label} NIF must have 9 digits`);
      }
      if (input.commissionRateBps < 100 || input.commissionRateBps > 1000) {
        throw new HttpError(400, "VALIDATION", "Commission rate must be between 1% and 10%");
      }
      if (input.salePriceCents <= 0n || input.salePriceCents >= 2n ** 63n) throw new HttpError(400, "VALIDATION", "Invalid sale price");
      if (input.cpcvDay >= input.escrituraDay) throw new HttpError(400, "VALIDATION", "The escritura must be after the CPCV date");
      const today = Math.floor((await readProtocolNow()) / DAY);
      if (input.escrituraDay <= today) throw new HttpError(400, "VALIDATION", "The escritura date must be in the future (protocol clock)");
      if (input.propertyAddress.trim().length < 5) throw new HttpError(400, "VALIDATION", "Property address is required");
      if (new TextEncoder().encode(normalizeAddress(input.propertyAddress)).length > 248) {
        throw new HttpError(400, "VALIDATION", "Property address is too long (max 248 bytes)");
      }
      const record: CpcvRecord = {
        buyerNif: Number(input.buyerNif),
        sellerNif: Number(input.sellerNif),
        salePriceCents: input.salePriceCents,
        commissionRateBps: input.commissionRateBps,
        propertyAddress: input.propertyAddress,
        cpcvDay: input.cpcvDay,
        escrituraDay: input.escrituraDay,
      };
      return { agent, record };
    });

    const { total, agent: agentCents } = computeCommission(input.salePriceCents, input.commissionRateBps);
    const pii: CpcvPii = {
      buyerName: input.buyerName,
      buyerNif: input.buyerNif,
      sellerName: input.sellerName,
      sellerNif: input.sellerNif,
      propertyAddress: input.propertyAddress,
      salePriceCents: Number(input.salePriceCents),
      commissionRateBps: input.commissionRateBps,
      cpcvDate: dayToIso(input.cpcvDay),
      escrituraDate: dayToIso(input.escrituraDay),
    };

    // 2. Signing attestation
    const att = await step(emit, "signing", async () => {
      const att = await signAttestation(record, agent.smartAccount);
      const nullifierHex = toHex32(att.publicSignals.nullifier);
      const used = await readContract<boolean>("cpcvNote", "nullifier_used", { nullifier: Buffer.from(hexToBytes(nullifierHex)) });
      if (used) throw new HttpError(409, "NULLIFIER_USED", "This CPCV has already been financed (nullifier used)");
      const row = await db.cpcv.create({
        data: {
          agentId: agent.userId,
          piiEncrypted: encryptPii(pii),
          totalCommissionCents: total,
          agentCommissionCents: agentCents,
          escrituraDay: input.escrituraDay,
          commitment: toHex32(att.publicSignals.commitment),
          nullifier: nullifierHex,
          status: "PROVING",
        },
      });
      cpcvId = row.id;
      return att;
    });

    // 3. Generating ZK proof
    const proof = await step(emit, "proving", () => generateProof(att), { cpcvId });

    // 4. Verifying locally
    const soroban = await step(emit, "verifying", () => verifyLocally(proof), { cpcvId });

    // 5. Minting on Stellar
    const minted = await step(
      emit,
      "minting",
      async () => {
        const { hash, result } = await invokeAsOperator<number>("cpcvNote", "mint", {
          to: agent.smartAccount,
          proof: { a: Buffer.from(soroban.a, "hex"), b: Buffer.from(soroban.b, "hex"), c: Buffer.from(soroban.c, "hex") },
          total_commission_cents: total,
          escritura_day: input.escrituraDay,
          commitment: Buffer.from(hexToBytes(toHex32(att.publicSignals.commitment))),
          nullifier: Buffer.from(hexToBytes(toHex32(att.publicSignals.nullifier))),
        });
        const noteId = Number(result);
        await db.cpcv.update({
          where: { id: cpcvId! },
          data: {
            status: "MINTED",
            noteId,
            mintTxHash: hash,
            proof: toJson({ snarkjs: proof.proof, publicSignals: proof.publicSignals, soroban }) as object,
          },
        });
        return { noteId, txHash: hash };
      },
      { cpcvId },
    );

    emit({ step: "done", status: "ok", cpcvId, noteId: minted.noteId, txHash: minted.txHash });
    return { cpcvId: cpcvId!, ...minted };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (cpcvId) await db.cpcv.update({ where: { id: cpcvId }, data: { status: "FAILED", error: message.slice(0, 1000) } }).catch(() => undefined);
    emit({ step: "error", status: "error", message, cpcvId });
    throw e;
  }
}
