// Builds the circuit input for a CPCV and signs the attestation (spec §8.3,
// §8.6). Server-side; no `server-only` so tsx scripts can import it.

import { Address } from "@stellar/stellar-sdk";

import { totalCommissionCents as computeTotalCommission } from "../units";

import { agentFieldValue } from "./agent-field";
import { U32_MAX, U64_MAX, randomField31 } from "./field";
import { parseAttesterKey, parseNullifierSecret } from "./keys";
import { getEddsa, poseidon, propertyHash } from "./poseidon";
import type { CpcvPrivateInput } from "./prove";

/** The off-chain secrets the prover needs (from env in production, fixed values in tests). */
export interface ZkKeys {
  /** `ATTESTER_EDDSA_PRIVKEY`: 32 bytes of hex. */
  attesterPrivKey: string;
  /** `NULLIFIER_SECRET`: decimal (or 0x-hex) field element. */
  nullifierSecret: string | bigint;
}

export interface CpcvWitnessInput {
  /** Circuit input signals (decimal strings) for `snarkjs.groth16.fullProve`. */
  circuitInput: Record<string, string>;
  /** The 9 public signals the proof must expose, in circuit order (spec §8.2). */
  publicSignals: string[];
  totalCommissionCents: bigint;
  agentCommissionCents: bigint;
  commitment: bigint;
  nullifier: bigint;
  salt: bigint;
  propertyHash: bigint;
}

/**
 * Invalid CPCV input (a client error, HTTP 400 if surfaced by an API route).
 * `code`: INVALID_AGENT | INVALID_NIF | INVALID_PRICE | INVALID_RATE | INVALID_DATE | INVALID_ADDRESS.
 */
export class CpcvInputError extends Error {
  readonly status = 400;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "CpcvInputError";
  }
}

const NIF = /^\d{9}$/;

/** Rejects input the circuit would reject, with a readable message (`CpcvInputError`). */
export function validateCpcvInput(agentAddress: string, input: CpcvPrivateInput): void {
  try {
    Address.fromString(agentAddress);
  } catch {
    throw new CpcvInputError(`Invalid agent address: ${agentAddress}`, "INVALID_AGENT");
  }
  if (!NIF.test(input.buyerNif)) throw new CpcvInputError("Buyer NIF must be 9 digits", "INVALID_NIF");
  if (!NIF.test(input.sellerNif)) throw new CpcvInputError("Seller NIF must be 9 digits", "INVALID_NIF");
  if (input.salePriceCents <= 0n || input.salePriceCents > U64_MAX) {
    throw new CpcvInputError("Sale price must be positive and fit in 64 bits of cents", "INVALID_PRICE");
  }
  const rate = input.commissionRateBps;
  if (!Number.isInteger(rate) || rate < 100 || rate > 1000) {
    throw new CpcvInputError("Commission rate must be between 100 and 1000 bps (1%–10%)", "INVALID_RATE");
  }
  for (const [name, day] of [
    ["CPCV day", input.cpcvDay],
    ["Escritura day", input.escrituraDay],
  ] as const) {
    if (!Number.isInteger(day) || day < 0 || BigInt(day) > U32_MAX) throw new CpcvInputError(`${name} is out of range`, "INVALID_DATE");
  }
  if (input.cpcvDay >= input.escrituraDay) throw new CpcvInputError("The escritura must be after the CPCV", "INVALID_DATE");
  if (input.propertyAddress.trim() === "") throw new CpcvInputError("Property address is required", "INVALID_ADDRESS");
}

/**
 * Computes the commitment, nullifier and attestation signature and returns
 * the full circuit input (spec §8.3). `salt` is random unless given (tests).
 */
export async function buildCpcvWitnessInput(
  agentAddress: string,
  input: CpcvPrivateInput,
  keys: ZkKeys,
  opts: { salt?: bigint } = {},
): Promise<CpcvWitnessInput> {
  validateCpcvInput(agentAddress, input);

  const buyerNif = BigInt(input.buyerNif);
  const sellerNif = BigInt(input.sellerNif);
  const salePrice = input.salePriceCents;
  const rate = BigInt(input.commissionRateBps);
  const cpcvDay = BigInt(input.cpcvDay);
  const escrituraDay = BigInt(input.escrituraDay);
  const salt = opts.salt ?? randomField31();
  const nullifierSecret = parseNullifierSecret(keys.nullifierSecret);

  const totalCommissionCents = computeTotalCommission(salePrice, input.commissionRateBps);
  const agentCommissionCents = totalCommissionCents / 2n;
  if (totalCommissionCents <= 0n) throw new CpcvInputError("The commission rounds down to zero", "INVALID_PRICE");

  let propHash: bigint;
  try {
    propHash = await propertyHash(input.propertyAddress);
  } catch (err) {
    throw new CpcvInputError(err instanceof Error ? err.message : String(err), "INVALID_ADDRESS");
  }

  const commitment = await poseidon([buyerNif, sellerNif, salePrice, rate, propHash, cpcvDay, escrituraDay, salt]);
  const nullifier = await poseidon([propHash, buyerNif, sellerNif, cpcvDay, nullifierSecret]);
  const nullifierSecretCommitment = await poseidon([nullifierSecret]);
  const agentField = agentFieldValue(agentAddress);
  const msg = await poseidon([commitment, agentField, totalCommissionCents, escrituraDay, nullifier]);

  const eddsa = await getEddsa();
  const privateKey = parseAttesterKey(keys.attesterPrivKey);
  const publicKey = eddsa.prv2pub(privateKey);
  const signature = eddsa.signPoseidon(privateKey, eddsa.F.e(msg));
  if (!eddsa.verifyPoseidon(eddsa.F.e(msg), signature, publicKey)) {
    throw new Error("EdDSA-Poseidon attestation signature failed to verify");
  }
  const [ax, ay] = publicKey.map((c) => eddsa.F.toObject(c));

  const publicSignals = [
    agentField,
    totalCommissionCents,
    agentCommissionCents,
    escrituraDay,
    commitment,
    nullifier,
    ax,
    ay,
    nullifierSecretCommitment,
  ].map(String);

  const circuitInput: Record<string, string> = {
    agent_field: publicSignals[0],
    total_commission_cents: publicSignals[1],
    agent_commission_cents: publicSignals[2],
    escritura_day: publicSignals[3],
    commitment: publicSignals[4],
    nullifier: publicSignals[5],
    attester_ax: publicSignals[6],
    attester_ay: publicSignals[7],
    nullifier_secret_commitment: publicSignals[8],
    buyer_nif: buyerNif.toString(),
    seller_nif: sellerNif.toString(),
    sale_price_cents: salePrice.toString(),
    commission_rate_bps: rate.toString(),
    property_hash: propHash.toString(),
    cpcv_day: cpcvDay.toString(),
    salt: salt.toString(),
    nullifier_secret: nullifierSecret.toString(),
    sig_r8x: eddsa.F.toObject(signature.R8[0]).toString(),
    sig_r8y: eddsa.F.toObject(signature.R8[1]).toString(),
    sig_s: signature.S.toString(),
  };

  return {
    circuitInput,
    publicSignals,
    totalCommissionCents,
    agentCommissionCents,
    commitment,
    nullifier,
    salt,
    propertyHash: propHash,
  };
}
