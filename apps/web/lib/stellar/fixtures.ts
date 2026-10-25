// Test fixtures: hand-built ScVals mirroring the Rust contract types of spec
// §7.2–7.3 (field names exactly as in Rust), filled with the §5.6 worked
// example. Used by unit tests only.

import { StrKey, xdr } from "@stellar/stellar-sdk";

import { scAddress, scBool, scBytes, scI128, scStruct, scU32, scU64, scUnitEnum } from "./scval";

const EUR = 10_000_000n; // stroops per EUR

export const AGENT = StrKey.encodeContract(Buffer.alloc(32, 7));
export const AGENT_2 = StrKey.encodeContract(Buffer.alloc(32, 8));
export const INVESTOR = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));
export const TEURC_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
export const NOTE_ID = StrKey.encodeContract(Buffer.alloc(32, 2));
export const POOL_ID = StrKey.encodeContract(Buffer.alloc(32, 3));

export const bytes = (len: number, fill: number) => new Uint8Array(len).fill(fill);

export interface NoteFixture {
  id?: number;
  agent?: string;
  totalCents?: bigint;
  escrituraDay?: number;
  status?: "Active" | "Settled" | "Cancelled";
  mintedAt?: bigint;
  commitmentFill?: number;
}

/** `Note` (spec §7.2): €15,000 total commission → agent €7,500, explorador €7,500. */
export function noteScVal(o: NoteFixture = {}): xdr.ScVal {
  const total = (o.totalCents ?? 1_500_000n) * 100_000n;
  const agentShare = total / 2n;
  return scStruct({
    id: scU32(o.id ?? 1),
    agent: scAddress(o.agent ?? AGENT),
    total_commission: scI128(total),
    agent_commission: scI128(agentShare),
    explorador_commission: scI128(total - agentShare),
    escritura_day: scU32(o.escrituraDay ?? 20_500),
    commitment: scBytes(bytes(32, o.commitmentFill ?? 0x11), 32),
    nullifier: scBytes(bytes(32, 0x22), 32),
    proof: scStruct({ a: scBytes(bytes(64, 0xaa), 64), b: scBytes(bytes(128, 0xbb), 128), c: scBytes(bytes(64, 0xcc), 64) }),
    minted_at: scU64(o.mintedAt ?? 1_792_000_000n),
    status: scUnitEnum(o.status ?? "Active"),
  });
}

export function paramsScVal(): xdr.ScVal {
  return scStruct({
    agent_apr_bps: scU32(1200),
    protocol_fee_bps: scU32(1000),
    senior_target_bps: scU32(800),
    ltv_bps: scU32(5000),
    grace_period_secs: scU64(180n * 86_400n),
    max_leverage: scU32(10),
    demo_mode: scBool(true),
  });
}

export interface StatsFixture {
  seniorEur?: bigint;
  juniorEur?: bigint;
  debtEur?: bigint;
  sharePriceScaled?: bigint;
  protocolNow?: bigint;
  shareSupply?: bigint;
}

/** `PoolStats` (spec §7.3): §5.6 yield illustration, senior €100,000 / junior €10,000 / debt €60,000. */
export function poolStatsScVal(o: StatsFixture = {}): xdr.ScVal {
  const senior = (o.seniorEur ?? 100_000n) * EUR;
  const junior = (o.juniorEur ?? 10_000n) * EUR;
  const debt = (o.debtEur ?? 60_000n) * EUR;
  return scStruct({
    senior_assets: scI128(senior),
    junior_assets: scI128(junior),
    fees_accrued: scI128(12n * EUR),
    total_debt: scI128(debt),
    total_principal: scI128(debt - 500n * EUR),
    pool_cash: scI128(senior + junior + 12n * EUR - debt),
    total_card_balances: scI128(4_411n * EUR),
    share_supply: scI128(o.shareSupply ?? 95_000n * EUR),
    share_price_scaled: scI128(o.sharePriceScaled ?? 1_052_631_578_947_368_421n),
    utilization_bps: scU32(5_454),
    leverage_x100: scU32(600),
    lendable: scI128(senior + junior - debt),
    leverage_headroom: scI128(10n * junior - debt),
    borrow_index: scI128(1_029_589_041_095_890_410n),
    protocol_now: scU64(o.protocolNow ?? 1_792_000_000n),
    params: paramsScVal(),
    written_off_total: scI128(0n),
  });
}

export function lineScVal(o: { noteId?: number; status?: "Active" | "Settled" | "Cancelled"; principalEur?: bigint } = {}): xdr.ScVal {
  return scStruct({
    note_id: scU32(o.noteId ?? 1),
    agent: scAddress(AGENT),
    credit_limit: scI128(3_750n * EUR),
    principal: scI128((o.principalEur ?? 3_000n) * EUR),
    scaled_debt: scI128(2_913_725_490n),
    escritura_day: scU32(20_500),
    status: scUnitEnum(o.status ?? "Active"),
  });
}

/** `LineView`: €3,000 drawn, €88.77 interest (single accrual over 90 days). */
export function lineViewScVal(o: { noteId?: number; principalEur?: bigint } = {}): xdr.ScVal {
  return scStruct({
    line: lineScVal(o),
    debt: scI128(30_887_700_000n),
    interest: scI128(887_700_000n),
    available: scI128(6_612_300_000n),
  });
}

export function agentPositionScVal(o: { graceDeadline?: bigint | null; lines?: xdr.ScVal[] } = {}): xdr.ScVal {
  return scStruct({
    card_balance: scI128(0n),
    card_enabled: scBool(true),
    blocked: scBool(false),
    lines: xdr.ScVal.scvVec(o.lines ?? [lineViewScVal()]),
    carried_debt: scI128(0n),
    grace_deadline: o.graceDeadline == null ? xdr.ScVal.scvVoid() : scU64(o.graceDeadline),
    total_debt: scI128(30_887_700_000n),
    total_principal: scI128(30_000_000_000n),
    available_credit: scI128(6_612_300_000n),
    borrowable_now: scI128(6_612_300_000n),
  });
}

export const drawResultScVal = (fromBalance: bigint, fromCredit: bigint): xdr.ScVal =>
  scStruct({ from_balance: scI128(fromBalance), from_credit: scI128(fromCredit) });
