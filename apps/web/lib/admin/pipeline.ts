// The CPCV → proof → note pipeline behind POST /api/admin/cpcv (spec §4.3,
// §8.6), reported step by step for the admin's Stepper:
//
//   validating  form + agent + protocol date (+ the signed PDF, if attached);
//               the Cpcv row is created (PROVING) with the PII encrypted, and
//               the PDF linked to it in the same transaction
//   signing     explorador's attester key signs the deal record   ┐ proveCpcv
//   proving     Groth16 proof with snarkjs                         │ (lib/zk)
//   verifying   local verification; commitment, nullifier, proof   ┘
//               and the salt (inside the PII) are stored
//   minting     cpcv_note.mint as operator → MINTED + noteId + mintTxHash
//   done
//
// Any failure marks the row FAILED with the error and ends the stream with a
// `failed` event for the step that failed.

import { piiKey } from "@/lib/crypto";
import { db, type Prisma } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { explorerUrl, mintNote, readProtocolNow } from "@/lib/stellar/contracts";
import type { AdminCpcvInput, PipelineEvent, PipelineStep } from "@/lib/types/api";
import { DAY_SECS } from "@/lib/units";
import { CpcvInputError, validateCpcvInput } from "@/lib/zk/attestation";
import { toHex } from "@/lib/zk/field";
import { proveCpcv, type CpcvPrivateInput } from "@/lib/zk/prove";

import { chainHttpError, shortMessage } from "./chain-errors";
import { previewCommission, type CommissionPreview } from "./commission";
import { checkLinkableDocument, linkCpcvDocument } from "./cpcv-documents";
import { isoDateToDay, protocolDateIssues } from "./cpcv-input";
import { encryptCpcvPii, type CpcvPii } from "./pii";

export interface PipelineResult {
  ok: boolean;
  cpcvId: string | null;
  noteId: number | null;
  txHash: string | null;
}

interface ValidatedCpcv {
  agent: { userId: string; email: string; smartAccount: string };
  privateInput: CpcvPrivateInput;
  commission: CommissionPreview;
  pii: CpcvPii;
  escrituraDay: number;
  /** The signed PDF to link, and the CPCV it is linked to now (null, or a FAILED one). */
  document: { id: string; previousCpcvId: string | null } | null;
}

/** Statuses that mean a deal was financed; a FAILED or abandoned PROVING row doesn't block a retry. */
const FINANCED = ["MINTED", "SETTLED", "CANCELLED", "WRITTEN_OFF"] as const;

const FAILURE_PREFIX: Partial<Record<PipelineStep, string>> = {
  signing: "Signing the attestation failed",
  proving: "Proof generation failed",
  verifying: "Local proof verification failed",
};

function requireServerSecrets(): void {
  try {
    requireEnv("ATTESTER_EDDSA_PRIVKEY");
    requireEnv("NULLIFIER_SECRET");
    piiKey();
  } catch (err) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", err instanceof Error ? err.message : String(err));
  }
}

/** Server-side checks beyond the form schema: the agent, the protocol date, the circuit's own rules. */
async function validate(input: AdminCpcvInput): Promise<ValidatedCpcv> {
  requireServerSecrets();

  const user = await db.user.findUnique({
    where: { id: input.agentId },
    select: { id: true, email: true, role: true, agent: { select: { smartAccount: true } } },
  });
  if (!user || user.role !== "AGENT") throw new HttpError(404, "UNKNOWN_AGENT", "There is no agent with this id");
  if (!user.agent) {
    throw new HttpError(409, "AGENT_NOT_READY", `${user.email} has no smart account yet: they need to finish onboarding first`);
  }

  const protocolNow = await readProtocolNow().catch((err: unknown) => {
    throw chainHttpError(err);
  });
  const issues = protocolDateIssues(input, Math.floor(Number(protocolNow) / DAY_SECS));
  if (issues.length > 0) throw new HttpError(400, "INVALID_DATE", issues.map((i) => i.message).join(". "));

  const cpcvDay = isoDateToDay(input.cpcvDate);
  const escrituraDay = isoDateToDay(input.escrituraDate);
  if (cpcvDay === null || escrituraDay === null) throw new HttpError(400, "INVALID_DATE", "Invalid date");

  const privateInput: CpcvPrivateInput = {
    buyerNif: input.buyerNif,
    sellerNif: input.sellerNif,
    salePriceCents: BigInt(input.salePriceCents),
    commissionRateBps: input.commissionRateBps,
    propertyAddress: input.propertyAddress,
    cpcvDay,
    escrituraDay,
  };
  try {
    validateCpcvInput(user.agent.smartAccount, privateInput);
  } catch (err) {
    if (err instanceof CpcvInputError) throw new HttpError(400, err.code, err.message);
    throw err;
  }

  const document = input.documentId ? { id: input.documentId, ...(await checkLinkableDocument(input.documentId)) } : null;

  return {
    agent: { userId: user.id, email: user.email, smartAccount: user.agent.smartAccount },
    privateInput,
    commission: previewCommission(input.salePriceCents, input.commissionRateBps),
    escrituraDay,
    document,
    pii: {
      v: 1,
      buyerName: input.buyerName,
      buyerNif: input.buyerNif,
      sellerName: input.sellerName,
      sellerNif: input.sellerNif,
      propertyAddress: input.propertyAddress,
      salePriceCents: input.salePriceCents,
      commissionRateBps: input.commissionRateBps,
      cpcvDate: input.cpcvDate,
      cpcvDay,
      salt: null,
    },
  };
}

/** Runs the whole pipeline, reporting through `emit`. Never throws: failures end with a `failed` event. */
export async function runCpcvPipeline(input: AdminCpcvInput, emit: (event: PipelineEvent) => void): Promise<PipelineResult> {
  let step: PipelineStep = "validating";
  let cpcvId: string | null = null;
  const start = (next: PipelineStep, message: string) => {
    step = next;
    emit({ step: next, status: "started", message });
  };
  const complete = (done: PipelineStep, message: string, data?: PipelineEvent["data"]) =>
    emit({ step: done, status: "completed", message, ...(data ? { data } : {}) });

  try {
    start("validating", "Checking the CPCV, the agent and the protocol date");
    const cpcv = await validate(input);
    const data = {
      agentId: cpcv.agent.userId,
      piiEncrypted: encryptCpcvPii(cpcv.pii),
      totalCommissionCents: cpcv.commission.totalCents,
      agentCommissionCents: cpcv.commission.agentCents,
      escrituraDay: cpcv.escrituraDay,
      // Known once the proof exists (the salt is random per proof).
      commitment: "",
      nullifier: "",
      status: "PROVING" as const,
    };
    const { document } = cpcv;
    const row = document
      ? // The row and its signed PDF together: if another CPCV took the PDF meanwhile, neither is written.
        await db.$transaction(async (tx) => {
          const created = await tx.cpcv.create({ data, select: { id: true } });
          await linkCpcvDocument(tx, document.id, document.previousCpcvId, created.id);
          return created;
        })
      : await db.cpcv.create({ data, select: { id: true } });
    cpcvId = row.id;
    complete("validating", `CPCV for ${cpcv.agent.email} recorded (personal data encrypted${document ? ", signed PDF attached" : ""})`, {
      cpcvId,
      totalCommission: cpcv.commission.total.toString(),
      agentCommission: cpcv.commission.agent.toString(),
      exploradorCommission: cpcv.commission.explorador.toString(),
      creditLimit: cpcv.commission.creditLimit.toString(),
    });

    start("signing", "explorador's attester key (EdDSA over BabyJubJub) signs the deal record");
    const proof = await proveCpcv(cpcv.agent.smartAccount, cpcv.privateInput, (proveStep) => {
      if (proveStep === "proving" && step === "signing") {
        complete("signing", "Attestation signed");
        start("proving", "Generating the Groth16 proof (BN254, Poseidon)");
      } else if (proveStep === "verifying" && step === "proving") {
        complete("proving", "Proof generated");
        start("verifying", "Checking the proof against the verification key");
      }
    });

    const commitment = toHex(proof.commitment);
    const nullifier = toHex(proof.nullifier);
    await db.cpcv.update({
      where: { id: cpcvId },
      data: {
        commitment,
        nullifier,
        proof: { proof: proof.snarkjsProof, publicSignals: proof.publicSignals } as unknown as Prisma.InputJsonObject,
        piiEncrypted: encryptCpcvPii({ ...cpcv.pii, salt: proof.salt }),
      },
    });
    complete("verifying", "Proof verified locally", { cpcvId, commitment, nullifier });

    start("minting", "cpcv_note.mint verifies the proof on-chain and mints the soulbound note");
    const financed = await db.cpcv.findFirst({
      where: { nullifier, id: { not: cpcvId }, status: { in: [...FINANCED] } },
      select: { noteId: true },
    });
    if (financed) {
      throw new HttpError(409, "ALREADY_FINANCED", `This CPCV was already financed${financed.noteId !== null ? ` as note #${financed.noteId}` : ""}`);
    }

    const minted = await mintNote({
      to: cpcv.agent.smartAccount,
      proof: proof.sorobanProof,
      totalCommissionCents: proof.totalCommissionCents,
      escrituraDay: cpcv.escrituraDay,
      commitment: proof.commitment,
      nullifier: proof.nullifier,
    }).catch((err: unknown) => {
      throw chainHttpError(err);
    });
    const noteId = minted.result;
    const txUrl = explorerUrl("tx", minted.txHash);
    try {
      await db.cpcv.update({ where: { id: cpcvId }, data: { status: "MINTED", noteId, mintTxHash: minted.txHash, error: null } });
    } catch (err) {
      throw new Error(`Note #${noteId} was minted (tx ${minted.txHash}) but could not be recorded: ${shortMessage(err)}`);
    }
    complete("minting", `CPCV Note #${noteId} minted to the agent's smart account`, { cpcvId, noteId, txHash: minted.txHash, explorerUrl: txUrl });

    emit({
      step: "done",
      status: "completed",
      message: `Note #${noteId} is live: credit line open`,
      data: { cpcvId, noteId, txHash: minted.txHash, explorerUrl: txUrl, registryUrl: `/registry/${noteId}` },
    });
    return { ok: true, cpcvId, noteId, txHash: minted.txHash };
  } catch (err) {
    const base = err instanceof HttpError ? err.message : shortMessage(err);
    const prefix = err instanceof HttpError ? undefined : FAILURE_PREFIX[step];
    const message = prefix ? `${prefix}: ${base}` : base;
    if (!(err instanceof HttpError)) console.error(`[admin] CPCV pipeline failed at ${step}`, err);
    if (cpcvId) {
      await db.cpcv
        .update({ where: { id: cpcvId }, data: { status: "FAILED", error: message } })
        .catch((dbErr: unknown) => console.error(`[admin] could not mark CPCV ${cpcvId} FAILED`, dbErr));
    }
    emit({
      step,
      status: "failed",
      message,
      data: { ...(cpcvId ? { cpcvId } : {}), code: err instanceof HttpError ? err.code : "PIPELINE_ERROR" },
    });
    return { ok: false, cpcvId, noteId: null, txHash: null };
  }
}
