import { Keypair, scValToNative, type Transaction } from "@stellar/stellar-sdk/base";
import { beforeEach, describe, expect, it } from "vitest";

import { centsToStroops } from "../units";
import {
  convertToAssets,
  deposit,
  depositArgs,
  faucet,
  faucetArgs,
  liquiditySlack,
  previewDeposit,
  previewRedeem,
  previewWithdraw,
  readLivePosition,
  readMaxRedeem,
  readMaxWithdraw,
  readShareBalance,
  readTeurcBalance,
  redeem,
  redeemArgs,
  withdraw,
  withdrawArgs,
  withdrawMax,
  type PoolClient,
  type PoolSigner,
} from "./pool";
import { i128 } from "./soroban";
import {
  DEPLOYMENT,
  POOL_ID,
  TEURC_ID,
  accountEntry,
  asRpc,
  createMockRpc,
  invocationOf,
  keypairSigner,
  noEntries,
  simOk,
  wireHappyPath,
  type MockRpc,
} from "./testing/mock-rpc";

const INVESTOR = Keypair.random();
const ME = INVESTOR.publicKey();

let rpc: MockRpc;
let client: PoolClient;
let signer: PoolSigner;

beforeEach(() => {
  rpc = createMockRpc();
  client = { rpc: asRpc(rpc), deployment: DEPLOYMENT };
  signer = { ...client, source: ME, sign: keypairSigner(INVESTOR), sleep: async () => {} };
});

const natives = (args: { type: string }[]) => args.map((a) => scValToNative(a as never));
const lastSimulated = () => invocationOf(rpc.simulateTransaction.mock.calls.at(-1)![0] as Transaction);
const sent = () => invocationOf(rpc.sendTransaction.mock.calls[0][0] as Transaction);

describe("argument lists follow the SEP-56 signatures", () => {
  const OTHER = Keypair.random().publicKey();
  it("deposit(assets, receiver, from, operator)", () => {
    const args = depositArgs(12_345n, ME, OTHER, ME);
    expect(args.map((a) => a.type)).toEqual(["scvI128", "scvAddress", "scvAddress", "scvAddress"]);
    expect(natives(args)).toEqual([12_345n, ME, OTHER, ME]);
  });
  it("withdraw(assets, receiver, owner, operator) and redeem(shares, receiver, owner, operator)", () => {
    expect(natives(withdrawArgs(5n, OTHER, ME, ME))).toEqual([5n, OTHER, ME, ME]);
    expect(natives(redeemArgs(7n, ME, OTHER, ME))).toEqual([7n, ME, OTHER, ME]);
  });
  it("faucet(to, amount)", () => {
    const args = faucetArgs(ME, 100_000_000_000n);
    expect(args.map((a) => a.type)).toEqual(["scvAddress", "scvI128"]);
    expect(natives(args)).toEqual([ME, 100_000_000_000n]);
  });
});

describe("views", () => {
  it.each([
    ["balance", () => readShareBalance(client, ME), POOL_ID, [ME]],
    ["balance", () => readTeurcBalance(client, ME), TEURC_ID, [ME]],
    ["preview_deposit", () => previewDeposit(client, 1_000n), POOL_ID, [1_000n]],
    ["preview_withdraw", () => previewWithdraw(client, 2_000n), POOL_ID, [2_000n]],
    ["preview_redeem", () => previewRedeem(client, 3_000n), POOL_ID, [3_000n]],
    ["max_withdraw", () => readMaxWithdraw(client, ME), POOL_ID, [ME]],
    ["max_redeem", () => readMaxRedeem(client, ME), POOL_ID, [ME]],
    ["convert_to_assets", () => convertToAssets(client, 4_000n), POOL_ID, [4_000n]],
  ] as const)("%s targets the right contract", async (method, call, contractId, args) => {
    rpc.simulateTransaction.mockResolvedValue(simOk(i128(31_337n)));
    await expect(call()).resolves.toBe(31_337n);
    const inv = lastSimulated();
    expect(inv.method).toBe(method);
    expect(inv.contractId).toBe(contractId);
    expect(natives(inv.args)).toEqual(args);
  });

  it("reads the whole live position, converting shares to their value", async () => {
    rpc.getLedgerEntries.mockResolvedValue(accountEntry(5n, 98_000_000_000n));
    rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
      const { method, contractId } = invocationOf(tx);
      const values: Record<string, bigint> = {
        [`${POOL_ID}:balance`]: 1_000_000_000n,
        [`${POOL_ID}:max_withdraw`]: 900_000_000n,
        [`${POOL_ID}:max_redeem`]: 950_000_000n,
        [`${TEURC_ID}:balance`]: 100_000_000_000n,
        [`${POOL_ID}:convert_to_assets`]: 1_052_000_000n,
      };
      return simOk(i128(values[`${contractId}:${method}`]));
    });
    await expect(readLivePosition(client, ME)).resolves.toEqual({
      shares: 1_000_000_000n,
      value: 1_052_000_000n,
      maxWithdraw: 900_000_000n,
      maxRedeem: 950_000_000n,
      teurc: 100_000_000_000n,
      xlm: 98_000_000_000n,
    });
  });

  it("skips convert_to_assets without shares and reports an unfunded account as xlm: null", async () => {
    rpc.getLedgerEntries.mockResolvedValue(noEntries());
    rpc.simulateTransaction.mockResolvedValue(simOk(i128(0n)));
    const live = await readLivePosition(client, ME);
    expect(live).toMatchObject({ shares: 0n, value: 0n, xlm: null });
    const methods = rpc.simulateTransaction.mock.calls.map(([tx]) => invocationOf(tx as Transaction).method);
    expect(methods).not.toContain("convert_to_assets");
  });
});

describe("writes", () => {
  it("deposits euros converted to stroops, with the investor in every role", async () => {
    wireHappyPath(rpc, { returnValue: i128(4_987_000_000n) });
    const assets = centsToStroops(500_000n); // €5,000.00
    const res = await deposit(signer, assets);
    expect(res).toMatchObject({ shares: 4_987_000_000n, assets: 50_000_000_000n });
    expect(res.txHash).toMatch(/^[0-9a-f]{64}$/);
    const inv = sent();
    expect(inv).toMatchObject({ contractId: POOL_ID, method: "deposit" });
    expect(natives(inv.args)).toEqual([50_000_000_000n, ME, ME, ME]);
  });

  it("withdraws exact assets and reports the shares burned", async () => {
    wireHappyPath(rpc, { returnValue: i128(1_900_000_000n) });
    const res = await withdraw(signer, 2_000_000_000n);
    expect(res).toMatchObject({ shares: 1_900_000_000n, assets: 2_000_000_000n });
    expect(natives(sent().args)).toEqual([2_000_000_000n, ME, ME, ME]);
    expect(sent().method).toBe("withdraw");
  });

  it("redeems exact shares and reports the assets paid", async () => {
    wireHappyPath(rpc, { returnValue: i128(1_052_631_578n) });
    const res = await redeem(signer, 1_000_000_000n);
    expect(res).toMatchObject({ shares: 1_000_000_000n, assets: 1_052_631_578n });
    expect(sent().method).toBe("redeem");
    expect(natives(sent().args)).toEqual([1_000_000_000n, ME, ME, ME]);
  });

  describe("withdrawMax", () => {
    function wireReads(values: { balance: bigint; max_redeem: bigint; max_withdraw: bigint }, returnValue: bigint) {
      wireHappyPath(rpc, { returnValue: i128(returnValue) });
      rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
        const { method } = invocationOf(tx);
        return simOk(i128(method in values ? values[method as keyof typeof values] : returnValue));
      });
    }

    it("redeems every share when liquidity allows a full exit (exact, no dust)", async () => {
      wireReads({ balance: 1_000_000_000n, max_redeem: 1_000_000_000n, max_withdraw: 1_052_000_000n }, 1_052_000_000n);
      const res = await withdrawMax(signer, 328_311n);
      expect(sent().method).toBe("redeem");
      expect(natives(sent().args)).toEqual([1_000_000_000n, ME, ME, ME]);
      expect(res).toMatchObject({ shares: 1_000_000_000n, assets: 1_052_000_000n });
    });

    it("withdraws max_withdraw minus the slack when liquidity caps the exit", async () => {
      wireReads({ balance: 1_000_000_000n, max_redeem: 400_000_000n, max_withdraw: 420_000_000n }, 399_000_000n);
      await withdrawMax(signer, 328_311n);
      expect(sent().method).toBe("withdraw");
      expect(natives(sent().args)).toEqual([420_000_000n - 328_311n, ME, ME, ME]);
    });

    it("refuses when there is nothing to withdraw", async () => {
      wireReads({ balance: 1_000_000_000n, max_redeem: 0n, max_withdraw: 200_000n }, 0n);
      await expect(withdrawMax(signer, 328_311n)).rejects.toMatchObject({ code: "CONTRACT_ERROR", contractCode: 5 });
      wireReads({ balance: 0n, max_redeem: 0n, max_withdraw: 0n }, 0n);
      await expect(withdrawMax(signer, 328_311n)).rejects.toMatchObject({ code: "WALLET_ERROR" });
      expect(rpc.sendTransaction).not.toHaveBeenCalled();
    });
  });

  it("sizes the liquidity slack as ten minutes of protocol fees plus a cent", () => {
    // €100,000 debt × 12% × 10% = €1,200 of fees a year → €0.0228 per 10 minutes.
    expect(liquiditySlack(1_000_000_000_000n, { agentAprBps: 1200, protocolFeeBps: 1000 })).toBe(228_310n + 1n + 100_000n);
    expect(liquiditySlack(0n, { agentAprBps: 1200, protocolFeeBps: 1000 })).toBe(100_001n);
  });

  it("calls teurc.faucet for the investor", async () => {
    wireHappyPath(rpc);
    await faucet(signer, 100_000_000_000n);
    expect(sent()).toMatchObject({ contractId: TEURC_ID, method: "faucet" });
    expect(natives(sent().args)).toEqual([ME, 100_000_000_000n]);
  });
});
