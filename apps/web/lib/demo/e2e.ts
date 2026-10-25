// End-to-end flow on testnet (spec §12.1), run by `pnpm e2e` against its own
// database: fresh deploy → investor deposit → demo-signer agent → enable card →
// CPCV through the admin's New CPCV pipeline + real on-chain Groth16 mint →
// card purchase through the simulated card network's ASA pipeline → +90 days →
// settle (worked example §5.6: interest
// €88.77, payout €4,411.23, junior +€7,500, share price up) → second CPCV →
// purchase from balance + credit → cancel → write-off refused before the grace
// deadline → +181 days → write off (junior absorbs the loss, senior untouched).
// Also checks agent_field parity with the contract (§8.4) and verifies the
// registry's proofs with snarkjs.

import { groth16 } from "snarkjs";

import { provisionDemoAgent } from "@/lib/agent/provision";
import { simulatePurchase } from "@/lib/card/simulate";
import { db } from "@/lib/db";
import { getRegistryDetail } from "@/lib/indexer/registry";
import { runSync } from "@/lib/indexer/sync";
import { adminKeypair, operatorKeypair, roleKeypair, treasuryKeypair } from "@/lib/stellar/config";
import {
  cancelNote,
  readAgentPosition,
  readLine,
  readNote,
  readPoolStats,
  settleNote,
  writeOff,
} from "@/lib/stellar/contracts";
import { isContractError } from "@/lib/stellar/errors";
import { publicSignalsFromNote, sorobanProofToSnarkjs } from "@/lib/stellar/proof";
import { asBigInt, asBytesHex, asString, asStruct, field, scAddress, scU32 } from "@/lib/stellar/scval";
import { simulateView } from "@/lib/stellar/simulate";
import { submitDemoAgentAction } from "@/lib/stellar/smart-account";
import type { AgentPosition, PoolStats } from "@/lib/types/chain";
import { DAY_SECS, STROOPS_PER_EUR } from "@/lib/units";
import { agentFieldHex } from "@/lib/zk/agent-field";
import { loadVerificationKey } from "@/lib/zk/artifacts";
import { fieldFromBytes } from "@/lib/zk/field";

import { ensureXlm, formatXlm, xlmBalance, type Log } from "./accounts";
import { createCpcvNote } from "./cpcv";
import { deployContracts, recordDeployment, storedWasmHashes, type DeployResult } from "./deploy";
import { demoInvestorKeypair } from "./keys-derived";
import { eur, fastForward, fmtEur, investorDeposit, protocolToday } from "./ops";
import { nif } from "./seed-data";
import { wipeDemoData } from "./wipe";

export class E2eAssertionError extends Error {}

export interface E2eSummary {
  deployment: DeployResult;
  agent: { email: string; smartAccount: string };
  investor: string;
  txs: Record<string, string>;
  checks: string[];
  figures: Record<string, string>;
  xlmSpent: Record<string, string>;
  durationMs: number;
}

const E2E_AGENT_EMAIL = "e2e-agent@demo.explorador.pt";
const CENT = 100_000n; // stroops

export async function runE2e(opts: { log: Log }): Promise<E2eSummary> {
  const started = Date.now();
  const { log } = opts;
  const checks: string[] = [];
  const txs: Record<string, string> = {};
  const figures: Record<string, string> = {};
  const check = (ok: boolean, what: string, detail = "") => {
    if (!ok) throw new E2eAssertionError(`✗ ${what}${detail ? `: ${detail}` : ""}`);
    checks.push(what);
    log(`✓ ${what}${detail ? ` (${detail})` : ""}`);
  };
  const near = (actual: bigint, expected: bigint, tolerance: bigint) => (actual > expected ? actual - expected : expected - actual) <= tolerance;

  // ---- fee payers
  const operator = operatorKeypair();
  const payers: Record<string, string> = {
    admin: adminKeypair().publicKey(),
    operator: operator.publicKey(),
    sponsor: roleKeypair("SPONSOR_SECRET").publicKey(),
  };
  const before: Record<string, bigint> = {};
  for (const [role, address] of Object.entries(payers)) {
    before[role] = await ensureXlm(address, role === "operator" ? 5_000 : 2_000, (m) => log(`${role}: ${m}`));
  }

  // ---- 1. fresh deploy (from the uploaded wasm) as this database's active deployment
  // This database is the e2e's own: rows of earlier runs belong to dead contracts (and the same deal
  // data would trip the admin pipeline's "already financed" nullifier guard), so start clean.
  await wipeDemoData(log);
  log("1. deploying fresh contracts from the stored wasm hashes");
  const deployment = await deployContracts({ wasmHashes: await storedWasmHashes(), log, demoMode: true });
  await recordDeployment(deployment);
  Object.assign(txs, Object.fromEntries(Object.entries(deployment.txs).map(([k, v]) => [`deploy: ${k}`, v])));
  const s0 = await readPoolStats();
  check(s0.juniorAssets === 10_000n * STROOPS_PER_EUR && s0.seniorAssets === 0n, "deploy seeds the junior tranche with €10,000", fmtEur(s0.juniorAssets));
  check(s0.params.demoMode && s0.params.agentAprBps === 1200 && s0.params.ltvBps === 5000, "pool params match §5.1 (12% APR, 50% LTV, demo mode)");
  const tokenBalance = async (address: string) =>
    asBigInt(await simulateView(deployment.teurc, "balance", [scAddress(address)]), "balance");
  const treasury = treasuryKeypair().publicKey();
  check((await tokenBalance(treasury)) === 990_000n * STROOPS_PER_EUR, "treasury holds 1,000,000 − 10,000 tEURC");

  // ---- 2. investor deposit
  log("2. investor deposit");
  const investor = demoInvestorKeypair("e2e");
  const dep = await investorDeposit(investor, eur(10_000), log);
  txs["investor deposit"] = dep.txHash;
  const s1 = await readPoolStats();
  check(dep.shares === eur(10_000) && s1.seniorAssets === eur(10_000), "first deposit mints 1:1 eaSR shares", `${fmtEur(dep.shares)} shares`);
  const priceAtDeposit = s1.sharePriceScaled;

  // ---- 3. demo-signer agent
  log("3. agent with a demo-signer smart account");
  const user = await db.user.upsert({
    where: { email: E2E_AGENT_EMAIL },
    create: { email: E2E_AGENT_EMAIL, role: "AGENT", displayName: "E2E Agent" },
    update: { role: "AGENT" },
  });
  const provisioning = await provisionDemoAgent({ userId: user.id });
  check(provisioning.status === "complete" && provisioning.smartAccount !== null, "agent provisioned (smart account + simulated card)", provisioning.smartAccount ?? provisioning.error ?? "");
  if (provisioning.deployTxHash) txs["agent smart account deploy"] = provisioning.deployTxHash;
  const agent = { userId: user.id, smartAccount: provisioning.smartAccount! };

  // agent_field parity (spec §8.4): TS encoding == cpcv_note.agent_field on testnet, C… and G… addresses
  for (const address of [agent.smartAccount, investor.publicKey()]) {
    const onChain = asBytesHex(await simulateView(deployment.cpcvNote, "agent_field", [scAddress(address)]), "agent_field", 32);
    check(onChain === agentFieldHex(address), `agent_field parity TS == contract for ${address.slice(0, 4)}…${address.slice(-4)}`, onChain.slice(0, 16));
  }

  // ---- 4. enable card (signed by the demo signer, sponsored)
  log("4. enable card");
  const enable = await submitDemoAgentAction({ label: E2E_AGENT_EMAIL, smartAccount: agent.smartAccount, action: { action: "enable_card" } });
  txs["enable_card"] = enable.txHash;
  check((await readAgentPosition(agent.smartAccount)).cardEnabled, "card enabled on-chain by the smart account");

  // ---- 5. CPCV → proof → mint (worked example, §5.6)
  log("5. CPCV #1: €300,000 at 5%, escritura in 90 days");
  let today = await protocolToday();
  const deal1 = {
    buyerName: "Inês Rodrigues Lima",
    buyerNif: nif("26543219"),
    sellerName: "Manuel Antunes Reis",
    sellerNif: nif("19283746"),
    propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
    salePriceCents: 30_000_000n,
    commissionRateBps: 500,
    cpcvDay: today - 2,
    escrituraDay: today + 90,
  };
  const m1 = await createCpcvNote(agent.userId, deal1);
  txs["mint note 1 (on-chain Groth16)"] = m1.txHash;
  const note1 = await readNote(m1.noteId);
  check(note1.totalCommission === eur(15_000) && note1.agentCommission === eur(7_500), "note #1 stores total €15,000 / agent €7,500", `note #${m1.noteId}`);
  check((await readLine(m1.noteId)).line.creditLimit === eur(3_750), "credit line = 50% of the agent commission (€3,750)");
  const p1 = await readAgentPosition(agent.smartAccount);
  check(p1.availableCredit === eur(3_750), "available credit €3,750");
  const tokenUri = asString(await simulateView(deployment.cpcvNote, "token_uri", [scU32(m1.noteId)]), "token_uri");
  check(tokenUri === `${deployment.baseUri}/${m1.noteId}`, "SEP-50 token_uri = base_uri + \"/\" + id (served by GET /api/notes/[id])", tokenUri);
  let soulbound: unknown = null;
  await simulateView(deployment.cpcvNote, "transfer", [scAddress(agent.smartAccount), scAddress(investor.publicKey()), scU32(m1.noteId)]).catch((err: unknown) => (soulbound = err));
  check(isContractError(soulbound, "Soulbound"), "note transfer fails (soulbound)");

  // the registry's proof (stored snarkjs proof) and the proof rebuilt from on-chain bytes both verify
  const vk = loadVerificationKey();
  const detail = await getRegistryDetail(m1.noteId);
  check(detail.snarkjsProof !== null && (await groth16.verify(vk, detail.publicSignals, detail.snarkjsProof)), "registry proof verifies with snarkjs");
  const params = asStruct(await simulateView(deployment.cpcvNote, "attester_params", []), "attester_params");
  const constant = (name: string) => fieldFromBytes(asBytesHex(field(params, name, "attester_params"), name, 32)).toString();
  const rebuilt = publicSignalsFromNote(note1, {
    attesterAx: constant("attester_ax"),
    attesterAy: constant("attester_ay"),
    nullifierSecretCommitment: constant("nullifier_secret_commitment"),
  });
  check(await groth16.verify(vk, rebuilt, sorobanProofToSnarkjs(note1.proof)), "proof rebuilt from on-chain note data verifies (browser path)");

  // ---- 6. card purchase through the simulated card network (ASA pipeline) + a decline
  log("6. card purchase via the simulated ASA pipeline");
  const buy = await simulatePurchase(agent.userId, { amountEur: 3_000, merchant: "Worten Colombo" });
  check(buy.response.decision === "APPROVED" && buy.response.via === "simulated", "€3,000 purchase approved by the ASA pipeline");
  await buy.followUp?.();
  const row1 = await db.cardAuthorization.findUniqueOrThrow({ where: { id: buy.response.authorizationId } });
  check(row1.chainStatus === "CONFIRMED" && row1.fromCreditStroops === eur(3_000) && row1.fromBalanceStroops === 0n, "card_draw confirmed on-chain: €3,000 on credit", row1.txHash ?? "");
  txs["card_draw €3,000 (ASA)"] = row1.txHash!;
  const declined = await simulatePurchase(agent.userId, { amountEur: 1_000, merchant: "Fnac Chiado" });
  check(declined.response.decision === "DECLINED" && declined.response.declineReason === "INSUFFICIENT_FUNDS", "€1,000 purchase above spendable is declined (INSUFFICIENT_FUNDS)");

  // ---- 7. +90 days with no other activity, then settle
  log("7. fast-forward 90 days and settle (escritura)");
  const ff1 = await fastForward(90);
  txs["advance_clock +90 days"] = ff1.txHash;
  const sBefore = await readPoolStats();
  const posBefore = await readAgentPosition(agent.smartAccount);
  const treasuryBefore = await tokenBalance(treasury);
  const settle = await settleNote(m1.noteId);
  txs["settle note 1"] = settle.txHash;
  const sAfter = await readPoolStats();
  const posAfter = await readAgentPosition(agent.smartAccount);
  const interest = posBefore.totalDebt - eur(3_000);
  figures.interest = fmtEur(interest);
  figures.payout = fmtEur(posAfter.cardBalance);
  check(near(interest, eur(88.77), CENT), "interest over 90 days = €88.77 (single accrual)", fmtEur(interest));
  check(near(posAfter.cardBalance, eur(4_411.23), CENT), "agent card balance credited €4,411.23", fmtEur(posAfter.cardBalance));
  check(posAfter.totalDebt === 0n && (await readNote(m1.noteId)).status === "Settled", "debt repaid, note #1 Settled");
  check(treasuryBefore - (await tokenBalance(treasury)) === eur(15_000), "treasury paid the €15,000 commission");
  const juniorTopUp = sAfter.juniorAssets - sBefore.juniorAssets;
  figures.juniorTopUp = fmtEur(juniorTopUp);
  check(near(juniorTopUp, eur(7_500), CENT), "junior tranche topped up by explorador's €7,500", fmtEur(juniorTopUp));
  check(sAfter.sharePriceScaled > priceAtDeposit, "senior share price rose", `${(Number(priceAtDeposit) / 1e18).toFixed(6)} → ${(Number(sAfter.sharePriceScaled) / 1e18).toFixed(6)}`);
  figures.sharePrice = (Number(sAfter.sharePriceScaled) / 1e18).toFixed(6);

  // ---- 8. second CPCV → spend (balance first, then credit) → cancel → grace → write off
  log("8. CPCV #2 → purchase → cancel → grace → write-off");
  today = await protocolToday();
  const m2 = await createCpcvNote(
    agent.userId,
    {
      buyerName: "Tiago Moreira Pinto",
      buyerNif: nif("27654321"),
      sellerName: "Rosa Batista Leal",
      sellerNif: nif("15432198"),
      propertyAddress: "Rua Formosa 300, 4000-252 Porto",
      salePriceCents: 20_000_000n,
      commissionRateBps: 500,
      cpcvDay: today - 1,
      escrituraDay: today + 60,
    },
  );
  txs["mint note 2"] = m2.txHash;
  const buy2 = await simulatePurchase(agent.userId, { amountEur: 6_000, merchant: "IKEA Alfragide" });
  check(buy2.response.decision === "APPROVED", "€6,000 purchase approved (card balance + credit)");
  await buy2.followUp?.();
  const row2 = await db.cardAuthorization.findUniqueOrThrow({ where: { id: buy2.response.authorizationId } });
  check(
    row2.chainStatus === "CONFIRMED" && row2.fromBalanceStroops === posAfter.cardBalance && row2.fromCreditStroops === eur(6_000) - posAfter.cardBalance,
    "draw takes the card balance first, then credit",
    `balance ${fmtEur(row2.fromBalanceStroops ?? 0n)} / credit ${fmtEur(row2.fromCreditStroops ?? 0n)}`,
  );
  txs["card_draw €6,000 (ASA)"] = row2.txHash!;
  const cancel = await cancelNote(m2.noteId);
  txs["cancel note 2"] = cancel.txHash;
  const pCancel: AgentPosition = await readAgentPosition(agent.smartAccount);
  const cancelNow = (await readPoolStats()).protocolNow;
  check(near(pCancel.carriedDebt, row2.fromCreditStroops!, CENT) && pCancel.lines.length === 0, "cancel moved the line debt to carried debt", fmtEur(pCancel.carriedDebt));
  check(
    pCancel.graceDeadline !== null && near(pCancel.graceDeadline, cancelNow + 180n * BigInt(DAY_SECS), 120n),
    "grace deadline = cancel + 180 protocol days",
  );
  let early: unknown = null;
  await writeOff(agent.smartAccount).catch((err: unknown) => (early = err));
  check(isContractError(early, "GraceNotOver"), "write-off is refused before the grace deadline (GraceNotOver)");
  const ff2 = await fastForward(181);
  txs["advance_clock +181 days"] = ff2.txHash;
  const sPre: PoolStats = await readPoolStats();
  const pPre = await readAgentPosition(agent.smartAccount);
  const wo = await writeOff(agent.smartAccount);
  txs["write_off"] = wo.txHash;
  const sPost = await readPoolStats();
  const pPost = await readAgentPosition(agent.smartAccount);
  const juniorLoss = sPre.juniorAssets - sPost.juniorAssets;
  figures.writtenOff = fmtEur(pPre.carriedDebt);
  figures.juniorLoss = fmtEur(juniorLoss);
  check(near(juniorLoss, pPre.carriedDebt, CENT), "junior absorbed the written-off debt", `${fmtEur(juniorLoss)} of ${fmtEur(pPre.carriedDebt)}`);
  check(sPost.seniorAssets + CENT >= sPre.seniorAssets, "senior tranche untouched by the loss");
  check(pPost.blocked && pPost.carriedDebt === 0n, "agent blocked, carried debt cleared");
  check(sPost.writtenOffTotal - sPre.writtenOffTotal === pPre.carriedDebt || near(sPost.writtenOffTotal - sPre.writtenOffTotal, pPre.carriedDebt, CENT), "pool written_off_total grew by the loss");

  // ---- 9. indexer: events → Cpcv statuses
  log("9. indexer sync");
  for (let i = 0; i < 4; i++) {
    const r = await runSync({ snapshot: false });
    if (r.status === "ok" && r.inserted === 0) break;
  }
  const rows = await db.cpcv.findMany({ where: { noteId: { in: [m1.noteId, m2.noteId] } }, select: { noteId: true, status: true } });
  const status = Object.fromEntries(rows.map((r) => [r.noteId, r.status]));
  check(status[m1.noteId] === "SETTLED" && status[m2.noteId] === "WRITTEN_OFF", "indexer reconciled CPCV statuses (SETTLED, WRITTEN_OFF)");
  const settled = await db.chainEvent.findFirst({ where: { type: "NoteSettled", txHash: settle.txHash } });
  const settledData = (settled?.data ?? {}) as Record<string, unknown>;
  check(
    settled !== null && near(BigInt(String(settledData.interestPaid ?? "0")), eur(88.77), CENT) && near(BigInt(String(settledData.agentPayout ?? "0")), eur(4_411.23), CENT),
    "NoteSettled event: interest €88.77, payout €4,411.23",
  );

  const xlmSpent: Record<string, string> = {};
  for (const [role, address] of Object.entries(payers)) xlmSpent[role] = formatXlm(before[role] - (await xlmBalance(address)));
  return {
    deployment,
    agent: { email: E2E_AGENT_EMAIL, smartAccount: agent.smartAccount },
    investor: investor.publicKey(),
    txs,
    checks,
    figures,
    xlmSpent,
    durationMs: Date.now() - started,
  };
}
