// Agent onboarding (§4.2), dashboard data (§10.2 /agent) and smart-account actions (§9.3).
import { agentField, toHex32 } from "@advance/zk";
import { Account, Address, Contract, Operation, rpc, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-sdk";
import type { ActivityItem, AgentDealDto, AgentOverviewResponse, AgentTxAction, AgentTxPrepareResponse } from "@/lib/api-types";
import { contractsDto, demoClock } from "@/lib/api/views";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Agent } from "@/lib/generated/prisma/client";
import { HttpError } from "@/lib/http";
import { createCard, lithicEnabled } from "@/lib/lithic";
import { pendingHoldsCents, positionForDecision, spendableStroops, STROOPS_PER_CENT } from "@/lib/lithic/asa";
import { DAY, type RawParams } from "@/lib/pool";
import { encodeArgs, readContract, submitPresigned } from "@/lib/stellar/client";
import { contractId } from "@/lib/stellar/contracts";
import { decodeContractError } from "@/lib/stellar/errors";
import { publicKey, rpcServer } from "@/lib/stellar/network";
import { deploySmartAccount, demoEntrySigner, passkeySigner } from "@/lib/stellar/smart-account";

// ---------------------------------------------------------------- onboarding

/** Deploys the agent's smart account for their passkey and creates the Agent row (+ Lithic card). */
export async function onboardAgent(userId: string, passkey: { publicKeyP256: Uint8Array; credentialId: string }): Promise<Agent> {
  const existing = await db.agent.findUnique({ where: { userId } });
  if (existing) return existing;
  const { address } = await deploySmartAccount(passkeySigner(passkey.publicKeyP256, passkey.credentialId));
  const field = await agentField(address);
  const agent = await db.agent.create({
    data: { userId, smartAccount: address, agentField: toHex32(field), signerKind: "passkey" },
  });
  return ensureCard(agent);
}

/** Creates the Lithic sandbox card when Lithic is configured and the agent has none yet. Never throws. */
export async function ensureCard(agent: Agent): Promise<Agent> {
  if (agent.lithicCardToken || !lithicEnabled()) return agent;
  try {
    const card = await createCard(agent.userId);
    return await db.agent.update({ where: { userId: agent.userId }, data: { lithicCardToken: card.token, cardLast4: card.last4 } });
  } catch (e) {
    console.error("Lithic card creation failed", e instanceof Error ? e.message : e);
    return agent;
  }
}

// ---------------------------------------------------------------- overview

export async function agentOverview(userId: string): Promise<AgentOverviewResponse> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { passkeys: { orderBy: { createdAt: "asc" } }, agent: true },
  });
  let agent = user.agent;
  if (agent) agent = await ensureCard(agent);

  const [demo, contracts, params] = await Promise.all([demoClock(), contractsDto(), readContract<RawParams>("advancePool", "params")]);
  const base = {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    passkeys: user.passkeys.map((p) => ({ id: p.id, createdAt: p.createdAt.toISOString() })),
    demo,
    contracts,
  };
  const aprBps = Number(params.agent_apr_bps);
  const ltvBps = BigInt(params.ltv_bps);

  if (!agent) {
    return {
      ...base,
      onboarding: { passkey: user.passkeys.length > 0, smartAccount: false, card: false, cardActivated: false },
      smartAccount: null,
      signerKind: "passkey",
      card: null,
      position: null,
      interest: { aprBps, protocolNow: demo.protocolNow, fetchedAt: Date.now() },
      spendable: "0",
      pendingHolds: "0",
      deals: [],
      activity: [],
    };
  }

  const state = await positionForDecision(agent);
  const holdsCents = await pendingHoldsCents(agent.userId);
  const position = state?.position ?? null;
  const cardActivated = position ? position.cardEnabled : agent.cardEnabledOnChain;
  if (position && position.cardEnabled !== agent.cardEnabledOnChain) {
    await db.agent.update({ where: { userId: agent.userId }, data: { cardEnabledOnChain: position.cardEnabled } });
  }

  const today = Math.floor(demo.protocolNow / DAY);
  const cpcvs = await db.cpcv.findMany({ where: { agentId: agent.userId }, orderBy: { createdAt: "desc" } });
  const deals: AgentDealDto[] = cpcvs.map((c) => {
    const line = position?.lines.find((l) => l.noteId === c.noteId);
    const agentStroops = c.agentCommissionCents * STROOPS_PER_CENT;
    return {
      cpcvId: c.id,
      noteId: c.noteId,
      status: c.status,
      totalCommission: (c.totalCommissionCents * STROOPS_PER_CENT).toString(),
      agentCommission: agentStroops.toString(),
      creditLimit: ((agentStroops * ltvBps) / 10000n).toString(),
      used: line?.debt ?? "0",
      escrituraDay: c.escrituraDay,
      overdue: c.status === "MINTED" && today > c.escrituraDay,
      mintTxHash: c.mintTxHash,
    };
  });

  return {
    ...base,
    onboarding: { passkey: user.passkeys.length > 0, smartAccount: true, card: Boolean(agent.lithicCardToken) || !lithicEnabled(), cardActivated },
    smartAccount: agent.smartAccount,
    signerKind: agent.signerKind === "demo-ed25519" ? "demo-ed25519" : "passkey",
    card: { last4: agent.cardLast4, hasLithic: Boolean(agent.lithicCardToken) },
    position,
    interest: { aprBps, protocolNow: demo.protocolNow, fetchedAt: Date.now() },
    spendable: state ? spendableStroops(state, holdsCents).toString() : "0",
    pendingHolds: (holdsCents * STROOPS_PER_CENT).toString(),
    deals,
    activity: await agentActivity(agent),
  };
}

export async function agentActivity(agent: Agent, limit = 50): Promise<ActivityItem[]> {
  const [auths, events] = await Promise.all([
    db.cardAuthorization.findMany({ where: { agentId: agent.userId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.chainEvent.findMany({
      where: {
        contract: "advancePool",
        type: { in: ["note_settled", "note_cancelled", "debt_written_off", "balance_withdrawn"] },
        data: { path: ["agent"], equals: agent.smartAccount },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  const items: ActivityItem[] = auths.map((a) => ({
    kind: "card",
    id: a.id,
    merchant: a.merchant,
    amountCents: Number(a.amountCents),
    decision: a.decision,
    declineReason: a.declineReason,
    chainStatus: a.chainStatus,
    fromBalance: a.fromBalanceStroops?.toString() ?? null,
    fromCredit: a.fromCreditStroops?.toString() ?? null,
    txHash: a.txHash,
    createdAt: a.createdAt.toISOString(),
  }));
  for (const e of events) {
    const d = e.data as Record<string, string>;
    const createdAt = e.createdAt.toISOString();
    if (e.type === "note_settled") {
      items.push({
        kind: "settlement",
        noteId: Number(d.note_id),
        agentPayout: String(d.agent_payout ?? "0"),
        debtRepaid: String(d.debt_repaid ?? "0"),
        interestPaid: String(d.interest_paid ?? "0"),
        carriedRepaid: String(d.carried_repaid ?? "0"),
        txHash: e.txHash,
        createdAt,
      });
    } else if (e.type === "note_cancelled") {
      items.push({
        kind: "cancellation",
        noteId: Number(d.note_id),
        debtCarried: String(d.debt_carried ?? "0"),
        graceDeadline: d.grace_deadline ? Number(d.grace_deadline) : null,
        txHash: e.txHash,
        createdAt,
      });
    } else if (e.type === "debt_written_off") {
      items.push({ kind: "writeoff", amount: String(d.amount ?? "0"), txHash: e.txHash, createdAt });
    } else if (e.type === "balance_withdrawn") {
      items.push({ kind: "withdrawal", amount: String(d.amount ?? "0"), to: String(d.to ?? ""), txHash: e.txHash, createdAt });
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

// ---------------------------------------------------------------- smart-account transactions

async function signerFor(agent: Agent) {
  if (agent.signerKind === "demo-ed25519") return null;
  const pk = await db.passkey.findFirst({ where: { userId: agent.userId }, orderBy: { createdAt: "asc" } });
  if (!pk) throw new HttpError(400, "NO_PASSKEY", "Register a passkey first");
  const s = passkeySigner(pk.publicKeyP256, pk.credentialId);
  return { verifier: s.verifier, keyData: Buffer.from(s.keyData).toString("hex"), credentialId: pk.credentialId };
}

async function agentOp(agent: Agent, action: AgentTxAction, params: { amount?: string; to?: string }): Promise<xdr.Operation> {
  const pool = await contractId("advancePool");
  let args: Record<string, unknown> = { agent: agent.smartAccount };
  if (action === "withdraw_balance") {
    const amount = BigInt(params.amount ?? "0");
    if (amount <= 0n) throw new HttpError(400, "VALIDATION", "Amount must be positive");
    const to = params.to?.trim() || agent.smartAccount;
    try {
      Address.fromString(to);
    } catch {
      throw new HttpError(400, "VALIDATION", "Invalid destination address");
    }
    args = { agent: agent.smartAccount, amount, to };
  }
  return new Contract(pool).call(action, ...encodeArgs("advancePool", action, args));
}

function buildSponsorTx(sequence: string, op: xdr.Operation): Transaction {
  return new TransactionBuilder(new Account(publicKey("sponsor"), sequence), { fee: "1000000", networkPassphrase: env.networkPassphrase })
    .addOperation(op)
    .setTimeout(300)
    .build();
}

/** Builds + simulates the action with sponsor as source and returns the tx whose auth entries the agent must sign. */
export async function prepareAgentTx(agent: Agent, action: AgentTxAction, params: { amount?: string; to?: string }): Promise<AgentTxPrepareResponse> {
  const op = await agentOp(agent, action, params);
  const server = rpcServer();
  const tx = buildSponsorTx("0", op);
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    const err = decodeContractError(sim.error);
    throw new HttpError(400, err.code || "SIMULATION_FAILED", err.message);
  }
  let auth = sim.result?.auth ?? [];
  const latestLedger = sim.latestLedger;
  const signer = await signerFor(agent);
  if (!signer) {
    if (!agent.demoSignerSecret) throw new HttpError(500, "NO_SIGNER", "Demo agent has no server-held signer");
    auth = await demoEntrySigner(agent.smartAccount, agent.demoSignerSecret)(auth, latestLedger);
  }
  const hf = (op.body().invokeHostFunctionOp() as xdr.InvokeHostFunctionOp).hostFunction();
  const unsigned = buildSponsorTx("0", Operation.invokeHostFunction({ func: hf, auth }));
  return {
    xdr: unsigned.toXDR(),
    networkPassphrase: env.networkPassphrase,
    rpcUrl: env.rpcUrl,
    smartAccount: agent.smartAccount,
    serverSigned: !signer,
    latestLedger,
    signer,
  };
}

/** Takes only the signed auth entries from the client's tx, rebuilds the call server-side and submits it from sponsor. */
export async function submitAgentTx(agent: Agent, action: AgentTxAction, txXdr: string) {
  let envelope: xdr.TransactionEnvelope;
  try {
    envelope = xdr.TransactionEnvelope.fromXDR(txXdr, "base64");
  } catch {
    throw new HttpError(400, "BAD_XDR", "Invalid transaction XDR");
  }
  const ops = envelope.switch().name === "envelopeTypeTx" ? envelope.v1().tx().operations() : [];
  const body = ops[0]?.body();
  if (!body || body.switch().name !== "invokeHostFunction") throw new HttpError(400, "BAD_XDR", "Expected one contract call");
  const ihf = body.invokeHostFunctionOp();
  const hf = ihf.hostFunction();
  if (hf.switch().name !== "hostFunctionTypeInvokeContract") throw new HttpError(400, "BAD_XDR", "Expected a contract call");
  const call = hf.invokeContract();
  const pool = await contractId("advancePool");
  const fn = call.functionName().toString();
  const target = Address.fromScAddress(call.contractAddress()).toString();
  const first = call.args()[0];
  const agentArg = first ? Address.fromScVal(first).toString() : "";
  if (target !== pool || fn !== action || agentArg !== agent.smartAccount) {
    throw new HttpError(400, "TX_MISMATCH", "The signed transaction does not match the requested action");
  }
  // Rebuild the call from the decoded arguments so nothing else from the client tx is used.
  const rebuilt = new Contract(pool).call(fn, ...call.args());
  const rebuiltHf = (rebuilt.body().invokeHostFunctionOp() as xdr.InvokeHostFunctionOp).hostFunction();
  const op = Operation.invokeHostFunction({ func: rebuiltHf, auth: ihf.auth() });
  const r = await submitPresigned(op, "sponsor");
  if (action === "enable_card" || action === "disable_card") {
    await db.agent.update({ where: { userId: agent.userId }, data: { cardEnabledOnChain: action === "enable_card" } });
  }
  return r;
}
