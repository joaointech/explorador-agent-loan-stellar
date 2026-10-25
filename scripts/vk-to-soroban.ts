// Converts a snarkjs verification_key.json into the hex values of the Soroban
// `VerificationKey` struct (§8.5).
//
//   tsx scripts/vk-to-soroban.ts <verification_key.json> <out.json>

import { readFileSync, writeFileSync } from "node:fs";
import { formatVk, type SnarkjsVk } from "../packages/zk/src/format.ts";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: vk-to-soroban <verification_key.json> <out.json>");
  process.exit(1);
}
const vk = JSON.parse(readFileSync(input, "utf8")) as SnarkjsVk;
if (vk.protocol !== "groth16" || vk.curve !== "bn128") throw new Error("expected a groth16/bn128 key");
if (vk.nPublic !== 9 || vk.IC.length !== 10) throw new Error(`expected 9 public inputs, got ${vk.nPublic}`);
writeFileSync(output, JSON.stringify(formatVk(vk), null, 2) + "\n");
console.log(`wrote ${output}`);
