// Request validation for the email sign-in routes. Pure zod, safe to import
// from client components for inline validation.

import { z } from "zod";

/** Trimmed, lowercased email address. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email address is too long")
  .pipe(z.email("Enter a valid email address"));

/** Six digits; spaces (e.g. from a pasted "123 456") are ignored. */
export const emailCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code"));

export const emailStartBody = z.object({ email: emailSchema });

export const emailVerifyBody = z.object({
  email: emailSchema,
  code: emailCodeSchema,
  /** Page to return to after sign-in; sanitized server-side. */
  next: z.string().max(512).optional(),
});
