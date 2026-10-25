// Request bodies of the admin API (spec §9.7: validate every body with zod).
// Pure, so the admin UI can reuse the limits.

import { z } from "zod";

import type { AdminAmountRequest, AdvanceClockRequest } from "@/lib/types/api";

/** Upper bound for one treasury operation (testnet treasury holds ~€1M of tEURC). */
export const MAX_TREASURY_EUR = 10_000_000;
export const MAX_ADVANCE_DAYS = 400;

export const amountEurSchema = z.object({
  amountEur: z
    .number()
    .positive("amountEur must be positive")
    .max(MAX_TREASURY_EUR, `amountEur must be at most ${MAX_TREASURY_EUR}`)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "amountEur has at most 2 decimals"),
}) satisfies z.ZodType<AdminAmountRequest>;

export const advanceClockSchema = z.union([
  z.strictObject({ days: z.number().int("days must be a whole number").min(1).max(MAX_ADVANCE_DAYS) }),
  z.strictObject({ toGraceDeadlineOf: z.string().trim().min(1) }),
]) satisfies z.ZodType<AdvanceClockRequest>;
