import { Keypair, scValToNative, type Transaction } from "@stellar/stellar-sdk/base";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FAUCET_AMOUNT, FAUCET_FALLBACK_ENDPOINT, FRIENDBOT_URL } from "./constants";
import { WalletError } from "./errors";
import { fundWithFriendbot, getTestEurc, serverFaucet } from "./faucet";
import type { PoolSigner } from "./pool";
import { DEPLOYMENT, TEURC_ID, asRpc, createMockRpc, invocationOf, keypairSigner, noEntries, wireHappyPath, type MockRpc } from "./testing/mock-rpc";

const INVESTOR = Keypair.random();
const ME = INVESTOR.publicKey();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let rpc: MockRpc;
let signer: PoolSigner;
beforeEach(() => {
  rpc = createMockRpc();
  signer = { rpc: asRpc(rpc), deployment: DEPLOYMENT, source: ME, sign: keypairSigner(INVESTOR), sleep: async () => {} };
});

describe("fundWithFriendbot", () => {
  it("funds a new account", async () => {
    const fetchImpl = vi.fn(async () => json(200, { hash: "abc123" }));
    await expect(fundWithFriendbot(ME, fetchImpl)).resolves.toEqual({ status: "funded", txHash: "abc123" });
    expect(fetchImpl).toHaveBeenCalledWith(`${FRIENDBOT_URL}/?addr=${ME}`);
  });

  it("treats an already funded account as success", async () => {
    const fetchImpl = vi.fn(async () => json(400, { status: 400, detail: "account already funded to starting balance" }));
    await expect(fundWithFriendbot(ME, fetchImpl)).resolves.toEqual({ status: "already-funded" });
  });

  it("reports other failures", async () => {
    await expect(fundWithFriendbot(ME, vi.fn(async () => json(500, { detail: "friendbot is down" })))).rejects.toThrow(/friendbot is down/);
    await expect(fundWithFriendbot(ME, vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))))).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("serverFaucet", () => {
  it("posts the address and returns the transaction", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(200, { txHash: "f00d", explorerUrl: "https://stellar.expert/explorer/testnet/tx/f00d" }));
    await expect(serverFaucet(ME, fetchImpl)).resolves.toEqual({ txHash: "f00d", explorerUrl: "https://stellar.expert/explorer/testnet/tx/f00d" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(FAUCET_FALLBACK_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ address: ME });
  });

  it("surfaces the API error message", async () => {
    const fetchImpl = vi.fn(async () => json(429, { error: { code: "RATE_LIMITED", message: "This address just received tEURC; try again in a minute" } }));
    await expect(serverFaucet(ME, fetchImpl)).rejects.toThrow(/try again in a minute/);
  });
});

describe("getTestEurc", () => {
  it("signs teurc.faucet in Freighter for 10,000 tEURC", async () => {
    wireHappyPath(rpc);
    const fetchImpl = vi.fn();
    const res = await getTestEurc({ signer, fetchImpl });
    expect(res.via).toBe("freighter");
    expect(fetchImpl).not.toHaveBeenCalled();
    const inv = invocationOf(rpc.sendTransaction.mock.calls[0][0] as Transaction);
    expect(inv).toMatchObject({ contractId: TEURC_ID, method: "faucet" });
    expect(scValToNative(inv.args[1])).toBe(FAUCET_AMOUNT);
    expect(FAUCET_AMOUNT).toBe(100_000_000_000n);
  });

  it("falls back to the server faucet when the Freighter path fails", async () => {
    rpc.getLedgerEntries.mockResolvedValue(noEntries()); // no XLM yet: the investor can't pay fees
    const fetchImpl = vi.fn(async () => json(200, { txHash: "beef", explorerUrl: "" }));
    const onFallback = vi.fn();
    const res = await getTestEurc({ signer, fetchImpl, onFallback });
    expect(res).toMatchObject({ via: "server", txHash: "beef" });
    expect(res.fallbackReason).toMatch(/Get test XLM/);
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ code: "ACCOUNT_NOT_FUNDED" }));
  });

  it("respects a rejection in Freighter (no fallback)", async () => {
    wireHappyPath(rpc);
    const fetchImpl = vi.fn();
    const declining: PoolSigner = { ...signer, sign: async () => Promise.reject(new WalletError("USER_DECLINED", "You rejected the request in Freighter.")) };
    await expect(getTestEurc({ signer: declining, fetchImpl })).rejects.toMatchObject({ code: "USER_DECLINED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports both failures when the fallback fails too", async () => {
    rpc.getLedgerEntries.mockResolvedValue(noEntries());
    const fetchImpl = vi.fn(async () => json(503, { error: { code: "NOT_CONFIGURED", message: "OPERATOR_SECRET is not set" } }));
    const err = await getTestEurc({ signer, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(WalletError);
    expect(err.message).toMatch(/Get test XLM/);
    expect(err.message).toMatch(/OPERATOR_SECRET is not set/);
  });
});
