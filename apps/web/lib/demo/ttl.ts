// TTL housekeeping for the deployed contracts. Every contract call extends its
// instance (and with it the contract code) to ~30 days once the TTL drops below
// ~15 days (spec §7). On today's testnet that extension is very expensive for
// the code entries (thousands of XLM for advance_pool's 55 KB), so the deploy
// tooling can pre-extend code and instances in one admin-paid transaction
// instead of leaving the bill to the first card draw after day 15.

import { Address, Operation, SorobanDataBuilder, TransactionBuilder, rpc, xdr, type Keypair } from "@stellar/stellar-sdk";

import { networkConfig } from "@/lib/stellar/config";
import { parseHostError } from "@/lib/stellar/errors";
import { getRpc, rpcCall } from "@/lib/stellar/rpc";

import { ensureXlm, STROOPS_PER_XLM, type Log } from "./accounts";
import { sorobanEnvelope } from "./tx";

export const LEDGERS_PER_DAY = 17_280;

export interface TtlEntry {
  label: string;
  key: xdr.LedgerKey;
}

export interface TtlInfo {
  label: string;
  liveUntilLedger: number | null;
  daysLeft: number | null;
  sizeBytes: number;
}

export const codeEntry = (label: string, hashHex: string): TtlEntry => ({
  label,
  key: xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(hashHex, "hex") })),
});

export const instanceEntry = (label: string, contractId: string): TtlEntry => ({
  label,
  key: xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  ),
});

export async function readTtls(entries: TtlEntry[]): Promise<{ latestLedger: number; entries: TtlInfo[] }> {
  const res = await rpcCall("getLedgerEntries", () => getRpc().getLedgerEntries(...entries.map((e) => e.key)));
  const byKey = new Map(res.entries.map((e) => [e.key.toXDR("base64"), e]));
  return {
    latestLedger: res.latestLedger,
    entries: entries.map((e) => {
      const found = byKey.get(e.key.toXDR("base64"));
      const until = found?.liveUntilLedgerSeq ?? null;
      return {
        label: e.label,
        liveUntilLedger: until,
        daysLeft: until === null ? null : (until - res.latestLedger) / LEDGERS_PER_DAY,
        sizeBytes: found ? found.val.toXDR().length : 0,
      };
    }),
  };
}

/** Extends every entry to live at least `days` more days (ExtendFootprintTTL, paid by `source`, fee-bumped if needed). */
export async function extendTtls(entries: TtlEntry[], days: number, source: Keypair, log: Log): Promise<{ txHash: string; feeStroops: bigint }> {
  const server = getRpc();
  const { networkPassphrase } = networkConfig();
  const extendTo = Math.round(days * LEDGERS_PER_DAY);
  const account = await rpcCall("getAccount", () => server.getAccount(source.publicKey()));
  const data = new SorobanDataBuilder().setReadOnly(entries.map((e) => e.key)).build();
  const draft = new TransactionBuilder(account, { fee: "10000", networkPassphrase })
    .setSorobanData(data)
    .addOperation(Operation.extendFootprintTtl({ extendTo }))
    .setTimeout(120)
    .build();
  const sim = await rpcCall("simulate extend_ttl", () => server.simulateTransaction(draft));
  if (rpc.Api.isSimulationError(sim)) throw parseHostError(sim.error, "extend_ttl");
  const simData = (sim as rpc.Api.SimulateTransactionSuccessResponse).transactionData.build();
  const fee = simData.resourceFee + 20_000n;
  log(`extend ${entries.length} entries to ${days} days: fee ${(Number(fee) / 1e7).toFixed(2)} XLM`);
  await ensureXlm(source.publicKey(), Number(fee / STROOPS_PER_XLM) + 100, log);
  const fresh = await rpcCall("getAccount", () => server.getAccount(source.publicKey()));
  const tx = sorobanEnvelope(source, fresh.sequenceNumber(), Operation.extendFootprintTtl({ extendTo }), simData);
  const sent = await rpcCall("send extend_ttl", () => server.sendTransaction(tx));
  if (sent.status === "ERROR") throw new Error(`extend_ttl rejected (${sent.errorResult?.result.type ?? "unknown"})`);
  const final = await server.pollTransaction(sent.hash, { attempts: 60 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`extend_ttl ${sent.hash} did not succeed (${final.status})`);
  return { txHash: sent.hash, feeStroops: fee };
}
