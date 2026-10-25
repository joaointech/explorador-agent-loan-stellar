import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { prepareInvestorTx } from "@/lib/investor";

const Body = z.object({
  action: z.enum(["deposit", "withdraw", "redeem", "faucet"]),
  address: z.string().trim(),
  amount: z.string().regex(/^\d{1,30}$/).optional(),
});

export const POST = handle(async (req: Request) => {
  const { action, address, amount } = await parseBody(req, Body);
  return json(await prepareInvestorTx(action, address, amount));
});
