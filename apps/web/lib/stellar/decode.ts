// ScVal → lib/types/chain.ts decoders for the contract return types in spec
// §7.2–7.3 (snake_case struct fields → camelCase, i128/u64 → bigint, u32 →
// number, BytesN → lowercase hex, unit enums → variant strings).

import type { xdr } from "@stellar/stellar-sdk";

import type {
  AgentPosition,
  DrawResult,
  Groth16ProofHex,
  Line,
  LineStatus,
  LineView,
  Note,
  NoteStatus,
  PoolParams,
  PoolStats,
} from "@/lib/types/chain";

import {
  asAddress,
  asBigInt,
  asBool,
  asBytesHex,
  asEnum,
  asNumber,
  asOption,
  asStruct,
  asVec,
  field,
} from "./scval";

type ScVal = xdr.ScVal;

export const NOTE_STATUSES = ["Active", "Settled", "Cancelled"] as const satisfies readonly NoteStatus[];
export const LINE_STATUSES = ["Active", "Settled", "Cancelled"] as const satisfies readonly LineStatus[];

/** Field accessors bound to one struct, with the field path in error messages. */
function reader(v: ScVal, ctx: string) {
  const s = asStruct(v, ctx);
  const at = (name: string) => field(s, name, ctx);
  const path = (name: string) => `${ctx}.${name}`;
  return {
    big: (name: string) => asBigInt(at(name), path(name)),
    num: (name: string) => asNumber(at(name), path(name)),
    bool: (name: string) => asBool(at(name), path(name)),
    addr: (name: string) => asAddress(at(name), path(name)),
    hex: (name: string, len?: number) => asBytesHex(at(name), path(name), len),
    raw: at,
    path,
  };
}

export function decodeGroth16Proof(v: ScVal, ctx = "Groth16Proof"): Groth16ProofHex {
  const r = reader(v, ctx);
  return { a: r.hex("a", 64), b: r.hex("b", 128), c: r.hex("c", 64) };
}

export function decodeNote(v: ScVal, ctx = "Note"): Note {
  const r = reader(v, ctx);
  return {
    id: r.num("id"),
    agent: r.addr("agent"),
    totalCommission: r.big("total_commission"),
    agentCommission: r.big("agent_commission"),
    exploradorCommission: r.big("explorador_commission"),
    escrituraDay: r.num("escritura_day"),
    commitment: r.hex("commitment", 32),
    nullifier: r.hex("nullifier", 32),
    proof: decodeGroth16Proof(r.raw("proof"), r.path("proof")),
    mintedAt: r.big("minted_at"),
    status: asEnum(r.raw("status"), NOTE_STATUSES, r.path("status")),
  };
}

export const decodeNotes = (v: ScVal, ctx = "Vec<Note>"): Note[] =>
  asVec(v, ctx).map((item, i) => decodeNote(item, `${ctx}[${i}]`));

export const decodeU32Vec = (v: ScVal, ctx = "Vec<u32>"): number[] =>
  asVec(v, ctx).map((item, i) => asNumber(item, `${ctx}[${i}]`));

export function decodeParams(v: ScVal, ctx = "Params"): PoolParams {
  const r = reader(v, ctx);
  return {
    agentAprBps: r.num("agent_apr_bps"),
    protocolFeeBps: r.num("protocol_fee_bps"),
    seniorTargetBps: r.num("senior_target_bps"),
    ltvBps: r.num("ltv_bps"),
    gracePeriodSecs: r.big("grace_period_secs"),
    maxLeverage: r.num("max_leverage"),
    demoMode: r.bool("demo_mode"),
  };
}

export function decodeLine(v: ScVal, ctx = "Line"): Line {
  const r = reader(v, ctx);
  return {
    noteId: r.num("note_id"),
    agent: r.addr("agent"),
    creditLimit: r.big("credit_limit"),
    principal: r.big("principal"),
    scaledDebt: r.big("scaled_debt"),
    escrituraDay: r.num("escritura_day"),
    status: asEnum(r.raw("status"), LINE_STATUSES, r.path("status")),
  };
}

export function decodeLineView(v: ScVal, ctx = "LineView"): LineView {
  const r = reader(v, ctx);
  return {
    line: decodeLine(r.raw("line"), r.path("line")),
    debt: r.big("debt"),
    interest: r.big("interest"),
    available: r.big("available"),
  };
}

export function decodeAgentPosition(v: ScVal, ctx = "AgentPosition"): AgentPosition {
  const r = reader(v, ctx);
  return {
    cardBalance: r.big("card_balance"),
    cardEnabled: r.bool("card_enabled"),
    blocked: r.bool("blocked"),
    lines: asVec(r.raw("lines"), r.path("lines")).map((item, i) => decodeLineView(item, `${r.path("lines")}[${i}]`)),
    carriedDebt: r.big("carried_debt"),
    graceDeadline: asOption(r.raw("grace_deadline"), r.path("grace_deadline"), asBigInt),
    totalDebt: r.big("total_debt"),
    totalPrincipal: r.big("total_principal"),
    availableCredit: r.big("available_credit"),
    borrowableNow: r.big("borrowable_now"),
  };
}

export function decodePoolStats(v: ScVal, ctx = "PoolStats"): PoolStats {
  const r = reader(v, ctx);
  return {
    seniorAssets: r.big("senior_assets"),
    juniorAssets: r.big("junior_assets"),
    feesAccrued: r.big("fees_accrued"),
    totalDebt: r.big("total_debt"),
    totalPrincipal: r.big("total_principal"),
    poolCash: r.big("pool_cash"),
    totalCardBalances: r.big("total_card_balances"),
    shareSupply: r.big("share_supply"),
    sharePriceScaled: r.big("share_price_scaled"),
    utilizationBps: r.num("utilization_bps"),
    leverageX100: r.num("leverage_x100"),
    lendable: r.big("lendable"),
    leverageHeadroom: r.big("leverage_headroom"),
    borrowIndex: r.big("borrow_index"),
    protocolNow: r.big("protocol_now"),
    params: decodeParams(r.raw("params"), r.path("params")),
    writtenOffTotal: r.big("written_off_total"),
  };
}

export function decodeDrawResult(v: ScVal, ctx = "DrawResult"): DrawResult {
  const r = reader(v, ctx);
  return { fromBalance: r.big("from_balance"), fromCredit: r.big("from_credit") };
}
