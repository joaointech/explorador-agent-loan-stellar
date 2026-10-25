// Normalized on-chain types, mirroring the Soroban contract types in spec §7.
// The stellar service decodes ScVals into these shapes: camelCase fields,
// amounts as bigint stroops, BytesN as lowercase hex, enum variants as strings.

export type NoteStatus = "Active" | "Settled" | "Cancelled";
export type LineStatus = "Active" | "Settled" | "Cancelled";

/** Groth16 proof as stored on-chain; `a` is negated (−A), spec §7.2 / §8.5. */
export interface Groth16ProofHex {
  a: string; // 64 bytes
  b: string; // 128 bytes
  c: string; // 64 bytes
}

export interface Note {
  id: number;
  agent: string; // smart account C… address
  totalCommission: bigint;
  agentCommission: bigint;
  exploradorCommission: bigint;
  escrituraDay: number; // days since Unix epoch
  commitment: string;
  nullifier: string;
  proof: Groth16ProofHex;
  mintedAt: bigint; // protocol clock, unix seconds
  status: NoteStatus;
}

export interface PoolParams {
  agentAprBps: number;
  protocolFeeBps: number;
  seniorTargetBps: number;
  ltvBps: number;
  gracePeriodSecs: bigint;
  maxLeverage: number;
  demoMode: boolean;
}

export interface Line {
  noteId: number;
  agent: string;
  creditLimit: bigint;
  principal: bigint;
  scaledDebt: bigint;
  escrituraDay: number;
  status: LineStatus;
}

export interface LineView {
  line: Line;
  debt: bigint;
  interest: bigint;
  available: bigint;
}

export interface AgentPosition {
  cardBalance: bigint;
  cardEnabled: boolean;
  blocked: boolean;
  lines: LineView[];
  carriedDebt: bigint;
  graceDeadline: bigint | null; // protocol clock, unix seconds
  totalDebt: bigint;
  totalPrincipal: bigint;
  availableCredit: bigint;
  borrowableNow: bigint;
}

export interface PoolStats {
  seniorAssets: bigint;
  juniorAssets: bigint;
  feesAccrued: bigint;
  totalDebt: bigint;
  totalPrincipal: bigint;
  poolCash: bigint;
  totalCardBalances: bigint;
  shareSupply: bigint;
  sharePriceScaled: bigint; // assets per 1 share × 1e18
  utilizationBps: number;
  leverageX100: number; // total_debt / junior × 100
  lendable: bigint;
  leverageHeadroom: bigint;
  borrowIndex: bigint; // × 1e18
  protocolNow: bigint;
  params: PoolParams;
  writtenOffTotal: bigint;
}

export interface DrawResult {
  fromBalance: bigint;
  fromCredit: bigint;
}

/** Maps bigint → string recursively: the JSON shape of an on-chain type. */
export type Jsonify<T> = T extends bigint
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;
