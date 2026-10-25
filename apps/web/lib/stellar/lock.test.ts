import { describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn(async () => 1);
const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts: unknown) => fn({ $executeRaw: executeRaw }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => transaction(fn, opts) } }));

const { advisoryLockKey, inProcessMutex, withAccountLock } = await import("./lock");

describe("advisoryLockKey", () => {
  it("is a stable signed 64-bit key per account", () => {
    const k = advisoryLockKey("GABC");
    expect(k).toBe(advisoryLockKey("GABC"));
    expect(k).not.toBe(advisoryLockKey("GABD"));
    expect(k >= -(2n ** 63n) && k < 2n ** 63n).toBe(true);
  });
});

describe("inProcessMutex", () => {
  it("runs callers one at a time and survives a failing holder", async () => {
    const log: string[] = [];
    const task = (name: string, fail = false) =>
      inProcessMutex("acct", async () => {
        log.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, 2));
        log.push(`${name}:end`);
        if (fail) throw new Error(name);
        return name;
      });
    const results = await Promise.allSettled([task("a"), task("b", true), task("c")]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });
});

describe("withAccountLock", () => {
  it("takes pg_advisory_xact_lock(key) inside a transaction before running", async () => {
    const result = await withAccountLock("GXYZ", async () => {
      expect(executeRaw).toHaveBeenCalledTimes(1);
      return 42;
    });
    expect(result).toBe(42);
    const [strings, key] = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, bigint];
    expect(strings.join("?")).toBe("SELECT pg_advisory_xact_lock(?)");
    expect(key).toBe(advisoryLockKey("GXYZ"));
    expect(transaction.mock.calls[0][1]).toMatchObject({ timeout: 180_000 });
  });
});
