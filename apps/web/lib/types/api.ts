// JSON contracts for every API route in spec §9.7. UI code and route handlers
// both import from here. Extend additively; don't rename fields other code uses.

import type { SessionUser } from "../auth/session-core";
import type { AgentPosition, Jsonify, NoteStatus, PoolStats } from "./chain";

/** Decimal string of stroops (7 decimals), bigint-safe. */
export type Stroops = string;
/** Unix seconds. Protocol clock unless the field name says otherwise. */
export type UnixSecs = number;
/** ISO-8601 timestamp, real (wall-clock) time. */
export type IsoTime = string;

/** Body of every error response (any 4xx/5xx). */
export interface ApiError {
  error: { code: string; message: string };
}

export interface TxResponse {
  txHash: string;
  explorerUrl: string;
}

// ---------- shared ----------

/** Registry-level status: notes are on-chain Active/Settled/Cancelled; a cancelled note whose carried debt was written off shows as WrittenOff. */
export type RegistryStatus = NoteStatus | "WrittenOff";
export type StatusCounts = Record<RegistryStatus, number> & { total: number };

export type CpcvStatus = "DRAFT" | "PROVING" | "MINTED" | "SETTLED" | "CANCELLED" | "WRITTEN_OFF" | "FAILED";
export type ChainStatus = "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED";
export type AuthDecision = "APPROVED" | "DECLINED";

export interface DemoClock {
  protocolNow: UnixSecs;
  offsetSecs: number;
  demoMode: boolean;
}

export interface DeploymentInfo {
  network: "testnet";
  rpcUrl: string;
  networkPassphrase: string;
  teurc: string;
  cpcvNote: string;
  advancePool: string;
  explorerBase: string; // https://stellar.expert/explorer/testnet
}

// GET /api/config (public): what client-side code needs (Freighter flows, links)
export interface ConfigResponse {
  deployment: DeploymentInfo | null;
  demoMode: boolean;
  lithicEnabled: boolean;
}

// ---------- auth (spec §9.2) ----------

export type { SessionUser };

// POST /api/auth/email/start (public)
export interface EmailStartRequest {
  email: string;
}
export interface EmailStartResponse {
  email: string; // normalized (trimmed, lowercase)
  expiresAt: IsoTime;
  /** Wait this long before asking for another code. */
  resendAfterSecs: number;
  /** "email" = sent with Resend; "console" = RESEND_API_KEY unset, code printed in the server log; "demo" = seeded demo account in DEMO_MODE. */
  delivery: "email" | "console" | "demo";
  /** Only for seeded demo accounts (@demo.explorador.pt) while DEMO_MODE is on: they have no real inbox. */
  demoCode?: string;
}

// POST /api/auth/email/verify (public): creates the user on first sign-in and starts a pre-passkey session
export interface EmailVerifyRequest {
  email: string;
  code: string; // 6 digits
  next?: string; // page to return to; ignored unless it's a safe path the user's role may open
}
export interface EmailVerifyResponse {
  user: SessionUser;
  isNewUser: boolean;
  /** Where to go now: `next` if allowed, else /agent (agents) or /admin (admins). */
  redirectTo: string;
}

// GET /api/auth/session (public); DELETE /api/auth/session signs out and returns { user: null }
export interface SessionResponse {
  user: SessionUser | null;
}

// ---------- pool ----------

// GET /api/pool/stats (public)
export interface PoolStatsResponse {
  stats: Jsonify<PoolStats>;
  /** Fractions: 0.08 = 8%. Computed in the app per spec §5.5. */
  apy: { target: number; projectedSenior: number; projectedJunior: number; trailing7dSenior: number | null };
  notes: StatusCounts;
  /** Cumulative EURC borrowed by card draws (from_credit). */
  totalAdvanced: Stroops;
  clock: DemoClock;
}

// GET /api/pool/snapshots?range=7d|30d|all (public)
export interface PoolSnapshotPoint {
  t: UnixSecs;
  sharePrice: number; // assets per share, display precision
  tvl: Stroops; // senior + junior
  debt: Stroops;
  seniorAssets: Stroops;
  juniorAssets: Stroops;
}
export interface PoolSnapshotsResponse {
  range: string;
  points: PoolSnapshotPoint[];
}

// ---------- registry ----------

// GET /api/registry?cursor&status&q (public; q = note id or agent address)
export interface RegistryNote {
  id: number;
  agent: string; // address only, never a name
  totalCommission: Stroops;
  agentCommission: Stroops;
  exploradorCommission: Stroops;
  creditLimit: Stroops;
  escrituraDay: number;
  status: RegistryStatus;
  overdue: boolean; // protocol date is past the escritura date and the note is still Active
  mintedAt: UnixSecs;
  mintTxHash: string | null;
}
export interface RegistryListResponse {
  notes: RegistryNote[];
  nextCursor: string | null;
  counts: StatusCounts;
}

// GET /api/registry/[id] (public)
export interface TimelineEvent {
  type: string; // NoteMinted, CardDraw, NoteSettled, NoteCancelled, DebtWrittenOff, …
  at: UnixSecs | null;
  ledger: number;
  txHash: string;
  data: Record<string, unknown>;
}
export interface SnarkjsProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: "groth16";
  curve: "bn128";
}
export interface RegistryDetailResponse {
  note: RegistryNote & {
    commitment: string;
    nullifier: string;
    proof: { a: string; b: string; c: string }; // hex as stored on-chain (a negated)
  };
  /** The 9 public signals in circuit order (spec §8.2), decimal strings. */
  publicSignals: string[];
  /** Un-negated proof in snarkjs format, for in-browser verification. */
  snarkjsProof: SnarkjsProof | null;
  draws: { count: number; total: Stroops };
  timeline: TimelineEvent[];
  /** Human labels of what the proof hides (buyer, seller, NIFs, price, rate, address, CPCV date). */
  hidden: string[];
}

// GET /api/investor/[address] (public)
export interface InvestorHistoryItem {
  type: "deposit" | "withdraw";
  assets: Stroops;
  shares: Stroops;
  txHash: string;
  at: UnixSecs;
}
export interface InvestorResponse {
  address: string;
  shares: Stroops;
  value: Stroops;
  deposited: Stroops;
  withdrawn: Stroops;
  earned: Stroops; // value + withdrawn − deposited
  sharePriceScaled: Stroops;
  maxWithdraw: Stroops;
  history: InvestorHistoryItem[];
}

// ---------- agent ----------

export interface AgentDeal {
  cpcvId: string;
  noteId: number | null;
  status: CpcvStatus;
  agentCommission: Stroops;
  creditLimit: Stroops;
  used: Stroops; // current debt on this note's line
  escrituraDay: number;
  overdue: boolean;
  mintTxHash: string | null;
  /** Settled deals: amount the settlement credited to the card balance (indexed NoteSettled), if known. */
  agentPayout?: Stroops | null;
  /** Cancelled deals: line debt moved into carried debt (indexed NoteCancelled), if known. */
  debtCarried?: Stroops | null;
}

export interface AgentPasskeyInfo {
  id: string;
  createdAt: IsoTime;
  /** The passkey that controls the smart account (the only one that can sign card actions). */
  signer: boolean;
}

export type ActivityItem =
  | {
      kind: "card";
      id: string;
      at: IsoTime;
      merchant: string;
      amount: Stroops;
      decision: AuthDecision;
      declineReason: string | null;
      fromBalance: Stroops | null;
      fromCredit: Stroops | null;
      chainStatus: ChainStatus;
      txHash: string | null;
    }
  | { kind: "settlement"; id: string; at: IsoTime; noteId: number; agentPayout: Stroops; debtRepaid: Stroops; txHash: string }
  | { kind: "cancellation"; id: string; at: IsoTime; noteId: number; debtCarried: Stroops; graceDeadline: UnixSecs | null; txHash: string }
  | { kind: "withdrawal"; id: string; at: IsoTime; amount: Stroops; to: string; txHash: string };

// GET /api/agent/overview (agent)
export interface AgentOverviewResponse {
  user: {
    email: string;
    displayName: string | null;
    /** Registered passkeys, oldest first. */
    passkeys?: AgentPasskeyInfo[];
  };
  agent: {
    smartAccount: string | null;
    cardLast4: string | null;
    cardEnabledOnChain: boolean;
    signerKind: "passkey" | "demo-ed25519";
    /** "simulated": built-in simulated card network (no LITHIC_API_KEY when issued); "lithic": Lithic sandbox. */
    cardNetwork?: "lithic" | "simulated" | null;
    /** Activated once, now disabled on-chain (disable_card). */
    cardPaused?: boolean;
  };
  /** cardActivated: the activation step is done (enable_card succeeded at least once). */
  onboarding: { passkey: boolean; smartAccount: boolean; card: boolean; cardActivated: boolean };
  position: Jsonify<AgentPosition> | null;
  /** For ticking interest client-side between refreshes. */
  rates: {
    agentAprBps: number;
    borrowIndex: Stroops;
    protocolNow: UnixSecs;
    fetchedAtMs: number;
    /** false when pool stats couldn't be read: protocolNow is an estimate and interest must not be extrapolated. */
    live?: boolean;
  };
  deals: AgentDeal[];
  activity: ActivityItem[];
  /** Where `position` came from: a live read, Agent.cachedPosition after a failed read, or nothing yet. */
  positionSource?: "chain" | "cache" | "none";
  /** When the cached position was read (positionSource "cache"). */
  positionAsOf?: IsoTime | null;
  /** Σ approved card purchases not yet drawn on-chain (stroops); spendable = card balance + borrowable now − holds. */
  pendingHolds?: Stroops;
}

// POST /api/agent/card/simulate (agent)
export interface SimulateRequest {
  amountEur: number;
  merchant: string;
}
export interface SimulateResponse {
  authorizationId: string;
  decision: AuthDecision;
  declineReason: string | null;
  via: "lithic" | "simulated";
}

// GET /api/agent/card/authorizations/[id] (agent): poll for the on-chain draw
export interface AuthorizationStatusResponse {
  id: string;
  decision: AuthDecision;
  chainStatus: ChainStatus;
  fromBalance: Stroops | null;
  fromCredit: Stroops | null;
  txHash: string | null;
  explorerUrl: string | null;
}

// GET /api/agent/card/reveal (agent, sandbox only)
export interface CardRevealResponse {
  pan: string;
  cvv: string;
  expMonth: string;
  expYear: string;
}

// POST /api/stellar/agent-tx/prepare and /submit (agent, passkey-signed)
export type AgentTxAction =
  | { action: "enable_card" }
  | { action: "disable_card" }
  | { action: "withdraw_balance"; amount: Stroops; to?: string };

// POST /api/stellar/agent-tx/prepare — body: AgentTxAction
export interface AgentTxPrepareResponse {
  action: AgentTxAction;
  smartAccount: string;
  /** "demo-ed25519" (seed agents): no passkey prompt, call /submit with the action only. */
  signerKind: "passkey" | "demo-ed25519";
  /** Unsigned auth entries (base64 XDR) with their expiration set; send them back unchanged to /submit. */
  authEntries: string[];
  /** One WebAuthn challenge (base64url of the smart-account auth digest) per auth entry. */
  challenges: string[];
  /** The passkey(s) allowed to sign (WebAuthn `allowCredentials`). */
  allowCredentials: { id: string; transports?: string[] }[];
  rpId: string;
  /** Ledger after which the signatures expire (null for demo-signer agents). */
  expirationLedger: number | null;
}

/** A WebAuthn assertion as returned by `@simplewebauthn/browser` `startAuthentication()`. */
export interface WebAuthnAssertionJSON {
  id: string;
  rawId?: string;
  type?: "public-key";
  response: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle?: string };
  clientExtensionResults?: object;
  authenticatorAttachment?: string;
}

// POST /api/stellar/agent-tx/submit — body: the same AgentTxAction fields plus the signed material
export type AgentTxSubmitRequest = AgentTxAction & {
  /** `authEntries` from /prepare, unchanged (omit for demo-signer agents). */
  authEntries?: string[];
  /** One assertion per auth entry, signing the matching challenge. */
  assertions?: WebAuthnAssertionJSON[];
};
export interface AgentTxSubmitResponse extends TxResponse {
  action: AgentTxAction["action"];
  ledger: number;
  /** On-chain card flag after enable_card / disable_card; null for withdraw_balance. */
  cardEnabledOnChain: boolean | null;
}

// ---------- passkeys (spec §9.2) ----------
// POST /api/auth/passkey/register/options → PublicKeyCredentialCreationOptionsJSON (@simplewebauthn)
// POST /api/auth/passkey/login/options    → PublicKeyCredentialRequestOptionsJSON

/** Smart account + card set-up of an agent (spec §4.2 steps 2–3). Retried by POST /api/auth/passkey/provision. */
export interface AgentProvisioning {
  status: "complete" | "failed";
  smartAccount: string | null;
  /** Null when the account already existed. */
  deployTxHash: string | null;
  cardLast4: string | null;
  failedStep: "smart_account" | "card" | null;
  error: string | null;
}

// POST /api/auth/passkey/register/verify — body: RegistrationResponseJSON
export interface PasskeyRegisterVerifyResponse {
  verified: true;
  credentialId: string;
  role: "AGENT" | "ADMIN";
  /** Agents only (null for admins). */
  provisioning: AgentProvisioning | null;
}

// POST /api/auth/passkey/login/verify — body: AuthenticationResponseJSON
export interface PasskeyLoginVerifyResponse {
  user: { email: string; role: "AGENT" | "ADMIN" };
  redirectTo: "/agent" | "/admin";
}

// ---------- admin ----------

// POST /api/admin/cpcv (admin): responds with a Server-Sent Events stream of PipelineEvent
export interface AdminCpcvInput {
  agentId: string; // User.id of the agent
  buyerName: string;
  buyerNif: string; // 9 digits
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  salePriceCents: number;
  commissionRateBps: number; // 100…1000
  cpcvDate: string; // YYYY-MM-DD
  escrituraDate: string; // YYYY-MM-DD, after cpcvDate and after the protocol date
}
export type PipelineStep = "validating" | "signing" | "proving" | "verifying" | "minting" | "done";
export interface PipelineEvent {
  step: PipelineStep;
  status: "started" | "completed" | "failed";
  message?: string;
  data?: { cpcvId?: string; noteId?: number; txHash?: string; explorerUrl?: string; [k: string]: unknown };
}

// GET /api/admin/cpcv and /api/admin/cpcv/[id] (admin; PII decrypted)
export interface AdminCpcvRow {
  id: string;
  agent: { id: string; email: string; displayName: string | null; smartAccount: string | null };
  propertyAddress: string;
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  salePriceCents: number;
  commissionRateBps: number;
  cpcvDay: number;
  totalCommission: Stroops;
  agentCommission: Stroops;
  escrituraDay: number;
  status: CpcvStatus;
  noteId: number | null;
  mintTxHash: string | null;
  settleTxHash: string | null;
  cancelTxHash: string | null;
  error: string | null;
  createdAt: IsoTime;
  /** Minted (active) note whose escritura date is before today's protocol date. */
  overdue: boolean;
  /** True when piiEncrypted could not be decrypted (wrong key); the PII fields are then empty. */
  piiUnavailable?: boolean;
}

// GET /api/admin/cpcv (admin): newest first
export interface AdminCpcvListResponse {
  cpcvs: AdminCpcvRow[];
  /** Protocol clock used for `overdue` (null when the chain read failed). */
  clock: DemoClock | null;
}

// GET /api/admin/cpcv/[id] (admin)
export interface AdminCpcvDetailResponse {
  cpcv: AdminCpcvRow;
  commitment: string; // hex, "" until proven
  nullifier: string;
  /** Commitment salt (hex) from the encrypted record: opens the commitment for an auditor. */
  salt: string | null;
  /** `Cpcv.proof`: the un-negated snarkjs proof and the 9 public signals. */
  proof: { proof: SnarkjsProof; publicSignals: string[] } | null;
  /** Live credit line of a minted note (null otherwise, or when the chain read fails). */
  line: { creditLimit: Stroops; principal: Stroops; debt: Stroops; interest: Stroops; available: Stroops } | null;
  /** The agent's position now, for the settle/cancel previews (null when unavailable). */
  agentPosition: { cardBalance: Stroops; carriedDebt: Stroops; graceDeadline: UnixSecs | null } | null;
  clock: DemoClock | null;
}

// POST /api/admin/cpcv/[id]/settle and /api/admin/cpcv/[id]/cancel (admin)
export interface AdminCpcvActionResponse extends TxResponse {
  cpcv: AdminCpcvRow;
}

// GET /api/admin/agents (admin)
export interface AdminAgentRow {
  id: string;
  email: string;
  displayName: string | null;
  smartAccount: string | null;
  cardLast4: string | null;
  cardEnabledOnChain: boolean;
  notes: number;
  /** Notes still active (minted, not settled or cancelled). */
  activeNotes: number;
  debt: Stroops;
  carriedDebt: Stroops;
  graceDeadline: UnixSecs | null;
  blocked: boolean;
  canWriteOff: boolean; // protocol now ≥ grace deadline and carried debt > 0
  /** Where debt/carried debt/grace/blocked came from: a live read, the ASA cache, or nothing (no smart account / no data). */
  positionSource: "chain" | "cache" | "none";
}
export interface AdminAgentsResponse {
  agents: AdminAgentRow[];
  clock: DemoClock | null;
}

// POST /api/admin/agents/[id]/write-off (admin)
export interface AdminWriteOffResponse extends TxResponse {
  /** How many of the agent's cancelled CPCVs are now WRITTEN_OFF. */
  writtenOff: number;
}

// POST /api/admin/junior/deposit, /api/admin/junior/withdraw, /api/admin/fees/claim (admin) → TxResponse
export interface AdminAmountRequest {
  amountEur: number;
}

// GET /api/admin/overview (admin): dashboard alerts
export interface AdminOverviewResponse {
  failedDraws: { id: string; agentEmail: string; merchant: string; amount: Stroops; attempts: number; createdAt: IsoTime }[];
  agentsPastGrace: AdminAgentRow[];
  deployment: DeploymentInfo | null;
  /** Falls back to the wall clock (offset 0) when the chain can't be read; see `warnings`. */
  clock: DemoClock;
  /** Live pool stats for the dashboard (null when the chain read failed). */
  stats: Jsonify<PoolStats> | null;
  /** Reads that failed (chain or deployment), for a banner. */
  warnings: string[];
}

// POST /api/admin/demo/advance-clock (admin, DEMO_MODE only)
export type AdvanceClockRequest = { days: number } | { toGraceDeadlineOf: string /* agent User.id */ };
export interface AdvanceClockResponse extends TxResponse {
  clock: DemoClock;
}

// POST /api/admin/demo/reset (admin): SSE stream of log lines
export interface ResetLogEvent {
  level: "info" | "error" | "done";
  message: string;
}
