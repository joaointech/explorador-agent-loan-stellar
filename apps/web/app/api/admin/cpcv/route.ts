import { z } from "zod";
import type { AdminCpcvListResponse } from "@/lib/api-types";
import { listCpcvs } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/session";
import { createAndMintCpcv, isoToDay } from "@/lib/cpcv";
import { handle, json, parseBody, sseStream } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  agentId: z.string().min(1),
  buyerName: z.string().trim().min(2).max(120),
  buyerNif: z.string().trim().regex(/^\d{9}$/, "9 digits"),
  sellerName: z.string().trim().min(2).max(120),
  sellerNif: z.string().trim().regex(/^\d{9}$/, "9 digits"),
  propertyAddress: z.string().trim().min(5).max(240),
  salePriceEur: z.number().positive().max(1e12),
  commissionRatePct: z.number().min(1).max(10),
  cpcvDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  escrituraDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const GET = handle(async () => {
  await requireAdmin();
  return json<AdminCpcvListResponse>({ cpcvs: await listCpcvs() });
});

/** Create → attest → prove → verify → mint, streamed as Server-Sent Events (§4.3). */
export const POST = handle(async (req: Request) => {
  await requireAdmin();
  const b = await parseBody(req, Body);
  const input = {
    agentId: b.agentId,
    buyerName: b.buyerName,
    buyerNif: b.buyerNif,
    sellerName: b.sellerName,
    sellerNif: b.sellerNif,
    propertyAddress: b.propertyAddress,
    salePriceCents: BigInt(Math.round(b.salePriceEur * 100)),
    commissionRateBps: Math.round(b.commissionRatePct * 100),
    cpcvDay: isoToDay(b.cpcvDate),
    escrituraDay: isoToDay(b.escrituraDate),
  };
  return sseStream(async (send) => {
    await createAndMintCpcv(input, send).catch(() => undefined); // errors are emitted as events
  });
});
