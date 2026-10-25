use soroban_sdk::{contracttype, Address, BytesN, Vec};

/// Groth16 proof over BN254. `a` is stored NEGATED (−A) so verification is a
/// single product-of-pairings == 1 check (spec §8.5). G1 = 64 bytes, G2 = 128.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Groth16Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

/// Groth16 verification key; `ic` has 10 entries (9 public inputs + 1).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NoteStatus {
    Active,
    Settled,
    Cancelled,
}

/// A soulbound CPCV Note (spec §7.2). Amounts are stroops.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Note {
    pub id: u32,
    pub agent: Address,
    pub total_commission: i128,
    /// floor(total_commission / 2)
    pub agent_commission: i128,
    /// total_commission − agent_commission
    pub explorador_commission: i128,
    /// Days since the Unix epoch.
    pub escritura_day: u32,
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub proof: Groth16Proof,
    /// Protocol clock (unix seconds).
    pub minted_at: u64,
    pub status: NoteStatus,
}
