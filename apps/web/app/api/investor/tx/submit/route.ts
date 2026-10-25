import { z } from "zod";
import { handle, json, parseBody } from "@/lib/http";
import { syncIfStale } from "@/lib/indexer/sync";
import { submitSignedTx } from "@/lib/investor";

export const maxDuration = 60;

const Body = z.object({ xdr: z.string().min(10).max(200_000) });

export const POST = handle(async (req: Request) => {
  const { xdr } = await parseBody(req, Body);
  const r = await submitSignedTx(xdr);
  await syncIfStale(0);
  return json(r);
});
