// Contract event decoding (spec §7.2–7.3, §9.6).
//
// `#[contractevent]` defaults (soroban-sdk 28): topics = [snake_case struct
// name, …fields marked #[topic]], data = a map of the remaining fields keyed
// by their Rust names, sparse (a `None` Option field is omitted). SEP-56
// Deposit/Withdraw (OpenZeppelin layout) carry their addresses as topics and
// {assets, shares} as data; SEP-41 transfers carry the amount as a single
// value, and Stellar Asset Contracts (e.g. real EURC swapped in for tEURC) add
// the SEP-11 asset as a last topic.
//
// Decoding: named map entries first; declared topic fields from the topics;
// a single/vec data value fills the missing data fields; leftover topics fill
// whatever is still missing (a contract that moved a field into the topics),
// and anything unassigned is kept under `extraTopics`.

import type { rpc, xdr } from "@stellar/stellar-sdk";

import { scValToJson, snakeToCamel, type JsonValue } from "@/lib/stellar/scval";

export interface EventSchema {
  /** PascalCase type stored in ChainEvent.type. */
  type: string;
  /** Fields published as topics (after the name), in order. */
  topics?: readonly string[];
  /** Data fields (Rust names) in declaration order. */
  fields: readonly string[];
}

export const EVENT_SCHEMAS: Record<string, EventSchema> = {
  // cpcv_note
  note_minted: { type: "NoteMinted", fields: ["id", "agent", "total_commission", "agent_commission", "escritura_day", "commitment", "nullifier"] },
  note_status_changed: { type: "NoteStatusChanged", fields: ["id", "status"] },
  // advance_pool
  card_enabled: { type: "CardEnabled", fields: ["agent", "enabled"] },
  card_draw: { type: "CardDraw", fields: ["agent", "amount", "from_balance", "from_credit", "auth_ref"] },
  line_opened: { type: "LineOpened", fields: ["note_id", "agent", "credit_limit"] },
  note_settled: {
    type: "NoteSettled",
    fields: ["note_id", "agent", "total_commission", "debt_repaid", "interest_paid", "carried_repaid", "agent_payout", "junior_deposit"],
  },
  note_cancelled: { type: "NoteCancelled", fields: ["note_id", "agent", "debt_carried", "grace_deadline"] },
  debt_written_off: { type: "DebtWrittenOff", fields: ["agent", "amount", "junior_loss", "senior_loss"] },
  balance_withdrawn: { type: "BalanceWithdrawn", fields: ["agent", "amount", "to"] },
  junior_deposit: { type: "JuniorDeposit", fields: ["amount"] },
  junior_withdraw: { type: "JuniorWithdraw", fields: ["amount"] },
  fees_claimed: { type: "FeesClaimed", fields: ["amount"] },
  clock_advanced: { type: "ClockAdvanced", fields: ["secs", "protocol_now"] },
  // SEP-56 vault (advance_pool)
  deposit: { type: "Deposit", topics: ["operator", "from", "receiver"], fields: ["assets", "shares"] },
  withdraw: { type: "Withdraw", topics: ["operator", "receiver", "owner"], fields: ["assets", "shares"] },
  // SEP-41 tokens (teurc, eaSR, SACs) and the SEP-50 note NFT (token_id instead of amount)
  transfer: { type: "Transfer", topics: ["from", "to"], fields: ["amount"] },
  mint: { type: "Mint", topics: ["to"], fields: ["amount"] },
  burn: { type: "Burn", topics: ["from"], fields: ["amount"] },
  approve: { type: "Approve", topics: ["owner", "spender"], fields: ["amount", "live_until_ledger"] },
};

/** Event types the registry, pool and investor views rely on. */
export const EventType = {
  NoteMinted: "NoteMinted",
  NoteStatusChanged: "NoteStatusChanged",
  CardEnabled: "CardEnabled",
  CardDraw: "CardDraw",
  LineOpened: "LineOpened",
  NoteSettled: "NoteSettled",
  NoteCancelled: "NoteCancelled",
  DebtWrittenOff: "DebtWrittenOff",
  BalanceWithdrawn: "BalanceWithdrawn",
  JuniorDeposit: "JuniorDeposit",
  JuniorWithdraw: "JuniorWithdraw",
  FeesClaimed: "FeesClaimed",
  ClockAdvanced: "ClockAdvanced",
  Deposit: "Deposit",
  Withdraw: "Withdraw",
} as const;

export type EventData = Record<string, JsonValue>;

export interface DecodedEvent {
  /** RPC event id ("<toid>-<index>"), sortable. */
  id: string;
  contract: string;
  type: string;
  ledger: number;
  /** Real (wall-clock) close time of the ledger, unix seconds. */
  closedAt: number;
  txHash: string;
  /** Index of the event within its transaction (suffix of the RPC id). */
  eventIdx: number;
  /** camelCase fields; 64/128-bit integers as decimal strings, bytes as hex. */
  data: EventData;
  /** false for events whose name has no schema (stored generically). */
  known: boolean;
}

/** "note_minted" → "NoteMinted". */
export const pascalCase = (snake: string): string => snake.split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

/** Ledger sequence encoded in an RPC event id / paging cursor ("<toid>-<index>", toid = ledger << 32 | …). */
export const ledgerOfCursor = (cursor: string): number => Number(BigInt(cursor.split("-")[0]) >> 32n);

const eventIndexOf = (id: string): number => {
  const idx = Number(id.split("-")[1]);
  return Number.isSafeInteger(idx) ? idx : 0;
};

function symbolOf(v: xdr.ScVal | undefined): string | null {
  return v && (v.type === "scvSymbol" || v.type === "scvString") ? String(v.value) : null;
}

/** Decodes a topic list + data value with the schema for its name. */
export function decodePayload(topics: xdr.ScVal[], value: xdr.ScVal): { type: string; data: EventData; known: boolean } {
  const name = symbolOf(topics[0]);
  const schema = name ? EVENT_SCHEMAS[name] : undefined;
  const data: EventData = {};
  const extraTopics = (name ? topics.slice(1) : topics).map(scValToJson);

  let single: JsonValue | undefined;
  let vec: JsonValue[] | undefined;
  if (value.type === "scvMap") {
    Object.assign(data, scValToJson(value) as EventData);
  } else if (value.type === "scvVec" && schema) {
    vec = (value.vec ?? []).map(scValToJson);
  } else if (value.type !== "scvVoid") {
    single = scValToJson(value);
  }

  if (!schema) {
    if (single !== undefined) data.value = single;
    if (extraTopics.length > 0) data.topics = extraTopics;
    return { type: name ? pascalCase(name) : "Unknown", data, known: false };
  }

  // 1. declared topic fields
  const topicQueue = [...extraTopics];
  for (const field of (schema.topics ?? []).map(snakeToCamel)) {
    if (topicQueue.length === 0) break;
    const value = topicQueue.shift()!;
    if (!(field in data)) data[field] = value;
  }
  // 2. data fields missing from the map: vec / single-value data first, then leftover topics
  const dataQueue: JsonValue[] = [...(vec ?? []), ...(single !== undefined ? [single] : [])];
  for (const field of schema.fields.map(snakeToCamel)) {
    if (field in data) continue;
    if (dataQueue.length > 0) data[field] = dataQueue.shift()!;
    else if (topicQueue.length > 0) data[field] = topicQueue.shift()!;
  }
  if (topicQueue.length > 0) data.extraTopics = topicQueue;
  if (dataQueue.length > 0) data.extraData = dataQueue;
  return { type: schema.type, data, known: true };
}

/** Parses an RPC close time: unix seconds as a string/number, or an ISO timestamp. */
export function parseCloseTime(value: string | number | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === "number") return value;
  if (/^\d+$/.test(value)) return Number(value);
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

/** Decodes one `getEvents` item; null for events we never store (failed calls, missing contract id). */
export function decodeEvent(ev: rpc.Api.EventResponse): DecodedEvent | null {
  if (ev.inSuccessfulContractCall === false) return null;
  const contract = ev.contractId?.contractId();
  if (!contract) return null;
  const { type, data, known } = decodePayload(ev.topic, ev.value);
  return {
    id: ev.id,
    contract,
    type,
    ledger: ev.ledger,
    closedAt: parseCloseTime(ev.ledgerClosedAt),
    txHash: ev.txHash,
    eventIdx: eventIndexOf(ev.id),
    data,
    known,
  };
}

/** Chain order: by ledger, then RPC id (toid + index). */
export const compareEvents = (a: { ledger: number; id: string }, b: { ledger: number; id: string }): number =>
  a.ledger - b.ledger || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---------- typed accessors for stored event data ----------

export const dataString = (data: unknown, key: string): string | null => {
  const v = (data as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
};
export const dataBigInt = (data: unknown, key: string): bigint | null => {
  const s = dataString(data, key);
  if (s === null || !/^-?\d+$/.test(s)) return null;
  return BigInt(s);
};
export const dataNumber = (data: unknown, key: string): number | null => {
  const v = (data as Record<string, unknown> | null)?.[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  return null;
};
