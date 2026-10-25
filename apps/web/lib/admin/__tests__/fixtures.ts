// Fixtures for the admin workstream's tests. Database-backed tests run against
// TEST_DATABASE_URL; each file uses its own email domain and deletes only its
// own rows, so files can run in parallel with the other workstreams' tests.

import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { StrKey } from "@stellar/stellar-sdk";

import { db, type CpcvStatus } from "@/lib/db";
import type { AgentPosition, PoolStats } from "@/lib/types/chain";
import type { CpcvProof } from "@/lib/zk/prove";

import { encryptCpcvPii, type CpcvPii } from "../pii";

export const EUR = 10_000_000n; // stroops
export const DAY = 86_400;
/** 25 Oct 2026, 12:00 UTC on the protocol clock. */
export const PROTOCOL_NOW = 20_751 * DAY + 12 * 3600;
export const PROTOCOL_DAY = 20_751;

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

/** A valid C… address (the pipeline checks agent addresses with stellar-sdk). */
export const contractAddress = () => StrKey.encodeContract(randomBytes(32));

export const txHash = () => randomBytes(32).toString("hex");

export function position(over: Partial<AgentPosition> = {}): AgentPosition {
  return {
    cardBalance: 0n,
    cardEnabled: true,
    blocked: false,
    lines: [],
    carriedDebt: 0n,
    graceDeadline: null,
    totalDebt: 0n,
    totalPrincipal: 0n,
    availableCredit: 0n,
    borrowableNow: 0n,
    ...over,
  };
}

export function poolStats(over: Partial<PoolStats> = {}): PoolStats {
  return {
    seniorAssets: 65_000n * EUR,
    juniorAssets: 10_000n * EUR,
    feesAccrued: 12n * EUR,
    totalDebt: 3_000n * EUR,
    totalPrincipal: 3_000n * EUR,
    poolCash: 72_012n * EUR,
    totalCardBalances: 0n,
    shareSupply: 65_000n * EUR,
    sharePriceScaled: 10n ** 18n,
    utilizationBps: 400,
    leverageX100: 30,
    lendable: 72_000n * EUR,
    leverageHeadroom: 97_000n * EUR,
    borrowIndex: 10n ** 18n,
    protocolNow: BigInt(PROTOCOL_NOW),
    params: {
      agentAprBps: 1200,
      protocolFeeBps: 1000,
      seniorTargetBps: 800,
      ltvBps: 5000,
      gracePeriodSecs: 15_552_000n,
      maxLeverage: 10,
      demoMode: true,
    },
    writtenOffTotal: 0n,
    ...over,
  };
}

/** What proveCpcv returns, with fresh commitment/nullifier bytes unless given. */
export function fakeProof(over: Partial<CpcvProof> = {}): CpcvProof {
  const field = () => {
    const bytes = new Uint8Array(randomBytes(32));
    bytes[0] = 0; // keep it below the BN254 scalar field
    return bytes;
  };
  return {
    totalCommissionCents: 1_500_000n,
    agentCommissionCents: 750_000n,
    commitment: field(),
    nullifier: field(),
    publicSignals: ["1", "1500000", "750000", "20841", "2", "3", "4", "5", "6"],
    snarkjsProof: {
      pi_a: ["11", "12", "1"],
      pi_b: [
        ["21", "22"],
        ["23", "24"],
        ["1", "0"],
      ],
      pi_c: ["31", "32", "1"],
      protocol: "groth16",
      curve: "bn128",
    },
    sorobanProof: { a: new Uint8Array(64).fill(1), b: new Uint8Array(128).fill(2), c: new Uint8Array(64).fill(3) },
    salt: "0f".repeat(32),
    ...over,
  };
}

export const samplePii = (over: Partial<CpcvPii> = {}): CpcvPii => ({
  v: 1,
  buyerName: "Maria Silva",
  buyerNif: "123456789",
  sellerName: "João Pereira",
  sellerNif: "987654321",
  propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
  salePriceCents: 30_000_000,
  commissionRateBps: 500,
  cpcvDate: "2026-10-20",
  cpcvDay: 20_746,
  salt: "0f".repeat(32),
  ...over,
});

export function adminFixtures(scope: string) {
  const domain = `${scope}.invalid`;

  async function agent(over: { smartAccount?: boolean; cachedPosition?: object } = {}) {
    const user = await db.user.create({ data: { email: `agent-${randomUUID()}@${domain}`, role: "AGENT", displayName: "Test Agent" } });
    if (over.smartAccount === false) return { userId: user.id, email: user.email, smartAccount: null as string | null };
    const smartAccount = contractAddress();
    await db.agent.create({
      data: {
        userId: user.id,
        smartAccount,
        agentField: "00".repeat(32),
        lithicCardToken: `sim_card_${randomUUID()}`,
        cardLast4: "4242",
        cardEnabledOnChain: true,
        ...(over.cachedPosition ? { cachedPosition: over.cachedPosition, cachedAt: new Date() } : {}),
      },
    });
    return { userId: user.id, email: user.email, smartAccount: smartAccount as string | null };
  }

  /** A Cpcv row as the pipeline would leave it. Pass noteId for MINTED and later statuses. */
  async function cpcv(agentId: string, over: { status?: CpcvStatus; noteId?: number | null; escrituraDay?: number; pii?: Partial<CpcvPii> } = {}) {
    return db.cpcv.create({
      data: {
        agentId,
        piiEncrypted: encryptCpcvPii(samplePii(over.pii)),
        totalCommissionCents: 1_500_000n,
        agentCommissionCents: 750_000n,
        escrituraDay: over.escrituraDay ?? PROTOCOL_DAY + 90,
        commitment: randomBytes(32).toString("hex"),
        nullifier: randomBytes(32).toString("hex"),
        status: over.status ?? "MINTED",
        noteId: over.noteId === undefined ? null : over.noteId,
        mintTxHash: over.noteId ? txHash() : null,
      },
    });
  }

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${domain}` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.cardAuthorization.deleteMany({ where: { agentId: { in: ids } } });
    await db.cpcv.deleteMany({ where: { agentId: { in: ids } } });
    await db.agent.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  return { domain, agent, cpcv, cleanup };
}

/** Cpcv.noteId is unique across the shared test database: each file draws ids from its own random range. */
export function noteIds() {
  let next = randomInt(100_000_000, 2_000_000_000);
  return () => next++;
}
