// Portuguese tax numbers (NIF for people, NIPC for companies): 9 digits, the
// last one a mod-11 check digit over the first eight with weights 9…2. Pure,
// shared by the CPCV extraction (server) and the New CPCV form (browser).
// The circuit only needs 9 digits (spec §8.2), so a failed check digit is a
// warning for the admin, never a hard error.

/** Check digit for the first eight digits of a NIF/NIPC. */
export function nifCheckDigit(first8: string): number {
  if (!/^\d{8}$/.test(first8)) throw new RangeError("nifCheckDigit: expected 8 digits");
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(first8[i]) * (9 - i);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** True for 9 digits whose last digit is the mod-11 check digit of the first eight. */
export function isValidNif(nif: string): boolean {
  return /^\d{9}$/.test(nif) && nifCheckDigit(nif.slice(0, 8)) === Number(nif[8]);
}

/**
 * Digits of a NIF as written in a contract ("PT 123 456 789", "123.456.789"),
 * or null when that isn't 9 digits.
 */
export function normalizeNif(raw: string): string | null {
  const digits = raw
    .trim()
    .replace(/^PT/i, "")
    .replace(/\D/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

/** Admin-facing warning for a 9-digit NIF that fails the check digit, or null when it passes. */
export function nifChecksumWarning(nif: string, who: string): string | null {
  if (!/^\d{9}$/.test(nif) || isValidNif(nif)) return null;
  return `${who} NIF ${nif} fails the Portuguese check digit (mod 11): compare it with the contract.`;
}
