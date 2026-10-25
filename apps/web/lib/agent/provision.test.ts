import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/http";
import { agentFieldHex } from "@/lib/zk/agent-field";

const ACCOUNT = "CA3BJ36JAJYP7XAWJMU5A2KYY6L2YKRPDK35DDLQOP25ODGJ2RMR5GTJ";

interface AgentRow {
  userId: string;
  smartAccount: string;
  agentField: string;
  signerKind: string;
  lithicCardToken: string | null;
  cardLast4: string | null;
}

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; role: "AGENT" | "ADMIN"; passkeys: { credentialId: string; publicKeyP256: Uint8Array }[] },
  agent: null as AgentRow | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => (state.user ? { ...state.user, agent: state.agent ? { ...state.agent } : null } : null)),
    },
    agent: {
      upsert: vi.fn(async ({ create }: { create: Omit<AgentRow, "lithicCardToken" | "cardLast4"> }) => {
        state.agent ??= { ...create, lithicCardToken: null, cardLast4: null };
        return { ...state.agent };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { lithicCardToken: null }; data: Partial<AgentRow> }) => {
        if (state.agent && state.agent.lithicCardToken === where.lithicCardToken) {
          Object.assign(state.agent, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...state.agent! })),
    },
  },
}));

vi.mock("@/lib/stellar/smart-account", () => ({
  deployPasskeySmartAccount: vi.fn(async () => ({ address: ACCOUNT, txHash: "d".repeat(64) })),
  deployDemoSmartAccount: vi.fn(async () => ({ address: ACCOUNT, txHash: "e".repeat(64) })),
}));

vi.mock("@/lib/lithic/cards", () => ({
  createAgentCard: vi.fn(async () => ({ token: "card_tok_1", last4: "4242" })),
}));

const { provisionAgent, provisionDemoAgent } = await import("./provision");
const { deployPasskeySmartAccount, deployDemoSmartAccount } = await import("@/lib/stellar/smart-account");
const { createAgentCard } = await import("@/lib/lithic/cards");

const passkey = { credentialId: "cred-1", publicKeyP256: new Uint8Array([4, ...new Uint8Array(64)]) };

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: "u1", email: "agent@explorador.ai", role: "AGENT", passkeys: [passkey] };
  state.agent = null;
});

describe("provisionAgent", () => {
  it("deploys the passkey account, stores the agent with its agent_field, and issues the card", async () => {
    const result = await provisionAgent("u1");
    expect(result).toEqual({
      status: "complete",
      smartAccount: ACCOUNT,
      deployTxHash: "d".repeat(64),
      cardLast4: "4242",
      failedStep: null,
      error: null,
    });
    expect(deployPasskeySmartAccount).toHaveBeenCalledWith({ credentialId: "cred-1", publicKeyP256: passkey.publicKeyP256 });
    expect(state.agent).toMatchObject({
      smartAccount: ACCOUNT,
      agentField: agentFieldHex(ACCOUNT),
      signerKind: "passkey",
      lithicCardToken: "card_tok_1",
      cardLast4: "4242",
    });
  });

  it("is idempotent: a provisioned agent needs no chain or card call", async () => {
    await provisionAgent("u1");
    vi.clearAllMocks();
    const again = await provisionAgent("u1");
    expect(again).toMatchObject({ status: "complete", smartAccount: ACCOUNT, cardLast4: "4242", deployTxHash: null });
    expect(deployPasskeySmartAccount).not.toHaveBeenCalled();
    expect(createAgentCard).not.toHaveBeenCalled();
  });

  it("reports a failed deployment without creating a card, then resumes", async () => {
    vi.mocked(deployPasskeySmartAccount).mockRejectedValueOnce(new Error("Simulation failed: resource limit exceeded"));
    const failed = await provisionAgent("u1");
    expect(failed).toMatchObject({ status: "failed", failedStep: "smart_account", smartAccount: null });
    expect(failed.error).toContain("resource limit");
    expect(createAgentCard).not.toHaveBeenCalled();
    expect(state.agent).toBeNull();

    const retried = await provisionAgent("u1");
    expect(retried.status).toBe("complete");
  });

  it("keeps the account when the card step fails and retries only the card", async () => {
    vi.mocked(createAgentCard).mockRejectedValueOnce(new Error("Lithic is down"));
    const failed = await provisionAgent("u1");
    expect(failed).toMatchObject({ status: "failed", failedStep: "card", smartAccount: ACCOUNT, error: "Lithic is down" });
    expect(state.agent?.smartAccount).toBe(ACCOUNT);

    const retried = await provisionAgent("u1");
    expect(retried).toMatchObject({ status: "complete", cardLast4: "4242" });
    expect(deployPasskeySmartAccount).toHaveBeenCalledTimes(1);
    expect(createAgentCard).toHaveBeenCalledTimes(2);
  });

  it("shares one run between concurrent calls", async () => {
    const [a, b] = await Promise.all([provisionAgent("u1"), provisionAgent("u1")]);
    expect(a).toEqual(b);
    expect(deployPasskeySmartAccount).toHaveBeenCalledTimes(1);
    expect(createAgentCard).toHaveBeenCalledTimes(1);
  });

  it("checks preconditions", async () => {
    state.user = { ...state.user!, passkeys: [] };
    await expect(provisionAgent("u1")).rejects.toMatchObject({ status: 409, code: "NO_PASSKEY" });
    state.user = { ...state.user!, role: "ADMIN" };
    await expect(provisionAgent("u1")).rejects.toBeInstanceOf(HttpError);
    state.user = null;
    await expect(provisionAgent("u1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("provisionDemoAgent", () => {
  it("deploys a demo-signer account labelled with the agent's email", async () => {
    const result = await provisionDemoAgent({ userId: "u1" });
    expect(result.status).toBe("complete");
    expect(deployDemoSmartAccount).toHaveBeenCalledWith({ label: "agent@explorador.ai" });
    expect(state.agent?.signerKind).toBe("demo-ed25519");
  });
});
