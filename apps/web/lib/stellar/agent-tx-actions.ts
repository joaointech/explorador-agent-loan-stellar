// Agent actions on `advance_pool` that the agent's smart account authorizes
// (spec §7.3: enable_card, disable_card, withdraw_balance all `agent.require_auth()`).

import { Address, StrKey, nativeToScVal, type xdr } from "@stellar/stellar-sdk";
import { z } from "zod";

import type { AgentTxAction } from "@/lib/types/api";

import { invokeContractFunc } from "./agent-tx-sponsor";

const I128_MAX = (1n << 127n) - 1n;

const isAccountOrContract = (s: string) => StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s);
const STROOPS = /^[0-9]{1,39}$/;
// zod runs refinements even after the regex fails, so re-check before BigInt().
const isPositiveI128 = (v: string) => STROOPS.test(v) && BigInt(v) > 0n && BigInt(v) <= I128_MAX;

/** Request-body schema for `AgentTxAction` (amount = decimal string of stroops). */
export const agentTxActionSchema: z.ZodType<AgentTxAction> = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable_card") }),
  z.object({ action: z.literal("disable_card") }),
  z.object({
    action: z.literal("withdraw_balance"),
    amount: z
      .string()
      .regex(STROOPS, "amount must be a decimal string of stroops")
      .refine(isPositiveI128, "amount must be a positive i128"),
    to: z.string().refine(isAccountOrContract, "to must be a G… account or C… contract address").optional(),
  }),
]);

/** The `advance_pool` invocation for an action, with the agent's smart account as `agent`. */
export function agentActionFunc(poolId: string, smartAccount: string, action: AgentTxAction): xdr.HostFunction {
  const agent = new Address(smartAccount).toScVal();
  switch (action.action) {
    case "enable_card":
      return invokeContractFunc(poolId, "enable_card", [agent]);
    case "disable_card":
      return invokeContractFunc(poolId, "disable_card", [agent]);
    case "withdraw_balance": {
      const amount = BigInt(action.amount);
      if (amount <= 0n || amount > I128_MAX) throw new Error("withdraw amount out of range");
      const to = new Address(action.to ?? smartAccount).toScVal();
      return invokeContractFunc(poolId, "withdraw_balance", [agent, nativeToScVal(amount, { type: "i128" }), to]);
    }
  }
}

/** On-chain `card_enabled` after a successful action, or null when the action doesn't change it. */
export function cardEnabledAfter(action: AgentTxAction): boolean | null {
  if (action.action === "enable_card") return true;
  if (action.action === "disable_card") return false;
  return null;
}
