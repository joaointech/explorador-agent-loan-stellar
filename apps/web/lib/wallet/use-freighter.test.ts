import { describe, expect, it, vi } from "vitest";

import { TESTNET_PASSPHRASE } from "./constants";
import { WalletError } from "./errors";
import type { FreighterSession } from "./freighter";
import { createFreighterStore, type FreighterDeps } from "./use-freighter";

const ADDRESS = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TESTNET = { network: "TESTNET", passphrase: TESTNET_PASSPHRASE };
const MAINNET = { network: "PUBLIC", passphrase: "Public Global Stellar Network ; September 2015" };
const session = (address = ADDRESS, network = TESTNET): FreighterSession => ({ address, network });

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(overrides: Partial<FreighterDeps> = {}) {
  let onChange: ((s: FreighterSession | null) => void) | null = null;
  const stopWatch = vi.fn();
  let preference: string | null = null;
  const deps: FreighterDeps = {
    detect: vi.fn(async () => true),
    restore: vi.fn(async () => null),
    connect: vi.fn(async () => session()),
    watch: vi.fn((cb) => {
      onChange = cb;
      return stopWatch;
    }),
    readPreference: () => preference,
    writePreference: vi.fn((v) => {
      preference = v;
    }),
    ...overrides,
  };
  const store = createFreighterStore(deps);
  const listener = vi.fn();
  return { store, deps, listener, stopWatch, emit: (s: FreighterSession | null) => onChange?.(s), setPreference: (v: string | null) => (preference = v) };
}

describe("createFreighterStore", () => {
  it("starts in `checking` and reports a missing extension", async () => {
    const { store, listener } = setup({ detect: vi.fn(async () => false) });
    expect(store.getState().status).toBe("checking");
    store.subscribe(listener);
    await flush();
    expect(store.getState().status).toBe("unavailable");
    expect(listener).toHaveBeenCalled();
  });

  it("restores an allowed session on the first subscription and watches it", async () => {
    const { store, deps, listener } = setup({ restore: vi.fn(async () => session()) });
    store.subscribe(listener);
    await flush();
    expect(store.getState()).toMatchObject({ status: "connected", address: ADDRESS, network: TESTNET });
    expect(deps.watch).toHaveBeenCalledTimes(1);
  });

  it("stays disconnected after an explicit disconnect, even if Freighter still allows the site", async () => {
    const { store, deps, listener, setPreference } = setup({ restore: vi.fn(async () => session()) });
    setPreference("disconnected");
    store.subscribe(listener);
    await flush();
    expect(store.getState().status).toBe("disconnected");
    expect(deps.restore).not.toHaveBeenCalled();
  });

  it("connects, remembers the choice, and follows account and network switches", async () => {
    const { store, deps, listener, emit } = setup();
    store.subscribe(listener);
    await flush();
    expect(store.getState().status).toBe("disconnected");

    const pending = store.connect();
    expect(store.getState().status).toBe("connecting");
    await pending;
    expect(store.getState()).toMatchObject({ status: "connected", address: ADDRESS });
    expect(deps.writePreference).toHaveBeenCalledWith("connected");

    emit(session(ADDRESS, MAINNET));
    expect(store.getState().network).toEqual(MAINNET);
    emit(session(OTHER, MAINNET));
    expect(store.getState().address).toBe(OTHER);
    const calls = listener.mock.calls.length;
    emit(session(OTHER, MAINNET)); // no change, no re-render
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("drops to disconnected when Freighter stops sharing the address", async () => {
    const { store, listener, emit, stopWatch } = setup({ restore: vi.fn(async () => session()) });
    store.subscribe(listener);
    await flush();
    emit(null);
    expect(store.getState().status).toBe("disconnected");
    expect(stopWatch).toHaveBeenCalled();
  });

  it("shows why a connection failed", async () => {
    const { store, listener } = setup({
      connect: vi.fn(async () => Promise.reject(new WalletError("USER_DECLINED", "You rejected the request in Freighter."))),
    });
    store.subscribe(listener);
    await flush();
    await store.connect();
    expect(store.getState()).toMatchObject({ status: "disconnected", error: "You rejected the request in Freighter." });
  });

  it("lets a disconnect win over a connection that resolves later", async () => {
    let resolveConnect: (s: FreighterSession) => void = () => {};
    const { store, listener } = setup({ connect: vi.fn(() => new Promise<FreighterSession>((r) => (resolveConnect = r))) });
    store.subscribe(listener);
    await flush();
    const pending = store.connect();
    await flush();
    store.disconnect();
    resolveConnect(session());
    await pending;
    expect(store.getState().status).toBe("disconnected");
  });

  it("stops watching when the last subscriber leaves", async () => {
    const { store, listener, stopWatch } = setup({ restore: vi.fn(async () => session()) });
    const unsubscribe = store.subscribe(listener);
    await flush();
    unsubscribe();
    expect(stopWatch).toHaveBeenCalled();
  });
});
