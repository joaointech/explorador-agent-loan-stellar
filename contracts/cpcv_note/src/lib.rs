#![no_std]
//! `cpcv_note` — soulbound SEP-50 CPCV Notes, the public on-chain registry and
//! the Groth16 verifier gate (spec §7.2).

use advance_shared::{
    groth16, interfaces::PoolClient, math, ttl, Error, Groth16Proof, Note, NoteStatus, VerificationKey,
};
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, panic_with_error, vec, xdr::ToXdr, Address, BytesN,
    Env, String, Vec,
};
use stellar_tokens::non_fungible::{Base, NonFungibleToken};

const MAX_LIST: u32 = 50;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Operator,
    Pool,
    AttesterAx,
    AttesterAy,
    NullifierSecretCommitment,
    Vk,
    BaseUri,
    NextId,
    Note(u32),
    NullifierUsed(BytesN<32>),
    CommitmentUsed(BytesN<32>),
    AgentNotes(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteMinted {
    #[topic]
    pub id: u32,
    #[topic]
    pub agent: Address,
    pub total_commission: i128,
    pub agent_commission: i128,
    pub escritura_day: u32,
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteStatusChanged {
    #[topic]
    pub id: u32,
    pub status: NoteStatus,
}

#[contract]
pub struct CpcvNote;

fn instance_get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(e: &Env, key: &DataKey) -> V {
    e.storage()
        .instance()
        .get(key)
        .unwrap_or_else(|| panic_with_error!(e, Error::PoolNotSet))
}

fn read_note(e: &Env, id: u32) -> Result<Note, Error> {
    let key = DataKey::Note(id);
    let note: Note = e.storage().persistent().get(&key).ok_or(Error::UnknownNote)?;
    ttl::bump_persistent(e, &key);
    Ok(note)
}

fn persistent_flag(e: &Env, key: &DataKey) -> bool {
    let used = e.storage().persistent().has(key);
    if used {
        ttl::bump_persistent(e, key);
    }
    used
}

fn agent_field_bytes(e: &Env, addr: &Address) -> BytesN<32> {
    let h = e.crypto().sha256(&addr.clone().to_xdr(e)).to_array();
    let mut out = [0u8; 32];
    out[1..32].copy_from_slice(&h[0..31]);
    BytesN::from_array(e, &out)
}

/// `base_uri` + "/" (the OZ helper appends the token id after it).
fn with_trailing_slash(e: &Env, base_uri: &String) -> String {
    let len = base_uri.len() as usize;
    if len == 0 || len >= 200 {
        panic_with_error!(e, Error::InvalidParams);
    }
    let mut buf = [0u8; 200];
    base_uri.copy_into_slice(&mut buf[..len]);
    if buf[len - 1] == b'/' {
        return base_uri.clone();
    }
    buf[len] = b'/';
    String::from_bytes(e, &buf[..len + 1])
}

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
        if vk.ic.len() != 10 {
            panic_with_error!(&e, Error::InvalidParams);
        }
        for v in [&attester_ax, &attester_ay, &nullifier_secret_commitment] {
            if !groth16::is_canonical_fr(v) {
                panic_with_error!(&e, Error::NonCanonicalField);
            }
        }
        let s = e.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Operator, &operator);
        s.set(&DataKey::AttesterAx, &attester_ax);
        s.set(&DataKey::AttesterAy, &attester_ay);
        s.set(&DataKey::NullifierSecretCommitment, &nullifier_secret_commitment);
        s.set(&DataKey::Vk, &vk);
        s.set(&DataKey::BaseUri, &base_uri);
        s.set(&DataKey::NextId, &1u32);
        Base::set_metadata(
            &e,
            with_trailing_slash(&e, &base_uri),
            String::from_str(&e, "explorador advance CPCV Note"),
            String::from_str(&e, "eaNOTE"),
        );
        ttl::bump_instance(&e);
    }

    /// Admin, once: wires the `advance_pool` contract.
    pub fn set_pool(e: Env, pool: Address) -> Result<(), Error> {
        let admin: Address = instance_get(&e, &DataKey::Admin);
        admin.require_auth();
        if e.storage().instance().has(&DataKey::Pool) {
            return Err(Error::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::Pool, &pool);
        ttl::bump_instance(&e);
        Ok(())
    }

    /// Operator: verifies the CPCV proof and mints a soulbound note to `to`.
    pub fn mint(
        e: Env,
        to: Address,
        proof: Groth16Proof,
        total_commission_cents: u64,
        escritura_day: u32,
        commitment: BytesN<32>,
        nullifier: BytesN<32>,
    ) -> Result<u32, Error> {
        // 1.
        let operator: Address = instance_get(&e, &DataKey::Operator);
        operator.require_auth();
        ttl::bump_instance(&e);
        let pool_addr: Address = e.storage().instance().get(&DataKey::Pool).ok_or(Error::PoolNotSet)?;

        if total_commission_cents == 0 {
            return Err(Error::InvalidAmount);
        }
        if !groth16::is_canonical_fr(&commitment) || !groth16::is_canonical_fr(&nullifier) {
            return Err(Error::NonCanonicalField);
        }
        // 2.
        if persistent_flag(&e, &DataKey::NullifierUsed(nullifier.clone())) {
            return Err(Error::NullifierUsed);
        }
        if persistent_flag(&e, &DataKey::CommitmentUsed(commitment.clone())) {
            return Err(Error::CommitmentUsed);
        }
        // 3–4.
        let agent_field = agent_field_bytes(&e, &to);
        let agent_commission_cents = total_commission_cents / 2;
        // 5.
        let pool = PoolClient::new(&e, &pool_addr);
        let now = pool.protocol_now();
        if (escritura_day as u64) <= now / math::DAY_SECS {
            return Err(Error::EscrituraInPast);
        }
        // 6.
        let s = e.storage().instance();
        let attester_ax: BytesN<32> = s.get(&DataKey::AttesterAx).unwrap();
        let attester_ay: BytesN<32> = s.get(&DataKey::AttesterAy).unwrap();
        let nsc: BytesN<32> = s.get(&DataKey::NullifierSecretCommitment).unwrap();
        let vk: VerificationKey = s.get(&DataKey::Vk).unwrap();
        let inputs = vec![
            &e,
            groth16::fr_from_bytes(&e, &agent_field),
            groth16::fr_from_u64(&e, total_commission_cents),
            groth16::fr_from_u64(&e, agent_commission_cents),
            groth16::fr_from_u64(&e, escritura_day as u64),
            groth16::fr_from_bytes(&e, &commitment),
            groth16::fr_from_bytes(&e, &nullifier),
            groth16::fr_from_bytes(&e, &attester_ax),
            groth16::fr_from_bytes(&e, &attester_ay),
            groth16::fr_from_bytes(&e, &nsc),
        ];
        // 7.
        if !groth16::verify(&e, &vk, &proof, &inputs) {
            return Err(Error::InvalidProof);
        }
        // 8.
        let id: u32 = s.get(&DataKey::NextId).unwrap();
        s.set(&DataKey::NextId, &(id + 1));
        let total = math::cents_to_stroops(&e, total_commission_cents);
        let agent_commission = math::cents_to_stroops(&e, agent_commission_cents);
        let note = Note {
            id,
            agent: to.clone(),
            total_commission: total,
            agent_commission,
            explorador_commission: total - agent_commission,
            escritura_day,
            commitment: commitment.clone(),
            nullifier: nullifier.clone(),
            proof,
            minted_at: now,
            status: NoteStatus::Active,
        };
        let p = e.storage().persistent();
        let note_key = DataKey::Note(id);
        p.set(&note_key, &note);
        ttl::bump_persistent(&e, &note_key);
        for key in [DataKey::NullifierUsed(nullifier.clone()), DataKey::CommitmentUsed(commitment.clone())] {
            p.set(&key, &true);
            ttl::bump_persistent(&e, &key);
        }
        let agent_key = DataKey::AgentNotes(to.clone());
        let mut ids: Vec<u32> = p.get(&agent_key).unwrap_or(Vec::new(&e));
        ids.push_back(id);
        p.set(&agent_key, &ids);
        ttl::bump_persistent(&e, &agent_key);
        // 9.
        Base::mint_with_id(&e, &to, id);
        // 10.
        pool.open_line(&id, &to, &agent_commission, &escritura_day);
        // 11.
        NoteMinted {
            id,
            agent: to,
            total_commission: total,
            agent_commission,
            escritura_day,
            commitment,
            nullifier,
        }
        .publish(&e);
        Ok(id)
    }

    /// Pool only: records a deal outcome.
    pub fn set_status(e: Env, id: u32, status: NoteStatus) -> Result<(), Error> {
        let pool: Address = e.storage().instance().get(&DataKey::Pool).ok_or(Error::PoolNotSet)?;
        pool.require_auth();
        let mut note = read_note(&e, id)?;
        note.status = status;
        e.storage().persistent().set(&DataKey::Note(id), &note);
        NoteStatusChanged { id, status }.publish(&e);
        ttl::bump_instance(&e);
        Ok(())
    }

    pub fn get(e: Env, id: u32) -> Result<Note, Error> {
        read_note(&e, id)
    }

    pub fn count(e: Env) -> u32 {
        let next: u32 = e.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        next - 1
    }

    /// Notes with ids in `[start, start + limit)` (ids start at 1), `limit ≤ 50`.
    pub fn list(e: Env, start: u32, limit: u32) -> Vec<Note> {
        let limit = limit.min(MAX_LIST);
        let count = Self::count(e.clone());
        let mut out = Vec::new(&e);
        let first = start.max(1);
        let mut id = first;
        while id <= count && id < first.saturating_add(limit) {
            if let Ok(n) = read_note(&e, id) {
                out.push_back(n);
            }
            id += 1;
        }
        out
    }

    pub fn notes_of(e: Env, agent: Address) -> Vec<u32> {
        let key = DataKey::AgentNotes(agent);
        let ids: Option<Vec<u32>> = e.storage().persistent().get(&key);
        match ids {
            Some(ids) => {
                ttl::bump_persistent(&e, &key);
                ids
            }
            None => Vec::new(&e),
        }
    }

    pub fn nullifier_used(e: Env, nullifier: BytesN<32>) -> bool {
        persistent_flag(&e, &DataKey::NullifierUsed(nullifier))
    }

    pub fn verification_key(e: Env) -> VerificationKey {
        e.storage().instance().get(&DataKey::Vk).unwrap()
    }

    pub fn agent_field(e: Env, addr: Address) -> BytesN<32> {
        agent_field_bytes(&e, &addr)
    }

    pub fn attester(e: Env) -> Vec<BytesN<32>> {
        let s = e.storage().instance();
        vec![
            &e,
            s.get::<_, BytesN<32>>(&DataKey::AttesterAx).unwrap(),
            s.get::<_, BytesN<32>>(&DataKey::AttesterAy).unwrap(),
            s.get::<_, BytesN<32>>(&DataKey::NullifierSecretCommitment).unwrap(),
        ]
    }

    pub fn pool(e: Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::Pool)
    }

    pub fn base_uri(e: Env) -> String {
        instance_get(&e, &DataKey::BaseUri)
    }
}

/// SEP-50 surface. Ownership changes are impossible: the note is soulbound.
#[contractimpl(contracttrait)]
impl NonFungibleToken for CpcvNote {
    type ContractType = Base;

    fn transfer(e: &Env, _from: Address, _to: Address, _token_id: u32) {
        panic_with_error!(e, Error::Soulbound);
    }

    fn transfer_from(e: &Env, _spender: Address, _from: Address, _to: Address, _token_id: u32) {
        panic_with_error!(e, Error::Soulbound);
    }

    fn approve(e: &Env, _approver: Address, _approved: Address, _token_id: u32, _live_until_ledger: u32) {
        panic_with_error!(e, Error::Soulbound);
    }

    fn approve_for_all(e: &Env, _owner: Address, _operator: Address, _live_until_ledger: u32) {
        panic_with_error!(e, Error::Soulbound);
    }
}

#[cfg(test)]
mod test_fixture;
#[cfg(test)]
mod test;
