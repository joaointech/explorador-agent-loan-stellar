// Mocked overviews for every agent-app state. Used by the /agent/preview
// gallery and the render tests. Numbers follow the spec §5.6 worked example
// (a €15,000 commission → €7,500 agent half → €3,750 credit limit).

import type { ActivityItem, AgentDeal, AgentOverviewResponse } from "@/lib/types/api";
import type { AgentPosition, Jsonify, LineView } from "@/lib/types/chain";

const EUR = 10_000_000n;
const DAY = 86_400;
const s = (v: bigint) => v.toString();
/** Euros with cents as stroops: e(406, 43) = €406.43. */
const e = (euros: number, cents = 0) => BigInt(euros) * EUR + BigInt(cents) * 100_000n;

export const FIXTURE_PROTOCOL_NOW = Date.UTC(2026, 9, 25, 12, 0, 0) / 1000;
export const FIXTURE_FETCHED_AT_MS = Date.UTC(2026, 9, 25, 12, 0, 0);
const TODAY = Math.floor(FIXTURE_PROTOCOL_NOW / DAY);
const SMART_ACCOUNT = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
/** A deterministic fake transaction hash (64 hex chars) for a seed. */
export function fakeTxHash(seed: string): string {
  let out = "";
  for (let block = 0; out.length < 64; block++) {
    let h = 0x811c9dc5 ^ block; // FNV-1a over the whole seed, once per 8-hex-char block
    for (const ch of `${seed}#${block}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}
const tx = fakeTxHash;

const RATES: AgentOverviewResponse["rates"] = {
  agentAprBps: 1200,
  borrowIndex: "1009863013698630136",
  protocolNow: FIXTURE_PROTOCOL_NOW,
  fetchedAtMs: FIXTURE_FETCHED_AT_MS,
  live: true,
};

function line(noteId: number, escrituraDay: number, creditLimit: bigint, principal: bigint, debt: bigint): Jsonify<LineView> {
  return {
    line: { noteId, agent: SMART_ACCOUNT, creditLimit: s(creditLimit), principal: s(principal), scaledDebt: s(debt), escrituraDay, status: "Active" },
    debt: s(debt),
    interest: s(debt - principal),
    available: s(creditLimit > debt ? creditLimit - debt : 0n),
  };
}

function position(lines: Jsonify<LineView>[], over: { cardBalance?: bigint; carriedDebt?: bigint; carriedPrincipal?: bigint; graceDeadline?: number | null; blocked?: boolean; cardEnabled?: boolean } = {}): Jsonify<AgentPosition> {
  const carried = over.carriedDebt ?? 0n;
  const lineDebt = lines.reduce((sum, l) => sum + BigInt(l.debt), 0n);
  const linePrincipal = lines.reduce((sum, l) => sum + BigInt(l.line.principal), 0n);
  const lineAvailable = lines.reduce((sum, l) => sum + BigInt(l.available), 0n);
  const available = over.blocked ? 0n : lineAvailable > carried ? lineAvailable - carried : 0n;
  return {
    cardBalance: s(over.cardBalance ?? 0n),
    cardEnabled: over.cardEnabled ?? true,
    blocked: over.blocked ?? false,
    lines,
    carriedDebt: s(carried),
    graceDeadline: over.graceDeadline === undefined || over.graceDeadline === null ? null : String(over.graceDeadline),
    totalDebt: s(lineDebt + carried),
    totalPrincipal: s(linePrincipal + (over.carriedPrincipal ?? carried)),
    availableCredit: s(available),
    borrowableNow: s(available),
  };
}

function deal(noteId: number, over: Partial<AgentDeal> = {}): AgentDeal {
  return {
    cpcvId: `cpcv-${noteId}`,
    noteId,
    status: "MINTED",
    agentCommission: s(e(7_500)),
    creditLimit: s(e(3_750)),
    used: "0",
    escrituraDay: TODAY + 45,
    overdue: false,
    mintTxHash: tx(`a${noteId}`),
    agentPayout: null,
    debtCarried: null,
    ...over,
  };
}

function purchase(id: string, at: string, merchant: string, amount: bigint, over: Partial<Extract<ActivityItem, { kind: "card" }>> = {}): ActivityItem {
  return {
    kind: "card",
    id,
    at,
    merchant,
    amount: s(amount),
    decision: "APPROVED",
    declineReason: null,
    fromBalance: "0",
    fromCredit: s(amount),
    chainStatus: "CONFIRMED",
    txHash: tx(id),
    ...over,
  };
}

const PASSKEY_USER: AgentOverviewResponse["user"] = {
  email: "ines.duarte@agents.example",
  displayName: "Inês Duarte",
  passkeys: [{ id: "pk-1", createdAt: "2026-07-02T09:12:00.000Z", signer: true }],
};

const READY_AGENT: AgentOverviewResponse["agent"] = {
  smartAccount: SMART_ACCOUNT,
  cardLast4: "4242",
  cardEnabledOnChain: true,
  signerKind: "passkey",
  cardNetwork: "simulated",
  cardPaused: false,
};

const DONE = { passkey: true, smartAccount: true, card: true, cardActivated: true };

// ---------- onboarding ----------

const newAgent: AgentOverviewResponse = {
  user: { email: "ines.duarte@agents.example", displayName: null, passkeys: [] },
  agent: { smartAccount: null, cardLast4: null, cardEnabledOnChain: false, signerKind: "passkey", cardNetwork: null, cardPaused: false },
  onboarding: { passkey: false, smartAccount: false, card: false, cardActivated: false },
  position: null,
  rates: { ...RATES, live: false },
  deals: [],
  activity: [],
  positionSource: "none",
  positionAsOf: null,
  pendingHolds: "0",
};

const provisioningFailed: AgentOverviewResponse = {
  ...newAgent,
  user: { ...newAgent.user, passkeys: [{ id: "pk-1", createdAt: "2026-10-25T11:58:00.000Z", signer: false }] },
  onboarding: { passkey: true, smartAccount: false, card: false, cardActivated: false },
};

const awaitingActivation: AgentOverviewResponse = {
  user: { ...PASSKEY_USER, passkeys: [{ id: "pk-1", createdAt: "2026-10-25T11:58:00.000Z", signer: true }] },
  agent: { ...READY_AGENT, cardEnabledOnChain: false },
  onboarding: { ...DONE, cardActivated: false },
  position: position([], { cardEnabled: false }),
  rates: RATES,
  deals: [],
  activity: [],
  positionSource: "chain",
  positionAsOf: null,
  pendingHolds: "0",
};

const seedAgent: AgentOverviewResponse = {
  user: { email: "ana@demo.explorador.pt", displayName: "Ana Costa", passkeys: [] },
  agent: { ...READY_AGENT, smartAccount: "CCX5ZMS6QZ3WFYW5LTPWUNTYQXGBLPK2FYPWAB2NOPV2O4UOXC6RKHRA", cardLast4: "0381", cardEnabledOnChain: false, signerKind: "demo-ed25519" },
  onboarding: { passkey: false, smartAccount: true, card: true, cardActivated: false },
  position: position([line(7, TODAY - 2, e(4_100), e(2_870), e(2_911, 64))], { cardEnabled: false }),
  rates: RATES,
  deals: [deal(7, { agentCommission: s(e(8_200)), creditLimit: s(e(4_100)), used: s(e(2_911, 64)), escrituraDay: TODAY - 2, overdue: true })],
  activity: [purchase("seed-1", "2026-09-02T10:30:00.000Z", "Leroy Merlin Braga", e(2_870))],
  positionSource: "chain",
  positionAsOf: null,
  pendingHolds: "0",
};

// ---------- active ----------

const activeNoDeals: AgentOverviewResponse = {
  ...awaitingActivation,
  agent: READY_AGENT,
  onboarding: DONE,
  position: position([]),
};

const DEAL_12 = line(12, TODAY + 45, e(3_750), e(2_600), e(2_625, 18));
const DEAL_13 = line(13, TODAY + 82, e(2_400), 0n, 0n);

const activeActivity: ActivityItem[] = [
  purchase("a8", "2026-10-25T11:52:00.000Z", "Galp fuel", e(62), { fromBalance: null, fromCredit: null, chainStatus: "SUBMITTED", txHash: null }),
  purchase("a7", "2026-10-25T09:41:00.000Z", "Pastelaria Aloma", e(4, 80), { fromBalance: s(e(4, 80)), fromCredit: "0" }),
  purchase("a6", "2026-10-24T18:03:00.000Z", "El Corte Inglés", e(5_000), {
    decision: "DECLINED",
    declineReason: "INSUFFICIENT_FUNDS",
    fromBalance: null,
    fromCredit: null,
    chainStatus: "PENDING",
    txHash: null,
  }),
  { kind: "withdrawal", id: "w1", at: "2026-10-23T10:04:00.000Z", amount: s(e(4_000)), to: SMART_ACCOUNT, txHash: tx("w1") },
  { kind: "settlement", id: "s9", at: "2026-10-22T15:20:00.000Z", noteId: 9, agentPayout: "44112328767", debtRepaid: "30887671233", txHash: tx("s9") },
  purchase("a5", "2026-10-14T13:30:00.000Z", "Worten", e(349)),
  purchase("a4", "2026-10-10T08:15:00.000Z", "Galp fuel", e(62)),
  purchase("a3", "2026-09-30T17:45:00.000Z", "Leroy Merlin", e(2_189)),
  purchase("a2", "2026-07-28T12:10:00.000Z", "Fnac Chiado", e(550)),
  purchase("a1", "2026-07-24T16:20:00.000Z", "IKEA Alfragide", e(2_450)),
];

const activeWithDeals: AgentOverviewResponse = {
  user: PASSKEY_USER,
  agent: READY_AGENT,
  onboarding: DONE,
  position: position([DEAL_12, DEAL_13], { cardBalance: e(406, 43) }),
  rates: RATES,
  deals: [
    deal(12, { used: DEAL_12.debt }),
    deal(13, { agentCommission: s(e(4_800)), creditLimit: s(e(2_400)), escrituraDay: TODAY + 82 }),
    deal(9, { status: "SETTLED", escrituraDay: TODAY - 3, agentPayout: "44112328767" }),
  ],
  activity: activeActivity,
  positionSource: "chain",
  positionAsOf: null,
  pendingHolds: s(e(62)),
};

// ---------- deal outcomes ----------

const DEAL_11 = line(11, TODAY + 30, e(4_625), e(800), e(806, 12));
const carriedDebt: AgentOverviewResponse = {
  user: { email: "bruno.ferreira@agents.example", displayName: "Bruno Ferreira", passkeys: [{ id: "pk-1", createdAt: "2026-06-11T08:00:00.000Z", signer: true }] },
  agent: { ...READY_AGENT, cardLast4: "7719" },
  onboarding: DONE,
  position: position([DEAL_11], { carriedDebt: e(2_034, 11), carriedPrincipal: e(2_000), graceDeadline: FIXTURE_PROTOCOL_NOW + 175 * DAY }),
  rates: RATES,
  deals: [
    deal(11, { agentCommission: s(e(9_250)), creditLimit: s(e(4_625)), used: DEAL_11.debt, escrituraDay: TODAY + 30 }),
    deal(14, { status: "CANCELLED", agentCommission: s(e(5_000)), creditLimit: s(e(2_500)), escrituraDay: TODAY + 12, debtCarried: s(e(2_000)) }),
  ],
  activity: [
    purchase("b4", "2026-10-24T19:12:00.000Z", "Continente Bom Dia", e(38, 45)),
    { kind: "cancellation", id: "c14", at: "2026-10-20T11:00:00.000Z", noteId: 14, debtCarried: s(e(2_000)), graceDeadline: FIXTURE_PROTOCOL_NOW + 175 * DAY, txHash: tx("c14") },
    purchase("b3", "2026-09-18T10:00:00.000Z", "Worten", e(761, 55)),
    purchase("b2", "2026-08-30T15:30:00.000Z", "Decathlon", e(1_200)),
    purchase("b1", "2026-08-12T09:00:00.000Z", "Galp fuel", e(800)),
  ],
  positionSource: "chain",
  positionAsOf: null,
  pendingHolds: "0",
};

const writtenOff: AgentOverviewResponse = {
  ...carriedDebt,
  position: position([], { cardBalance: e(15, 20), blocked: true }),
  deals: [deal(14, { status: "WRITTEN_OFF", agentCommission: s(e(5_000)), creditLimit: s(e(2_500)), escrituraDay: TODAY - 170, debtCarried: s(e(2_000)) })],
  activity: carriedDebt.activity.filter((a) => a.kind !== "card" || a.id !== "b4"),
};

const pausedCard: AgentOverviewResponse = {
  ...activeWithDeals,
  agent: { ...READY_AGENT, cardEnabledOnChain: false, cardPaused: true },
  position: position([DEAL_12, DEAL_13], { cardBalance: e(406, 43), cardEnabled: false }),
  pendingHolds: "0",
  activity: activeActivity.slice(1),
};

const offline: AgentOverviewResponse = {
  ...activeWithDeals,
  rates: { ...RATES, live: false },
  positionSource: "cache",
  positionAsOf: "2026-10-25T11:58:00.000Z",
};

export const AGENT_FIXTURES = {
  newAgent,
  provisioningFailed,
  awaitingActivation,
  seedAgent,
  activeNoDeals,
  activeWithDeals,
  carriedDebt,
  writtenOff,
  pausedCard,
  offline,
} satisfies Record<string, AgentOverviewResponse>;

export type AgentFixtureName = keyof typeof AGENT_FIXTURES;

export const isAgentFixtureName = (v: unknown): v is AgentFixtureName => typeof v === "string" && Object.hasOwn(AGENT_FIXTURES, v);

export const AGENT_FIXTURE_LABELS: Record<AgentFixtureName, string> = {
  newAgent: "New agent",
  provisioningFailed: "Setup failed",
  awaitingActivation: "Card created",
  seedAgent: "Seed agent",
  activeNoDeals: "Active, no deals",
  activeWithDeals: "Active with deals",
  carriedDebt: "Carried debt",
  writtenOff: "Written off",
  pausedCard: "Card paused",
  offline: "Offline (cached)",
};
