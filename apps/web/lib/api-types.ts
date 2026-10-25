// JSON shapes returned by app/api/** route handlers. Shared by server and client.
//
// Conventions:
// - On-chain amounts are tEURC stroops (7 decimals) serialized as decimal strings (`Stroops`).
// - Off-chain card amounts are EUR cents (`amountCents`, number).
// - Times: `protocolNow`, `mintedAt`, `graceDeadline` … are protocol-clock unix SECONDS.
//   `createdAt` fields are real ISO timestamps.
// - Days (`escrituraDay`) are days since the Unix epoch (UTC).
// - Errors: `{ error: { code: string, message: string } }` with a non-2xx status.

export type Stroops = string;

export interface ApiError {
  error: { code: string; message: string };
}

// ------------------------------------------------------------------ shared

export interface DemoClockDto {
  demoMode: boolean;
  offsetSecs: number;
  protocolNow: number;
}

export interface ContractsDto {
  network: string;
  teurc: string;
  cpcvNote: string;
  advancePool: string;
}

export interface ParamsDto {
  agentAprBps: number;
  protocolFeeBps: number;
  seniorTargetBps: number;
  ltvBps: number;
  gracePeriodSecs: number;
  maxLeverage: number;
  demoMode: boolean;
}

export interface PoolStatsDto {
  seniorAssets: Stroops;
  juniorAssets: Stroops;
  feesAccrued: Stroops;
  totalDebt: Stroops;
  totalPrincipal: Stroops;
  poolCash: Stroops;
  totalCardBalances: Stroops;
  shareSupply: Stroops;
  /** assets per 1 share × 10^18 */
  sharePriceScaled: string;
  /** convenience float of sharePriceScaled / 10^18 */
  sharePrice: number;
  utilizationBps: number;
  leverageX100: number;
  lendable: Stroops;
  leverageHeadroom: Stroops;
  borrowIndex: string;
  protocolNow: number;
  params: ParamsDto;
  writtenOffTotal: Stroops;
}

export interface NoteCountsDto {
  active: number;
  settled: number;
  cancelled: number;
  writtenOff: number;
  total: number;
}

/** GET /api/pool/stats */
export interface PoolStatsResponse {
  stats: PoolStatsDto;
  apy: {
    target: number; // 0.08
    projectedSenior: number; // fraction, e.g. 0.0648
    projectedJunior: number;
    trailing7d: number | null;
  };
  tvl: Stroops; // senior + junior
  coverage: number; // junior / (senior + junior), fraction
  totalAdvanced: Stroops; // all-time credit drawn by card (from events)
  notes: NoteCountsDto;
  demo: DemoClockDto;
  contracts: ContractsDto;
}

/** GET /api/pool/snapshots?range=7d|30d|all */
export interface SnapshotPoint {
  t: number; // protocol seconds
  realT: number; // real unix seconds
  sharePrice: number;
  tvlEur: number;
  debtEur: number;
  seniorEur: number;
  juniorEur: number;
}
export interface SnapshotsResponse {
  points: SnapshotPoint[];
}

// ------------------------------------------------------------------ registry

export type NoteStatusDto = "Active" | "Settled" | "Cancelled" | "WrittenOff";

export interface RegistryNote {
  id: number;
  agent: string;
  totalCommission: Stroops;
  agentCommission: Stroops;
  exploradorCommission: Stroops;
  creditLimit: Stroops;
  escrituraDay: number;
  status: NoteStatusDto;
  overdue: boolean;
  mintedAt: number;
  mintTxHash: string | null;
  commitment: string; // hex
  nullifier: string; // hex
}

/** GET /api/registry?cursor=&status=&q= */
export interface RegistryResponse {
  notes: RegistryNote[];
  nextCursor: number | null;
  counts: NoteCountsDto;
}

export interface ChainEventDto {
  type: string;
  contract: string;
  ledger: number;
  txHash: string;
  protocolTs: number | null;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface SnarkjsProofDto {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol?: string;
  curve?: string;
}

/** GET /api/registry/[id] — also carries SEP-50 metadata fields (name, description, attributes). */
export interface RegistryDetailResponse {
  name: string;
  description: string;
  attributes: { trait_type: string; value: string | number }[];
  note: RegistryNote;
  proof: { a: string; b: string; c: string }; // on-chain hex, A negated
  snarkjsProof: SnarkjsProofDto; // A un-negated, ready for snarkjs.groth16.verify
  publicSignals: string[]; // rebuilt from on-chain data, circuit order
  publicSignalLabels: string[];
  line: { creditLimit: Stroops; principal: Stroops; debt: Stroops; interest: Stroops; available: Stroops } | null;
  drawsTotal: Stroops;
  events: ChainEventDto[];
  hidden: string[]; // human list of what the proof hides
  contracts: ContractsDto;
  demo: DemoClockDto;
}

/** GET /api/registry/[id]/metadata — SEP-50 token metadata */
export interface NoteMetadataResponse {
  name: string;
  description: string;
  external_url: string;
  attributes: { trait_type: string; value: string | number }[];
}

// ------------------------------------------------------------------ investor

export interface InvestorHistoryItem {
  type: "deposit" | "withdraw";
  assets: Stroops;
  shares: Stroops;
  txHash: string;
  ledger: number;
  createdAt: string;
}

/** GET /api/investor/[address] */
export interface InvestorResponse {
  address: string;
  funded: boolean; // account exists on testnet
  xlmBalance: string | null; // XLM, decimal string
  teurcBalance: Stroops;
  shares: Stroops;
  value: Stroops;
  deposited: Stroops;
  withdrawn: Stroops;
  earned: Stroops; // value + withdrawn − deposited
  sharePrice: number;
  maxWithdraw: Stroops;
  maxRedeem: Stroops;
  history: InvestorHistoryItem[];
}

/** GET /api/investor/preview?action=deposit|withdraw|redeem&amount=<stroops> */
export interface InvestorPreviewResponse {
  action: "deposit" | "withdraw" | "redeem";
  amount: Stroops;
  result: Stroops; // shares for deposit/withdraw, assets for redeem
}

/** POST /api/investor/tx/prepare {action, address, amount?} — unsigned tx for Freighter */
export type InvestorTxAction = "deposit" | "withdraw" | "redeem" | "faucet";
export interface InvestorTxPrepareRequest {
  action: InvestorTxAction;
  address: string;
  amount?: Stroops; // assets for deposit/withdraw/faucet, shares for redeem
}
export interface TxPrepareResponse {
  xdr: string;
  networkPassphrase: string;
}
/** POST /api/investor/tx/submit {xdr} */
export interface TxSubmitResponse {
  hash: string;
  status: "SUCCESS" | "FAILED";
  error?: string;
}

// ------------------------------------------------------------------ agent

export interface LineViewDto {
  noteId: number;
  creditLimit: Stroops;
  principal: Stroops;
  debt: Stroops;
  interest: Stroops;
  available: Stroops;
  escrituraDay: number;
  status: "Active" | "Settled" | "Cancelled";
}

export interface AgentPositionDto {
  cardBalance: Stroops;
  cardEnabled: boolean;
  blocked: boolean;
  lines: LineViewDto[];
  carriedDebt: Stroops;
  graceDeadline: number | null;
  totalDebt: Stroops;
  totalPrincipal: Stroops;
  availableCredit: Stroops;
  borrowableNow: Stroops;
}

export interface AgentDealDto {
  cpcvId: string;
  noteId: number | null;
  status: "PROVING" | "MINTED" | "SETTLED" | "CANCELLED" | "WRITTEN_OFF" | "FAILED" | "DRAFT";
  totalCommission: Stroops;
  agentCommission: Stroops;
  creditLimit: Stroops;
  used: Stroops; // current line debt
  escrituraDay: number;
  overdue: boolean;
  mintTxHash: string | null;
}

export type ActivityItem =
  | {
      kind: "card";
      id: string;
      merchant: string;
      amountCents: number;
      decision: "APPROVED" | "DECLINED";
      declineReason: string | null;
      chainStatus: "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";
      fromBalance: Stroops | null;
      fromCredit: Stroops | null;
      txHash: string | null;
      createdAt: string;
    }
  | { kind: "settlement"; noteId: number; agentPayout: Stroops; debtRepaid: Stroops; interestPaid: Stroops; carriedRepaid: Stroops; txHash: string; createdAt: string }
  | { kind: "cancellation"; noteId: number; debtCarried: Stroops; graceDeadline: number | null; txHash: string; createdAt: string }
  | { kind: "writeoff"; amount: Stroops; txHash: string; createdAt: string }
  | { kind: "withdrawal"; amount: Stroops; to: string; txHash: string; createdAt: string };

/** GET /api/agent/overview */
export interface AgentOverviewResponse {
  user: { id: string; email: string; displayName: string | null };
  onboarding: { passkey: boolean; smartAccount: boolean; card: boolean; cardActivated: boolean };
  smartAccount: string | null;
  signerKind: "passkey" | "demo-ed25519";
  card: { last4: string | null; hasLithic: boolean } | null;
  position: AgentPositionDto | null;
  /** For ticking interest client-side: debt(t) ≈ debt × (1 + apr × (t − protocolNow) / YEAR). */
  interest: { aprBps: number; protocolNow: number; /** server Date.now() in ms */ fetchedAt: number };
  spendable: Stroops; // card balance + borrowable now − pending holds
  pendingHolds: Stroops;
  deals: AgentDealDto[];
  activity: ActivityItem[];
  passkeys: { id: string; createdAt: string }[];
  demo: DemoClockDto;
  contracts: ContractsDto;
}

/** POST /api/agent/card/simulate {amountEur, merchant} */
export interface CardSimulateRequest {
  amountEur: number;
  merchant: string;
}
export interface CardSimulateResponse {
  token: string;
  mode: "lithic" | "local"; // "local" when LITHIC_API_KEY is unset
  decision: "APPROVED" | "DECLINED" | "PENDING";
  declineReason: string | null;
  authorizationId: string | null;
}

/** GET /api/agent/card/reveal */
export interface CardRevealResponse {
  pan: string;
  cvv: string;
  expMonth: string;
  expYear: string;
}

/** POST /api/stellar/agent-tx/prepare */
export type AgentTxAction = "enable_card" | "disable_card" | "withdraw_balance";
export interface AgentTxPrepareRequest {
  action: AgentTxAction;
  amount?: Stroops; // withdraw_balance
  to?: string; // withdraw_balance, defaults to the agent's smart account
}
export interface AgentTxPrepareResponse {
  /** Transaction XDR (sponsor as source) whose smart-account auth entries the client must sign. */
  xdr: string;
  networkPassphrase: string;
  rpcUrl: string;
  smartAccount: string;
  /** When the agent uses the server-held demo signer the server signs; the client just calls submit. */
  serverSigned: boolean;
  /** Ledger the simulation ran at; signatures expire SIGNATURE_LIFETIME_LEDGERS later. */
  latestLedger: number;
  /** The smart account's passkey signer (null when serverSigned). keyData = hex(p256 pubkey65 ‖ credentialId). */
  signer: { verifier: string; keyData: string; credentialId: string } | null;
}
/** POST /api/stellar/agent-tx/submit {xdr, action} */
export interface AgentTxSubmitRequest {
  xdr: string;
  action: AgentTxAction;
}

/** Client config for the passkey wallet (GET /api/stellar/config) */
export interface StellarConfigResponse {
  rpcUrl: string;
  networkPassphrase: string;
  accountWasmHash: string;
  webauthnVerifier: string;
  ed25519Verifier: string;
  nativeToken: string;
  rpId: string;
  rpName: string;
  contracts: ContractsDto;
}

// ------------------------------------------------------------------ auth

/** GET /api/auth/me */
export interface MeResponse {
  user: { id: string; email: string; role: "AGENT" | "ADMIN"; hasPasskey: boolean; smartAccount: string | null } | null;
  /** true while the user has verified their email but not yet registered a passkey */
  prePasskey: boolean;
}

// ------------------------------------------------------------------ admin

export interface CpcvPii {
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  salePriceCents: number;
  commissionRateBps: number;
  cpcvDate: string; // YYYY-MM-DD
  escrituraDate: string; // YYYY-MM-DD
}

export interface AdminCpcvDto {
  id: string;
  agentId: string;
  agentEmail: string;
  agentName: string | null;
  smartAccount: string;
  pii: CpcvPii;
  totalCommission: Stroops;
  agentCommission: Stroops;
  creditLimit: Stroops;
  escrituraDay: number;
  status: AgentDealDto["status"];
  noteId: number | null;
  mintTxHash: string | null;
  settleTxHash: string | null;
  cancelTxHash: string | null;
  error: string | null;
  overdue: boolean;
  debt: Stroops | null; // current line debt from chain (active notes)
  createdAt: string;
}

/** GET /api/admin/cpcv */
export interface AdminCpcvListResponse {
  cpcvs: AdminCpcvDto[];
}

/** POST /api/admin/cpcv — streams Server-Sent Events, each `data:` line is a CpcvPipelineEvent */
export interface CpcvCreateRequest {
  agentId: string;
  buyerName: string;
  buyerNif: string; // 9 digits
  sellerName: string;
  sellerNif: string; // 9 digits
  propertyAddress: string;
  salePriceEur: number;
  commissionRatePct: number; // 1–10, up to 2 decimals
  cpcvDate: string; // YYYY-MM-DD (protocol calendar)
  escrituraDate: string; // YYYY-MM-DD
}
export type CpcvPipelineStep = "validating" | "signing" | "proving" | "verifying" | "minting" | "done";
export interface CpcvPipelineEvent {
  step: CpcvPipelineStep | "error";
  status: "start" | "ok" | "error";
  message?: string;
  cpcvId?: string;
  noteId?: number;
  txHash?: string;
  ms?: number;
}

export interface AdminAgentDto {
  userId: string;
  email: string;
  displayName: string | null;
  smartAccount: string;
  signerKind: string;
  cardLast4: string | null;
  cardEnabled: boolean;
  noteIds: number[];
  debt: Stroops;
  carriedDebt: Stroops;
  cardBalance: Stroops;
  graceDeadline: number | null;
  blocked: boolean;
  canWriteOff: boolean;
}

/** GET /api/admin/agents */
export interface AdminAgentsResponse {
  agents: AdminAgentDto[];
}

export interface FailedDrawDto {
  id: string;
  agentEmail: string;
  merchant: string;
  amountCents: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** GET /api/admin/overview */
export interface AdminOverviewResponse {
  pool: PoolStatsResponse;
  failedDraws: FailedDrawDto[];
  agentsPastGrace: { userId: string; email: string; carriedDebt: Stroops; graceDeadline: number }[];
  deployment: (ContractsDto & { createdAt: string; wasmHashes: Record<string, string> }) | null;
  treasury: { address: string; teurcBalance: Stroops };
}

/** POST /api/admin/junior/deposit | /withdraw | /api/admin/fees/claim  {amountEur} */
export interface AmountEurRequest {
  amountEur: number;
}
/** settle / cancel / write-off / junior / fees / advance-clock all respond with this */
export interface TxResponse {
  txHash: string;
}

/** POST /api/admin/demo/advance-clock {days} or {toGraceOf: agentUserId} */
export interface AdvanceClockRequest {
  days?: number;
  toGraceOf?: string;
}

/** POST /api/admin/demo/reset — SSE stream of {line: string, done?: boolean, error?: string} */
export interface DemoResetEvent {
  line: string;
  done?: boolean;
  error?: string;
}
