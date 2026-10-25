import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { TESTNET_PASSPHRASE } from "./constants";

type WatchCallback = (p: { address: string; network: string; networkPassphrase: string; error?: { code: number; message: string } }) => void;

const api = vi.hoisted(() => ({
  isConnected: vi.fn(),
  isAllowed: vi.fn(),
  getAddress: vi.fn(),
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
  watchers: [] as { cb: WatchCallback | null; stop: Mock<() => void>; timeout: number }[],
}));

vi.mock("@stellar/freighter-api", () => ({
  isConnected: api.isConnected,
  isAllowed: api.isAllowed,
  getAddress: api.getAddress,
  requestAccess: api.requestAccess,
  getNetworkDetails: api.getNetworkDetails,
  signTransaction: api.signTransaction,
  WatchWalletChanges: class {
    entry: (typeof api.watchers)[number];
    constructor(timeout = 3000) {
      this.entry = { cb: null, stop: vi.fn<() => void>(), timeout };
      api.watchers.push(this.entry);
    }
    watch(cb: WatchCallback) {
      this.entry.cb = cb;
      return {};
    }
    stop() {
      this.entry.stop();
    }
  },
}));

const { connectFreighter, detectFreighter, freighterSigner, networkName, readFreighterNetwork, restoreFreighterSession, watchFreighter } = await import("./freighter");

const ADDRESS = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const TESTNET = { network: "TESTNET", networkUrl: "https://horizon-testnet.stellar.org", networkPassphrase: TESTNET_PASSPHRASE, sorobanRpcUrl: "https://soroban-testnet.stellar.org" };

beforeEach(() => {
  vi.clearAllMocks();
  api.watchers.length = 0;
  api.getNetworkDetails.mockResolvedValue(TESTNET);
});

describe("detectFreighter", () => {
  it("is true when the extension answers", async () => {
    api.isConnected.mockResolvedValue({ isConnected: true });
    await expect(detectFreighter()).resolves.toBe(true);
  });
  it("is false when it doesn't (or throws)", async () => {
    api.isConnected.mockResolvedValue({ isConnected: false });
    await expect(detectFreighter()).resolves.toBe(false);
    api.isConnected.mockRejectedValue(new Error("no extension"));
    await expect(detectFreighter()).resolves.toBe(false);
  });
});

describe("sessions", () => {
  it("restores an allowed session without prompting", async () => {
    api.isAllowed.mockResolvedValue({ isAllowed: true });
    api.getAddress.mockResolvedValue({ address: ADDRESS });
    await expect(restoreFreighterSession()).resolves.toEqual({
      address: ADDRESS,
      network: { network: "TESTNET", passphrase: TESTNET_PASSPHRASE, rpcUrl: "https://soroban-testnet.stellar.org" },
    });
    expect(api.requestAccess).not.toHaveBeenCalled();
  });

  it("returns null when the site isn't allowed yet", async () => {
    api.isAllowed.mockResolvedValue({ isAllowed: false });
    await expect(restoreFreighterSession()).resolves.toBeNull();
    expect(api.getAddress).not.toHaveBeenCalled();
  });

  it("connects through requestAccess", async () => {
    api.requestAccess.mockResolvedValue({ address: ADDRESS });
    await expect(connectFreighter()).resolves.toMatchObject({ address: ADDRESS, network: { passphrase: TESTNET_PASSPHRASE } });
  });

  it("maps a rejected connection and an empty address", async () => {
    api.requestAccess.mockResolvedValue({ address: "", error: { code: -4, message: "The user rejected this request." } });
    await expect(connectFreighter()).rejects.toMatchObject({ code: "USER_DECLINED" });
    api.requestAccess.mockResolvedValue({ address: "" });
    await expect(connectFreighter()).rejects.toMatchObject({ code: "WALLET_ERROR" });
  });

  it("reads the network or reports Freighter's error", async () => {
    await expect(readFreighterNetwork()).resolves.toMatchObject({ network: "TESTNET" });
    api.getNetworkDetails.mockResolvedValue({ network: "", networkUrl: "", networkPassphrase: "", error: { code: -1, message: "locked" } });
    await expect(readFreighterNetwork()).rejects.toThrow(/locked/);
  });
});

describe("freighterSigner", () => {
  it("passes the passphrase and account, and returns the signed envelope", async () => {
    api.signTransaction.mockResolvedValue({ signedTxXdr: "SIGNED", signerAddress: ADDRESS });
    await expect(freighterSigner("UNSIGNED", { networkPassphrase: TESTNET_PASSPHRASE, address: ADDRESS })).resolves.toBe("SIGNED");
    expect(api.signTransaction).toHaveBeenCalledWith("UNSIGNED", { networkPassphrase: TESTNET_PASSPHRASE, address: ADDRESS });
  });

  it("maps a rejection", async () => {
    api.signTransaction.mockResolvedValue({ signedTxXdr: "", signerAddress: "", error: { code: -4, message: "The user rejected this request." } });
    await expect(freighterSigner("X", { networkPassphrase: TESTNET_PASSPHRASE, address: ADDRESS })).rejects.toMatchObject({ code: "USER_DECLINED" });
  });
});

describe("watchFreighter", () => {
  it("reports account and network switches, and a lost session after two empty replies", () => {
    const onChange = vi.fn();
    const stop = watchFreighter(onChange, 1_000);
    const { cb, timeout } = api.watchers[0];
    expect(timeout).toBe(1_000);
    cb!({ address: ADDRESS, network: "PUBLIC", networkPassphrase: "Public Global Stellar Network ; September 2015" });
    expect(onChange).toHaveBeenLastCalledWith({ address: ADDRESS, network: { network: "PUBLIC", passphrase: "Public Global Stellar Network ; September 2015" } });
    cb!({ address: "", network: "", networkPassphrase: "" });
    expect(onChange).toHaveBeenCalledTimes(1);
    cb!({ address: "", network: "", networkPassphrase: "" });
    expect(onChange).toHaveBeenLastCalledWith(null);
    cb!({ address: "", network: "", networkPassphrase: "", error: { code: -1, message: "x" } });
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    expect(api.watchers[0].stop).toHaveBeenCalled();
  });
});

describe("networkName", () => {
  it("names well-known passphrases", () => {
    expect(networkName({ network: "TESTNET", passphrase: TESTNET_PASSPHRASE })).toBe("Testnet");
    expect(networkName({ network: "PUBLIC", passphrase: "Public Global Stellar Network ; September 2015" })).toBe("Mainnet");
    expect(networkName({ network: "CUSTOM", passphrase: "My Net" })).toBe("Custom");
    expect(networkName(null)).toBe("unknown network");
  });
});
