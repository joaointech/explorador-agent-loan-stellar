import { after } from "next/server";
import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { balanceInquiry, decideAuthorization, processDraw, verifyAsaSignature, type AsaRequestBody } from "@/lib/lithic/asa";

export const maxDuration = 60;

/** Lithic Auth Stream Access responder (§9.5). Must answer in < 2 s; the draw runs in after(). */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyAsaSignature(req.headers, raw)) return json({ result: "UNAUTHORIZED_MERCHANT" }, { status: 401 });
  let body: AsaRequestBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: { code: "BAD_JSON", message: "Invalid JSON" } }, { status: 400 });
  }
  try {
    if (body.status === "BALANCE_INQUIRY") {
      const b = await balanceInquiry(body);
      return json({ result: b.result, balance: { amount: b.cents, available: b.cents } });
    }
    if (body.status === "AUTHORIZATION" || body.status === "FINANCIAL_AUTHORIZATION") {
      const d = await decideAuthorization(body);
      if (d.drawAuthorizationId) {
        const id = d.drawAuthorizationId;
        after(() => processDraw(id).then(() => undefined));
      }
      return json({ result: d.result, token: body.token });
    }
    // Credits, reversals, advices: approve and record nothing on-chain (out of scope).
    console.info(`ASA ${body.status} ${body.token}: approved without on-chain action`);
    return json({ result: "APPROVED", token: body.token });
  } catch (e) {
    console.error("ASA handler error", e);
    // Fail closed.
    const known = body.card?.token ? await db.agent.findUnique({ where: { lithicCardToken: body.card.token } }).catch(() => null) : null;
    return json({ result: known ? "INSUFFICIENT_FUNDS" : "SUSPECTED_FRAUD", token: body.token });
  }
}
