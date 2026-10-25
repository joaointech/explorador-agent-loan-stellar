import { Address, Keypair, type Operation, type Transaction, xdr } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT, NOTE_ID, POOL_ID, TEURC_ID, drawResultScVal, noteScVal, poolStatsScVal } from "./fixtures";

const TREASURY = Keypair.random();
const ADMIN = Keypair.random();

const invokeAsOperator = vi.fn();
vi.mock("./invoke", () => ({ invokeAsOperator: (...args: unknown[]) => invokeAsOperator(...args) }));
vi.mock("./config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./config")>();
  return { ...mod, treasuryKeypair: () => TREASURY, adminKeypair: () => ADMIN };
});
vi.mock("./deployment", () => ({
  resolveDeployment: async () => ({ info: { teurc: TEURC_ID, cpcvNote: NOTE_ID, advancePool: POOL_ID } }),
  requireDeployment: async () => ({ info: { teurc: TEURC_ID, cpcvNote: NOTE_ID, advancePool: POOL_ID } }),
}));
const simulateTransaction = vi.fn();
vi.mock("./rpc", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./rpc")>();
  return { ...mod, getRpc: () => ({ simulateTransaction }) };
});

const c = await import("./contracts");

/** The contract call inside the simulated transaction. */
function simulatedCall(): { contract: string; fn: string; args: xdr.ScVal[] } {
  const tx = simulateTransaction.mock.calls.at(-1)![0] as Transaction;
  const fn = (tx.operations[0] as Operation.InvokeHostFunction).func as unknown as { invokeContract: xdr.InvokeContractArgs };
  const call = fn.invokeContract;
  return { contract: Address.fromScAddress(call.contractAddress).toString(), fn: String(call.functionName), args: call.args };
}
const simReturns = (retval: xdr.ScVal) =>
  simulateTransaction.mockResolvedValue({ _parsed: true, id: "1", latestLedger: 1, events: [], minResourceFee: "0", result: { auth: [], retval } });

beforeEach(() => {
  invokeAsOperator.mockReset();
  invokeAsOperator.mockResolvedValue({ txHash: "ab".repeat(32), ledger: 10, result: undefined });
  simulateTransaction.mockReset();
});

describe("views", () => {
  it("readPoolStats simulates advance_pool.stats and decodes PoolStats", async () => {
    simReturns(poolStatsScVal());
    const stats = await c.readPoolStats({ timeoutMs: 1200 });
    expect(simulatedCall()).toMatchObject({ contract: POOL_ID, fn: "stats", args: [] });
    expect(stats.juniorAssets).toBe(100_000_000_000n);
  });

  it("readAgentPosition passes the agent address", async () => {
    simReturns(xdr.ScVal.scvVoid());
    await c.readAgentPosition(AGENT).catch(() => undefined);
    const call = simulatedCall();
    expect(call.fn).toBe("agent_position");
    expect(Address.fromScVal(call.args[0]).toString()).toBe(AGENT);
  });

  it("readNotes calls cpcv_note.list with the limit capped at 50", async () => {
    simReturns(xdr.ScVal.scvVec([noteScVal()]));
    const notes = await c.readNotes(0, 500);
    const call = simulatedCall();
    expect(call).toMatchObject({ contract: NOTE_ID, fn: "list" });
    expect(call.args.map((a) => (a as xdr.ScVal & { value: number }).value)).toEqual([0, 50]);
    expect(notes[0].agent).toBe(AGENT);
  });

  it("readNote / readShareBalance / readMaxWithdraw / readProtocolNow hit the right functions", async () => {
    simReturns(noteScVal({ id: 3 }));
    expect((await c.readNote(3)).id).toBe(3);
    expect(simulatedCall().fn).toBe("get");
    simReturns(xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 42n })));
    expect(await c.readShareBalance(AGENT)).toBe(42n);
    expect(simulatedCall()).toMatchObject({ contract: POOL_ID, fn: "balance" });
    expect(await c.readMaxWithdraw(AGENT)).toBe(42n);
    expect(simulatedCall().fn).toBe("max_withdraw");
    simReturns(xdr.ScVal.scvU64(1_792_000_000n));
    expect(await c.readProtocolNow()).toBe(1_792_000_000n);
  });

  it("maps a contract error to a typed HttpError", async () => {
    simulateTransaction.mockResolvedValue({ _parsed: true, id: "1", latestLedger: 1, events: [], error: "HostError: Error(Contract, #18)" });
    await expect(c.readNote(99)).rejects.toMatchObject({ status: 404, code: "UNKNOWN_NOTE" });
  });
});

describe("writes", () => {
  it("mintNote encodes the proof struct, cents as u64 and BytesN<32> values", async () => {
    invokeAsOperator.mockResolvedValue({ txHash: "h", ledger: 1, result: 7 });
    const res = await c.mintNote({
      to: AGENT,
      proof: { a: new Uint8Array(64), b: new Uint8Array(128), c: new Uint8Array(64) },
      totalCommissionCents: 1_500_000n,
      escrituraDay: 20_500,
      commitment: new Uint8Array(32).fill(1),
      nullifier: new Uint8Array(32).fill(2),
    });
    expect(res.result).toBe(7);
    const [contract, fn, args, opts] = invokeAsOperator.mock.calls[0];
    expect([contract, fn]).toEqual(["cpcvNote", "mint"]);
    expect((args as xdr.ScVal[]).map((a) => a.type)).toEqual(["scvAddress", "scvMap", "scvU64", "scvU32", "scvBytes", "scvBytes"]);
    const proof = (args[1] as xdr.ScVal & { map: xdr.ScMapEntry[] }).map;
    expect(proof.map((e) => String(e.key.value))).toEqual(["a", "b", "c"]);
    expect((args[2] as xdr.ScVal & { value: bigint }).value).toBe(1_500_000n);
    expect(opts.decode(xdr.ScVal.scvU32(7))).toBe(7);
  });

  it("mintNote rejects wrong-size proof bytes before touching the network", async () => {
    await expect(
      c.mintNote({ to: AGENT, proof: { a: new Uint8Array(63), b: new Uint8Array(128), c: new Uint8Array(64) }, totalCommissionCents: 1n, escrituraDay: 1, commitment: new Uint8Array(32), nullifier: new Uint8Array(32) }),
    ).rejects.toThrow(/expected 64 bytes/);
    expect(invokeAsOperator).not.toHaveBeenCalled();
  });

  it("cardDraw sends (agent, i128, BytesN<32>) and decodes DrawResult", async () => {
    await c.cardDraw(AGENT, 48_000_000n, new Uint8Array(32));
    const [contract, fn, args, opts] = invokeAsOperator.mock.calls[0];
    expect([contract, fn]).toEqual(["advancePool", "card_draw"]);
    expect((args as xdr.ScVal[]).map((a) => a.type)).toEqual(["scvAddress", "scvI128", "scvBytes"]);
    expect(opts.decode(drawResultScVal(10n, 20n))).toEqual({ fromBalance: 10n, fromCredit: 20n });
    await expect(c.cardDraw(AGENT, 0n, new Uint8Array(32))).rejects.toMatchObject({ status: 400 });
  });

  it("settle / junior / fees are co-signed by the treasury, advance_clock by the admin", async () => {
    await c.settleNote(1);
    await c.juniorDeposit(10n);
    await c.juniorWithdraw(10n);
    await c.claimFees(10n);
    await c.advanceClock(86_400);
    const calls = invokeAsOperator.mock.calls.map(([contract, fn, , opts]) => [contract, fn, opts?.extraSigners?.[0]?.publicKey()]);
    expect(calls).toEqual([
      ["advancePool", "settle", TREASURY.publicKey()],
      ["advancePool", "junior_deposit", TREASURY.publicKey()],
      ["advancePool", "junior_withdraw", TREASURY.publicKey()],
      ["advancePool", "claim_fees", TREASURY.publicKey()],
      ["advancePool", "advance_clock", ADMIN.publicKey()],
    ]);
    expect((invokeAsOperator.mock.calls[4][2][0] as xdr.ScVal).type).toBe("scvU64");
  });

  it("operator-only writes and the faucet", async () => {
    await c.cancelNote(2);
    await c.writeOff(AGENT);
    await c.setBlocked(AGENT, true);
    await c.faucetTeurc(AGENT, 100_000_000_000n);
    expect(invokeAsOperator.mock.calls.map(([contract, fn, , opts]) => [contract, fn, opts?.extraSigners])).toEqual([
      ["advancePool", "cancel", undefined],
      ["advancePool", "write_off", undefined],
      ["advancePool", "set_blocked", undefined],
      ["teurc", "faucet", undefined],
    ]);
  });
});

describe("explorerUrl", () => {
  it("links to stellar.expert testnet", () => {
    expect(c.explorerUrl("tx", "abc")).toBe("https://stellar.expert/explorer/testnet/tx/abc");
  });
});
