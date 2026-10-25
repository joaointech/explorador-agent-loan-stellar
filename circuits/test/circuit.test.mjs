// Circuit tests (spec §12.1): a valid witness satisfies the R1CS and proves;
// violating each constraint individually makes witness generation fail at
// that exact constraint.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  BASE_DEAL,
  FIELD_R,
  OTHER_PRIVKEY,
  PUBLIC_ORDER,
  buildInput,
  committedArtifacts,
  compileCircuit,
  propertyHash,
  quietly,
  releaseCurve,
  snarkjs,
  sourceLine,
} from "./helpers.mjs";

let circuit;

before(() => {
  circuit = compileCircuit();
});

after(releaseCurve);

/** Witness generation must succeed and the witness must satisfy every R1CS constraint. */
async function expectValid(input) {
  const wtns = { type: "mem" };
  await snarkjs.wtns.calculate(input, circuit.wasm, wtns);
  assert.equal(await snarkjs.wtns.check(circuit.r1cs, wtns), true, "R1CS check failed");
}

/**
 * Witness generation must fail. `where` pins the failing constraint: a source
 * marker (a line of cpcv_attestation.circom) or a circomlib template name.
 */
async function expectViolation(input, where) {
  let error;
  await quietly(async () => {
    try {
      await snarkjs.wtns.calculate(input, circuit.wasm, { type: "mem" });
    } catch (e) {
      error = e;
    }
  });
  assert.ok(error, "witness generation unexpectedly succeeded");
  assert.match(error.message, /Assert Failed/);
  if (where.marker) {
    const line = sourceLine(where.marker);
    assert.match(error.message, new RegExp(`template CpcvAttestation_\\d+ line: ${line}\\b`), error.message);
  } else {
    assert.match(error.message, new RegExp(`template ${where.template}_\\d+ line: \\d+`), error.message);
  }
}

const RATE_MIN = { marker: "rateMin.out === 1;" };
const RATE_MAX = { marker: "rateMax.out === 1;" };
const COMMISSION = { marker: "sale_price_cents * commission_rate_bps === total_commission_cents * 10000 + rem;" };
const SPLIT = { marker: "2 * agent_commission_cents + odd === total_commission_cents;" };
const DATES = { marker: "dateOrder.out === 1;" };
const COMMITMENT = { marker: "commitment === commitmentHash.out;" };
const NULLIFIER = { marker: "nullifier === nullifierHash.out;" };
const SECRET_COMMITMENT = { marker: "nullifier_secret_commitment === secretHash.out;" };
const SIGNATURE = { template: "ForceEqualIfEnabled" };
const RANGE = { template: "Num2Bits" };

describe("valid witness", () => {
  it("satisfies the R1CS for the worked example (€300,000 at 5%)", async () => {
    const input = await buildInput();
    assert.equal(input.total_commission_cents, "1500000");
    assert.equal(input.agent_commission_cents, "750000");
    await expectValid(input);
  });

  it("accepts the rate bounds 100 and 1000 bps, an odd total and a 1-day gap", async () => {
    await expectValid(await buildInput({ commission_rate_bps: 100n }));
    await expectValid(await buildInput({ commission_rate_bps: 1000n }));
    // 18,500,033 × 437 / 10,000 = 808,451.44… → total 808,451 (odd), agent 404,225
    const odd = await buildInput({ sale_price_cents: 18_500_033n, commission_rate_bps: 437n });
    assert.equal(odd.total_commission_cents, "808451");
    assert.equal(odd.agent_commission_cents, "404225");
    await expectValid(odd);
    await expectValid(await buildInput({ escritura_day: BASE_DEAL.cpcv_day + 1n }));
  });

  it("proves and verifies with the committed zkey, public signals in spec order", async (t) => {
    const artifacts = committedArtifacts();
    if (!artifacts) return t.skip("apps/web/zk artifacts not built yet (pnpm circuits:build)");
    const input = await buildInput();
    // Witness from the freshly compiled source: a stale zkey fails here.
    const wtns = { type: "mem" };
    await snarkjs.wtns.calculate(input, circuit.wasm, wtns);
    const { proof, publicSignals } = await snarkjs.groth16.prove(artifacts.zkey, wtns);
    assert.deepEqual(
      publicSignals,
      PUBLIC_ORDER.map((k) => input[k]),
    );
    assert.equal(artifacts.vk.nPublic, 9);
    assert.equal(await snarkjs.groth16.verify(artifacts.vk, publicSignals, proof), true);
    // Same proof against a different agent must fail.
    const tampered = [...publicSignals];
    tampered[0] = (BigInt(tampered[0]) + 1n).toString();
    assert.equal(await snarkjs.groth16.verify(artifacts.vk, tampered, proof), false);
  });
});

describe("1. range checks", () => {
  it("rejects a commission rate below 100 bps", async () => {
    await expectViolation(await buildInput({ commission_rate_bps: 99n }), RATE_MIN);
  });

  it("rejects a commission rate above 1000 bps", async () => {
    await expectViolation(await buildInput({ commission_rate_bps: 1001n }), RATE_MAX);
  });

  it("rejects a commission rate that does not fit the 10-bit bound", async () => {
    await expectViolation(await buildInput({ commission_rate_bps: 5000n }), RANGE);
  });

  it("rejects a sale price of 2^64 cents or more", async () => {
    await expectViolation(await buildInput({ sale_price_cents: 1n << 64n, commission_rate_bps: 100n }), RANGE);
  });

  it("rejects an escritura day of 2^32 or more", async () => {
    await expectViolation(await buildInput({ escritura_day: 1n << 32n }), RANGE);
  });

  it("rejects a field-wrapped (negative) agent commission", async () => {
    // agent = (total − 1 − r) / 2 mod r would satisfy 2·agent + 1 = total over the field
    const total = 1_500_000n;
    const wrapped = ((total - 1n + FIELD_R) * ((FIELD_R + 1n) / 2n)) % FIELD_R;
    assert.equal((2n * wrapped + 1n) % FIELD_R, total);
    await expectViolation(await buildInput({}, { agent: wrapped }), RANGE);
  });
});

describe("2. commission", () => {
  it("rejects a total commission that does not match price × rate", async () => {
    await expectViolation(await buildInput({}, { total: 1_500_001n }), COMMISSION);
    await expectViolation(await buildInput({}, { total: 1_499_999n }), COMMISSION);
  });
});

describe("3. split", () => {
  it("rejects an agent commission other than floor(total / 2)", async () => {
    await expectViolation(await buildInput({}, { agent: 750_001n }), SPLIT);
    await expectViolation(await buildInput({}, { agent: 749_999n }), SPLIT);
  });
});

describe("4. dates", () => {
  it("rejects an escritura on the CPCV day", async () => {
    await expectViolation(await buildInput({ escritura_day: BASE_DEAL.cpcv_day }), DATES);
  });

  it("rejects an escritura before the CPCV", async () => {
    await expectViolation(await buildInput({ escritura_day: BASE_DEAL.cpcv_day - 30n }), DATES);
  });
});

describe("5–7. commitment, nullifier, secret commitment", () => {
  it("rejects a wrong commitment (even when the attester signed it)", async () => {
    const good = await buildInput();
    await expectViolation(await buildInput({}, { commitment: BigInt(good.commitment) + 1n }), COMMITMENT);
  });

  it("rejects a wrong nullifier", async () => {
    const good = await buildInput();
    await expectViolation(await buildInput({}, { nullifier: BigInt(good.nullifier) + 1n }), NULLIFIER);
  });

  it("rejects a nullifier secret that does not match the published commitment", async () => {
    const good = await buildInput();
    await expectViolation(await buildInput({}, { nsc: BigInt(good.nullifier_secret_commitment) + 1n }), SECRET_COMMITMENT);
  });

  it("keeps the nullifier independent of the salt", async () => {
    const a = await buildInput({ salt: 1n });
    const b = await buildInput({ salt: 2n });
    assert.notEqual(a.commitment, b.commitment);
    assert.equal(a.nullifier, b.nullifier);
  });
});

describe("8. attestation signature", () => {
  it("rejects a signature by another key", async () => {
    await expectViolation(await buildInput({}, { signer: OTHER_PRIVKEY }), SIGNATURE);
  });

  it("rejects a tampered signature scalar", async () => {
    await expectViolation(
      await buildInput({}, { tamper: (i) => (i.sig_s = BigInt(i.sig_s) + 1n) }),
      SIGNATURE,
    );
  });

  it("rejects a signature over a different agent", async () => {
    // The attester signed agent A; the prover claims agent B.
    await expectViolation(
      await buildInput({}, { tamper: (i) => (i.agent_field = BigInt(i.agent_field) + 1n) }),
      SIGNATURE,
    );
  });
});

describe("property_hash (spec §8.4)", () => {
  it("normalizes case and whitespace", async () => {
    const a = await propertyHash("Rua Augusta 100, 1100-053 Lisboa");
    const b = await propertyHash("  rua   AUGUSTA 100,\t1100-053   lisboa ");
    assert.equal(a, b);
    assert.notEqual(a, await propertyHash("Rua Augusta 101, 1100-053 Lisboa"));
  });
});
