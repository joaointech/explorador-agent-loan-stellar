// Cpcv rows → the admin API's AdminCpcvRow (PII decrypted).

import type { Prisma } from "@/lib/db";
import { centsToStroops } from "@/lib/units";
import type { AdminCpcvRow } from "@/lib/types/api";

import { decryptCpcvPii, type CpcvPii } from "./pii";

export const cpcvWithAgent = {
  agent: { select: { userId: true, smartAccount: true, user: { select: { email: true, displayName: true } } } },
  // Metadata of the signed PDF only: the (encrypted) content is read by GET /api/admin/cpcv/[id]/document.
  document: { select: { fileName: true, sizeBytes: true, createdAt: true } },
} satisfies Prisma.CpcvInclude;

export type CpcvWithAgent = Prisma.CpcvGetPayload<{ include: typeof cpcvWithAgent }>;

/** The PII of a row, or null when it can't be decrypted (e.g. written under another PII_ENCRYPTION_KEY). */
export function tryDecryptPii(row: { id: string; piiEncrypted: Uint8Array }): CpcvPii | null {
  try {
    return decryptCpcvPii(row.piiEncrypted);
  } catch (err) {
    console.warn(`[admin] cannot decrypt the PII of CPCV ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** An active note is overdue once the protocol date passes its escritura date (spec §2 "Escritura delays"). */
export const isOverdue = (status: string, escrituraDay: number, protocolDay: number | null): boolean =>
  status === "MINTED" && protocolDay !== null && protocolDay > escrituraDay;

export function toAdminCpcvRow(row: CpcvWithAgent, protocolDay: number | null, pii: CpcvPii | null = tryDecryptPii(row)): AdminCpcvRow {
  return {
    id: row.id,
    agent: {
      id: row.agent.userId,
      email: row.agent.user.email,
      displayName: row.agent.user.displayName,
      smartAccount: row.agent.smartAccount,
    },
    propertyAddress: pii?.propertyAddress ?? "",
    buyerName: pii?.buyerName ?? "",
    buyerNif: pii?.buyerNif ?? "",
    sellerName: pii?.sellerName ?? "",
    sellerNif: pii?.sellerNif ?? "",
    salePriceCents: pii?.salePriceCents ?? 0,
    commissionRateBps: pii?.commissionRateBps ?? 0,
    cpcvDay: pii?.cpcvDay ?? 0,
    totalCommission: centsToStroops(row.totalCommissionCents).toString(),
    agentCommission: centsToStroops(row.agentCommissionCents).toString(),
    escrituraDay: row.escrituraDay,
    status: row.status,
    noteId: row.noteId,
    mintTxHash: row.mintTxHash,
    settleTxHash: row.settleTxHash,
    cancelTxHash: row.cancelTxHash,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    overdue: isOverdue(row.status, row.escrituraDay, protocolDay),
    ...(pii ? {} : { piiUnavailable: true }),
    document: row.document ? { fileName: row.document.fileName, sizeBytes: row.document.sizeBytes, uploadedAt: row.document.createdAt.toISOString() } : null,
  };
}
