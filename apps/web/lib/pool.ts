// Typed reads of advance_pool / cpcv_note and their DTO conversions (§5, §7.3).
import type { AgentPositionDto, LineViewDto, NoteStatusDto, ParamsDto, PoolStatsDto, RegistryNote } from "@/lib/api-types";
import { readContract } from "@/lib/stellar/client";

export const SCALE = 10n ** 18n;
export const YEAR = 31_536_000;
export const BPS = 10_000;
export const DAY = 86_400;

// ---- raw contract shapes (as decoded by contract.Spec: snake_case, i128/u64 → bigint)

type Tagged = { tag: string; values?: unknown[] } | string;

export interface RawParams {
  agent_apr_bps: number;
  protocol_fee_bps: number;
  senior_target_bps: number;
  ltv_bps: number;
  grace_period_secs: bigint;
  max_leverage: number;
  demo_mode: boolean;
}

export interface RawPoolStats {
  senior_assets: bigint;
  junior_assets: bigint;
  fees_accrued: bigint;
  total_debt: bigint;
  total_principal: bigint;
  pool_cash: bigint;
  total_card_balances: bigint;
  share_supply: bigint;
  share_price_scaled: bigint;
  utilization_bps: number;
  leverage_x100: number;
  lendable: bigint;
  leverage_headroom: bigint;
  borrow_index: bigint;
  protocol_now: bigint;
  params: RawParams;
  written_off_total: bigint;
}

export interface RawLine {
  note_id: number;
  agent: string;
  credit_limit: bigint;
  principal: bigint;
  scaled_debt: bigint;
  escritura_day: number;
  status: Tagged;
}

export interface RawLineView {
  line: RawLine;
  debt: bigint;
  interest: bigint;
  available: bigint;
}

export interface RawAgentPosition {
  card_balance: bigint;
  card_enabled: boolean;
  blocked: boolean;
  lines: RawLineView[];
  carried_debt: bigint;
  grace_deadline: bigint | null | undefined;
  total_debt: bigint;
  total_principal: bigint;
  available_credit: bigint;
  borrowable_now: bigint;
}

export interface RawNote {
  id: number;
  agent: string;
  total_commission: bigint;
  agent_commission: bigint;
  explorador_commission: bigint;
  escritura_day: number;
  commitment: Buffer;
  nullifier: Buffer;
  proof: { a: Buffer; b: Buffer; c: Buffer };
  minted_at: bigint;
  status: Tagged;
}

export function tag(v: Tagged | unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag);
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return String(v);
}

const s = (v: bigint | number | null | undefined) => (v === null || v === undefined ? "0" : v.toString());

// ---- reads

export const readStats = (timeoutMs?: number) => readContract<RawPoolStats>("advancePool", "stats", {}, { timeoutMs });
export const readPosition = (agent: string, timeoutMs?: number) =>
  readContract<RawAgentPosition>("advancePool", "agent_position", { agent }, { timeoutMs });
export const readNote = (id: number) => readContract<RawNote>("cpcvNote", "get", { id });
export const readNoteCount = () => readContract<number>("cpcvNote", "count");
export const readNotes = (start: number, limit: number) => readContract<RawNote[]>("cpcvNote", "list", { start, limit });
export const readLine = (noteId: number) => readContract<RawLineView>("advancePool", "line", { note_id: noteId });
export const readProtocolNow = async () => Number(await readContract<bigint>("advancePool", "protocol_now"));

// ---- conversions

export function paramsDto(p: RawParams): ParamsDto {
  return {
    agentAprBps: Number(p.agent_apr_bps),
    protocolFeeBps: Number(p.protocol_fee_bps),
    seniorTargetBps: Number(p.senior_target_bps),
    ltvBps: Number(p.ltv_bps),
    gracePeriodSecs: Number(p.grace_period_secs),
    maxLeverage: Number(p.max_leverage),
    demoMode: Boolean(p.demo_mode),
  };
}

export function statsDto(r: RawPoolStats): PoolStatsDto {
  const price = BigInt(r.share_price_scaled);
  return {
    seniorAssets: s(r.senior_assets),
    juniorAssets: s(r.junior_assets),
    feesAccrued: s(r.fees_accrued),
    totalDebt: s(r.total_debt),
    totalPrincipal: s(r.total_principal),
    poolCash: s(r.pool_cash),
    totalCardBalances: s(r.total_card_balances),
    shareSupply: s(r.share_supply),
    sharePriceScaled: price.toString(),
    sharePrice: Number(price) / 1e18,
    utilizationBps: Number(r.utilization_bps),
    leverageX100: Number(r.leverage_x100),
    lendable: s(r.lendable),
    leverageHeadroom: s(r.leverage_headroom),
    borrowIndex: s(r.borrow_index),
    protocolNow: Number(r.protocol_now),
    params: paramsDto(r.params),
    writtenOffTotal: s(r.written_off_total),
  };
}

export function lineDto(v: RawLineView): LineViewDto {
  return {
    noteId: Number(v.line.note_id),
    creditLimit: s(v.line.credit_limit),
    principal: s(v.line.principal),
    debt: s(v.debt),
    interest: s(v.interest),
    available: s(v.available),
    escrituraDay: Number(v.line.escritura_day),
    status: tag(v.line.status) as LineViewDto["status"],
  };
}

export function positionDto(p: RawAgentPosition): AgentPositionDto {
  return {
    cardBalance: s(p.card_balance),
    cardEnabled: Boolean(p.card_enabled),
    blocked: Boolean(p.blocked),
    lines: (p.lines ?? []).map(lineDto),
    carriedDebt: s(p.carried_debt),
    graceDeadline: p.grace_deadline === null || p.grace_deadline === undefined ? null : Number(p.grace_deadline),
    totalDebt: s(p.total_debt),
    totalPrincipal: s(p.total_principal),
    availableCredit: s(p.available_credit),
    borrowableNow: s(p.borrowable_now),
  };
}

export function noteStatus(n: RawNote, writtenOff = false): NoteStatusDto {
  const t = tag(n.status) as NoteStatusDto;
  return t === "Cancelled" && writtenOff ? "WrittenOff" : t;
}

export function registryNoteDto(n: RawNote, opts: { ltvBps: number; protocolNow: number; mintTxHash?: string | null; writtenOff?: boolean }): RegistryNote {
  const status = noteStatus(n, opts.writtenOff);
  const today = Math.floor(opts.protocolNow / DAY);
  return {
    id: Number(n.id),
    agent: n.agent,
    totalCommission: s(n.total_commission),
    agentCommission: s(n.agent_commission),
    exploradorCommission: s(n.explorador_commission),
    creditLimit: ((BigInt(n.agent_commission) * BigInt(opts.ltvBps)) / BigInt(BPS)).toString(),
    escrituraDay: Number(n.escritura_day),
    status,
    overdue: status === "Active" && today > Number(n.escritura_day),
    mintedAt: Number(n.minted_at),
    mintTxHash: opts.mintTxHash ?? null,
    commitment: Buffer.from(n.commitment).toString("hex"),
    nullifier: Buffer.from(n.nullifier).toString("hex"),
  };
}

// ---- yields (§5.5, computed off-chain)

export function projectedApy(st: PoolStatsDto) {
  const debt = Number(st.totalDebt) / 1e7;
  const senior = Number(st.seniorAssets) / 1e7;
  const junior = Number(st.juniorAssets) / 1e7;
  const apr = st.params.agentAprBps / BPS;
  const fee = st.params.protocolFeeBps / BPS;
  const target = st.params.seniorTargetBps / BPS;
  const netPerYear = debt * apr * (1 - fee);
  const seniorApy = senior > 0 ? Math.min(target, netPerYear / senior) : 0;
  const juniorApy = junior > 0 ? Math.max(0, netPerYear - seniorApy * senior) / junior : 0;
  return { target, projectedSenior: seniorApy, projectedJunior: juniorApy };
}

/** (p_now / p_then)^(YEAR/Δt) − 1 */
export function trailingApy(pNow: number, pThen: number, dtSecs: number): number | null {
  if (!(pNow > 0) || !(pThen > 0) || dtSecs <= 0) return null;
  return Math.pow(pNow / pThen, YEAR / dtSecs) - 1;
}
