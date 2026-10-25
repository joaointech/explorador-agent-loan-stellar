// ASA handler decisions (§9.5): approve, insufficient funds, idempotent retry, unknown card,
// paused card. Uses the dev Postgres; chain reads are stubbed.
import { randomBytes, randomUUID } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const EUR = 10_000_000n;
const chain = vi.hoisted(() => ({ cardBalance: 0n, availableCredit: 0n, blocked: false }));

vi.mock("@/lib/pool", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/pool")>();
  const params = { agent_apr_bps: 1200, protocol_fee_bps: 1000, senior_target_bps: 800, ltv_bps: 5000, grace_period_secs: 0n, max_leverage: 10, demo_mode: true };
  return {
    ...orig,
    readPosition: vi.fn(async () => ({
      card_balance: chain.cardBalance,
      card_enabled: true,
      blocked: chain.blocked,
      lines: [],
      carried_debt: 0n,
      grace_deadline: null,
      total_debt: 0n,
      total_principal: 0n,
      available_credit: chain.availableCredit,
      borrowable_now: chain.availableCredit,
    })),
    readStats: vi.fn(async () => ({
      senior_assets: 100_000n * EUR, junior_assets: 10_000n * EUR, fees_accrued: 0n, total_debt: 0n, total_principal: 0n,
      pool_cash: 110_000n * EUR, total_card_balances: 0n, share_supply: 0n, share_price_scaled: 10n ** 18n, utilization_bps: 0,
      leverage_x100: 0, lendable: 110_000n * EUR, leverage_headroom: 100_000n * EUR, borrow_index: 10n ** 18n, protocol_now: 0n,
      params, written_off_total: 0n,
    })),
  };
});

const { db } = await import("@/lib/db");
const { decideAuthorization, balanceInquiry } = await import("@/lib/lithic/asa");

const cardToken = `test-card-${randomUUID()}`;
const pausedCard = `test-card-${randomUUID()}`;
let userId = "";
let pausedUserId = "";

async function makeAgent(card: string, enabled: boolean) {
  const user = await db.user.create({ data: { email: `${randomUUID()}@test.invalid`, role: "AGENT" } });
  await db.agent.create({
    data: {
      userId: user.id,
      smartAccount: StrKey.encodeContract(randomBytes(32)),
      agentField: "00",
      lithicCardToken: card,
      cardEnabledOnChain: enabled,
    },
  });
  return user.id;
}

const auth = (token: string, cents: number, card = cardToken) => ({
  token,
  status: "AUTHORIZATION",
  amount: cents,
  amounts: { cardholder: { amount: cents } },
  card: { token: card },
  merchant: { descriptor: "TEST MERCHANT" },
});

beforeAll(async () => {
  userId = await makeAgent(cardToken, true);
  pausedUserId = await makeAgent(pausedCard, false);
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userId, pausedUserId] } } });
  await db.$disconnect();
});

beforeEach(() => {
  chain.cardBalance = 0n;
  chain.availableCredit = 100n * EUR;
  chain.blocked = false;
});

describe("decideAuthorization", () => {
  it("approves within spendable and records a PENDING hold", async () => {
    const d = await decideAuthorization(auth(`t-${randomUUID()}`, 5_000));
    expect(d.result).toBe("APPROVED");
    expect(d.authorization?.chainStatus).toBe("PENDING");
    expect(d.drawAuthorizationId).toBe(d.authorization?.id);
  });

  it("declines with INSUFFICIENT_FUNDS once pending holds are counted", async () => {
    // €100 credit − €50 held by the previous test → €60 does not fit.
    const d = await decideAuthorization(auth(`t-${randomUUID()}`, 6_000));
    expect(d.result).toBe("INSUFFICIENT_FUNDS");
    expect(d.authorization?.decision).toBe("DECLINED");
    expect(d.drawAuthorizationId).toBeNull();
  });

  it("spends card balance before credit", async () => {
    chain.cardBalance = 30n * EUR;
    chain.availableCredit = 0n;
    await db.cardAuthorization.updateMany({ where: { agentId: userId }, data: { chainStatus: "CONFIRMED" } });
    expect((await decideAuthorization(auth(`t-${randomUUID()}`, 2_500))).result).toBe("APPROVED");
    expect((await decideAuthorization(auth(`t-${randomUUID()}`, 1_000))).result).toBe("INSUFFICIENT_FUNDS");
  });

  it("is idempotent on the Lithic token", async () => {
    await db.cardAuthorization.updateMany({ where: { agentId: userId }, data: { chainStatus: "CONFIRMED" } });
    const token = `t-${randomUUID()}`;
    const first = await decideAuthorization(auth(token, 1_000));
    const again = await decideAuthorization(auth(token, 1_000));
    expect(first.result).toBe("APPROVED");
    expect(again.result).toBe("APPROVED");
    expect(again.authorization?.id).toBe(first.authorization?.id);
    expect(again.drawAuthorizationId).toBeNull(); // the retry must not trigger a second draw
    expect(await db.cardAuthorization.count({ where: { lithicToken: token } })).toBe(1);
  });

  it("declines an unknown card as SUSPECTED_FRAUD without recording a row", async () => {
    const token = `t-${randomUUID()}`;
    const d = await decideAuthorization(auth(token, 100, "no-such-card"));
    expect(d.result).toBe("SUSPECTED_FRAUD");
    expect(await db.cardAuthorization.count({ where: { lithicToken: token } })).toBe(0);
  });

  it("declines a card that was not enabled on-chain as CARD_PAUSED", async () => {
    const d = await decideAuthorization(auth(`t-${randomUUID()}`, 100, pausedCard));
    expect(d.result).toBe("CARD_PAUSED");
  });

  it("declines a blocked agent", async () => {
    await db.cardAuthorization.updateMany({ where: { agentId: userId }, data: { chainStatus: "CONFIRMED" } });
    chain.blocked = true;
    expect((await decideAuthorization(auth(`t-${randomUUID()}`, 100))).result).toBe("INSUFFICIENT_FUNDS");
  });

  it("answers BALANCE_INQUIRY with spendable cents", async () => {
    await db.cardAuthorization.updateMany({ where: { agentId: userId }, data: { chainStatus: "CONFIRMED" } });
    chain.cardBalance = 12n * EUR;
    chain.availableCredit = 8n * EUR;
    const b = await balanceInquiry({ token: "bi", status: "BALANCE_INQUIRY", card: { token: cardToken } });
    expect(b).toEqual({ result: "APPROVED", cents: 2_000 });
  });
});
