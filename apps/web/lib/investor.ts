// Investor (Freighter) side of the senior vault (§4.1): position, previews and unsigned txs.
import { Address, Contract, rpc, StrKey, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-sdk";
import type { InvestorHistoryItem, InvestorResponse, InvestorTxAction, TxPrepareResponse, TxSubmitResponse } from "@/lib/api-types";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { readStats, statsDto } from "@/lib/pool";
import { encodeArgs, readContract, waitForTx } from "@/lib/stellar/client";
import { contractId, getContracts, type ContractName } from "@/lib/stellar/contracts";
import { decodeContractError } from "@/lib/stellar/errors";
import { rpcServer } from "@/lib/stellar/network";

export const FAUCET_AMOUNT = 10_000n * 10_000_000n;

export function assertAccount(address: string) {
  if (!StrKey.isValidEd25519PublicKey(address)) throw new HttpError(400, "VALIDATION", "Expected a Stellar G… account address");
}

async function nativeBalance(address: string): Promise<string | null> {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(address)) }));
  const r = await rpcServer().getLedgerEntries(key);
  const entry = r.entries[0];
  if (!entry) return null;
  const stroops = BigInt(entry.val.account().balance().toString());
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export async function investorPosition(address: string): Promise<InvestorResponse> {
  assertAccount(address);
  const [xlm, teurc, shares, maxWithdraw, maxRedeem, st] = await Promise.all([
    nativeBalance(address),
    readContract<bigint>("teurc", "balance", { account: address }).catch(() => 0n),
    readContract<bigint>("advancePool", "balance", { account: address }).catch(() => 0n),
    readContract<bigint>("advancePool", "max_withdraw", { owner: address }).catch(() => 0n),
    readContract<bigint>("advancePool", "max_redeem", { owner: address }).catch(() => 0n),
    readStats(),
  ]);
  const value = shares > 0n ? await readContract<bigint>("advancePool", "convert_to_assets", { shares }) : 0n;
  const events = await db.chainEvent.findMany({
    where: {
      contract: "advancePool",
      OR: [
        { type: "deposit", data: { path: ["receiver"], equals: address } },
        { type: "withdraw", data: { path: ["owner"], equals: address } },
      ],
    },
    orderBy: [{ ledger: "desc" }, { eventIdx: "desc" }],
    take: 100,
  });
  let deposited = 0n;
  let withdrawn = 0n;
  const history: InvestorHistoryItem[] = events.map((e) => {
    const d = e.data as Record<string, string>;
    const assets = BigInt(d.assets ?? 0);
    if (e.type === "deposit") deposited += assets;
    else withdrawn += assets;
    return {
      type: e.type as "deposit" | "withdraw",
      assets: assets.toString(),
      shares: String(d.shares ?? "0"),
      txHash: e.txHash,
      ledger: e.ledger,
      createdAt: e.createdAt.toISOString(),
    };
  });
  // Share conversions round down, so a fresh deposit is worth a few stroops less; hide sub-cent dust.
  const earnedRaw = BigInt(value) + withdrawn - deposited;
  const earned = earnedRaw > -100_000n && earnedRaw < 0n ? 0n : earnedRaw;
  return {
    address,
    funded: xlm !== null,
    xlmBalance: xlm,
    teurcBalance: BigInt(teurc).toString(),
    shares: BigInt(shares).toString(),
    value: BigInt(value).toString(),
    deposited: deposited.toString(),
    withdrawn: withdrawn.toString(),
    earned: earned.toString(),
    sharePrice: statsDto(st).sharePrice,
    maxWithdraw: BigInt(maxWithdraw).toString(),
    maxRedeem: BigInt(maxRedeem).toString(),
    history,
  };
}

export async function preview(action: "deposit" | "withdraw" | "redeem", amount: bigint): Promise<bigint> {
  return readContract<bigint>("advancePool", `preview_${action}`, action === "redeem" ? { shares: amount } : { assets: amount });
}

function callFor(action: InvestorTxAction, address: string, amount: bigint): { name: ContractName; fn: string; args: Record<string, unknown> } {
  switch (action) {
    case "deposit":
      return { name: "advancePool", fn: "deposit", args: { assets: amount, receiver: address, from: address, operator: address } };
    case "withdraw":
      return { name: "advancePool", fn: "withdraw", args: { assets: amount, receiver: address, owner: address, operator: address } };
    case "redeem":
      return { name: "advancePool", fn: "redeem", args: { shares: amount, receiver: address, owner: address, operator: address } };
    case "faucet":
      return { name: "teurc", fn: "faucet", args: { to: address, amount } };
  }
}

/** Unsigned, simulated + assembled tx with the investor as source (signed in Freighter). */
export async function prepareInvestorTx(action: InvestorTxAction, address: string, amountStr?: string): Promise<TxPrepareResponse> {
  assertAccount(address);
  const amount = action === "faucet" ? BigInt(amountStr ?? FAUCET_AMOUNT) : BigInt(amountStr ?? "0");
  if (amount <= 0n) throw new HttpError(400, "VALIDATION", "Amount must be positive");
  const server = rpcServer();
  let account;
  try {
    account = await server.getAccount(address);
  } catch {
    throw new HttpError(400, "ACCOUNT_NOT_FUNDED", "This account does not exist on testnet yet — use “Get test XLM” first");
  }
  const { name, fn, args } = callFor(action, address, amount);
  const op = new Contract(await contractId(name)).call(fn, ...encodeArgs(name, fn, args));
  const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase: env.networkPassphrase }).addOperation(op).setTimeout(300).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    const err = decodeContractError(sim.error);
    throw new HttpError(400, err.code || "SIMULATION_FAILED", err.message);
  }
  return { xdr: rpc.assembleTransaction(tx, sim).build().toXDR(), networkPassphrase: env.networkPassphrase };
}

/** Relays a Freighter-signed tx; only calls into our own contracts are accepted. */
export async function submitSignedTx(signedXdr: string): Promise<TxSubmitResponse> {
  let tx: Transaction;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, env.networkPassphrase) as Transaction;
  } catch {
    throw new HttpError(400, "BAD_XDR", "Invalid transaction XDR");
  }
  const c = await getContracts();
  const ours = new Set([c.teurc, c.advancePool, c.cpcvNote]);
  const okOps = tx.operations.length === 1 && tx.operations[0].type === "invokeHostFunction";
  const hf = okOps ? (tx.operations[0] as unknown as { func: xdr.HostFunction }).func : null;
  const target = hf && hf.switch().name === "hostFunctionTypeInvokeContract" ? Address.fromScAddress(hf.invokeContract().contractAddress()).toString() : "";
  if (!ours.has(target)) throw new HttpError(400, "TX_REJECTED", "Only explorador advance contract calls can be relayed");

  const sent = await rpcServer().sendTransaction(tx);
  if (sent.status === "ERROR") {
    return { hash: sent.hash, status: "FAILED", error: sent.errorResult?.result().switch().name ?? "rejected" };
  }
  try {
    await waitForTx(sent.hash);
    return { hash: sent.hash, status: "SUCCESS" };
  } catch (e) {
    return { hash: sent.hash, status: "FAILED", error: e instanceof Error ? e.message : String(e) };
  }
}
