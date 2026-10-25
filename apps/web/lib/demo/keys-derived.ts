// Deterministic demo keys derived from DEMO_SIGNER_SEED (falls back to
// SPONSOR_SECRET, like the seed agents' demo signers): the two seed investors
// and the channel accounts the seed uses as transaction sources. Being
// deterministic, they are funded with Friendbot once and reused by every demo
// reset, so a reset needs no Friendbot round trips.

import { createHmac } from "node:crypto";

import { Keypair } from "@stellar/stellar-sdk";

import { env, requireEnv } from "@/lib/env";

function derive(purpose: string): Keypair {
  const secret = env().DEMO_SIGNER_SEED ?? requireEnv("SPONSOR_SECRET");
  return Keypair.fromRawEd25519Seed(createHmac("sha256", secret).update(`explorador-advance/${purpose}`).digest());
}

/** Seed investor `n` (spec §11.2: "two investors, generated keys, funded"). */
export const demoInvestorKeypair = (label: string | number): Keypair => derive(`demo-investor/v1/${label}`);

/**
 * Channel account `i`: pays fees for operator-authorized calls (the operator
 * signs its auth entry), so independent seed steps can run in parallel without
 * fighting over the operator's sequence number.
 */
export const channelKeypair = (i: number): Keypair => derive(`channel/v1/${i}`);
