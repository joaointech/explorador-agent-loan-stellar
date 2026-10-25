// A fake AgentApi for the /agent/preview gallery: purchases are decided from
// the fixture's spendable amount and "confirm on Stellar" after a few seconds,
// card details are obviously fake. Nothing leaves the browser.

import { explorerTxUrl } from "@/lib/format";
import type { AgentOverviewResponse, AuthorizationStatusResponse } from "@/lib/types/api";
import { eurToCents, STROOPS_PER_CENT } from "@/lib/units";

import type { AgentApi } from "./api";
import { fakeTxHash } from "./fixtures";
import { cardState, spendable } from "./state";

const CONFIRM_AFTER_MS = 2_500;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface FakeAuthorization {
  createdAt: number;
  decision: "APPROVED" | "DECLINED";
  fromBalance: bigint;
  fromCredit: bigint;
}

export function createPreviewApi(getData: () => AgentOverviewResponse): AgentApi {
  const authorizations = new Map<string, FakeAuthorization>();
  let counter = 0;

  return {
    overview: async () => getData(),

    simulate: async ({ amountEur }) => {
      await sleep(500);
      const data = getData();
      const amount = eurToCents(amountEur) * STROOPS_PER_CENT;
      const id = `preview_${++counter}`;
      if (cardState(data) !== "active") {
        authorizations.set(id, { createdAt: Date.now(), decision: "DECLINED", fromBalance: 0n, fromCredit: 0n });
        return { authorizationId: id, decision: "DECLINED", declineReason: "CARD_PAUSED", via: "simulated" };
      }
      if (amount > spendable(data)) {
        authorizations.set(id, { createdAt: Date.now(), decision: "DECLINED", fromBalance: 0n, fromCredit: 0n });
        return { authorizationId: id, decision: "DECLINED", declineReason: "INSUFFICIENT_FUNDS", via: "simulated" };
      }
      const balance = BigInt(data.position?.cardBalance ?? "0");
      const fromBalance = balance < amount ? balance : amount;
      authorizations.set(id, { createdAt: Date.now(), decision: "APPROVED", fromBalance, fromCredit: amount - fromBalance });
      return { authorizationId: id, decision: "APPROVED", declineReason: null, via: "simulated" };
    },

    authorization: async (id): Promise<AuthorizationStatusResponse> => {
      const a = authorizations.get(id);
      if (!a) throw new Error("Unknown preview authorization");
      const confirmed = a.decision === "APPROVED" && Date.now() - a.createdAt >= CONFIRM_AFTER_MS;
      const txHash = confirmed ? fakeTxHash(id) : null;
      return {
        id,
        decision: a.decision,
        chainStatus: confirmed ? "CONFIRMED" : a.decision === "APPROVED" ? "SUBMITTED" : "PENDING",
        fromBalance: confirmed ? a.fromBalance.toString() : null,
        fromCredit: confirmed ? a.fromCredit.toString() : null,
        txHash,
        explorerUrl: txHash ? explorerTxUrl(txHash) : null,
      };
    },

    reveal: async () => {
      await sleep(300);
      const last4 = getData().agent.cardLast4 ?? "0000";
      return { pan: `400000000000${last4}`, cvv: "000", expMonth: "12", expYear: "2029" };
    },
  };
}
