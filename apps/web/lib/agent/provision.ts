// Agent provisioning (spec §4.2 steps 2–3): smart account (sponsored) → Agent
// row with its agent_field → Lithic card. Idempotent and resumable: each step
// is skipped when already done, the account address is deterministic, and a
// failed step is reported (not thrown) so onboarding can offer "Try again".

import { db, type Agent } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/http";
import { createAgentCard } from "@/lib/lithic/cards";
import { deployDemoSmartAccount, deployPasskeySmartAccount, type DeployedAccount } from "@/lib/stellar/smart-account";
import type { AgentProvisioning } from "@/lib/types/api";
import { agentFieldHex } from "@/lib/zk/agent-field";

type SignerKind = "passkey" | "demo-ed25519";

// Concurrent calls for the same user (double click, retry while running) share one run.
const inFlight = new Map<string, Promise<AgentProvisioning>>();

function once(userId: string, run: () => Promise<AgentProvisioning>): Promise<AgentProvisioning> {
  const running = inFlight.get(userId);
  if (running) return running;
  const promise = run().finally(() => inFlight.delete(userId));
  inFlight.set(userId, promise);
  return promise;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Provisions an agent whose smart account is controlled by their first passkey. */
export function provisionAgent(userId: string): Promise<AgentProvisioning> {
  return once(userId, async () => {
    const user = await loadAgentUser(userId);
    const passkey = user.passkeys[0];
    if (!user.agent && !passkey) throw conflict("Register a passkey first", "NO_PASSKEY");
    return provision(user.agent, userId, "passkey", () =>
      deployPasskeySmartAccount({ credentialId: passkey!.credentialId, publicKeyP256: passkey!.publicKeyP256 }),
    );
  });
}

/**
 * Seed agents (spec §11.2): smart account controlled by the server-held Ed25519 demo signer
 * derived from `label` (defaults to the agent's email; use the same label for submitDemoAgentAction).
 */
export function provisionDemoAgent(input: { userId: string; label?: string }): Promise<AgentProvisioning> {
  return once(input.userId, async () => {
    const user = await loadAgentUser(input.userId);
    const label = input.label ?? user.email;
    return provision(user.agent, input.userId, "demo-ed25519", () => deployDemoSmartAccount({ label }));
  });
}

async function loadAgentUser(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { agent: true, passkeys: { orderBy: { createdAt: "asc" } } },
  });
  if (!user) throw notFound("User not found");
  if (user.role !== "AGENT") throw forbidden("Only agents get a smart account and a card");
  return user;
}

async function provision(
  existing: Agent | null,
  userId: string,
  signerKind: SignerKind,
  deploy: () => Promise<DeployedAccount>,
): Promise<AgentProvisioning> {
  const result: AgentProvisioning = {
    status: "complete",
    smartAccount: existing?.smartAccount ?? null,
    deployTxHash: null,
    cardLast4: existing?.cardLast4 ?? null,
    failedStep: null,
    error: null,
  };

  // 1. Smart account + Agent row (an existing row keeps its account, whatever its signer).
  let agent = existing;
  if (!agent) {
    try {
      const deployed = await deploy();
      agent = await db.agent.upsert({
        where: { userId },
        create: { userId, smartAccount: deployed.address, agentField: agentFieldHex(deployed.address), signerKind },
        update: {},
      });
      result.smartAccount = agent.smartAccount;
      result.deployTxHash = deployed.txHash;
    } catch (err) {
      return { ...result, status: "failed", failedStep: "smart_account", error: errorMessage(err) };
    }
  }

  // 2. Card (compare-and-set so a racing run can't overwrite an issued card).
  if (!agent.lithicCardToken) {
    try {
      const card = await createAgentCard(userId);
      await db.agent.updateMany({
        where: { userId, lithicCardToken: null },
        data: { lithicCardToken: card.token, cardLast4: card.last4 },
      });
      const fresh = await db.agent.findUniqueOrThrow({ where: { userId }, select: { cardLast4: true } });
      result.cardLast4 = fresh.cardLast4;
    } catch (err) {
      return { ...result, status: "failed", failedStep: "card", error: errorMessage(err) };
    }
  }
  return result;
}
