import type { Jsonify } from "./types/chain";

/** Recursively converts bigints to decimal strings so values can go through JSON. */
export function jsonify<T>(value: T): Jsonify<T> {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Jsonify<T>;
}

/** `Response.json` that accepts bigints. */
export function jsonResponse<T>(body: T, init?: ResponseInit): Response {
  return Response.json(jsonify(body), init);
}

/** Error body used by every API route: `{ error: { code, message } }`. */
export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
