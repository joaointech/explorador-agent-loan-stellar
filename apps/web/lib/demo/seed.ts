// Demo seed (spec §11.2), shared by `pnpm seed` and the demo reset. Needs a
// fresh DEMO_MODE deployment (no notes yet). Builds the history on-chain with
// the real pipelines and the protocol clock:
//
//   D0   investors deposit 40,000 + 25,000 · mint A1 (Ana, Lisboa) and C3
//        (Carla, Porto) · card spends                                  → +30 d
//   D30  Ana's last A1 spends · mint A5 (Ana, Cascais) · spends on A5   → +30 d
//   D60  settle C3 · mint B4 (Bruno, Faro) · spends on B4               → +15 d
//   D75  settle A5 · Ana spends from her card balance                   → +15 d
//   D90  cancel B4 (carried debt, grace) · mint B2 (Bruno, Braga) · spend → +30 d
//   D120 end: A1 ~70% used (escritura +55 d), B2 lightly used (+75 d),
//        C3 + A5 settled, B4 cancelled in grace (deadline D270)
//
// CPCVs are created with the admin's New CPCV pipeline (lib/admin/pipeline.ts),
// so seeded rows are identical to UI-created ones. Steps that don't depend on
// each other run in parallel lanes: each agent's card draws, settlements and
// cancellations are paid by its own channel account (the operator signs its
// auth entry), mints by the operator, enable_card by the sponsor, deposits by
// the investors themselves.

import { provisionDemoAgent } from "@/lib/agent/provision";
import { refreshCachedPosition } from "@/lib/card/position";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { recordPoolSnapshot } from "@/lib/indexer/snapshot";
import { runSync } from "@/lib/indexer/sync";
import { operatorKeypair, roleKeypair } from "@/lib/stellar/config";
import { cancelNote, readAgentPosition, readNoteCount, readPoolStats, settleNote } from "@/lib/stellar/contracts";
import { requireDeployment } from "@/lib/stellar/deployment";
import { inProcessMutex } from "@/lib/stellar/lock";
import { predictDemoSmartAccount, submitDemoAgentAction } from "@/lib/stellar/smart-account";
import type { Keypair } from "@stellar/stellar-sdk";

import { ensureXlm, formatXlm, xlmBalance, type Log } from "./accounts";
import { createCpcvNote } from "./cpcv";
import { channelKeypair, demoInvestorKeypair } from "./keys-derived";
import { eur, fastForward, fmtEur, investorDeposit, protocolToday, seedCardSpend } from "./ops";
import { SEED_AGENTS, SEED_DEALS, SEED_INVESTORS, SEED_SPENDS, SEED_TOTAL_DAYS, type AgentKey, type DealKey, type SeedSpend } from "./seed-data";
import { wipeDemoData } from "./wipe";

export interface SeedAgent {
  key: AgentKey;
  userId: string;
  email: string;
  displayName: string;
  smartAccount: string;
}

export interface SeedSummary {
  startDay: number;
  endDay: number;
  agents: Record<AgentKey, SeedAgent & { enableTx: string }>;
  notes: Record<DealKey, { noteId: number; mintTx: string; settleTx?: string; cancelTx?: string }>;
  investors: { address: string; deposited: string; shares: string; txHash: string }[];
  spends: number;
  xlmSpent: Record<string, string>;
  durationMs: number;
}

/** Awaits every promise, then throws the first failure (so no lane keeps running unobserved). */
async function all<T extends readonly unknown[]>(promises: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const settled = await Promise.allSettled(promises);
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failed) throw failed.reason;
  return settled.map((s) => (s as PromiseFulfilledResult<unknown>).value) as unknown as T;
}

const short = (hash: string) => `${hash.slice(0, 10)}…`;

async function ensureSeedAgent(a: (typeof SEED_AGENTS)[number], log: Log): Promise<SeedAgent> {
  const user = await db.user.upsert({
    where: { email: a.email },
    create: { email: a.email, role: "AGENT", displayName: a.displayName },
    update: { role: "AGENT", displayName: a.displayName },
  });
  // An Agent row from other keys (different sponsor or demo-signer seed) can't be signed for: replace it.
  const expected = predictDemoSmartAccount(a.email);
  const existing = await db.agent.findUnique({ where: { userId: user.id } });
  if (existing && existing.smartAccount !== expected) {
    log(`${a.email}: stored smart account ${existing.smartAccount} was made with other keys; re-provisioning`);
    await db.$transaction([
      db.cardAuthorization.deleteMany({ where: { agentId: user.id } }),
      db.cpcv.deleteMany({ where: { agentId: user.id } }),
      db.agent.delete({ where: { userId: user.id } }),
    ]);
  }
  const p = await provisionDemoAgent({ userId: user.id });
  if (p.status !== "complete" || !p.smartAccount) throw new Error(`provisioning ${a.email} failed at ${p.failedStep}: ${p.error}`);
  log(`${a.displayName}: smart account ${p.smartAccount}${p.deployTxHash ? ` deployed (tx ${short(p.deployTxHash)})` : " (exists)"}, card •••• ${p.cardLast4}`);
  return { key: a.key, userId: user.id, email: a.email, displayName: a.displayName, smartAccount: p.smartAccount };
}

export async function runSeed(opts: { log: Log }): Promise<SeedSummary> {
  const started = Date.now();
  const { log } = opts;
  const deployment = await requireDeployment();
  const stats = await readPoolStats();
  if (!stats.params.demoMode) throw new Error("The seed needs a DEMO_MODE deployment (it fast-forwards the protocol clock)");
  if ((await readNoteCount()) > 0) throw new Error("The seed needs a fresh deployment with no notes: run pnpm demo:reset (or pnpm deploy:testnet) first");
  log(`seeding deployment ${deployment.info.advancePool} (pool) / ${deployment.info.cpcvNote} (notes)`);

  // ---- XLM for every fee payer (Friendbot top-ups when low; deterministic accounts persist across resets)
  const operator = operatorKeypair();
  const sponsor = roleKeypair("SPONSOR_SECRET");
  const lanes: Record<AgentKey, Keypair> = { ana: channelKeypair(0), bruno: channelKeypair(1), carla: channelKeypair(2) };
  const payers: Record<string, string> = {
    operator: operator.publicKey(),
    sponsor: sponsor.publicKey(),
    "channel ana": lanes.ana.publicKey(),
    "channel bruno": lanes.bruno.publicKey(),
    "channel carla": lanes.carla.publicKey(),
  };
  const before: Record<string, bigint> = {};
  await all(
    Object.entries(payers).map(async ([role, address]) => {
      // The operator pays the five mints (~1,000-1,500 XLM each); the channels pay draws, settles, cancels.
      before[role] = await ensureXlm(address, role === "operator" ? 7_000 : 2_000, (m) => log(`${role}: ${m}`));
    }),
  );

  // ---- database: wipe the previous deployment's data, admin + seed agents
  await wipeDemoData(log);
  const adminEmail = env().ADMIN_EMAILS[0];
  if (adminEmail) {
    await db.user.upsert({ where: { email: adminEmail }, create: { email: adminEmail, role: "ADMIN", displayName: "explorador admin" }, update: { role: "ADMIN" } });
    log(`admin user ${adminEmail}`);
  } else {
    log("ADMIN_EMAILS is empty: no admin user seeded");
  }
  const agentList = await all(SEED_AGENTS.map((a) => ensureSeedAgent(a, log)));
  const agents = Object.fromEntries(agentList.map((a) => [a.key, a])) as Record<AgentKey, SeedAgent>;

  const d0 = await protocolToday();
  log(`protocol day D0 = ${d0} (${new Date(d0 * 86_400_000).toISOString().slice(0, 10)})`);
  const notes = {} as SeedSummary["notes"];
  let spendCount = 0;

  // CPCVs go through the admin's New CPCV pipeline (operator-signed mint, like the UI). Mints never
  // run concurrently: the note's storage keys depend on cpcv_note's next id, so two mints simulated
  // against the same state would collide (the second fails its footprint).
  const mint = (key: DealKey) =>
    inProcessMutex("demo-seed:mint", async () => {
      const s = SEED_DEALS[key];
      const agent = agents[s.agent];
      // A mint cost ~1,000-1,500 XLM while testnet fees spiked (new persistent entries with 90-day TTLs).
      await ensureXlm(operator.publicKey(), 2_500, (m) => log(`operator: ${m}`));
      const res = await createCpcvNote(agent.userId, { ...s.deal, cpcvDay: d0 + s.cpcvOn, escrituraDay: d0 + s.escrituraOn });
      notes[key] = { noteId: res.noteId, mintTx: res.txHash };
      log(`${key} minted: note #${res.noteId} for ${agent.displayName} (${s.deal.propertyAddress.split(", ").pop()}), escritura D${s.escrituraOn} (tx ${short(res.txHash)})`);
      return res;
    });
  const spend = async (s: SeedSpend) => {
    const agent = agents[s.agent];
    const r = await seedCardSpend(agent, s.amountEur, s.merchant, { source: lanes[s.agent] });
    spendCount++;
    log(`${agent.displayName}: ${s.merchant} ${fmtEur(eur(s.amountEur))} (balance ${fmtEur(r.fromBalance)} / credit ${fmtEur(r.fromCredit)}, tx ${short(r.txHash)})`);
  };
  const spendAll = async (list: SeedSpend[], agent: AgentKey) => {
    for (const s of list.filter((x) => x.agent === agent)) await spend(s);
  };
  const snapshot = async (label: string) => {
    await recordPoolSnapshot({ force: true });
    const st = await readPoolStats();
    log(`snapshot ${label}: senior ${fmtEur(st.seniorAssets)}, junior ${fmtEur(st.juniorAssets)}, debt ${fmtEur(st.totalDebt)}, share price ${(Number(st.sharePriceScaled) / 1e18).toFixed(6)}`);
  };
  const forward = async (days: number) => {
    const r = await fastForward(days);
    log(`clock +${days} days → D${r.day - d0} (tx ${short(r.txHash)})`);
    await snapshot(`D${r.day - d0}`);
  };

  // ---- D0
  const enableTx = {} as Record<AgentKey, string>;
  const enable = (key: AgentKey) =>
    submitDemoAgentAction({ label: agents[key].email, smartAccount: agents[key].smartAccount, action: { action: "enable_card" } }).then((r) => {
      enableTx[key] = r.txHash;
      log(`${agents[key].displayName}: card enabled on-chain (tx ${short(r.txHash)})`);
    });
  // The sponsor serializes its transactions in-process; start them in the order they are needed.
  const anaEnabled = enable("ana");
  const carlaEnabled = enable("carla");
  const brunoEnabled = enable("bruno");
  const investors: SeedSummary["investors"] = [];
  await all([
    anaEnabled,
    carlaEnabled,
    brunoEnabled,
    ...SEED_INVESTORS.map(async (inv) => {
      const kp = demoInvestorKeypair(inv.label);
      const r = await investorDeposit(kp, eur(inv.amountEur), (m) => log(`investor ${inv.label}: ${m}`));
      investors.push({ address: kp.publicKey(), deposited: eur(inv.amountEur).toString(), shares: r.shares.toString(), txHash: r.txHash });
      log(`investor ${inv.label} ${kp.publicKey()} deposited ${fmtEur(eur(inv.amountEur))} → ${fmtEur(r.shares)} eaSR (tx ${short(r.txHash)})`);
    }),
    (async () => {
      await mint("A1");
      await anaEnabled;
      await spendAll(SEED_SPENDS.day0, "ana");
    })(),
    (async () => {
      await mint("C3");
      await carlaEnabled;
      await spendAll(SEED_SPENDS.day0, "carla");
    })(),
  ]);
  await snapshot("D0");
  await forward(30);

  // ---- D30
  await all([
    (async () => {
      await spendAll(SEED_SPENDS.day30a1, "ana");
      await mint("A5");
      await spendAll(SEED_SPENDS.day30a5, "ana");
    })(),
    spendAll(SEED_SPENDS.day30a5, "carla"),
  ]);
  await snapshot("D30");
  await forward(30);

  // ---- D60
  await all([
    (async () => {
      const r = await settleNote(notes.C3.noteId, { source: lanes.carla });
      notes.C3.settleTx = r.txHash;
      await db.cpcv.updateMany({ where: { noteId: notes.C3.noteId }, data: { status: "SETTLED", settleTxHash: r.txHash } });
      log(`C3 settled: note #${notes.C3.noteId} (tx ${short(r.txHash)})`);
    })(),
    (async () => {
      await mint("B4");
      await spendAll(SEED_SPENDS.day60, "bruno");
    })(),
  ]);
  await snapshot("D60");
  await forward(15);

  // ---- D75
  {
    const r = await settleNote(notes.A5.noteId, { source: lanes.ana });
    notes.A5.settleTx = r.txHash;
    await db.cpcv.updateMany({ where: { noteId: notes.A5.noteId }, data: { status: "SETTLED", settleTxHash: r.txHash } });
    log(`A5 settled: note #${notes.A5.noteId} (tx ${short(r.txHash)})`);
    await spendAll(SEED_SPENDS.day75, "ana");
  }
  await snapshot("D75");
  await forward(15);

  // ---- D90
  {
    const r = await cancelNote(notes.B4.noteId, { source: lanes.bruno });
    notes.B4.cancelTx = r.txHash;
    await db.cpcv.updateMany({ where: { noteId: notes.B4.noteId }, data: { status: "CANCELLED", cancelTxHash: r.txHash } });
    log(`B4 cancelled: note #${notes.B4.noteId}, debt carried, grace period running (tx ${short(r.txHash)})`);
    await mint("B2");
    await spendAll(SEED_SPENDS.day90, "bruno");
  }
  await snapshot("D90");
  await forward(SEED_TOTAL_DAYS - 90);

  // ---- end: index everything, refresh the ASA cache, report
  for (let i = 0; i < 3; i++) {
    const r = await runSync({ snapshot: false });
    if (r.status !== "ok") log(`indexer: ${r.status} ${r.reason ?? ""}`);
    else log(`indexer: +${r.inserted} events (ledgers ${r.fromLedger}→${r.toLedger})`);
    if (r.status === "ok" && r.inserted === 0) break;
  }
  const endDay = await protocolToday();
  for (const a of agentList) {
    await refreshCachedPosition({ userId: a.userId, smartAccount: a.smartAccount });
    const p = await readAgentPosition(a.smartAccount);
    log(
      `${a.displayName}: card ${fmtEur(p.cardBalance)}, debt ${fmtEur(p.totalDebt)}, carried ${fmtEur(p.carriedDebt)}, available ${fmtEur(p.availableCredit)}` +
        (p.graceDeadline !== null ? `, grace until D${Math.floor(Number(p.graceDeadline) / 86_400) - d0}` : ""),
    );
  }
  const xlmSpent: Record<string, string> = {};
  for (const [role, address] of Object.entries(payers)) {
    const spent = before[role] - (await xlmBalance(address));
    xlmSpent[role] = formatXlm(spent);
  }
  log(`XLM spent: ${Object.entries(xlmSpent).map(([r, v]) => `${r} ${v}`).join(", ")}`);
  log(`seed done in ${((Date.now() - started) / 1000).toFixed(0)} s: ${Object.keys(notes).length} notes, ${spendCount} card spends, protocol day D${endDay - d0}`);

  return {
    startDay: d0,
    endDay,
    agents: Object.fromEntries(agentList.map((a) => [a.key, { ...a, enableTx: enableTx[a.key] }])) as SeedSummary["agents"],
    notes,
    investors,
    spends: spendCount,
    xlmSpent,
    durationMs: Date.now() - started,
  };
}
