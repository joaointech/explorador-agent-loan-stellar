import { badRequest } from "@/lib/http";

/** Parses a note id path segment (a u32); throws 400 otherwise. */
export function parseNoteId(raw: string): number {
  if (!/^\d{1,10}$/.test(raw) || Number(raw) > 0xffff_ffff) throw badRequest("note id must be a non-negative integer", "VALIDATION_ERROR");
  return Number(raw);
}
