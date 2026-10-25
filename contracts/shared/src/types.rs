use soroban_sdk::{contracttype, Address, BytesN, Vec};

/// Groth16 proof. `a` is stored NEGATED (−A) so verification is a single
/// product-of-pairings == 1 check (§8.5).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Groth16Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    /// Length 10 (9 public inputs + 1).
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NoteStatus {
    Active,
    Settled,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Note {
    pub id: u32,
    pub agent: Address,
    /// stroops
    pub total_commission: i128,
    /// stroops, floor(total / 2)
    pub agent_commission: i128,
    /// stroops, total − agent
    pub explorador_commission: i128,
    /// days since Unix epoch
    pub escritura_day: u32,
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub proof: Groth16Proof,
    /// protocol clock
    pub minted_at: u64,
    pub status: NoteStatus,
}
