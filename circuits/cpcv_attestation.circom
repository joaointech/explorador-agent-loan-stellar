pragma circom 2.1.6;

// explorador advance: CPCV attestation circuit (spec §8.2–8.3).
//
// Proves, without revealing the deal's personal data, that explorador's
// attester key signed this exact deal record, that the commission follows from
// a hidden sale price and a 1–10% rate, that the agent gets exactly half, that
// the escritura comes after the CPCV, that the record is bound to one agent
// account, and that the deal has a unique nullifier.
//
// Encodings (spec §8.4): every value is a BN254 scalar-field element; amounts
// are EUR cents; days are floor(unix_seconds / 86400) in UTC.

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";

template CpcvAttestation() {
    // ---- public inputs: declared first, in exactly the spec §8.2 order ----
    signal input agent_field;                  // 0
    signal input total_commission_cents;       // 1
    signal input agent_commission_cents;       // 2
    signal input escritura_day;                // 3
    signal input commitment;                   // 4
    signal input nullifier;                    // 5
    signal input attester_ax;                  // 6
    signal input attester_ay;                  // 7
    signal input nullifier_secret_commitment;  // 8

    // ---- private inputs ----
    signal input buyer_nif;            // 9-digit integer
    signal input seller_nif;           // 9-digit integer
    signal input sale_price_cents;     // u64
    signal input commission_rate_bps;  // 100…1000
    signal input property_hash;        // Poseidon hash of the normalized address
    signal input cpcv_day;             // days since the Unix epoch
    signal input salt;                 // 31 random bytes
    signal input nullifier_secret;     // explorador's NULLIFIER_SECRET
    signal input sig_r8x;              // EdDSA-Poseidon (BabyJubJub) signature
    signal input sig_r8y;
    signal input sig_s;

    // 1. Range checks: amounts fit in 64 bits, days in 32 bits.
    component salePriceBits = Num2Bits(64);
    salePriceBits.in <== sale_price_cents;
    component totalBits = Num2Bits(64);
    totalBits.in <== total_commission_cents;
    component agentBits = Num2Bits(64);
    agentBits.in <== agent_commission_cents;
    component cpcvDayBits = Num2Bits(32);
    cpcvDayBits.in <== cpcv_day;
    component escrituraDayBits = Num2Bits(32);
    escrituraDayBits.in <== escritura_day;

    //    100 ≤ commission_rate_bps ≤ 1000. The rate is first bounded to 10 bits
    //    (1000 < 2^10) so the comparators below are sound.
    component rateBits = Num2Bits(10);
    rateBits.in <== commission_rate_bps;
    component rateMin = GreaterEqThan(10);
    rateMin.in[0] <== commission_rate_bps;
    rateMin.in[1] <== 100;
    rateMin.out === 1;
    component rateMax = LessEqThan(10);
    rateMax.in[0] <== commission_rate_bps;
    rateMax.in[1] <== 1000;
    rateMax.out === 1;

    // 2. Commission: sale_price × rate == total × 10000 + rem, 0 ≤ rem < 10000.
    //    No wrap-around: the left side is < 2^74 and the right side < 2^78.
    signal rem;
    rem <-- (sale_price_cents * commission_rate_bps) % 10000;
    component remBits = Num2Bits(14);
    remBits.in <== rem;
    component remMax = LessThan(14);
    remMax.in[0] <== rem;
    remMax.in[1] <== 10000;
    remMax.out === 1;
    sale_price_cents * commission_rate_bps === total_commission_cents * 10000 + rem;

    // 3. Split: 2 × agent + odd == total, odd ∈ {0, 1}.
    signal odd;
    odd <-- total_commission_cents % 2;
    odd * (odd - 1) === 0;
    2 * agent_commission_cents + odd === total_commission_cents;

    // 4. Dates: cpcv_day < escritura_day (both range-checked to 32 bits above).
    component dateOrder = LessThan(32);
    dateOrder.in[0] <== cpcv_day;
    dateOrder.in[1] <== escritura_day;
    dateOrder.out === 1;

    // 5. commitment == Poseidon(buyer_nif, seller_nif, sale_price_cents,
    //    commission_rate_bps, property_hash, cpcv_day, escritura_day, salt).
    component commitmentHash = Poseidon(8);
    commitmentHash.inputs[0] <== buyer_nif;
    commitmentHash.inputs[1] <== seller_nif;
    commitmentHash.inputs[2] <== sale_price_cents;
    commitmentHash.inputs[3] <== commission_rate_bps;
    commitmentHash.inputs[4] <== property_hash;
    commitmentHash.inputs[5] <== cpcv_day;
    commitmentHash.inputs[6] <== escritura_day;
    commitmentHash.inputs[7] <== salt;
    commitment === commitmentHash.out;

    // 6. nullifier == Poseidon(property_hash, buyer_nif, seller_nif, cpcv_day,
    //    nullifier_secret): independent of the salt, so re-attesting the same
    //    deal gives the same nullifier.
    component nullifierHash = Poseidon(5);
    nullifierHash.inputs[0] <== property_hash;
    nullifierHash.inputs[1] <== buyer_nif;
    nullifierHash.inputs[2] <== seller_nif;
    nullifierHash.inputs[3] <== cpcv_day;
    nullifierHash.inputs[4] <== nullifier_secret;
    nullifier === nullifierHash.out;

    // 7. nullifier_secret_commitment == Poseidon(nullifier_secret).
    component secretHash = Poseidon(1);
    secretHash.inputs[0] <== nullifier_secret;
    nullifier_secret_commitment === secretHash.out;

    // 8. msg = Poseidon(commitment, agent_field, total_commission_cents,
    //    escritura_day, nullifier), signed by the attester (EdDSA-Poseidon).
    component msgHash = Poseidon(5);
    msgHash.inputs[0] <== commitment;
    msgHash.inputs[1] <== agent_field;
    msgHash.inputs[2] <== total_commission_cents;
    msgHash.inputs[3] <== escritura_day;
    msgHash.inputs[4] <== nullifier;

    component signature = EdDSAPoseidonVerifier();
    signature.enabled <== 1;
    signature.Ax <== attester_ax;
    signature.Ay <== attester_ay;
    signature.R8x <== sig_r8x;
    signature.R8y <== sig_r8y;
    signature.S <== sig_s;
    signature.M <== msgHash.out;
}

component main {public [
    agent_field,
    total_commission_cents,
    agent_commission_cents,
    escritura_day,
    commitment,
    nullifier,
    attester_ax,
    attester_ay,
    nullifier_secret_commitment
]} = CpcvAttestation();
