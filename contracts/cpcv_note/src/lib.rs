//! cpcv_note (spec §7.2): soulbound SEP-50 CPCV Notes, the public on-chain
//! registry of every financed deal, and on-chain verification of the CPCV
//! attestation Groth16 proof (spec §8).
//!
//! A note is minted to the agent's smart account only if the proof verifies
//! against the public inputs rebuilt here (agent_field of the recipient,
//! commission, split, escritura day, commitment, nullifier and the stored
//! attester key / nullifier-secret commitment). Notes can never be
//! transferred or approved.
#![no_std]
// The constructor signature (8 arguments) is fixed by spec §7.2.
#![allow(clippy::too_many_arguments)]

use advance_shared::{
    groth16, interfaces::PoolClient, math::STROOPS_PER_CENT, Error, Groth16Proof, Note, NoteStatus,
    VerificationKey,
};
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, panic_with_error, vec, xdr::ToXdr,
    Address, BytesN, Env, IntoVal, String, Val, Vec,
};
use stellar_tokens::non_fungible::{
    Base, NFTStorageKey, NonFungibleToken, NonFungibleTokenError, MAX_BASE_URI_LEN,
};

/// SEP-50 collection name.
pub const NAME: &str = "explorador advance CPCV Note";
/// SEP-50 collection symbol.
pub const SYMBOL: &str = "eaNOTE";
/// Maximum page size of `list`.
pub const MAX_LIST: u32 = 50;
/// Public inputs of the CPCV attestation circuit (spec §8.2).
pub const PUBLIC_INPUTS: u32 = 9;

const SECONDS_PER_DAY: u64 = 86_400;
const DAY_IN_LEDGERS: u32 = 17_280;
/// Instance TTL: ~30 days, extended when below half (spec §7).
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP / 2;
/// Persistent records: ~90 days, extended when below half (spec §7).
const PERSISTENT_BUMP: u32 = 90 * DAY_IN_LEDGERS;
const PERSISTENT_THRESHOLD: u32 = PERSISTENT_BUMP / 2;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    // instance
    Admin,
    Operator,
    Pool,
    AttesterAx,
    AttesterAy,
    NullifierSecretCommitment,
    Vk,
    BaseUri,
    NextId,
    // persistent
    Note(u32),
    /// nullifier → id of the note that used it
    NullifierUsed(BytesN<32>),
    /// commitment → id of the note that used it
    CommitmentUsed(BytesN<32>),
    /// agent → ids of their notes, in mint order
    AgentNotes(Address),
}

/// The proof parameters fixed at deploy time (public inputs 6–8). Lets anyone
/// rebuild a note's public signals from on-chain data alone.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttesterParams {
    pub attester_ax: BytesN<32>,
    pub attester_ay: BytesN<32>,
    pub nullifier_secret_commitment: BytesN<32>,
}

/// Emitted when a note is minted. Topic `note_minted`; amounts in stroops.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteMinted {
    pub id: u32,
    pub agent: Address,
    pub total_commission: i128,
    pub agent_commission: i128,
    pub escritura_day: u32,
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
}

/// Emitted when the pool settles or cancels a note. Topic `note_status_changed`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteStatusChanged {
    pub id: u32,
    pub status: NoteStatus,
}

#[contract]
pub struct CpcvNote;

#[contractimpl]
impl CpcvNote {
    pub fn __constructor(
        e: Env,
        admin: Address,
        operator: Address,
        attester_ax: BytesN<32>,
        attester_ay: BytesN<32>,
        nullifier_secret_commitment: BytesN<32>,
        vk: VerificationKey,
        base_uri: String,
    ) {
        if vk.ic.len() != PUBLIC_INPUTS + 1 {
            panic_with_error!(&e, Error::InvalidProof);
        }
        for value in [&attester_ax, &attester_ay, &nullifier_secret_commitment] {
            if !groth16::is_canonical_fr(value) {
                panic_with_error!(&e, Error::InvalidProof);
            }
        }
        // Leave room for the "/" separator within OpenZeppelin's 200-byte limit.
        if base_uri.len() as usize >= MAX_BASE_URI_LEN {
            panic_with_error!(&e, NonFungibleTokenError::BaseUriMaxLenExceeded);
        }
        let s = e.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Operator, &operator);
        s.set(&DataKey::AttesterAx, &attester_ax);
        s.set(&DataKey::AttesterAy, &attester_ay);
        s.set(
            &DataKey::NullifierSecretCommitment,
            &nullifier_secret_commitment,
        );
        s.set(&DataKey::Vk, &vk);
        s.set(&DataKey::BaseUri, &base_uri);
        s.set(&DataKey::NextId, &1u32);
        // OpenZeppelin composes token_uri as metadata.base_uri + id, so its copy
        // ends with the "/" separator: token_uri = base_uri + "/" + id.
        Base::set_metadata(
            &e,
            with_trailing_slash(&e, &base_uri),
            String::from_str(&e, NAME),
            String::from_str(&e, SYMBOL),
        );
        extend_instance(&e);
    }

    /// Wires the advance_pool contract (admin, once).
    pub fn set_pool(e: Env, pool: Address) -> Result<(), Error> {
        admin(&e).require_auth();
        extend_instance(&e);
        if e.storage().instance().has(&DataKey::Pool) {
            return Err(Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Pool, &pool);
        Ok(())
    }

    /// Verifies the CPCV attestation proof and mints the soulbound note to
    /// `to` (operator only). Amounts are EUR cents; the note stores stroops.
    pub fn mint(
        e: Env,
        to: Address,
        proof: Groth16Proof,
        total_commission_cents: u64,
        escritura_day: u32,
        commitment: BytesN<32>,
        nullifier: BytesN<32>,
    ) -> Result<u32, Error> {
        // 1. operator auth
        operator(&e).require_auth();
        extend_instance(&e);
        if total_commission_cents == 0 {
            return Err(Error::InvalidAmount);
        }

        // 2. one note per nullifier (deal) and per commitment (record)
        let persistent = e.storage().persistent();
        if persistent.has(&DataKey::NullifierUsed(nullifier.clone())) {
            return Err(Error::NullifierUsed);
        }
        if persistent.has(&DataKey::CommitmentUsed(commitment.clone())) {
            return Err(Error::CommitmentUsed);
        }

        // 3. the proof must be bound to the recipient
        let agent_field = compute_agent_field(&e, &to);

        // 4. agent gets floor(total / 2)
        let agent_commission_cents = total_commission_cents / 2;

        // 5. the escritura must be in the future on the protocol clock
        let pool = PoolClient::new(&e, &pool(&e)?);
        let now = pool.protocol_now();
        if u64::from(escritura_day) <= now / SECONDS_PER_DAY {
            return Err(Error::EscrituraInPast);
        }

        // 6. public inputs, in circuit order (spec §8.2)
        let s = e.storage().instance();
        let public_inputs: Vec<BytesN<32>> = vec![
            &e,
            agent_field,
            u64_field(&e, total_commission_cents),
            u64_field(&e, agent_commission_cents),
            u64_field(&e, u64::from(escritura_day)),
            commitment.clone(),
            nullifier.clone(),
            s.get::<_, BytesN<32>>(&DataKey::AttesterAx).unwrap(),
            s.get::<_, BytesN<32>>(&DataKey::AttesterAy).unwrap(),
            s.get::<_, BytesN<32>>(&DataKey::NullifierSecretCommitment)
                .unwrap(),
        ];

        // 7. Groth16 (spec §8.5)
        let vk: VerificationKey = s.get(&DataKey::Vk).unwrap();
        if !groth16::verify(&e, &vk, &proof, &public_inputs) {
            return Err(Error::InvalidProof);
        }

        // 8. store the note (stroops) and mark nullifier + commitment used
        let id: u32 = s.get(&DataKey::NextId).unwrap();
        let total_commission = cents_to_stroops(total_commission_cents)?;
        let agent_commission = cents_to_stroops(agent_commission_cents)?;
        let note = Note {
            id,
            agent: to.clone(),
            total_commission,
            agent_commission,
            explorador_commission: total_commission
                .checked_sub(agent_commission)
                .ok_or(Error::Overflow)?,
            escritura_day,
            commitment: commitment.clone(),
            nullifier: nullifier.clone(),
            proof,
            minted_at: now,
            status: NoteStatus::Active,
        };
        set_persistent(&e, &DataKey::Note(id), &note);
        set_persistent(&e, &DataKey::NullifierUsed(nullifier.clone()), &id);
        set_persistent(&e, &DataKey::CommitmentUsed(commitment.clone()), &id);
        let mut agent_notes = notes_of(&e, &to);
        agent_notes.push_back(id);
        set_persistent(&e, &DataKey::AgentNotes(to.clone()), &agent_notes);
        s.set(&DataKey::NextId, &id.checked_add(1).ok_or(Error::Overflow)?);

        // 9. mint the soulbound NFT, token id = note id
        Base::mint_with_id(&e, &to, id);
        extend_persistent(&e, &NFTStorageKey::Owner(id));
        extend_persistent(&e, &NFTStorageKey::Balance(to.clone()));

        // 10. open the credit line (the note is passed by value: no re-entry)
        pool.open_line(&note);

        // 11. event
        NoteMinted {
            id,
            agent: to,
            total_commission,
            agent_commission,
            escritura_day,
            commitment,
            nullifier,
        }
        .publish(&e);
        Ok(id)
    }

    /// Settled / Cancelled, set by the pool (pool only).
    pub fn set_status(e: Env, id: u32, status: NoteStatus) -> Result<(), Error> {
        pool(&e)?.require_auth();
        extend_instance(&e);
        let mut note = load_note(&e, id)?;
        note.status = status;
        set_persistent(&e, &DataKey::Note(id), &note);
        NoteStatusChanged { id, status }.publish(&e);
        Ok(())
    }

    pub fn get(e: Env, id: u32) -> Result<Note, Error> {
        extend_instance(&e);
        load_note(&e, id)
    }

    /// Number of notes minted (ids run from 1 to count).
    pub fn count(e: Env) -> u32 {
        extend_instance(&e);
        count(&e)
    }

    /// Notes with id ≥ `start` (ids start at 1, so 0 and 1 both mean "from
    /// the first"), in id order, at most `min(limit, 50)`.
    pub fn list(e: Env, start: u32, limit: u32) -> Vec<Note> {
        extend_instance(&e);
        let count = count(&e);
        let limit = limit.min(MAX_LIST);
        let mut notes = Vec::new(&e);
        let mut id = start.max(1);
        while id <= count && notes.len() < limit {
            if let Ok(note) = load_note(&e, id) {
                notes.push_back(note);
            }
            id += 1;
        }
        notes
    }

    /// Note ids of `agent`, in mint order.
    pub fn notes_of(e: Env, agent: Address) -> Vec<u32> {
        extend_instance(&e);
        let key = DataKey::AgentNotes(agent.clone());
        if e.storage().persistent().has(&key) {
            extend_persistent(&e, &key);
        }
        notes_of(&e, &agent)
    }

    pub fn nullifier_used(e: Env, nullifier: BytesN<32>) -> bool {
        extend_instance(&e);
        let key = DataKey::NullifierUsed(nullifier);
        let used = e.storage().persistent().has(&key);
        if used {
            extend_persistent(&e, &key);
        }
        used
    }

    pub fn verification_key(e: Env) -> VerificationKey {
        extend_instance(&e);
        e.storage().instance().get(&DataKey::Vk).unwrap()
    }

    /// `0x00 ‖ sha256(ScVal::Address XDR)[0..31]` (spec §8.4), the circuit's
    /// public input 0. View helper for the TypeScript parity tests.
    pub fn agent_field(e: Env, addr: Address) -> BytesN<32> {
        compute_agent_field(&e, &addr)
    }

    /// Attester public key and nullifier-secret commitment (public inputs 6–8).
    pub fn attester_params(e: Env) -> AttesterParams {
        extend_instance(&e);
        let s = e.storage().instance();
        AttesterParams {
            attester_ax: s.get(&DataKey::AttesterAx).unwrap(),
            attester_ay: s.get(&DataKey::AttesterAy).unwrap(),
            nullifier_secret_commitment: s.get(&DataKey::NullifierSecretCommitment).unwrap(),
        }
    }
}

/// SEP-50 surface (OpenZeppelin `Base`): balance, owner_of, name, symbol,
/// token_uri, get_approved, is_approved_for_all. Notes are soulbound: every
/// transfer and approval fails with `Error::Soulbound`.
#[contractimpl(contracttrait)]
impl NonFungibleToken for CpcvNote {
    type ContractType = Base;

    fn transfer(e: &Env, _from: Address, _to: Address, _token_id: u32) {
        panic_with_error!(e, Error::Soulbound);
    }

    fn transfer_from(e: &Env, _spender: Address, _from: Address, _to: Address, _token_id: u32) {
        panic_with_error!(e, Error::Soulbound);
    }

    fn approve(
        e: &Env,
        _approver: Address,
        _approved: Address,
        _token_id: u32,
        _live_until_ledger: u32,
    ) {
        panic_with_error!(e, Error::Soulbound);
    }

    fn approve_for_all(e: &Env, _owner: Address, _operator: Address, _live_until_ledger: u32) {
        panic_with_error!(e, Error::Soulbound);
    }
}

// ---------- helpers ----------

fn admin(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Admin).unwrap()
}

fn operator(e: &Env) -> Address {
    e.storage().instance().get(&DataKey::Operator).unwrap()
}

fn pool(e: &Env) -> Result<Address, Error> {
    e.storage()
        .instance()
        .get(&DataKey::Pool)
        .ok_or(Error::PoolNotSet)
}

fn count(e: &Env) -> u32 {
    e.storage()
        .instance()
        .get::<_, u32>(&DataKey::NextId)
        .unwrap_or(1)
        - 1
}

fn load_note(e: &Env, id: u32) -> Result<Note, Error> {
    let key = DataKey::Note(id);
    let note: Note = e
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::UnknownNote)?;
    extend_persistent(e, &key);
    Ok(note)
}

fn notes_of(e: &Env, agent: &Address) -> Vec<u32> {
    e.storage()
        .persistent()
        .get(&DataKey::AgentNotes(agent.clone()))
        .unwrap_or_else(|| Vec::new(e))
}

fn compute_agent_field(e: &Env, addr: &Address) -> BytesN<32> {
    let digest = e.crypto().sha256(&addr.clone().to_xdr(e)).to_array();
    let mut out = [0u8; 32];
    out[1..].copy_from_slice(&digest[..31]);
    BytesN::from_array(e, &out)
}

/// A u64 as a 32-byte big-endian field element.
fn u64_field(e: &Env, value: u64) -> BytesN<32> {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&value.to_be_bytes());
    BytesN::from_array(e, &out)
}

fn cents_to_stroops(cents: u64) -> Result<i128, Error> {
    i128::from(cents)
        .checked_mul(STROOPS_PER_CENT)
        .ok_or(Error::Overflow)
}

/// `base_uri` + "/" unless empty or already ending with "/". Callers ensure
/// `base_uri.len() < MAX_BASE_URI_LEN`.
fn with_trailing_slash(e: &Env, base_uri: &String) -> String {
    let len = base_uri.len() as usize;
    if len == 0 {
        return base_uri.clone();
    }
    let mut buf = [0u8; MAX_BASE_URI_LEN];
    base_uri.copy_into_slice(&mut buf[..len]);
    if buf[len - 1] == b'/' {
        return base_uri.clone();
    }
    buf[len] = b'/';
    String::from_bytes(e, &buf[..=len])
}

fn extend_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

fn extend_persistent<K: IntoVal<Env, Val>>(e: &Env, key: &K) {
    e.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

fn set_persistent<K: IntoVal<Env, Val>, V: IntoVal<Env, Val>>(e: &Env, key: &K, value: &V) {
    e.storage().persistent().set(key, value);
    extend_persistent(e, key);
}

#[cfg(test)]
mod test;
