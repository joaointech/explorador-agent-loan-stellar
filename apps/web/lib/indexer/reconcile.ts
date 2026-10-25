// Applies newly indexed events to the app's tables (spec §9.6): Cpcv
// statuses (MINTED / SETTLED / CANCELLED / WRITTEN_OFF) and, as safety nets
// for the request-path writers, Agent.cardEnabledOnChain and confirmed card
// draws. Every update is guarded so it only moves a row forward and is
// idempotent; the request-path code (admin pipeline, ASA `after()`) normally
// gets there first.

import { createHash } from "node:crypto";

import { db } from "@/lib/db";

import { dataBigInt, dataNumber, dataString, EventType, type DecodedEvent } from "./events";

type Status = "DRAFT" | "PROVING" | "MINTED" | "SETTLED" | "CANCELLED" | "WRITTEN_OFF" | "FAILED";
const PRE_MINT: Status[] = ["DRAFT", "PROVING", "FAILED"];
const OPEN: Status[] = ["DRAFT", "PROVING", "FAILED", "MINTED"];

/** sha256 of the Lithic transaction token: the `auth_ref` passed to card_draw (spec §9.5). */
export const authRefHex = (lithicToken: string): string => createHash("sha256").update(lithicToken).digest("hex");

const hexVariants = (hex: string) => [{ equals: hex, mode: "insensitive" as const }, { equals: `0x${hex}`, mode: "insensitive" as const }];

async function onNoteMinted(e: DecodedEvent) {
  const id = dataNumber(e.data, "id");
  const commitment = dataString(e.data, "commitment");
  if (id === null || !commitment) return;
  const byCommitment = { OR: hexVariants(commitment).map((c) => ({ commitment: c })) };
  try {
    await db.cpcv.updateMany({ where: { ...byCommitment, noteId: null }, data: { noteId: id } });
  } catch (err) {
    // noteId is unique: a stale row from an older deployment may hold it. Leave both alone.
    console.warn(`[indexer] could not link note ${id} to its CPCV: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
  await db.cpcv.updateMany({ where: { ...byCommitment, noteId: id, status: { in: PRE_MINT } }, data: { status: "MINTED", error: null } });
  await db.cpcv.updateMany({ where: { ...byCommitment, noteId: id, mintTxHash: null }, data: { mintTxHash: e.txHash } });
}

/** Rows for a note id, restricted to the event's agent so stale rows of an older deployment are never touched. */
const noteRow = (noteId: number, agent: string | null) => ({ noteId, ...(agent ? { agent: { smartAccount: agent } } : {}) });

/** NoteSettled / NoteCancelled { note_id, agent, … }. */
async function onNoteClosed(e: DecodedEvent, outcome: "SETTLED" | "CANCELLED") {
  const noteId = dataNumber(e.data, "noteId");
  if (noteId === null) return;
  const where = noteRow(noteId, dataString(e.data, "agent"));
  await db.cpcv.updateMany({ where: { ...where, status: { in: OPEN } }, data: { status: outcome } });
  const field = outcome === "SETTLED" ? "settleTxHash" : "cancelTxHash";
  await db.cpcv.updateMany({ where: { ...where, [field]: null }, data: { [field]: e.txHash } });
}

async function onStatusChanged(e: DecodedEvent) {
  const status = dataString(e.data, "status");
  const id = dataNumber(e.data, "id");
  if (id === null) return;
  if (status === "Settled") await db.cpcv.updateMany({ where: { noteId: id, status: { in: OPEN } }, data: { status: "SETTLED" } });
  if (status === "Cancelled") await db.cpcv.updateMany({ where: { noteId: id, status: { in: OPEN } }, data: { status: "CANCELLED" } });
}

async function onDebtWrittenOff(e: DecodedEvent) {
  const agent = dataString(e.data, "agent");
  if (!agent) return;
  // Cancelled notes of this agent whose debt was carried; notes cancelled with zero debt stay CANCELLED.
  const cancels = await db.chainEvent.findMany({
    where: { type: EventType.NoteCancelled, contract: e.contract, data: { path: ["agent"], equals: agent } },
    select: { data: true },
  });
  const zeroDebt = cancels.filter((c) => dataBigInt(c.data, "debtCarried") === 0n).map((c) => dataNumber(c.data, "noteId")).filter((n): n is number => n !== null);
  await db.cpcv.updateMany({
    where: { status: "CANCELLED", agent: { smartAccount: agent }, ...(zeroDebt.length ? { NOT: { noteId: { in: zeroDebt } } } : {}) },
    data: { status: "WRITTEN_OFF" },
  });
}

async function onCardEnabled(e: DecodedEvent) {
  const agent = dataString(e.data, "agent");
  const enabled = (e.data as Record<string, unknown>).enabled;
  if (!agent || typeof enabled !== "boolean") return;
  await db.agent.updateMany({ where: { smartAccount: agent, cardEnabledOnChain: !enabled }, data: { cardEnabledOnChain: enabled } });
}

async function onCardDraw(e: DecodedEvent) {
  const agent = dataString(e.data, "agent");
  const authRef = dataString(e.data, "authRef")?.toLowerCase();
  if (!agent || !authRef) return;
  const pending = await db.cardAuthorization.findMany({
    where: { agent: { smartAccount: agent }, decision: "APPROVED", chainStatus: { not: "CONFIRMED" } },
    select: { id: true, lithicToken: true },
  });
  const match = pending.find((p) => authRefHex(p.lithicToken) === authRef);
  if (!match) return;
  await db.cardAuthorization.update({
    where: { id: match.id },
    data: {
      chainStatus: "CONFIRMED",
      fromBalanceStroops: dataBigInt(e.data, "fromBalance"),
      fromCreditStroops: dataBigInt(e.data, "fromCredit"),
      txHash: e.txHash,
    },
  });
}

/** Applies events in chain order; a failure on one event is logged and doesn't stop the others. */
export async function reconcile(events: DecodedEvent[]): Promise<void> {
  for (const e of events) {
    try {
      switch (e.type) {
        case EventType.NoteMinted:
          await onNoteMinted(e);
          break;
        case EventType.NoteSettled:
          await onNoteClosed(e, "SETTLED");
          break;
        case EventType.NoteCancelled:
          await onNoteClosed(e, "CANCELLED");
          break;
        case EventType.NoteStatusChanged:
          await onStatusChanged(e);
          break;
        case EventType.DebtWrittenOff:
          await onDebtWrittenOff(e);
          break;
        case EventType.CardEnabled:
          await onCardEnabled(e);
          break;
        case EventType.CardDraw:
          await onCardDraw(e);
          break;
      }
    } catch (err) {
      console.warn(`[indexer] reconcile ${e.type} ${e.txHash}#${e.eventIdx} failed: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  }
}
