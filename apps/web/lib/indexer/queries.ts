// Read helpers over indexed events (ChainEvent) for the registry, pool and
// investor views. Always scoped to the current deployment's contract ids.

import { db } from "@/lib/db";

import { dataBigInt, dataNumber, dataString, EventType } from "./events";

export interface StoredEvent {
  type: string;
  contract: string;
  ledger: number;
  eventIdx: number;
  txHash: string;
  data: Record<string, unknown>;
  protocolTs: bigint | null;
}

const SELECT = { type: true, contract: true, ledger: true, eventIdx: true, txHash: true, data: true, protocolTs: true } as const;
const ORDER = [{ ledger: "asc" as const }, { eventIdx: "asc" as const }];

const asStored = (rows: { type: string; contract: string; ledger: number; eventIdx: number; txHash: string; data: unknown; protocolTs: bigint | null }[]): StoredEvent[] =>
  rows.map((r) => ({ ...r, data: (r.data ?? {}) as Record<string, unknown> }));

/**
 * Notes whose carried debt was written off (registry status "WrittenOff"):
 * cancelled with debt > 0 and followed by a DebtWrittenOff for the same agent.
 * `events` must be in chain order.
 */
export function writtenOffFromEvents(events: StoredEvent[]): Set<number> {
  const pending = new Map<string, number[]>();
  const out = new Set<number>();
  for (const e of events) {
    const agent = dataString(e.data, "agent");
    if (!agent) continue;
    if (e.type === EventType.NoteCancelled) {
      const noteId = dataNumber(e.data, "noteId");
      if (noteId !== null && (dataBigInt(e.data, "debtCarried") ?? 0n) > 0n) pending.set(agent, [...(pending.get(agent) ?? []), noteId]);
    } else if (e.type === EventType.DebtWrittenOff) {
      for (const id of pending.get(agent) ?? []) out.add(id);
      pending.delete(agent);
    }
  }
  return out;
}

export async function loadWrittenOffNoteIds(poolId: string): Promise<Set<number>> {
  const rows = await db.chainEvent.findMany({
    where: { contract: poolId, type: { in: [EventType.NoteCancelled, EventType.DebtWrittenOff] } },
    select: SELECT,
    orderBy: ORDER,
  });
  return writtenOffFromEvents(asStored(rows));
}

/** credit_limit per note from LineOpened events. */
export async function loadCreditLimits(poolId: string): Promise<Map<number, bigint>> {
  const rows = await db.chainEvent.findMany({ where: { contract: poolId, type: EventType.LineOpened }, select: { data: true } });
  const out = new Map<number, bigint>();
  for (const r of rows) {
    const id = dataNumber(r.data, "noteId");
    const limit = dataBigInt(r.data, "creditLimit");
    if (id !== null && limit !== null) out.set(id, limit);
  }
  return out;
}

/** Mint transaction per note id from NoteMinted events. */
export async function loadMintTxHashes(noteContractId: string): Promise<Map<number, string>> {
  const rows = await db.chainEvent.findMany({ where: { contract: noteContractId, type: EventType.NoteMinted }, select: { data: true, txHash: true } });
  const out = new Map<number, string>();
  for (const r of rows) {
    const id = dataNumber(r.data, "id");
    if (id !== null) out.set(id, r.txHash);
  }
  return out;
}

/** Cumulative tEURC borrowed by card draws (Σ CardDraw.from_credit), stroops. */
export async function loadTotalAdvanced(poolId: string): Promise<bigint> {
  const rows = await db.$queryRaw<{ total: string | null }[]>`
    SELECT COALESCE(SUM(("data"->>'fromCredit')::numeric), 0)::text AS total
    FROM "ChainEvent" WHERE "type" = ${EventType.CardDraw} AND "contract" = ${poolId}`;
  const total = rows[0]?.total ?? "0";
  return BigInt(total.split(".")[0]);
}

/** Every event that names this agent (notes, lines, draws, settlements, write-offs), in chain order. */
export async function loadAgentEvents(agent: string, contractIds: string[]): Promise<StoredEvent[]> {
  const rows = await db.chainEvent.findMany({
    where: { contract: { in: contractIds }, data: { path: ["agent"], equals: agent } },
    select: SELECT,
    orderBy: ORDER,
  });
  return asStored(rows);
}

/** SEP-56 Deposit (receiver = address) and Withdraw (owner = address) events of the vault, in chain order. */
export async function loadVaultHistory(poolId: string, address: string): Promise<StoredEvent[]> {
  const rows = await db.chainEvent.findMany({
    where: {
      contract: poolId,
      OR: [
        { type: EventType.Deposit, data: { path: ["receiver"], equals: address } },
        { type: EventType.Withdraw, data: { path: ["owner"], equals: address } },
      ],
    },
    select: SELECT,
    orderBy: ORDER,
  });
  return asStored(rows);
}
