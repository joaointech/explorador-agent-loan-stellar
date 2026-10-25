// In-memory stand-in for the Prisma calls the auth code makes (User and
// EmailCode only), so auth tests run without Postgres. Supports equality,
// `null`, `{ lt, lte, gt, gte }` filters, `{ increment }` updates, `select`,
// single-key `orderBy`, unique violations (P2002) and batch transactions.
//
//   vi.mock("@/lib/db", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("@/lib/db")>()),
//     db: (await import("@/lib/auth/testing/fake-db")).fakeDb,
//   }));

import { randomUUID } from "node:crypto";

import { Prisma } from "@/lib/generated/prisma/client";

type Row = Record<string, unknown>;
type Args = { where?: Row; data?: Row; select?: Record<string, boolean>; orderBy?: Record<string, "asc" | "desc"> };

const toComparable = (value: unknown): number => (value instanceof Date ? value.getTime() : Number(value));

function matchesCondition(actual: unknown, condition: unknown): boolean {
  if (condition === null) return actual === null || actual === undefined;
  if (condition instanceof Date) return actual instanceof Date && actual.getTime() === condition.getTime();
  if (typeof condition === "object") {
    const { lt, lte, gt, gte } = condition as Record<string, unknown>;
    const a = toComparable(actual);
    if (lt !== undefined && !(a < toComparable(lt))) return false;
    if (lte !== undefined && !(a <= toComparable(lte))) return false;
    if (gt !== undefined && !(a > toComparable(gt))) return false;
    if (gte !== undefined && !(a >= toComparable(gte))) return false;
    return true;
  }
  return actual === condition;
}

const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([key, condition]) => matchesCondition(row[key], condition));

function applyData(row: Row, data: Row = {}) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date) && "increment" in value) {
      row[key] = Number(row[key]) + Number((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
}

function project(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

function sorted(rows: Row[], orderBy?: Args["orderBy"]): Row[] {
  if (!orderBy) return rows;
  const [key, direction] = Object.entries(orderBy)[0]!;
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((x, y) => (toComparable(x[key]) - toComparable(y[key])) * sign);
}

const uniqueViolation = (field: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${field}\`)`, {
    code: "P2002",
    clientVersion: "fake",
    meta: { target: [field] },
  });

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError("No record was found", { code: "P2025", clientVersion: "fake" });

// Methods are async but never await, so each call runs to completion
// immediately: `db.$transaction([a(), b()])` applies a then b, in order.
function createTable(defaults: () => Row, uniqueFields: string[]) {
  const rows: Row[] = [];
  return {
    rows,
    async findMany(args: Args = {}) {
      return sorted(rows.filter((r) => matches(r, args.where)), args.orderBy).map((r) => project(r, args.select));
    },
    async findFirst(args: Args = {}) {
      const row = sorted(rows.filter((r) => matches(r, args.where)), args.orderBy)[0];
      return row ? project(row, args.select) : null;
    },
    async findUnique(args: Args) {
      const row = rows.find((r) => matches(r, args.where));
      return row ? project(row, args.select) : null;
    },
    async findUniqueOrThrow(args: Args) {
      const row = rows.find((r) => matches(r, args.where));
      if (!row) throw notFound();
      return project(row, args.select);
    },
    async create(args: Args) {
      const row = { ...defaults(), ...args.data };
      for (const field of uniqueFields) {
        if (rows.some((r) => r[field] === row[field])) throw uniqueViolation(field);
      }
      rows.push(row);
      return project(row, args.select);
    },
    async update(args: Args) {
      const row = rows.find((r) => matches(r, args.where));
      if (!row) throw notFound();
      applyData(row, args.data);
      return project(row, args.select);
    },
    async updateMany(args: Args) {
      const hits = rows.filter((r) => matches(r, args.where));
      for (const row of hits) applyData(row, args.data);
      return { count: hits.length };
    },
    async deleteMany(args: Args = {}) {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i]!, args.where)) {
          rows.splice(i, 1);
          count++;
        }
      }
      return { count };
    },
    async count(args: Args = {}) {
      return rows.filter((r) => matches(r, args.where)).length;
    },
  };
}

function createFakeDb() {
  const user = createTable(() => ({ id: randomUUID(), displayName: null, createdAt: new Date() }), ["id", "email"]);
  const emailCode = createTable(
    () => ({ id: randomUUID(), consumedAt: null, attempts: 0, createdAt: new Date() }),
    ["id"],
  );
  const fake = {
    user,
    emailCode,
    async $transaction(arg: unknown) {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: typeof fake) => Promise<unknown>)(fake);
    },
    reset() {
      user.rows.length = 0;
      emailCode.rows.length = 0;
    },
  };
  return fake;
}

export type FakeDb = ReturnType<typeof createFakeDb>;

/** One shared instance per test file (vitest isolates modules per file); call `fakeDb.reset()` in `beforeEach`. */
export const fakeDb = createFakeDb();
