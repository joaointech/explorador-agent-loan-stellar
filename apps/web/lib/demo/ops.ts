// Building blocks shared by the seed and the e2e: investor funding + SEP-56
// deposits, seed card spends (spec §11.2: `card_draw` called directly plus a
// CardAuthorization row with the merchant name, independent of the ASA
// endpoint), and the demo clock.

import { randomUUID } from "node:crypto";

import type { Keypair } from "@stellar/stellar-sdk";

import { authRefFor } from "@/lib/card/draw";
import { db } from "@/lib/db";
import { advanceClock, cardDraw, readProtocolNow, type TxSourceOptions } from "@/lib/stellar/contracts";
import { requireDeployment } from "@/lib/stellar/deployment";
import { invokeContract } from "@/lib/stellar/invoke";
import { asBigInt, scAddress, scI128 } from "@/lib/stellar/scval";
import { DAY_SECS, STROOPS_PER_CENT, STROOPS_PER_EUR, unixToDay } from "@/lib/units";

import { ensureXlm, type Log } from "./accounts";

/** teurc.faucet cap per call (spec §7.1). */
const FAUCET_MAX = 25_000n * STROOPS_PER_EUR;

export const eur = (value: number): bigint => BigInt(Math.round(value * 100)) * STROOPS_PER_CENT;
export const fmtEur = (stroops: bigint): string =>
  `€${(Number(stroops) / 1e7).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Faucets `amount` tEURC to the investor (≤ 25,000 per call) and deposits it into the senior vault, signed by the investor. */
export async function investorDeposit(investor: Keypair, amount: bigint, log: Log): Promise<{ shares: bigint; txHash: string }> {
  const d = await requireDeployment();
  const address = investor.publicKey();
  await ensureXlm(address, 500, log);
  for (let left = amount; left > 0n; ) {
    const chunk = left > FAUCET_MAX ? FAUCET_MAX : left;
    await invokeContract({ contractId: d.info.teurc, fn: "faucet", args: [scAddress(address), scI128(chunk)], source: investor });
    left -= chunk;
  }
  const res = await invokeContract({
    contractId: d.info.advancePool,
    fn: "deposit",
    args: [scI128(amount), scAddress(address), scAddress(address), scAddress(address)],
    source: investor,
    decode: (v) => asBigInt(v, "deposit"),
  });
  return { shares: res.result, txHash: res.txHash };
}

export interface CardSpend {
  id: string;
  txHash: string;
  fromBalance: bigint;
  fromCredit: bigint;
}

/** A seed card purchase: `card_draw` with auth_ref = sha256(token), then the CardAuthorization row (CONFIRMED, with the split). */
export async function seedCardSpend(agent: { userId: string; smartAccount: string }, amountEur: number, merchant: string, tx: TxSourceOptions = {}): Promise<CardSpend> {
  const amountCents = BigInt(Math.round(amountEur * 100));
  const token = `seed_txn_${randomUUID()}`;
  const res = await cardDraw(agent.smartAccount, amountCents * STROOPS_PER_CENT, authRefFor(token), tx);
  const row = await db.cardAuthorization.create({
    data: {
      lithicToken: token,
      agentId: agent.userId,
      amountCents,
      merchant,
      decision: "APPROVED",
      chainStatus: "CONFIRMED",
      fromBalanceStroops: res.result.fromBalance,
      fromCreditStroops: res.result.fromCredit,
      txHash: res.txHash,
      attempts: 1,
    },
  });
  return { id: row.id, txHash: res.txHash, fromBalance: res.result.fromBalance, fromCredit: res.result.fromCredit };
}

/** Protocol day (days since the epoch on the protocol clock). */
export const protocolToday = async (): Promise<number> => unixToDay(await readProtocolNow());

/** `advance_clock(days)` (admin-signed; demo mode only). Returns the new protocol day. */
export async function fastForward(days: number, tx: TxSourceOptions = {}): Promise<{ day: number; txHash: string }> {
  const res = await advanceClock(days * DAY_SECS, tx);
  return { day: await protocolToday(), txHash: res.txHash };
}
