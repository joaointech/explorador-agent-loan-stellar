import { z } from "zod";
import type { TxResponse } from "@/lib/api-types";
import { handle, json, parseBody } from "@/lib/http";
import { assertAccount, FAUCET_AMOUNT } from "@/lib/investor";
import { invoke } from "@/lib/stellar/client";

export const maxDuration = 60;

const Body = z.object({ address: z.string().trim() });

/** Server-side faucet fallback (sponsor pays the fee; teurc.faucet needs no auth). */
export const POST = handle(async (req: Request) => {
  const { address } = await parseBody(req, Body);
  assertAccount(address);
  const r = await invoke("teurc", "faucet", { to: address, amount: FAUCET_AMOUNT }, { source: "sponsor" });
  return json<TxResponse>({ txHash: r.hash });
});
