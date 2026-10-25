// agent_field encoding (spec §8.4). Must match `cpcv_note.agent_field(addr)`
// byte-for-byte; the parity vectors live in lib/zk/zk.test.ts and in the
// cpcv_note Rust tests. Browser-safe.

import { Address, hash, nativeToScVal } from "@stellar/stellar-sdk";

import { bytesToBigInt, toHex } from "./field";

/** 0x00 ‖ sha256(XDR of ScVal::Address)[0..31]: a BN254 field element, big-endian. */
export function agentFieldBytes(address: string): Uint8Array {
  const xdr = nativeToScVal(Address.fromString(address)).toXDR();
  const digest = hash(xdr);
  const out = new Uint8Array(32);
  out.set(digest.subarray(0, 31), 1);
  return out;
}

/** Lowercase hex (64 chars, no 0x) as stored in `Agent.agentField`. */
export function agentFieldHex(address: string): string {
  return toHex(agentFieldBytes(address));
}

/** The circuit's public input 0. */
export function agentFieldValue(address: string): bigint {
  return bytesToBigInt(agentFieldBytes(address));
}
