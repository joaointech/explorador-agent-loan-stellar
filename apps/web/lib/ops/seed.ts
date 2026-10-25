// Demo data (§11.2). History is built by fast-forwarding the protocol clock between steps;
// every escritura is chosen relative to the protocol date at mint time, and the run ends
// with the active notes' escrituras 30–90 protocol days ahead.
import { randomUUID } from "node:crypto";
import { agentField, toHex32 } from "@advance/zk";
import { Keypair } from "@stellar/stellar-sdk";
import { advanceClock, cancelCpcv, settleCpcv } from "@/lib/admin";
import { ensureCard } from "@/lib/agent";
import { createAndMintCpcv } from "@/lib/cpcv";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Agent } from "@/lib/generated/prisma/client";
import { syncEvents, takeSnapshot } from "@/lib/indexer/sync";
import { authRef, refreshCachedPosition } from "@/lib/lithic/asa";
import { DAY, readPosition, readProtocolNow } from "@/lib/pool";
import { invoke, invokeAsOperator } from "@/lib/stellar/client";
import { friendbot } from "@/lib/stellar/network";
import { deploySmartAccount, demoEntrySigner, ed25519Signer } from "@/lib/stellar/smart-account";
import type { Log } from "./deploy";

const TEURC = 10_000_000n;
const CENT = 100_000n;

const AGENTS = [
  { key: "ana", name: "Ana Costa", email: "ana@demo.explorador.pt" },
  { key: "bruno", name: "Bruno Ferreira", email: "bruno@demo.explorador.pt" },
  { key: "carla", name: "Carla Mendes", email: "carla@demo.explorador.pt" },
] as const;
type AgentKey = (typeof AGENTS)[number]["key"];

async function today() {
  return Math.floor((await readProtocolNow()) / DAY);
}

/** Seed agent with a server-held Ed25519 signer; reuses the existing smart account when present. */
async function seedAgent(a: (typeof AGENTS)[number], log: Log): Promise<Agent> {
  const user = await db.user.upsert({
    where: { email: a.email },
    create: { email: a.email, role: "AGENT", displayName: a.name },
    update: { displayName: a.name },
  });
  let agent = await db.agent.findUnique({ where: { userId: user.id } });
  if (!agent) {
    const kp = Keypair.random();
    const { address } = await deploySmartAccount(ed25519Signer(kp));
    agent = await db.agent.create({
      data: {
        userId: user.id,
        smartAccount: address,
        agentField: toHex32(await agentField(address)),
        signerKind: "demo-ed25519",
        demoSignerSecret: kp.secret(),
      },
    });
    log(`${a.name}: smart account ${address}`);
  } else {
    log(`${a.name}: reusing smart account ${agent.smartAccount}`);
  }
  agent = await ensureCard(agent);
  await invoke("advancePool", "enable_card", { agent: agent.smartAccount }, {
    source: "sponsor",
    signAuthEntries: demoEntrySigner(agent.smartAccount, agent.demoSignerSecret!),
  });
  agent = await db.agent.update({ where: { userId: user.id }, data: { cardEnabledOnChain: true } });
  log(`${a.name}: card enabled on-chain${agent.cardLast4 ? ` (Lithic •••• ${agent.cardLast4})` : ""}`);
  return agent;
}

async function seedInvestor(label: string, amountEur: bigint, log: Log) {
  const kp = Keypair.random();
  await friendbot(kp.publicKey());
  let left = amountEur * TEURC;
  while (left > 0n) {
    const chunk = left > 25_000n * TEURC ? 25_000n * TEURC : left;
    await invoke("teurc", "faucet", { to: kp.publicKey(), amount: chunk }, { source: kp });
    left -= chunk;
  }
  const a = kp.publicKey();
  await invoke("advancePool", "deposit", { assets: amountEur * TEURC, receiver: a, from: a, operator: a }, { source: kp });
  log(`${label} ${a} deposited €${amountEur.toLocaleString("en-GB")}`);
  return kp;
}

/** Seed card spend: calls card_draw directly and records a CardAuthorization row (§11.2). */
async function spend(agent: Agent, merchant: string, eur: number, log: Log) {
  const cents = BigInt(Math.round(eur * 100));
  const token = `seed-${randomUUID()}`;
  const { hash, result } = await invokeAsOperator<{ from_balance: bigint; from_credit: bigint }>("advancePool", "card_draw", {
    agent: agent.smartAccount,
    amount: cents * CENT,
    auth_ref: authRef(token),
  });
  await db.cardAuthorization.create({
    data: {
      lithicToken: token,
      agentId: agent.userId,
      amountCents: cents,
      merchant,
      decision: "APPROVED",
      chainStatus: "CONFIRMED",
      fromBalanceStroops: BigInt(result.from_balance),
      fromCreditStroops: BigInt(result.from_credit),
      txHash: hash,
      attempts: 1,
    },
  });
  log(`  card: ${merchant} €${eur.toFixed(2)}`);
}

interface Deal {
  agent: AgentKey;
  buyer: [string, string];
  seller: [string, string];
  address: string;
  priceEur: number;
  rateBps: number;
  escrituraInDays: number;
}

async function mint(agents: Record<AgentKey, Agent>, d: Deal, log: Log) {
  const t = await today();
  const r = await createAndMintCpcv({
    agentId: agents[d.agent].userId,
    buyerName: d.buyer[0],
    buyerNif: d.buyer[1],
    sellerName: d.seller[0],
    sellerNif: d.seller[1],
    propertyAddress: d.address,
    salePriceCents: BigInt(d.priceEur) * 100n,
    commissionRateBps: d.rateBps,
    cpcvDay: t - 2,
    escrituraDay: t + d.escrituraInDays,
  });
  log(`Note #${r.noteId} minted for ${d.agent} (${d.address.split(",").slice(-1)[0].trim()}, €${d.priceEur.toLocaleString("en-GB")})`);
  return r;
}

async function fastForward(days: number, log: Log) {
  await advanceClock({ days });
  await takeSnapshot(true);
  log(`Protocol clock +${days} days`);
}

export async function seedDemo(log: Log = console.log) {
  // Admin user
  const adminEmail = env.adminEmails[0];
  if (adminEmail) {
    await db.user.upsert({ where: { email: adminEmail }, create: { email: adminEmail, role: "ADMIN" }, update: { role: "ADMIN" } });
    log(`Admin: ${adminEmail}`);
  }

  // Agents and investors (independent sources run in parallel)
  const [ana, bruno, carla, , ,] = await Promise.all([
    seedAgent(AGENTS[0], log),
    seedAgent(AGENTS[1], log),
    seedAgent(AGENTS[2], log),
    seedInvestor("Investor 1", 40_000n, log),
    seedInvestor("Investor 2", 25_000n, log),
  ]);
  const agents = { ana, bruno, carla };
  await takeSnapshot(true);

  // 5. Ana — settled earlier (Faro), then spends from the card balance.
  const d5 = await mint(
    agents,
    {
      agent: "ana",
      buyer: ["Miguel Antunes", "245871336"],
      seller: ["Helena Rocha", "198453270"],
      address: "Rua de Santo António 42, 8000-283 Faro",
      priceEur: 320_000,
      rateBps: 400,
      escrituraInDays: 40,
    },
    log,
  );
  // 3. Carla — settled (Braga).
  const d3 = await mint(
    agents,
    {
      agent: "carla",
      buyer: ["Ricardo Lopes", "231904585"],
      seller: ["Teresa Matos", "176230984"],
      address: "Avenida da Liberdade 210, 2.º Dto, 4710-251 Braga",
      priceEur: 185_000,
      rateBps: 500,
      escrituraInDays: 55,
    },
    log,
  );
  await spend(ana, "Pastelaria Aloma", 4.8, log);
  await spend(ana, "Worten Colombo", 349, log);
  await spend(ana, "Galp Energia", 62.35, log);
  await spend(ana, "IKEA Alfragide", 1_180.5, log);
  await spend(carla, "Continente Braga", 211.4, log);
  await spend(carla, "Fnac Braga Parque", 899, log);
  await spend(carla, "Booking.com", 684.6, log);

  await fastForward(20, log);
  await spend(ana, "Uber", 18.9, log);
  await fastForward(21, log);
  await settleCpcv(d5.cpcvId);
  log(`Note #${d5.noteId} settled (escritura)`);
  await spend(ana, "El Corte Inglés", 254.3, log);
  await spend(ana, "Vodafone", 39.99, log);

  // 4. Bruno — cancelled later, carried debt in grace (Cascais).
  const d4 = await mint(
    agents,
    {
      agent: "bruno",
      buyer: ["Sofia Almeida", "209118743"],
      seller: ["Jorge Pinto", "157302816"],
      address: "Rua Frederico Arouca 15, 2750-353 Cascais",
      priceEur: 620_000,
      rateBps: 450,
      escrituraInDays: 120,
    },
    log,
  );
  await spend(bruno, "Leroy Merlin Cascais", 640, log);
  await spend(bruno, "Pingo Doce", 96.75, log);
  await spend(bruno, "TAP Air Portugal", 363.2, log);

  await fastForward(15, log);
  await settleCpcv(d3.cpcvId);
  log(`Note #${d3.noteId} settled (escritura)`);

  await fastForward(10, log);
  await cancelCpcv(d4.cpcvId);
  log(`Note #${d4.noteId} cancelled (buyer withdrew)`);

  // 1. Ana — active, ~70% of credit used (Lisboa).
  const d1 = await mint(
    agents,
    {
      agent: "ana",
      buyer: ["Pedro Carvalho", "238510792"],
      seller: ["Isabel Nunes", "182667405"],
      address: "Rua Augusta 100, 3.º Esq, 1100-053 Lisboa",
      priceEur: 450_000,
      rateBps: 500,
      escrituraInDays: 75,
    },
    log,
  );
  // 2. Bruno — active, lightly used (Porto).
  const d2 = await mint(
    agents,
    {
      agent: "bruno",
      buyer: ["Rui Oliveira", "226734018"],
      seller: ["Marta Sousa", "191845502"],
      address: "Rua de Santa Catarina 312, 4000-443 Porto",
      priceEur: 385_000,
      rateBps: 400,
      escrituraInDays: 60,
    },
    log,
  );
  // Ana's line: €5,625 credit. Draws spend the card balance first (left over from deal 5),
  // so spend that balance plus ~70% of the new line.
  const anaBalance = await anaCardBalance(ana);
  const target = 5_625 * 0.7 + anaBalance;
  const spends: [string, number][] = [
    ["Remax Marketing Lda", 0.32],
    ["Apple Store Chiado", 0.27],
    ["Hotel Avenida Palace", 0.18],
    ["Staples Saldanha", 0.13],
    ["Restaurante Solar dos Presuntos", 0.1],
  ];
  for (const [m, share] of spends) await spend(ana, m, Math.round(target * share * 100) / 100, log);
  await spend(bruno, "Cafetaria Majestic", 14.5, log);
  await spend(bruno, "Via Verde", 32.4, log);

  await fastForward(5, log);
  for (const a of [ana, bruno, carla]) await refreshCachedPosition(a);
  await syncEvents();
  await takeSnapshot(true);
  log(`Seed complete: notes #${d1.noteId} and #${d2.noteId} active, #${d3.noteId} and #${d5.noteId} settled, #${d4.noteId} cancelled.`);
}

async function anaCardBalance(agent: Agent): Promise<number> {
  const p = await readPosition(agent.smartAccount);
  return Number(BigInt(p.card_balance) / CENT) / 100;
}
