// Converts the snarkjs verification key to Soroban bytes and writes a Rust
// test fixture made of real proofs (spec §8.5). Run by circuits/build.sh after
// the trusted setup, or alone: pnpm --filter @advance/scripts vk:soroban
//
// Outputs:
//   apps/web/zk/verification_key.soroban.json     hex alpha, beta, gamma, delta, ic[]: the
//                                                 `VerificationKey` the deploy script passes to
//                                                 the cpcv_note constructor
//   contracts/shared/fixtures/groth16_fixture.rs  that vk + three real Groth16 proofs (fixed TEST
//                                                 keys) with their public inputs, for the Rust tests
//
// Encoding (lib/zk/format.ts): G1 = be(x) ‖ be(y); G2 = be(x.c1) ‖ be(x.c0) ‖ be(y.c1) ‖ be(y.c0);
// proof A is negated.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dateToDay } from "@/lib/units";
import { VK_SOROBAN_FILE, loadVerificationKey, zkArtifacts } from "@/lib/zk/artifacts";
import { fieldToBytes } from "@/lib/zk/field";
import { vkToSoroban, vkToSorobanHex } from "@/lib/zk/format";
import { attesterParams, attesterPublicKey } from "@/lib/zk/keys";
import { proveCpcvWithKeys, releaseZkResources, type CpcvPrivateInput } from "@/lib/zk/prove";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_RS = path.join(REPO, "contracts", "shared", "fixtures", "groth16_fixture.rs");

/** Fixed TEST keys: never use them anywhere else. */
const TEST_KEYS = {
  attesterPrivKey: "a1".repeat(32),
  nullifierSecret: BigInt("0x" + "0e".repeat(31)).toString(),
};
const OTHER_ATTESTER_PRIVKEY = "b2".repeat(32);

/** Fixed agent smart accounts: StrKey.encodeContract(sha256("explorador advance fixture agent A" | "… B")). */
const AGENT_A = "CCI4DBTXGTZMSKIJHYUCXHR434R6K5EYVVSB2N6G4G6KBJAJFDTEWMQR";
const AGENT_B = "CCU64FTJA23BECHA5JRMQN3CBRJ73KZ6PDJDHMVD4UGEMPSCPGASD3XU";

const CPCV_DAY = dateToDay(new Date(Date.UTC(2026, 9, 25)));

const DEALS: { agent: string; salt: bigint; input: CpcvPrivateInput }[] = [
  {
    // The worked example (spec §5.6): €300,000 at 5% → €15,000; escritura 90 days later.
    agent: AGENT_A,
    salt: BigInt("0x" + "3d".repeat(31)),
    input: {
      buyerNif: "123456789",
      sellerNif: "987654321",
      salePriceCents: 30_000_000n,
      commissionRateBps: 500,
      propertyAddress: "Rua Augusta 100, 1100-053 Lisboa",
      cpcvDay: CPCV_DAY,
      escrituraDay: CPCV_DAY + 90,
    },
  },
  {
    agent: AGENT_A,
    salt: BigInt("0x" + "4e".repeat(31)),
    input: {
      buyerNif: "234567891",
      sellerNif: "876543219",
      salePriceCents: 41_850_000n,
      commissionRateBps: 450,
      propertyAddress: "Avenida da Boavista 1234, 4100-114 Porto",
      cpcvDay: CPCV_DAY,
      escrituraDay: CPCV_DAY + 60,
    },
  },
  {
    // Odd total commission: 18,500,033 × 437 / 10,000 → 808,451 cents.
    agent: AGENT_B,
    salt: BigInt("0x" + "5f".repeat(31)),
    input: {
      buyerNif: "345678912",
      sellerNif: "765432198",
      salePriceCents: 18_500_033n,
      commissionRateBps: 437,
      propertyAddress: "Rua do Souto 45, 4700-329 Braga",
      cpcvDay: CPCV_DAY,
      escrituraDay: CPCV_DAY + 75,
    },
  },
];

function rsBytes(bytes: Uint8Array, indent: string): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    lines.push(
      indent +
        "    " +
        Array.from(bytes.subarray(i, i + 16), (b) => `0x${b.toString(16).padStart(2, "0")},`).join(" "),
    );
  }
  return `[\n${lines.join("\n")}\n${indent}]`;
}

const rsArray = (items: string[], indent: string) => `[\n${items.map((s) => `${indent}    ${s},`).join("\n")}\n${indent}]`;

async function main() {
  const artifacts = zkArtifacts();
  const vkJson = loadVerificationKey();
  const vkHex = vkToSorobanHex(vkJson);
  const vkOut = path.join(artifacts.dir, VK_SOROBAN_FILE);
  writeFileSync(vkOut, JSON.stringify(vkHex, null, 2) + "\n");
  console.log(`wrote ${path.relative(REPO, vkOut)}`);

  const vk = vkToSoroban(vkJson);
  const params = await attesterParams(TEST_KEYS);
  const other = await attesterPublicKey(OTHER_ATTESTER_PRIVKEY);

  const notes: string[] = [];
  for (const deal of DEALS) {
    const started = Date.now();
    const p = await proveCpcvWithKeys(deal.agent, deal.input, TEST_KEYS, undefined, { salt: deal.salt });
    console.log(`proved ${deal.input.propertyAddress} in ${Date.now() - started} ms`);
    const ind = "        ";
    notes.push(
      [
        "FixtureNote {",
        `        agent: "${deal.agent}",`,
        `        total_commission_cents: ${p.totalCommissionCents},`,
        `        agent_commission_cents: ${p.agentCommissionCents},`,
        `        escritura_day: ${deal.input.escrituraDay},`,
        `        commitment: ${rsBytes(p.commitment, ind)},`,
        `        nullifier: ${rsBytes(p.nullifier, ind)},`,
        `        a: ${rsBytes(p.sorobanProof.a, ind)},`,
        `        b: ${rsBytes(p.sorobanProof.b, ind)},`,
        `        c: ${rsBytes(p.sorobanProof.c, ind)},`,
        `        public_inputs: ${rsArray(
          p.publicSignals.map((s) => rsBytes(fieldToBytes(BigInt(s)), ind + "    ")),
          ind,
        )},`,
        "    }",
      ].join("\n"),
    );
  }

  const rs = `// @generated by scripts/vk-to-soroban.ts (pnpm circuits:build). Do not edit.
//
// The verification key of apps/web/zk/cpcv_attestation_final.zkey in Soroban
// encoding and three real Groth16 proofs made with lib/zk/prove.ts and fixed
// TEST keys (attester private key a1×32, nullifier secret 0x0e×31). Included
// by the advance-shared (groth16) and cpcv_note tests; regenerated by every
// trusted setup.

/// One proved CPCV (amounts in cents, as passed to \`cpcv_note.mint\`).
pub struct FixtureNote {
    pub agent: &'static str,
    pub total_commission_cents: u64,
    pub agent_commission_cents: u64,
    pub escritura_day: u32,
    pub commitment: [u8; 32],
    pub nullifier: [u8; 32],
    /// Proof point A, NEGATED (spec §8.5).
    pub a: [u8; 64],
    pub b: [u8; 128],
    pub c: [u8; 64],
    /// Public inputs in circuit order (spec §8.2), 32-byte big-endian.
    pub public_inputs: [[u8; 32]; 9],
}

pub const VK_ALPHA: [u8; 64] = ${rsBytes(vk.alpha, "")};

pub const VK_BETA: [u8; 128] = ${rsBytes(vk.beta, "")};

pub const VK_GAMMA: [u8; 128] = ${rsBytes(vk.gamma, "")};

pub const VK_DELTA: [u8; 128] = ${rsBytes(vk.delta, "")};

pub const VK_IC: [[u8; 64]; ${vk.ic.length}] = ${rsArray(
    vk.ic.map((p) => rsBytes(p, "    ")),
    "",
  )};

/// BabyJubJub public key of the TEST attester (cpcv_note constructor).
pub const ATTESTER_AX: [u8; 32] = ${rsBytes(params.attesterAx, "")};
pub const ATTESTER_AY: [u8; 32] = ${rsBytes(params.attesterAy, "")};

/// Poseidon(TEST nullifier secret) (cpcv_note constructor).
pub const NULLIFIER_SECRET_COMMITMENT: [u8; 32] = ${rsBytes(params.nullifierSecretCommitment, "")};

/// Public key of another attester (b2×32), for wrong-key tests.
pub const OTHER_ATTESTER_AX: [u8; 32] = ${rsBytes(other.ax, "")};
pub const OTHER_ATTESTER_AY: [u8; 32] = ${rsBytes(other.ay, "")};

/// CPCV day of every fixture deal (days since the Unix epoch).
pub const CPCV_DAY: u32 = ${CPCV_DAY};

/// Two notes for agent A (the worked example first), one for agent B.
pub const NOTES: [FixtureNote; ${notes.length}] = [
    ${notes.join(",\n    ")},
];
`;
  mkdirSync(path.dirname(FIXTURE_RS), { recursive: true });
  writeFileSync(FIXTURE_RS, rs);
  console.log(`wrote ${path.relative(REPO, FIXTURE_RS)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(releaseZkResources);
