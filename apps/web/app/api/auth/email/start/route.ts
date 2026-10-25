import { z } from "zod";
import { startEmailCode } from "@/lib/auth/email";
import { handle, json, parseBody } from "@/lib/http";

const Body = z.object({ email: z.string().trim().email().max(200) });

export const POST = handle(async (req: Request) => {
  const { email } = await parseBody(req, Body);
  await startEmailCode(email);
  return json({ ok: true });
});
