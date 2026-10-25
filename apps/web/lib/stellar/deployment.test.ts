import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTE_ID, POOL_ID, TEURC_ID } from "./fixtures";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst: (...args: unknown[]) => findFirst(...args) } } }));

const { getDeployment } = await import("./contracts");
const { invalidateDeploymentCache, requireDeployment, resolveDeployment } = await import("./deployment");

const ids = { teurc: TEURC_ID, cpcvNote: NOTE_ID, advancePool: POOL_ID };

let dir: string;
beforeEach(() => {
  invalidateDeploymentCache();
  findFirst.mockReset();
  dir = mkdtempSync(path.join(tmpdir(), "advance-deploy-"));
  vi.spyOn(process, "cwd").mockReturnValue(path.join(dir, "apps", "web"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function writeDeploymentFile(content: unknown) {
  mkdirSync(path.join(dir, "deployments"), { recursive: true });
  writeFileSync(path.join(dir, "deployments", "testnet.json"), JSON.stringify(content));
}

describe("getDeployment", () => {
  it("prefers the active Deployment row and adds network settings from env", async () => {
    const createdAt = new Date("2026-10-20T10:00:00Z");
    findFirst.mockResolvedValue({ id: "d1", network: "testnet", active: true, ...ids, wasmHashes: { teurc: "ab" }, createdAt });
    writeDeploymentFile({ network: "testnet", teurc: POOL_ID, cpcvNote: POOL_ID, advancePool: POOL_ID, wasmHashes: {} });

    expect(await getDeployment()).toEqual({
      network: "testnet",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      ...ids,
      explorerBase: "https://stellar.expert/explorer/testnet",
    });
    const resolved = await resolveDeployment();
    expect(resolved).toMatchObject({ source: "db", createdAt, key: `${TEURC_ID}:${NOTE_ID}:${POOL_ID}` });
    expect(findFirst).toHaveBeenCalledWith({ where: { active: true, network: "testnet" }, orderBy: { createdAt: "desc" } });
  });

  it("falls back to deployments/testnet.json (two levels up from apps/web)", async () => {
    findFirst.mockResolvedValue(null);
    writeDeploymentFile({ network: "testnet", ...ids, wasmHashes: { teurc: "aa", cpcvNote: "bb", advancePool: "cc" } });
    expect(await resolveDeployment()).toMatchObject({ source: "file", createdAt: null, info: ids });
  });

  it("falls back to the file when the database is unreachable", async () => {
    findFirst.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    writeDeploymentFile({ ...ids });
    expect((await resolveDeployment())?.source).toBe("file");
  });

  it("returns null (and requireDeployment throws 503 NOT_DEPLOYED) when nothing is deployed", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getDeployment()).toBeNull();
    await expect(requireDeployment()).rejects.toMatchObject({ status: 503, code: "NOT_DEPLOYED" });
  });

  it("ignores a file with invalid contract ids", async () => {
    findFirst.mockResolvedValue(null);
    writeDeploymentFile({ teurc: "nope", cpcvNote: NOTE_ID, advancePool: POOL_ID });
    expect(await resolveDeployment()).toBeNull();
  });

  it("caches for a few seconds; invalidateDeploymentCache forces a re-read", async () => {
    findFirst.mockResolvedValue({ id: "d1", network: "testnet", active: true, ...ids, wasmHashes: {}, createdAt: new Date() });
    await resolveDeployment();
    await resolveDeployment();
    expect(findFirst).toHaveBeenCalledTimes(1);
    invalidateDeploymentCache();
    await resolveDeployment();
    expect(findFirst).toHaveBeenCalledTimes(2);
    await resolveDeployment({ fresh: true });
    expect(findFirst).toHaveBeenCalledTimes(3);
  });
});
