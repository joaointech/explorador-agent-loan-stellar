// pnpm e2e — full flow on testnet (§12.1):
// deploy fresh → investor deposit → agent (demo signer) → enable card → CPCV → mint →
// purchase (Lithic if configured, else card_draw) → settle → asserts → second CPCV →
// cancel → advance_clock past grace → write off → asserts.
//
// Runs against its own `<db>_e2e` database (see _e2e-db.ts); deployments/testnet.json is
// restored at the end, so the demo deployment stays active.
import "./_env";
import "./_e2e-db";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { advanceClock, cancelCpcv, settleCpcv, writeOffAgent } from "../apps/web/lib/admin";
import { createAndMintCpcv } from "../apps/web/lib/cpcv";
import { db } from "../apps/web/lib/db";
import { syncEvents } from "../apps/web/lib/indexer/sync";
import { lithicEnabled, simulateAuthorization } from "../apps/web/lib/lithic";
import { authRef } from "../apps/web/lib/lithic/asa";
import { deployAll } from "../apps/web/lib/ops/deploy";
import { agentField, Keypair, toHex32 } from "../apps/web/lib/ops/sdk";
import { DAY, readPosition, readProtocolNow, readStats } from "../apps/web/lib/pool";
import { invoke, invokeAsOperator } from "../apps/web/lib/stellar/client";
import { repoRoot } from "../apps/web/lib/stellar/contracts";
import { friendbot } from "../apps/web/lib/stellar/network";
import { deploySmartAccount, demoEntrySigner, ed25519Signer } from "../apps/web/lib/stellar/smart-account";

const EUR = 10_000_000n;
const CENT = 100_000n;
const eur = (s: bigint) => `€${(Number(s) / 1e7).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const near = (a: bigint, b: bigint, tol: bigint, msg: string) => assert.ok((a > b ? a - b : b - a) <= tol, `${msg}: ${eur(a)} vs ${eur(b)}`);
const step = (s: string) => console.log(`\n▶ ${s}`);

const deploymentsJson = path.join(repoRoot(), "deployments", "testnet.json");
const previousJson = existsSync(deploymentsJson) ? readFileSync(deploymentsJson, "utf8") : null;

// Rows left by an earlier run (each run deploys fresh contracts, so note ids restart at 1).
await db.user.deleteMany({ where: { email: { endsWith: "@e2e.test.invalid" } } });
let userId = "";

try {
  step("Deploy fresh contracts");
  await deployAll((l) => console.log("  " + l));

  step("Investor deposits €20,000");
  const investor = Keypair.random();
  await friendbot(investor.publicKey());
  await invoke("teurc", "faucet", { to: investor.publicKey(), amount: 20_000n * EUR }, { source: investor });
  const inv = investor.publicKey();
  await invoke("advancePool", "deposit", { assets: 20_000n * EUR, receiver: inv, from: inv, operator: inv }, { source: investor });
  const st0 = await readStats();
  assert.equal(st0.senior_assets, 20_000n * EUR);
  assert.equal(st0.junior_assets, 10_000n * EUR);

  step("Agent with a demo Ed25519 signer + enable_card");
  const signerKp = Keypair.random();
  const { address: agent } = await deploySmartAccount(ed25519Signer(signerKp));
  const user = await db.user.create({ data: { email: `${randomUUID()}@e2e.test.invalid`, role: "AGENT", displayName: "E2E Agent" } });
  userId = user.id;
  await db.agent.create({
    data: { userId, smartAccount: agent, agentField: toHex32(agentField(agent)), signerKind: "demo-ed25519", demoSignerSecret: signerKp.secret() },
  });
  await invoke("advancePool", "enable_card", { agent }, { source: "sponsor", signAuthEntries: demoEntrySigner(agent, signerKp.secret()) });
  assert.equal((await readPosition(agent)).card_enabled, true);
  console.log(`  smart account ${agent}`);

  step("CPCV €300,000 @ 5% → proof → note");
  const today = Math.floor((await readProtocolNow()) / DAY);
  const n1 = await createAndMintCpcv(
    {
      agentId: userId,
      buyerName: "E2E Buyer",
      buyerNif: "245871336",
      sellerName: "E2E Seller",
      sellerNif: "198453270",
      propertyAddress: `Rua Augusta 100, 3.º Esq, 1100-053 Lisboa (e2e ${randomUUID().slice(0, 8)})`,
      salePriceCents: 30_000_000n,
      commissionRateBps: 500,
      cpcvDay: today - 1,
      escrituraDay: today + 100,
    },
    (e) => e.status !== "start" && console.log(`  ${e.step} ${e.status}${e.ms ? ` (${e.ms} ms)` : ""}`),
  );
  const line = (await readPosition(agent)).lines[0];
  assert.equal(line.line.credit_limit, 3_750n * EUR, "credit limit is 50% of the agent's half");

  step("Purchase €3,000");
  let drawn = false;
  const agentRow = await db.agent.findUniqueOrThrow({ where: { userId } });
  if (lithicEnabled() && agentRow.lithicCardToken) {
    await simulateAuthorization(agentRow.lithicCardToken, 300_000, "E2E PURCHASE");
    for (let i = 0; i < 20 && !drawn; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      drawn = (await db.cardAuthorization.count({ where: { agentId: userId, chainStatus: "CONFIRMED", decision: "APPROVED" } })) > 0;
    }
    if (!drawn) console.log("  ASA endpoint did not confirm in 20 s (tunnel down?) — falling back to card_draw");
  }
  if (!drawn) {
    const r = await invokeAsOperator<{ from_balance: bigint; from_credit: bigint }>("advancePool", "card_draw", {
      agent,
      amount: 300_000n * CENT,
      auth_ref: authRef(`e2e-${randomUUID()}`),
    });
    assert.equal(r.result.from_credit, 3_000n * EUR);
  }
  near((await readPosition(agent)).total_debt, 3_000n * EUR, CENT, "debt after the purchase (scaled debt rounds up)");

  step("Fast-forward 90 days and settle");
  await advanceClock({ days: 90 });
  const before = await readStats();
  await settleCpcv(n1.cpcvId);
  const after = await readStats();
  const pos = await readPosition(agent);
  near(pos.card_balance, 4_411_23n * CENT, CENT, "agent payout ≈ €4,411.23");
  assert.equal(pos.total_debt, 0n, "debt repaid");
  near(after.junior_assets - before.junior_assets, 7_500n * EUR, CENT, "junior top-up €7,500");
  assert.ok(after.share_price_scaled > st0.share_price_scaled, "share price increased");
  near(after.fees_accrued, 888n * CENT, 2n * CENT, "protocol fee ≈ €8.88");
  console.log(`  payout ${eur(pos.card_balance)}, junior ${eur(after.junior_assets)}, share price ${Number(after.share_price_scaled) / 1e18}`);

  step("Second CPCV → draw → cancel");
  const today2 = Math.floor((await readProtocolNow()) / DAY);
  const n2 = await createAndMintCpcv({
    agentId: userId,
    buyerName: "E2E Buyer 2",
    buyerNif: "226734018",
    sellerName: "E2E Seller 2",
    sellerNif: "191845502",
    propertyAddress: `Rua de Santa Catarina 312, 4000-443 Porto (e2e ${randomUUID().slice(0, 8)})`,
    salePriceCents: 18_500_000n,
    commissionRateBps: 400,
    cpcvDay: today2 - 1,
    escrituraDay: today2 + 60,
  });
  // Spends the €4,411.23 card balance first, then €1,000 of credit.
  await invokeAsOperator("advancePool", "card_draw", { agent, amount: pos.card_balance + 1_000n * EUR, auth_ref: authRef(`e2e-${randomUUID()}`) });
  await cancelCpcv(n2.cpcvId);
  const cancelled = await readPosition(agent);
  near(cancelled.carried_debt, 1_000n * EUR, CENT, "carried debt");
  assert.ok(cancelled.grace_deadline, "grace deadline set");

  step("Fast-forward past the grace deadline and write off");
  await advanceClock({ toGraceOf: userId });
  const pre = await readStats();
  const carried = (await readPosition(agent)).carried_debt;
  await writeOffAgent(userId);
  const post = await readStats();
  near(pre.junior_assets - post.junior_assets, carried, CENT, "junior absorbs the loss");
  near(post.senior_assets, pre.senior_assets, CENT, "senior untouched");
  assert.equal((await readPosition(agent)).blocked, true, "agent blocked");
  console.log(`  written off ${eur(carried)}; junior ${eur(pre.junior_assets)} → ${eur(post.junior_assets)}`);

  await syncEvents();
  console.log("\n✅ e2e passed");
} finally {
  // deployAll rewrote deployments/testnet.json with the e2e contracts.
  if (previousJson !== null) writeFileSync(deploymentsJson, previousJson);
  if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
  await db.$disconnect();
}
// snarkjs / circomlibjs keep worker threads alive after proving; exit explicitly.
process.exit(0);
