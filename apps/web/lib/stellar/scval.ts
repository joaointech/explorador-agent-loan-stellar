// ScVal encoders and strict decoders for the contract types in spec §7.
// stellar-sdk 17 models xdr.ScVal as a discriminated union on `.type`.
// Decoders are strict about presence (a missing field is an error) and
// lenient about integer width (u32 vs u64 vs i128), since the contracts are
// built in parallel with this service.

import { Address, nativeToScVal, scValToBigInt, scvSortedMap, xdr } from "@stellar/stellar-sdk";

import { DecodeError } from "./errors";

type ScVal = xdr.ScVal;

// ---------- encoders ----------

/** G… account or C… contract address. */
export const scAddress = (address: string): ScVal => Address.fromString(address).toScVal();
export const scI128 = (value: bigint): ScVal => nativeToScVal(value, { type: "i128" });
export const scU32 = (value: number): ScVal => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`not a u32: ${value}`);
  return xdr.ScVal.scvU32(value);
};
export const scU64 = (value: bigint | number): ScVal => {
  const v = BigInt(value);
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new RangeError(`not a u64: ${value}`);
  return xdr.ScVal.scvU64(v);
};
export const scBool = (value: boolean): ScVal => xdr.ScVal.scvBool(value);

/** Bytes / BytesN<len>. */
export function scBytes(bytes: Uint8Array, len?: number): ScVal {
  if (len !== undefined && bytes.length !== len) throw new RangeError(`expected ${len} bytes, got ${bytes.length}`);
  return xdr.ScVal.scvBytes(Uint8Array.from(bytes));
}

/** A `#[contracttype]` struct: ScMap with symbol keys sorted by key. */
export function scStruct(fields: Record<string, ScVal>): ScVal {
  return scvSortedMap(Object.entries(fields).map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })));
}

/** A unit variant of a `#[contracttype]` enum: Vec[Symbol(name)]. */
export const scUnitEnum = (variant: string): ScVal => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant)]);

// ---------- decoders ----------

export const bytesToHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new RangeError(`not a hex string: ${hex}`);
  return Uint8Array.from(Buffer.from(clean, "hex"));
};

const fail = (ctx: string, expected: string, v: ScVal): never => {
  throw new DecodeError(`${ctx}: expected ${expected}, got ${v.type}`);
};

/** A struct (ScMap with symbol/string keys) as a key → value map. */
export function asStruct(v: ScVal, ctx: string): Map<string, ScVal> {
  if (v.type !== "scvMap") return fail(ctx, "a struct (map)", v);
  const out = new Map<string, ScVal>();
  for (const entry of v.map ?? []) {
    const key = entry.key;
    if (key.type !== "scvSymbol" && key.type !== "scvString") fail(`${ctx} key`, "a symbol", key);
    out.set(String(key.value), entry.val);
  }
  return out;
}

export function field(struct: Map<string, ScVal>, name: string, ctx: string): ScVal {
  const v = struct.get(name);
  if (v === undefined) throw new DecodeError(`${ctx}: missing field "${name}"`);
  return v;
}

const INT_TYPES = new Set(["scvU32", "scvI32", "scvU64", "scvI64", "scvU128", "scvI128", "scvU256", "scvI256", "scvTimepoint", "scvDuration"]);

/** Any Soroban integer as bigint. */
export function asBigInt(v: ScVal, ctx: string): bigint {
  switch (v.type) {
    case "scvU32":
    case "scvI32":
      return BigInt(v.value);
    case "scvU64":
    case "scvI64":
    case "scvTimepoint":
    case "scvDuration":
      return v.value;
    case "scvU128":
    case "scvI128":
    case "scvU256":
    case "scvI256":
      return scValToBigInt(v);
    default:
      return fail(ctx, "an integer", v);
  }
}

/** Any Soroban integer that fits in a JS safe integer, as number. */
export function asNumber(v: ScVal, ctx: string): number {
  const big = asBigInt(v, ctx);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new DecodeError(`${ctx}: ${big} does not fit in a number`);
  }
  return Number(big);
}

export function asBool(v: ScVal, ctx: string): boolean {
  if (v.type !== "scvBool") return fail(ctx, "a bool", v);
  return v.value;
}

export function asAddress(v: ScVal, ctx: string): string {
  if (v.type !== "scvAddress") return fail(ctx, "an address", v);
  return Address.fromScVal(v).toString();
}

export function asBytes(v: ScVal, ctx: string, len?: number): Uint8Array {
  if (v.type !== "scvBytes") return fail(ctx, "bytes", v);
  const bytes = Uint8Array.from(v.value.value);
  if (len !== undefined && bytes.length !== len) throw new DecodeError(`${ctx}: expected ${len} bytes, got ${bytes.length}`);
  return bytes;
}

export const asBytesHex = (v: ScVal, ctx: string, len?: number): string => bytesToHex(asBytes(v, ctx, len));

export function asString(v: ScVal, ctx: string): string {
  if (v.type !== "scvString" && v.type !== "scvSymbol") return fail(ctx, "a string", v);
  return String(v.value);
}

export function asVec(v: ScVal, ctx: string): ScVal[] {
  if (v.type !== "scvVec") return fail(ctx, "a vec", v);
  return v.vec ?? [];
}

/** `Option<T>`: Void → null. A missing struct field is not accepted here (use `optionalField`). */
export function asOption<T>(v: ScVal, ctx: string, inner: (v: ScVal, ctx: string) => T): T | null {
  return v.type === "scvVoid" ? null : inner(v, ctx);
}

/**
 * A unit-variant `#[contracttype]` enum. Canonical encoding is Vec[Symbol];
 * a bare Symbol and a u32 discriminant (`#[repr(u32)]` enums) are accepted too.
 */
export function asEnum<T extends string>(v: ScVal, variants: readonly T[], ctx: string): T {
  let name: string | undefined;
  if (v.type === "scvVec" && v.vec?.length === 1 && v.vec[0].type === "scvSymbol") name = String(v.vec[0].value);
  else if (v.type === "scvSymbol") name = String(v.value);
  else if (v.type === "scvU32") name = variants[v.value];
  if (name !== undefined && (variants as readonly string[]).includes(name)) return name as T;
  throw new DecodeError(`${ctx}: expected one of ${variants.join("|")}, got ${describe(v)}`);
}

function describe(v: ScVal): string {
  try {
    return `${v.type} ${JSON.stringify(v.toJson())}`;
  } catch {
    return v.type;
  }
}

// ---------- generic JSON conversion (indexed event payloads) ----------

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** "from_balance" → "fromBalance", "leverage_x100" → "leverageX100". */
export const snakeToCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * ScVal → JSON-safe value: 64/128/256-bit integers become decimal strings,
 * 32-bit integers numbers, bytes lowercase hex, addresses strkeys, map keys
 * camelCase. Single-symbol vecs (unit enum variants) become the variant name.
 */
export function scValToJson(v: ScVal): JsonValue {
  if (INT_TYPES.has(v.type)) {
    return v.type === "scvU32" || v.type === "scvI32" ? Number(asBigInt(v, "")) : asBigInt(v, "").toString();
  }
  switch (v.type) {
    case "scvBool":
      return v.value;
    case "scvVoid":
      return null;
    case "scvBytes":
      return bytesToHex(v.value.value);
    case "scvString":
    case "scvSymbol":
      return String(v.value);
    case "scvAddress":
      return Address.fromScVal(v).toString();
    case "scvVec": {
      const items = v.vec ?? [];
      if (items.length === 1 && items[0].type === "scvSymbol") return String(items[0].value);
      return items.map(scValToJson);
    }
    case "scvMap": {
      const out: Record<string, JsonValue> = {};
      for (const entry of v.map ?? []) {
        const key = entry.key.type === "scvSymbol" || entry.key.type === "scvString" ? snakeToCamel(String(entry.key.value)) : JSON.stringify(scValToJson(entry.key));
        out[key] = scValToJson(entry.val);
      }
      return out;
    }
    case "scvError":
      return { error: v.value.type === "sceContract" ? `Contract #${v.value.value}` : JSON.stringify(v.value.toJson()) };
    default:
      return JSON.parse(JSON.stringify(v.toJson())) as JsonValue;
  }
}
