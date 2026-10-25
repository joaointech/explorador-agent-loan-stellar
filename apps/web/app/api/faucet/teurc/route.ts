// POST /api/faucet/teurc { address } (public): server-side "Get 10,000 tEURC"
// fallback when the investor's own Freighter call to `teurc.faucet` fails
// (spec §4.1, §9.7). Operator-signed; one grant per address per minute.

import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

import { HttpError, parseBody, route } from "@/lib/http";
import { jsonResponse } from "@/lib/json";
import { explorerUrl, faucetTeurc } from "@/lib/stellar/contracts";
import type { TxResponse } from "@/lib/types/api";
import { STROOPS_PER_EUR } from "@/lib/units";

export const dynamic = "force-dynamic";
/** Queueing behind other operator transactions + submit + confirmation. */
export const maxDuration = 90;

const AMOUNT = 10_000n * STROOPS_PER_EUR;
const COOLDOWN_MS = 60_000;

const g = globalThis as unknown as { teurcFaucet?: { granted: Map<string, number>; inflight: Set<string> } };
const state = (g.teurcFaucet ??= { granted: new Map(), inflight: new Set() });

const bodySchema = z.object({
  address: z
    .string()
    .trim()
    .refine((a) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a), "must be a Stellar account (G…) or contract (C…) address"),
});

export const POST = route(async (req: Request) => {
  const { address } = await parseBody(req, bodySchema);
  const now = Date.now();
  for (const [a, at] of state.granted) if (now - at > COOLDOWN_MS) state.granted.delete(a);
  if (state.inflight.has(address) || state.granted.has(address)) {
    throw new HttpError(429, "RATE_LIMITED", "This address just received tEURC; try again in a minute");
  }
  state.inflight.add(address);
  try {
    const { txHash } = await faucetTeurc(address, AMOUNT);
    state.granted.set(address, Date.now());
    const body: TxResponse = { txHash, explorerUrl: explorerUrl("tx", txHash) };
    return jsonResponse(body);
  } finally {
    state.inflight.delete(address);
  }
});
