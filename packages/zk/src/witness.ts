// Builds the circuit input for a CPCV attestation (§8.2, §8.3).

import { agentField } from "./agent";
import { FR, randomFieldElement } from "./field";
import { attesterPublicKey, poseidon, propertyHash, signPoseidon } from "./hash";

export interface CpcvRecord {
  buyerNif: number | bigint;
  sellerNif: number | bigint;
  salePriceCents: bigint;
  commissionRateBps: number;
  propertyAddress: string;
  cpcvDay: number;
  escrituraDay: number;
}

export interface AttestationKeys {
  attesterPrivHex: string;
  nullifierSecret: bigint;
}

export interface PublicSignals {
  agentField: bigint;
  totalCommissionCents: bigint;
  agentCommissionCents: bigint;
  escrituraDay: number;
  commitment: bigint;
  nullifier: bigint;
  attesterAx: bigint;
  attesterAy: bigint;
  nullifierSecretCommitment: bigint;
}

export interface Attestation {
  input: Record<string, string>;
  publicSignals: PublicSignals;
  salt: bigint;
  propertyHash: bigint;
  msg: bigint;
}

export function computeCommission(salePriceCents: bigint, rateBps: number) {
  const total = (salePriceCents * BigInt(rateBps)) / 10_000n;
  const agent = total / 2n;
  return { total, agent, explorador: total - agent };
}

/** Public signals in the exact circuit order (§8.2). */
export function publicSignalsArray(s: PublicSignals): string[] {
  return [
    s.agentField,
    s.totalCommissionCents,
    s.agentCommissionCents,
    BigInt(s.escrituraDay),
    s.commitment,
    s.nullifier,
    s.attesterAx,
    s.attesterAy,
    s.nullifierSecretCommitment,
  ].map((v) => v.toString());
}

export async function nullifierSecretCommitment(secret: bigint): Promise<bigint> {
  return poseidon([secret]);
}

export async function buildAttestation(
  record: CpcvRecord,
  agentAddress: string,
  keys: AttestationKeys,
  opts: { salt?: bigint } = {},
): Promise<Attestation> {
  if (keys.nullifierSecret <= 0n || keys.nullifierSecret >= FR) throw new Error("bad nullifier secret");
  const buyer = BigInt(record.buyerNif);
  const seller = BigInt(record.sellerNif);
  const { total, agent } = computeCommission(record.salePriceCents, record.commissionRateBps);
  const salt = opts.salt ?? randomFieldElement();
  const prop = await propertyHash(record.propertyAddress);
  const af = agentField(agentAddress);
  const escr = BigInt(record.escrituraDay);
  const cpcv = BigInt(record.cpcvDay);

  const commitment = await poseidon([
    buyer,
    seller,
    record.salePriceCents,
    BigInt(record.commissionRateBps),
    prop,
    cpcv,
    escr,
    salt,
  ]);
  const nullifier = await poseidon([prop, buyer, seller, cpcv, keys.nullifierSecret]);
  const nsc = await nullifierSecretCommitment(keys.nullifierSecret);
  const pub = await attesterPublicKey(keys.attesterPrivHex);
  const msg = await poseidon([commitment, af, total, escr, nullifier]);
  const sig = await signPoseidon(keys.attesterPrivHex, msg);

  const publicSignals: PublicSignals = {
    agentField: af,
    totalCommissionCents: total,
    agentCommissionCents: agent,
    escrituraDay: record.escrituraDay,
    commitment,
    nullifier,
    attesterAx: pub.ax,
    attesterAy: pub.ay,
    nullifierSecretCommitment: nsc,
  };

  const input: Record<string, string> = {
    agent_field: af.toString(),
    total_commission_cents: total.toString(),
    agent_commission_cents: agent.toString(),
    escritura_day: escr.toString(),
    commitment: commitment.toString(),
    nullifier: nullifier.toString(),
    attester_ax: pub.ax.toString(),
    attester_ay: pub.ay.toString(),
    nullifier_secret_commitment: nsc.toString(),
    buyer_nif: buyer.toString(),
    seller_nif: seller.toString(),
    sale_price_cents: record.salePriceCents.toString(),
    commission_rate_bps: record.commissionRateBps.toString(),
    property_hash: prop.toString(),
    cpcv_day: cpcv.toString(),
    salt: salt.toString(),
    nullifier_secret: keys.nullifierSecret.toString(),
    sig_r8x: sig.r8x.toString(),
    sig_r8y: sig.r8y.toString(),
    sig_s: sig.s.toString(),
  };

  return { input, publicSignals, salt, propertyHash: prop, msg };
}
