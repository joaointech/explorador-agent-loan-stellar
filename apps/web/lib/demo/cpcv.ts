// The CPCV → proof → note pipeline (spec §4.3) for the seed and e2e: the real
// thing, end to end — encrypted PII (including the commitment salt) in
// Postgres, attestation signature + Groth16 proof (snarkjs) verified locally,
// `cpcv_note.mint` verified on-chain, and the Cpcv row moved to MINTED with
// the note id and tx hash. `Cpcv.proof` = `{ proof, publicSignals }`.
//
// PII format: version 1 of the admin workstream's `Cpcv.piiEncrypted` record
// (lib/admin/pii.ts on its branch), so the admin panel decrypts seeded rows:
//   { v: 1, buyerName, buyerNif, sellerName, sellerNif, propertyAddress,
//     salePriceCents: number, commissionRateBps: number,
//     cpcvDate: "YYYY-MM-DD", cpcvDay: number, salt: "<64 hex>" | null }

import { encryptJson } from "@/lib/crypto";
import { db } from "@/lib/db";
import { mintNote, type TxSourceOptions } from "@/lib/stellar/contracts";
import { DAY_SECS } from "@/lib/units";
import { toHex } from "@/lib/zk/field";
import { proveCpcvWithKeys, zkKeysFromEnv, type CpcvProof, type ProveStep, type ZkKeys } from "@/lib/zk/prove";

export interface DealInput {
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

export interface CpcvPiiV1 {
  v: 1;
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  salePriceCents: number;
  commissionRateBps: number;
  cpcvDate: string;
  cpcvDay: number;
  salt: string | null;
}

export const dayToIsoDate = (day: number): string => new Date(day * DAY_SECS * 1000).toISOString().slice(0, 10);

export function piiRecord(deal: DealInput, salt: string | null): CpcvPiiV1 {
  return {
    v: 1,
    buyerName: deal.buyerName,
    buyerNif: deal.buyerNif,
    sellerName: deal.sellerName,
    sellerNif: deal.sellerNif,
    propertyAddress: deal.propertyAddress,
    salePriceCents: Number(deal.salePriceCents),
    commissionRateBps: deal.commissionRateBps,
    cpcvDate: dayToIsoDate(deal.cpcvDay),
    cpcvDay: deal.cpcvDay,
    salt,
  };
}

export interface MintedCpcv {
  cpcvId: string;
  noteId: number;
  txHash: string;
  proof: CpcvProof;
}

export interface CreateCpcvOptions extends TxSourceOptions {
  keys?: ZkKeys;
  onStep?: (step: ProveStep | "minting") => void;
}

/** Proves the deal for `agent.smartAccount`, stores the encrypted record and mints the note. */
export async function createCpcvNote(agent: { userId: string; smartAccount: string }, deal: DealInput, opts: CreateCpcvOptions = {}): Promise<MintedCpcv> {
  const proof = await proveCpcvWithKeys(
    agent.smartAccount,
    {
      buyerNif: deal.buyerNif,
      sellerNif: deal.sellerNif,
      salePriceCents: deal.salePriceCents,
      commissionRateBps: deal.commissionRateBps,
      propertyAddress: deal.propertyAddress,
      cpcvDay: deal.cpcvDay,
      escrituraDay: deal.escrituraDay,
    },
    opts.keys ?? zkKeysFromEnv(),
    opts.onStep,
  );
  const row = await db.cpcv.create({
    data: {
      agentId: agent.userId,
      piiEncrypted: encryptJson(piiRecord(deal, proof.salt)),
      totalCommissionCents: proof.totalCommissionCents,
      agentCommissionCents: proof.agentCommissionCents,
      escrituraDay: deal.escrituraDay,
      commitment: toHex(proof.commitment),
      nullifier: toHex(proof.nullifier),
      proof: { proof: proof.snarkjsProof, publicSignals: proof.publicSignals } as object,
      status: "PROVING",
    },
  });
  opts.onStep?.("minting");
  try {
    const res = await mintNote(
      {
        to: agent.smartAccount,
        proof: proof.sorobanProof,
        totalCommissionCents: proof.totalCommissionCents,
        escrituraDay: deal.escrituraDay,
        commitment: proof.commitment,
        nullifier: proof.nullifier,
      },
      { source: opts.source },
    );
    await db.cpcv.update({ where: { id: row.id }, data: { status: "MINTED", noteId: res.result, mintTxHash: res.txHash, error: null } });
    return { cpcvId: row.id, noteId: res.result, txHash: res.txHash, proof };
  } catch (err) {
    await db.cpcv.update({ where: { id: row.id }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : String(err) } });
    throw err;
  }
}
