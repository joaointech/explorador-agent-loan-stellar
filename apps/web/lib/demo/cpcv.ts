// Seed / e2e CPCVs go through the admin's own CPCV → proof → note pipeline
// (lib/admin/pipeline.ts, behind POST /api/admin/cpcv), so they are exactly
// what the "New CPCV" form produces: the same form validation, PII encrypted
// with `encryptCpcvPii` (v1, including the commitment salt), the proof stored
// as `{ proof, publicSignals }`, the nullifier "already financed" guard, and the
// row moved PROVING → MINTED with `noteId` + `mintTxHash` (or FAILED).

import { adminCpcvInputSchema, dayToIsoDate } from "@/lib/admin/cpcv-input";
import { runCpcvPipeline } from "@/lib/admin/pipeline";
import type { AdminCpcvInput, PipelineEvent } from "@/lib/types/api";

export interface DealInput {
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  salePriceCents: bigint;
  commissionRateBps: number;
  /** Days since the Unix epoch (UTC). */
  cpcvDay: number;
  escrituraDay: number;
}

export interface MintedCpcv {
  cpcvId: string;
  noteId: number;
  txHash: string;
}

/** The New CPCV form body for a deal (validated with the form's schema). */
export function adminCpcvInput(agentUserId: string, deal: DealInput): AdminCpcvInput {
  return adminCpcvInputSchema.parse({
    agentId: agentUserId,
    buyerName: deal.buyerName,
    buyerNif: deal.buyerNif,
    sellerName: deal.sellerName,
    sellerNif: deal.sellerNif,
    propertyAddress: deal.propertyAddress,
    salePriceCents: Number(deal.salePriceCents),
    commissionRateBps: deal.commissionRateBps,
    cpcvDate: dayToIsoDate(deal.cpcvDay),
    escrituraDate: dayToIsoDate(deal.escrituraDay),
  });
}

/** Runs the admin pipeline for `deal` (operator-signed mint); throws with the failed step's message. */
export async function createCpcvNote(agentUserId: string, deal: DealInput, opts: { onEvent?: (event: PipelineEvent) => void } = {}): Promise<MintedCpcv> {
  let failure: PipelineEvent | undefined;
  const res = await runCpcvPipeline(adminCpcvInput(agentUserId, deal), (event) => {
    if (event.status === "failed") failure = event;
    opts.onEvent?.(event);
  });
  if (!res.ok || res.cpcvId === null || res.noteId === null || res.txHash === null) {
    throw new Error(`CPCV pipeline failed at "${failure?.step ?? "unknown"}": ${failure?.message ?? "no details"}`);
  }
  return { cpcvId: res.cpcvId, noteId: res.noteId, txHash: res.txHash };
}
