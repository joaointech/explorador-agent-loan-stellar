// agent_field(addr) = 0x00 ‖ sha256(ScVal::Address(addr).to_xdr())[0..31] (§8.4).

import { createHash } from "node:crypto";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { bytesToBigInt } from "./field";

export function agentFieldBytes(address: string): Uint8Array {
  const xdr = nativeToScVal(Address.fromString(address)).toXDR();
  const h = createHash("sha256").update(xdr).digest();
  const out = new Uint8Array(32);
  out.set(h.subarray(0, 31), 1);
  return out;
}

export function agentField(address: string): bigint {
  return bytesToBigInt(agentFieldBytes(address));
}
