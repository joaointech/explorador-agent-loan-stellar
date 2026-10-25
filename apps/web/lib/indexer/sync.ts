// Event indexer (§9.6): Soroban RPC getEvents → ChainEvent rows, Cpcv status updates,
// and PoolSnapshot rows (at most one per real minute). Runs sync-on-read.
import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { db, toJson } from "@/lib/db";
import { authRef } from "@/lib/lithic/asa";
import { readStats, tag } from "@/lib/pool";
import { getContracts } from "@/lib/stellar/contracts";
import { rpcServer } from "@/lib/stellar/network";

const CURSOR_ID = "events";
const OFFSET_ID = "demo_offset";
const PAGE = 200;

/** Names of each event's #[topic] fields after the event name, by event type. */
const TOPIC_FIELDS: Record<string, string[]> = {
  note_minted: ["id", "agent"],
  note_status_changed: ["id"],
  card_enabled: ["agent"],
  card_draw: ["agent"],
  line_opened: ["note_id", "agent"],
  note_settled: ["note_id", "agent"],
  note_cancelled: ["note_id", "agent"],
  debt_written_off: ["agent"],
  balance_withdrawn: ["agent"],
  blocked_set: ["agent"],
  deposit: ["operator", "from", "receiver"],
  withdraw: ["operator", "receiver", "owner"],
  transfer: ["from", "to"],
  mint: ["to"],
  burn: ["from"],
  approve: ["owner", "spender"],
};

function native(v: xdr.ScVal): unknown {
  try {
    return normalize(scValToNative(v));
  } catch {
    return v.toXDR("base64");
  }
}

function normalize(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = normalize(x);
    return out;
  }
  return v;
}

export interface DecodedEvent {
  type: string;
  data: Record<string, unknown>;
}

export function decodeEvent(topics: xdr.ScVal[], value: xdr.ScVal): DecodedEvent {
  const [first, ...rest] = topics.map(native);
  const type = typeof first === "string" ? first : String(first);
  const names = TOPIC_FIELDS[type] ?? [];
  const data: Record<string, unknown> = {};
  rest.forEach((t, i) => {
    data[names[i] ?? `topic${i + 1}`] = t;
  });
  const body = native(value);
  if (body && typeof body === "object" && !Array.isArray(body)) Object.assign(data, body);
  else data.value = body;
  return { type, data };
}

async function getCursor(id: string): Promise<number | null> {
  const row = await db.indexerCursor.findUnique({ where: { id } });
  return row?.lastLedger ?? null;
}

async function setCursor(id: string, lastLedger: number) {
  await db.indexerCursor.upsert({ where: { id }, create: { id, lastLedger }, update: { lastLedger } });
}

/** Resets indexing to start at `ledger` (called after a fresh deploy). */
export async function resetIndexer(ledger: number) {
  await setCursor(CURSOR_ID, ledger);
  await setCursor(OFFSET_ID, 0);
}

export async function syncEvents(): Promise<number> {
  const contracts = await getContracts();
  const server = rpcServer();
  const latest = await server.getLatestLedger();
  let start = (await getCursor(CURSOR_ID)) ?? Math.max(1, latest.sequence - 10_000);
  let offset = (await getCursor(OFFSET_ID)) ?? 0;
  const ids = [contracts.teurc, contracts.cpcvNote, contracts.advancePool];
  const names = new Map([
    [contracts.teurc, "teurc"],
    [contracts.cpcvNote, "cpcvNote"],
    [contracts.advancePool, "advancePool"],
  ]);
  let total = 0;
  let cursor: string | undefined;

  for (let page = 0; page < 20; page++) {
    let res: rpc.Api.GetEventsResponse;
    try {
      res = cursor
        ? await server.getEvents({ cursor, filters: [{ type: "contract", contractIds: ids }], limit: PAGE })
        : await server.getEvents({ startLedger: start, filters: [{ type: "contract", contractIds: ids }], limit: PAGE });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // startLedger fell out of the RPC retention window: jump forward.
      const m = msg.match(/ledger range: (\d+) - (\d+)/);
      if (m && !cursor) {
        start = Number(m[1]);
        continue;
      }
      throw e;
    }
    for (const ev of res.events) {
      const { type, data } = decodeEvent(ev.topic, ev.value);
      const ledgerTs = Math.floor(new Date(ev.ledgerClosedAt).getTime() / 1000);
      if (type === "clock_advanced" && data.protocol_now !== undefined) offset = Number(data.protocol_now) - ledgerTs;
      const contract = names.get(ev.contractId?.toString() ?? "") ?? ev.contractId?.toString() ?? "";
      const eventIdx = Number(ev.id.split("-")[1] ?? 0);
      const protocolTs = BigInt(ledgerTs + offset);
      await db.chainEvent.upsert({
        where: { txHash_eventIdx: { txHash: ev.txHash, eventIdx } },
        create: { contract, type, ledger: ev.ledger, txHash: ev.txHash, eventIdx, data: toJson(data) as object, protocolTs },
        update: {},
      });
      await applyEvent(type, data, ev.txHash);
      total++;
    }
    await setCursor(OFFSET_ID, offset);
    if (res.events.length < PAGE) {
      await setCursor(CURSOR_ID, Math.max(start, res.latestLedger));
      break;
    }
    cursor = res.cursor;
    const last = res.events[res.events.length - 1];
    await setCursor(CURSOR_ID, last.ledger);
  }
  return total;
}

async function applyEvent(type: string, data: Record<string, unknown>, txHash: string) {
  switch (type) {
    case "note_minted": {
      const noteId = Number(data.id);
      await db.cpcv.updateMany({
        where: { commitment: String(data.commitment), noteId: null },
        data: { noteId, status: "MINTED", mintTxHash: txHash },
      });
      break;
    }
    case "note_status_changed": {
      const noteId = Number(data.id);
      const status = tag(data.status);
      if (status === "Settled") await db.cpcv.updateMany({ where: { noteId, status: { in: ["MINTED"] } }, data: { status: "SETTLED" } });
      if (status === "Cancelled") await db.cpcv.updateMany({ where: { noteId, status: { in: ["MINTED"] } }, data: { status: "CANCELLED" } });
      break;
    }
    case "note_settled": {
      await db.cpcv.updateMany({ where: { noteId: Number(data.note_id), settleTxHash: null }, data: { settleTxHash: txHash } });
      break;
    }
    case "note_cancelled": {
      await db.cpcv.updateMany({ where: { noteId: Number(data.note_id), cancelTxHash: null }, data: { cancelTxHash: txHash } });
      break;
    }
    case "card_draw": {
      // Fills the split for draws confirmed by a retry that hit DuplicateDraw.
      const ref = String(data.auth_ref ?? "");
      if (ref) {
        const rows = await db.cardAuthorization.findMany({ where: { txHash: null, decision: "APPROVED" }, select: { id: true, lithicToken: true } });
        const hit = rows.find((r) => authRef(r.lithicToken).toString("hex") === ref);
        if (hit) {
          await db.cardAuthorization.update({
            where: { id: hit.id },
            data: {
              chainStatus: "CONFIRMED",
              txHash,
              fromBalanceStroops: BigInt(String(data.from_balance ?? 0)),
              fromCreditStroops: BigInt(String(data.from_credit ?? 0)),
            },
          });
        }
      }
      break;
    }
    case "debt_written_off": {
      const agent = await db.agent.findUnique({ where: { smartAccount: String(data.agent) } });
      if (agent) await db.cpcv.updateMany({ where: { agentId: agent.userId, status: "CANCELLED" }, data: { status: "WRITTEN_OFF" } });
      break;
    }
    case "card_enabled": {
      await db.agent.updateMany({ where: { smartAccount: String(data.agent) }, data: { cardEnabledOnChain: Boolean(data.enabled) } });
      break;
    }
  }
}

let lastSnapshotAt = 0;

export async function takeSnapshot(force = false) {
  if (!force && Date.now() - lastSnapshotAt < 60_000) return;
  const last = await db.poolSnapshot.findFirst({ orderBy: { createdAt: "desc" } });
  if (!force && last && Date.now() - last.createdAt.getTime() < 60_000) {
    lastSnapshotAt = last.createdAt.getTime();
    return;
  }
  const st = await readStats();
  await db.poolSnapshot.create({
    data: {
      protocolTs: BigInt(st.protocol_now),
      seniorAssets: BigInt(st.senior_assets),
      juniorAssets: BigInt(st.junior_assets),
      feesAccrued: BigInt(st.fees_accrued),
      totalDebt: BigInt(st.total_debt),
      poolCash: BigInt(st.pool_cash),
      sharePrice: BigInt(st.share_price_scaled).toString(),
      shareSupply: BigInt(st.share_supply),
    },
  });
  lastSnapshotAt = Date.now();
}

let lastSync = 0;
let running: Promise<void> | null = null;

/** Sync-on-read: at most once per `maxAgeMs` per process; never throws. */
export async function syncIfStale(maxAgeMs = 10_000): Promise<void> {
  if (Date.now() - lastSync < maxAgeMs) return;
  if (running) return running;
  running = (async () => {
    try {
      await syncEvents();
      await takeSnapshot();
    } catch (e) {
      console.warn("indexer sync failed:", e instanceof Error ? e.message : e);
    } finally {
      lastSync = Date.now();
      running = null;
    }
  })();
  return running;
}
