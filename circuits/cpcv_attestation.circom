pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/eddsaposeidon.circom";

// explorador advance — CPCV attestation circuit (spec §8).
//
// Proves, without revealing the deal's personal data, that explorador's attester
// key signed a CPCV record whose commission, split, dates, agent binding and
// nullifier are all internally consistent.
template CpcvAttestation() {
    // ---- public inputs (declaration order == public signal order, §8.2) ----
    signal input agent_field;
    signal input total_commission_cents;
    signal input agent_commission_cents;
    signal input escritura_day;
    signal input commitment;
    signal input nullifier;
    signal input attester_ax;
    signal input attester_ay;
    signal input nullifier_secret_commitment;

    // ---- private inputs ----
    signal input buyer_nif;
    signal input seller_nif;
    signal input sale_price_cents;
    signal input commission_rate_bps;
    signal input property_hash;
    signal input cpcv_day;
    signal input salt;
    signal input nullifier_secret;
    signal input sig_r8x;
    signal input sig_r8y;
    signal input sig_s;

    // 1. Range checks.
    component salePriceBits = Num2Bits(64);
    salePriceBits.in <== sale_price_cents;
    component totalBits = Num2Bits(64);
    totalBits.in <== total_commission_cents;
    component agentBits = Num2Bits(64);
    agentBits.in <== agent_commission_cents;
    component escrituraBits = Num2Bits(32);
    escrituraBits.in <== escritura_day;
    component cpcvBits = Num2Bits(32);
    cpcvBits.in <== cpcv_day;
    // NIFs are 9-digit integers (< 10^9 < 2^30).
    component buyerBits = Num2Bits(30);
    buyerBits.in <== buyer_nif;
    component sellerBits = Num2Bits(30);
    sellerBits.in <== seller_nif;

    component rateBits = Num2Bits(16);
    rateBits.in <== commission_rate_bps;
    component rateMin = GreaterEqThan(16);
    rateMin.in[0] <== commission_rate_bps;
    rateMin.in[1] <== 100;
    rateMin.out === 1;
    component rateMax = LessEqThan(16);
    rateMax.in[0] <== commission_rate_bps;
    rateMax.in[1] <== 1000;
    rateMax.out === 1;

    // 2. Commission: sale × rate == total × 10000 + rem, 0 ≤ rem < 10000.
    //    sale < 2^64 and rate < 2^16, so nothing here can wrap the field.
    signal sale_times_rate;
    sale_times_rate <== sale_price_cents * commission_rate_bps;
    signal rem;
    rem <-- sale_times_rate - total_commission_cents * 10000;
    sale_times_rate === total_commission_cents * 10000 + rem;
    component remBits = Num2Bits(14);
    remBits.in <== rem;
    component remMax = LessThan(14);
    remMax.in[0] <== rem;
    remMax.in[1] <== 10000;
    remMax.out === 1;

    // 3. Split: 2 × agent + odd == total, odd ∈ {0, 1}.
    signal odd;
    odd <-- total_commission_cents - 2 * agent_commission_cents;
    odd * (odd - 1) === 0;
    2 * agent_commission_cents + odd === total_commission_cents;

    // 4. Dates: cpcv_day < escritura_day.
    component datesOrdered = LessThan(32);
    datesOrdered.in[0] <== cpcv_day;
    datesOrdered.in[1] <== escritura_day;
    datesOrdered.out === 1;

    // 5. Commitment to the full private record.
    component commitmentHash = Poseidon(8);
    commitmentHash.inputs[0] <== buyer_nif;
    commitmentHash.inputs[1] <== seller_nif;
    commitmentHash.inputs[2] <== sale_price_cents;
    commitmentHash.inputs[3] <== commission_rate_bps;
    commitmentHash.inputs[4] <== property_hash;
    commitmentHash.inputs[5] <== cpcv_day;
    commitmentHash.inputs[6] <== escritura_day;
    commitmentHash.inputs[7] <== salt;
    commitmentHash.out === commitment;

    // 6. Nullifier: independent of the salt, keyed by explorador's secret.
    component nullifierHash = Poseidon(5);
    nullifierHash.inputs[0] <== property_hash;
    nullifierHash.inputs[1] <== buyer_nif;
    nullifierHash.inputs[2] <== seller_nif;
    nullifierHash.inputs[3] <== cpcv_day;
    nullifierHash.inputs[4] <== nullifier_secret;
    nullifierHash.out === nullifier;

    // 7. The nullifier secret is the one the contract knows the commitment of.
    component secretHash = Poseidon(1);
    secretHash.inputs[0] <== nullifier_secret;
    secretHash.out === nullifier_secret_commitment;

    // 8. explorador's attester signed (commitment, agent, commission, escritura, nullifier).
    component msgHash = Poseidon(5);
    msgHash.inputs[0] <== commitment;
    msgHash.inputs[1] <== agent_field;
    msgHash.inputs[2] <== total_commission_cents;
    msgHash.inputs[3] <== escritura_day;
    msgHash.inputs[4] <== nullifier;

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax <== attester_ax;
    sig.Ay <== attester_ay;
    sig.R8x <== sig_r8x;
    sig.R8y <== sig_r8y;
    sig.S <== sig_s;
    sig.M <== msgHash.out;
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
