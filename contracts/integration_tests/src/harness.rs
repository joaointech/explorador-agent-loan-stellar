//! Deploys the three real contracts, wires them as in spec §7.4 and drives
//! them with strict authorization. Every state-changing step goes through
//! `Ctx::step`, which checks the §5.3 invariant (and that the note registry
//! and the pool's books agree) right after the call.

use core::{cell::Cell, fmt::Debug};
use std::{format, path::PathBuf, string::String as StdString, vec::Vec as StdVec};

use advance_pool::{
    AdvancePool, AdvancePoolClient, AgentPosition, DrawResult, LineStatus, Params, PoolStats,
};
use advance_shared::{Error, Groth16Proof, NoteStatus, VerificationKey};
use cpcv_note::{CpcvNote, CpcvNoteClient};
use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, ContractEvents, EnvTestConfig,
        Events as _, Ledger as _, MockAuthContract, Register,
    },
    xdr, Address, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
};
use teurc::{Teurc, TeurcClient};

use crate::fixture::{self, FixtureNote, NOTES};

/// 1 tEURC in stroops.
pub const EUR: i128 = 10_000_000;
/// 1 EUR cent in stroops.
pub const CENT: i128 = 100_000;
pub const DAY: u64 = 86_400;
/// 1e18 fixed-point scale (borrow index, share price). The expected values
/// in these tests are derived from spec §5 independently of the contracts'
/// own constants and helpers.
pub const SCALE: i128 = 1_000_000_000_000_000_000;
pub const BPS: i128 = 10_000;
/// Seconds in a 365-day year.
pub const YEAR: i128 = 31_536_000;
/// tEURC minted to the treasury at deploy (spec §7.4 step 6).
pub const TREASURY_FUNDING: i128 = 1_000_000 * EUR;
/// explorador's first-loss seed (spec §2, §7.4 step 6).
pub const JUNIOR_SEED: i128 = 10_000 * EUR;
/// The investor's senior deposit (the §5.6 illustration: senior €100,000).
pub const SENIOR_DEPOSIT: i128 = 100_000 * EUR;
pub const BASE_URI: &str = "https://advance.explorador.ai/api/registry";
/// Validity of a signed authorization entry: ~10 minutes of ledgers, like a
/// backend or wallet signing just before submitting.
pub const SIGNATURE_LIFETIME_LEDGERS: u32 = 120;

/// Soroban per-transaction limits on Stellar testnet (protocol 29), read
/// with `stellar network settings --network testnet` on 2026-10-25. They
/// equal soroban-sdk 28's `InvocationResourceLimits::mainnet()` snapshot,
/// which the test Env also enforces on every top-level invocation.
pub mod limits {
    pub const TX_MAX_INSTRUCTIONS: i64 = 400_000_000;
    pub const TX_MEMORY_LIMIT: i64 = 41_943_040;
    pub const TX_MAX_DISK_READ_ENTRIES: u32 = 200;
    pub const TX_MAX_DISK_READ_BYTES: u32 = 200_000;
    pub const TX_MAX_WRITE_ENTRIES: u32 = 200;
    pub const TX_MAX_WRITE_BYTES: u32 = 132_096;
    pub const TX_MAX_FOOTPRINT_ENTRIES: u32 = 400;
    pub const TX_MAX_EVENTS_SIZE_BYTES: u32 = 16_384;
    pub const CONTRACT_MAX_SIZE_BYTES: usize = 131_072;
}

/// 00:00 UTC on the fixture's CPCV day (2026-10-25), the ledger time of every
/// test: all three fixture escrituras lie 60–90 days ahead.
pub fn start() -> u64 {
    u64::from(fixture::CPCV_DAY) * DAY
}

/// `ceil(x × y / d)` (no overflow at these magnitudes).
pub fn mul_div_ceil(x: i128, y: i128, d: i128) -> i128 {
    (x * y + d - 1) / d
}

/// Spec §5.2: the borrow index after one accrual of `days` at 12% APR,
/// `index + floor(index × 1200 × dt / (BPS × YEAR))`.
pub fn accrue_index(index: i128, days: u64) -> i128 {
    index + index * 1200 * (days * DAY) as i128 / (BPS * YEAR)
}

/// Spec §5.1, with `demo_mode` on (demo deployments).
pub fn spec_params() -> Params {
    Params {
        agent_apr_bps: 1200,
        protocol_fee_bps: 1000,
        senior_target_bps: 800,
        ltv_bps: 5000,
        grace_period_secs: 180 * DAY,
        max_leverage: 10,
        demo_mode: true,
    }
}

// ---------------------------------------------------------------- contract code

/// Where the contract code comes from.
#[derive(Clone, Copy)]
pub enum Code<'a> {
    /// The contract crates linked as rlibs: contract code runs natively, host
    /// functions (BN254 pairings, storage, events) are metered.
    Native,
    /// The optimized wasm from `stellar contract build`: everything is
    /// metered, including VM instantiation and execution.
    Wasm(&'a Wasm),
}

impl Code<'_> {
    pub fn label(&self) -> &'static str {
        match self {
            Code::Native => "native contract code",
            Code::Wasm(_) => "optimized wasm",
        }
    }
}

/// Declares an end-to-end scenario `fn name(code: Code)` as a module with two
/// tests: `native` (always runs) and `wasm` (the same scenario on the
/// optimized wasm; ignored unless built, run with `--ignored`).
macro_rules! e2e {
    ($(#[doc = $doc:literal])* fn $name:ident($code:ident: Code) $body:block) => {
        $(#[doc = $doc])*
        mod $name {
            use super::*;

            fn scenario($code: Code) $body

            #[test]
            fn native() {
                scenario(Code::Native)
            }

            #[test]
            #[ignore = "needs the optimized wasm: cd contracts && stellar contract build"]
            fn wasm() {
                let wasm = Wasm::load();
                scenario(Code::Wasm(&wasm))
            }
        }
    };
}
pub(crate) use e2e;

/// The optimized wasm of the three contracts.
pub struct Wasm {
    pub teurc: StdVec<u8>,
    pub cpcv_note: StdVec<u8>,
    pub advance_pool: StdVec<u8>,
}

impl Wasm {
    /// Reads `contracts/target/wasm32v1-none/release/*.wasm`, the output of
    /// `stellar contract build` (`pnpm contracts:build`).
    pub fn load() -> Self {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/wasm32v1-none/release");
        let read = |name: &str| {
            let path = dir.join(format!("{name}.wasm"));
            std::fs::read(&path).unwrap_or_else(|e| {
                panic!(
                    "{}: {e}. Build the wasm first: cd contracts && stellar contract build",
                    path.display()
                )
            })
        };
        Wasm {
            teurc: read("teurc"),
            cpcv_note: read("cpcv_note"),
            advance_pool: read("advance_pool"),
        }
    }
}

fn register(env: &Env, native: impl Register, wasm: Option<&[u8]>, args: Vec<Val>) -> Address {
    match wasm {
        Some(code) => env.register(code, args),
        None => env.register(native, args),
    }
}

// ---------------------------------------------------------------- strict auth

/// One node of an authorization tree: `contract.func(args)` plus the calls
/// it makes that need the same signer (e.g. a tEURC transfer from them).
#[derive(Clone, Debug)]
pub struct Call {
    contract: Address,
    func: &'static str,
    args: Vec<Val>,
    subs: StdVec<Call>,
}

impl Call {
    pub fn new(contract: &Address, func: &'static str, args: impl IntoVal<Env, Vec<Val>>) -> Self {
        Call {
            contract: contract.clone(),
            func,
            args: args.into_val(contract.env()),
            subs: StdVec::new(),
        }
    }

    /// Adds an authorized sub-invocation.
    pub fn then(mut self, sub: Call) -> Self {
        self.subs.push(sub);
        self
    }

    fn to_xdr(&self) -> xdr::SorobanAuthorizedInvocation {
        xdr::SorobanAuthorizedInvocation {
            function: xdr::SorobanAuthorizedFunction::ContractFn(xdr::InvokeContractArgs {
                contract_address: (&self.contract).into(),
                function_name: self.func.try_into().unwrap(),
                args: self.args.clone().into(),
            }),
            sub_invocations: self
                .subs
                .iter()
                .map(Call::to_xdr)
                .collect::<StdVec<_>>()
                .try_into()
                .unwrap(),
        }
    }

    fn to_authorized(&self) -> AuthorizedInvocation {
        AuthorizedInvocation {
            function: AuthorizedFunction::Contract((
                self.contract.clone(),
                Symbol::new(self.contract.env(), self.func),
                self.args.clone(),
            )),
            sub_invocations: self.subs.iter().map(Call::to_authorized).collect(),
        }
    }
}

/// A signer and the call tree they authorize: what the backend (operator,
/// treasury, admin), an investor (Freighter) or the agent (passkey) signs.
#[derive(Clone, Debug)]
pub struct Sig {
    pub signer: Address,
    pub root: Call,
}

pub fn sig(signer: &Address, root: Call) -> Sig {
    Sig {
        signer: signer.clone(),
        root,
    }
}

// ---------------------------------------------------------------- outcomes

/// What a call produced. Captured before the invariant check, whose own view
/// invocations replace the Env's "last invocation" events, auths and costs.
pub struct Outcome<R> {
    pub value: R,
    pub events: ContractEvents,
    pub auths: StdVec<(Address, AuthorizedInvocation)>,
    pub cost: Cost,
}

/// Metered resources of one top-level invocation (soroban-sdk invocation
/// metering), compared with the testnet limits.
#[derive(Clone, Debug)]
pub struct Cost {
    pub instructions: i64,
    pub mem_bytes: i64,
    pub disk_read_entries: u32,
    pub memory_read_entries: u32,
    pub write_entries: u32,
    pub disk_read_bytes: u32,
    pub write_bytes: u32,
    pub events_bytes: u32,
    /// Estimated resource fee in stroops of XLM (the SDK's mainnet fee
    /// snapshot; its rent rate is a deliberate overestimate).
    pub fee: i64,
    /// The rent part of `fee`: new entries and TTL extensions (persistent
    /// records are kept alive ~90 days, spec §7).
    pub rent_fee: i64,
}

impl Cost {
    fn of_last_call(env: &Env) -> Self {
        let r = env.cost_estimate().resources();
        let fee = env.cost_estimate().fee();
        Cost {
            instructions: r.instructions,
            mem_bytes: r.mem_bytes,
            disk_read_entries: r.disk_read_entries,
            memory_read_entries: r.memory_read_entries,
            write_entries: r.write_entries,
            disk_read_bytes: r.disk_read_bytes,
            write_bytes: r.write_bytes,
            events_bytes: r.contract_events_size_bytes,
            fee: fee.total,
            rent_fee: fee.persistent_entry_rent + fee.temporary_entry_rent,
        }
    }

    pub fn footprint_entries(&self) -> u32 {
        self.disk_read_entries + self.memory_read_entries + self.write_entries
    }

    /// Every per-transaction limit of the network holds.
    #[track_caller]
    pub fn assert_fits_testnet(&self, what: &str) {
        use limits::*;
        let checks = [
            ("instructions", self.instructions, TX_MAX_INSTRUCTIONS),
            ("memory bytes", self.mem_bytes, TX_MEMORY_LIMIT),
            (
                "disk read entries",
                self.disk_read_entries.into(),
                TX_MAX_DISK_READ_ENTRIES.into(),
            ),
            (
                "disk read bytes",
                self.disk_read_bytes.into(),
                TX_MAX_DISK_READ_BYTES.into(),
            ),
            (
                "write entries",
                self.write_entries.into(),
                TX_MAX_WRITE_ENTRIES.into(),
            ),
            (
                "write bytes",
                self.write_bytes.into(),
                TX_MAX_WRITE_BYTES.into(),
            ),
            (
                "footprint entries",
                self.footprint_entries().into(),
                TX_MAX_FOOTPRINT_ENTRIES.into(),
            ),
            (
                "events bytes",
                self.events_bytes.into(),
                TX_MAX_EVENTS_SIZE_BYTES.into(),
            ),
        ];
        for (name, used, limit) in checks {
            assert!(
                used <= limit,
                "{what}: {name} {used} > testnet limit {limit}"
            );
        }
    }

    /// One line per resource, with the share of the testnet limit.
    pub fn report(&self, what: &str) -> StdString {
        use limits::*;
        let pct = |used: i64, limit: i64| 100.0 * used as f64 / limit as f64;
        format!(
            "{what}:\n  \
             CPU instructions  {:>11}  ({:.1}% of {})\n  \
             memory bytes      {:>11}  ({:.1}% of {})\n  \
             ledger entries    {:>11}  ({} read in memory, {} from disk, {} written; \
             {:.1}% of {})\n  \
             write bytes       {:>11}  ({:.1}% of {})\n  \
             events bytes      {:>11}  ({:.1}% of {})\n  \
             est. resource fee {:>11}  stroops of XLM ({} of it rent)",
            self.instructions,
            pct(self.instructions, TX_MAX_INSTRUCTIONS),
            TX_MAX_INSTRUCTIONS,
            self.mem_bytes,
            pct(self.mem_bytes, TX_MEMORY_LIMIT),
            TX_MEMORY_LIMIT,
            self.footprint_entries(),
            self.memory_read_entries,
            self.disk_read_entries,
            self.write_entries,
            pct(
                self.footprint_entries().into(),
                TX_MAX_FOOTPRINT_ENTRIES.into()
            ),
            TX_MAX_FOOTPRINT_ENTRIES,
            self.write_bytes,
            pct(self.write_bytes.into(), TX_MAX_WRITE_BYTES.into()),
            TX_MAX_WRITE_BYTES,
            self.events_bytes,
            pct(self.events_bytes.into(), TX_MAX_EVENTS_SIZE_BYTES.into()),
            TX_MAX_EVENTS_SIZE_BYTES,
            self.fee,
            self.rent_fee,
        )
    }
}

/// The contract error of a failed `try_*` call.
#[track_caller]
pub fn contract_error<T: Debug, C: Debug, I: Debug>(
    res: Result<Result<T, C>, Result<Error, I>>,
) -> Error {
    match res {
        Err(Ok(e)) => e,
        other => panic!("expected a contract error, got {other:?}"),
    }
}

// ---------------------------------------------------------------- fixture data

pub fn bytes32(env: &Env, b: &[u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, b)
}

pub fn fixture_vk(env: &Env) -> VerificationKey {
    let mut ic = Vec::new(env);
    for p in fixture::VK_IC.iter() {
        ic.push_back(BytesN::from_array(env, p));
    }
    VerificationKey {
        alpha: BytesN::from_array(env, &fixture::VK_ALPHA),
        beta: BytesN::from_array(env, &fixture::VK_BETA),
        gamma: BytesN::from_array(env, &fixture::VK_GAMMA),
        delta: BytesN::from_array(env, &fixture::VK_DELTA),
        ic,
    }
}

pub fn proof(env: &Env, n: &FixtureNote) -> Groth16Proof {
    Groth16Proof {
        a: BytesN::from_array(env, &n.a),
        b: BytesN::from_array(env, &n.b),
        c: BytesN::from_array(env, &n.c),
    }
}

/// `cpcv_note.mint` arguments for fixture note `i`, minted to `to`.
pub type MintArgs = (Address, Groth16Proof, u64, u32, BytesN<32>, BytesN<32>);

/// The line status a note status must match.
pub fn line_status(status: NoteStatus) -> LineStatus {
    match status {
        NoteStatus::Active => LineStatus::Active,
        NoteStatus::Settled => LineStatus::Settled,
        NoteStatus::Cancelled => LineStatus::Cancelled,
    }
}

// ---------------------------------------------------------------- context

pub struct Ctx {
    pub env: Env,
    pub admin: Address,
    pub operator: Address,
    pub treasury: Address,
    pub card_settlement: Address,
    /// Deposited `SENIOR_DEPOSIT` into the senior vault at deploy.
    pub investor: Address,
    pub token: TeurcClient<'static>,
    pub notes: CpcvNoteClient<'static>,
    pub pool: AdvancePoolClient<'static>,
    nonces: Cell<i64>,
    refs: Cell<u32>,
}

impl Ctx {
    /// Spec §7.4: deploy tEURC, cpcv_note (fixture vk, attester key,
    /// nullifier-secret commitment) and advance_pool (§5.1 params, demo mode),
    /// `set_pool`, fund the treasury with 1,000,000 tEURC, `junior_deposit`
    /// 10,000; then an investor takes 100,000 tEURC from the faucet and
    /// deposits it into the senior vault (§4.1).
    pub fn deploy(code: Code) -> Self {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.ledger().set_timestamp(start());
        let wasm = match code {
            Code::Native => None,
            Code::Wasm(w) => Some(w),
        };
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let treasury = Address::generate(&env);
        let card_settlement = Address::generate(&env);
        let investor = Address::generate(&env);

        let token_id = register(
            &env,
            Teurc,
            wasm.map(|w| w.teurc.as_slice()),
            (admin.clone(),).into_val(&env),
        );
        let notes_id = register(
            &env,
            CpcvNote,
            wasm.map(|w| w.cpcv_note.as_slice()),
            (
                admin.clone(),
                operator.clone(),
                bytes32(&env, &fixture::ATTESTER_AX),
                bytes32(&env, &fixture::ATTESTER_AY),
                bytes32(&env, &fixture::NULLIFIER_SECRET_COMMITMENT),
                fixture_vk(&env),
                String::from_str(&env, BASE_URI),
            )
                .into_val(&env),
        );
        let pool_id = register(
            &env,
            AdvancePool,
            wasm.map(|w| w.advance_pool.as_slice()),
            (
                admin.clone(),
                operator.clone(),
                treasury.clone(),
                card_settlement.clone(),
                token_id.clone(),
                notes_id.clone(),
                spec_params(),
            )
                .into_val(&env),
        );

        let ctx = Ctx {
            token: TeurcClient::new(&env, &token_id),
            notes: CpcvNoteClient::new(&env, &notes_id),
            pool: AdvancePoolClient::new(&env, &pool_id),
            env,
            admin,
            operator,
            treasury,
            card_settlement,
            investor,
            nonces: Cell::new(0),
            refs: Cell::new(0),
        };

        // Step 5: the note contract learns the pool (admin, once).
        ctx.signed(
            &[sig(
                &ctx.admin,
                Call::new(&ctx.notes.address, "set_pool", (pool_id.clone(),)),
            )],
            || ctx.notes.set_pool(&pool_id),
        );
        // Step 6: fund the treasury and seed the junior tranche.
        ctx.signed(
            &[sig(
                &ctx.admin,
                Call::new(
                    &ctx.token.address,
                    "mint",
                    (ctx.treasury.clone(), TREASURY_FUNDING),
                ),
            )],
            || ctx.token.mint(&ctx.treasury, &TREASURY_FUNDING),
        );
        ctx.junior_deposit(JUNIOR_SEED);
        // An investor: test EURC from the faucet (no auth), then a deposit.
        for _ in 0..4 {
            ctx.step(|| ctx.token.faucet(&ctx.investor, &(25_000 * EUR)));
        }
        let shares = ctx.deposit(&ctx.investor.clone(), SENIOR_DEPOSIT).value;
        // First deposit: one share per stroop.
        assert_eq!(shares, SENIOR_DEPOSIT);
        let s = ctx.stats();
        assert_eq!(s.senior_assets, SENIOR_DEPOSIT);
        assert_eq!(s.junior_assets, JUNIOR_SEED);
        assert_eq!(s.pool_cash, SENIOR_DEPOSIT + JUNIOR_SEED);
        assert_eq!(s.share_supply, SENIOR_DEPOSIT);
        assert_eq!(s.protocol_now, start());
        ctx
    }

    // ------------------------------------------------------------ steps

    /// Runs one call, captures what it produced, then checks the §5.3
    /// invariant and the cross-contract books. Failed calls are steps too.
    pub fn step<R>(&self, call: impl FnOnce() -> R) -> Outcome<R> {
        let value = call();
        let events = self.env.events().all();
        let auths = self.env.auths();
        let cost = Cost::of_last_call(&self.env);
        self.assert_invariant();
        self.assert_books_agree();
        Outcome {
            value,
            events,
            auths,
            cost,
        }
    }

    /// Installs exactly these authorizations for the next call. Strict: any
    /// other `require_auth` fails, as on the network. Signers are contract
    /// addresses in tests (the agents are smart accounts), backed by a mock
    /// account contract that accepts the signature, like `Env::mock_auths`.
    pub fn authorize(&self, sigs: &[Sig]) {
        let entries: StdVec<xdr::SorobanAuthorizationEntry> = sigs
            .iter()
            .map(|s| {
                self.env.register_at(&s.signer, MockAuthContract, ());
                let nonce = self.nonces.get() + 1;
                self.nonces.set(nonce);
                xdr::SorobanAuthorizationEntry {
                    root_invocation: s.root.to_xdr(),
                    credentials: xdr::SorobanCredentials::Address(xdr::SorobanAddressCredentials {
                        address: (&s.signer).into(),
                        nonce,
                        // The nonce is kept (and rented) until expiry:
                        // a realistic lifetime keeps the fee estimate
                        // honest (`Env::mock_auths` uses the max TTL).
                        signature_expiration_ledger: self.env.ledger().sequence()
                            + SIGNATURE_LIFETIME_LEDGERS,
                        signature: xdr::ScVal::Void,
                    }),
                }
            })
            .collect();
        self.env.set_auths(&entries);
    }

    /// A step signed by exactly `sigs`, which must also be exactly the
    /// authorizations the contracts required.
    #[track_caller]
    pub fn signed<R>(&self, sigs: &[Sig], call: impl FnOnce() -> R) -> Outcome<R> {
        self.authorize(sigs);
        let out = self.step(call);
        let expected: StdVec<(Address, AuthorizedInvocation)> = sigs
            .iter()
            .map(|s| (s.signer.clone(), s.root.to_authorized()))
            .collect();
        assert_eq!(
            out.auths.len(),
            expected.len(),
            "required auths: {:?}",
            out.auths
        );
        for e in &expected {
            assert!(out.auths.contains(e), "{e:?} not in {:?}", out.auths);
        }
        out
    }

    // ------------------------------------------------------------ checks

    /// Spec §5.3, exactly as advance_pool's own tests check it:
    /// `senior + junior + fees == pool_cash + total_debt` with zero tolerance
    /// (the pool books its rounding surplus to junior), where pool cash is
    /// the pool's real tEURC balance minus the agents' card balances.
    #[track_caller]
    pub fn assert_invariant(&self) {
        let s = self.pool.stats();
        assert_eq!(
            s.senior_assets + s.junior_assets + s.fees_accrued,
            s.pool_cash + s.total_debt,
            "core invariant broken: {s:?}"
        );
        assert_eq!(
            s.pool_cash,
            self.token.balance(&self.pool.address) - s.total_card_balances
        );
    }

    /// The two contracts agree: each registry note has a pool line for the
    /// same agent and escritura, with credit limit = agent commission × LTV
    /// and the matching status; each fixture agent's active lines are exactly
    /// their Active notes, and the agents' positions add up to the pool's
    /// totals (each position's debt rounds up, so by at most 1 stroop each).
    #[track_caller]
    pub fn assert_books_agree(&self) {
        let ltv = i128::from(spec_params().ltv_bps);
        let notes = self.notes.list(&0, &50);
        assert_eq!(notes.len(), self.notes.count());
        for note in notes.iter() {
            let view = self.pool.line(&note.id);
            assert_eq!(view.line.note_id, note.id);
            assert_eq!(view.line.agent, note.agent);
            assert_eq!(view.line.escritura_day, note.escritura_day);
            assert_eq!(view.line.credit_limit, note.agent_commission * ltv / BPS);
            assert_eq!(
                view.line.status,
                line_status(note.status),
                "note {}",
                note.id
            );
            assert_eq!(self.notes.owner_of(&note.id), note.agent);
        }
        let stats = self.stats();
        let (mut card_balances, mut principal, mut debt) = (0, 0, 0);
        let mut positions = 0;
        for agent in [self.agent(0), self.agent(2)] {
            let p = self.position(&agent);
            // Draw order: earliest escritura first, then note id.
            let mut active: StdVec<(u32, u32)> = notes
                .iter()
                .filter(|n| n.agent == agent && n.status == NoteStatus::Active)
                .map(|n| (n.escritura_day, n.id))
                .collect();
            active.sort();
            let active: StdVec<u32> = active.into_iter().map(|(_, id)| id).collect();
            let lines: StdVec<u32> = p.lines.iter().map(|v| v.line.note_id).collect();
            assert_eq!(lines, active, "active lines of {agent:?}");
            card_balances += p.card_balance;
            principal += p.total_principal;
            debt += p.total_debt;
            positions += p.lines.len() as i128 + i128::from(p.carried_debt > 0);
        }
        assert_eq!(stats.total_card_balances, card_balances);
        assert_eq!(stats.total_principal, principal);
        assert!(
            debt >= stats.total_debt && debt <= stats.total_debt + positions,
            "positions owe {debt}, the pool books {}",
            stats.total_debt
        );
    }

    // ------------------------------------------------------------ views

    pub fn stats(&self) -> PoolStats {
        self.pool.stats()
    }

    pub fn position(&self, agent: &Address) -> AgentPosition {
        self.pool.agent_position(agent)
    }

    /// The agent fixture note `i` was proven for (A for 0 and 1, B for 2).
    pub fn agent(&self, i: usize) -> Address {
        Address::from_str(&self.env, NOTES[i].agent)
    }

    pub fn balance(&self, who: &Address) -> i128 {
        self.token.balance(who)
    }

    /// The events `contract` emitted, in order.
    pub fn emitted(
        &self,
        events: &ContractEvents,
        contract: &Address,
    ) -> StdVec<xdr::ContractEvent> {
        events.filter_by_contract(contract).events().to_vec()
    }

    /// `contract:event_name` of every event, in emission order.
    pub fn event_names(&self, events: &ContractEvents) -> StdVec<StdString> {
        let id = |a: &Address| match xdr::ScAddress::from(a) {
            xdr::ScAddress::Contract(id) => Some(id),
            other => panic!("not a contract: {other:?}"),
        };
        let (token, notes, pool) = (
            id(&self.token.address),
            id(&self.notes.address),
            id(&self.pool.address),
        );
        events
            .events()
            .iter()
            .map(|e| {
                let who = if e.contract_id == token {
                    "teurc"
                } else if e.contract_id == notes {
                    "cpcv_note"
                } else if e.contract_id == pool {
                    "advance_pool"
                } else {
                    "other"
                };
                let xdr::ContractEventBody::V0(body) = &e.body;
                let name = match body.topics.first() {
                    Some(xdr::ScVal::Symbol(s)) => s.to_utf8_string_lossy(),
                    other => format!("{other:?}"),
                };
                format!("{who}:{name}")
            })
            .collect()
    }

    // ------------------------------------------------------------ operations

    pub fn mint_args(&self, i: usize, to: &Address) -> MintArgs {
        let n = &NOTES[i];
        (
            to.clone(),
            proof(&self.env, n),
            n.total_commission_cents,
            n.escritura_day,
            bytes32(&self.env, &n.commitment),
            bytes32(&self.env, &n.nullifier),
        )
    }

    fn mint_sig(&self, args: &MintArgs) -> Sig {
        sig(
            &self.operator,
            Call::new(&self.notes.address, "mint", args.clone()),
        )
    }

    /// `cpcv_note.mint` of fixture note `i` to its proven agent, signed by
    /// the operator only: the real Groth16 verification runs on-chain and
    /// the pool's `open_line` must accept the note contract's invoker auth.
    pub fn mint(&self, i: usize) -> Outcome<u32> {
        let args = self.mint_args(i, &self.agent(i));
        self.signed(&[self.mint_sig(&args)], || {
            self.notes
                .mint(&args.0, &args.1, &args.2, &args.3, &args.4, &args.5)
        })
    }

    /// Like `mint`, to any address, returning the contract error.
    pub fn try_mint_as(&self, i: usize, to: &Address) -> Result<u32, Error> {
        let args = self.mint_args(i, to);
        self.authorize(&[self.mint_sig(&args)]);
        self.step(|| {
            match self
                .notes
                .try_mint(&args.0, &args.1, &args.2, &args.3, &args.4, &args.5)
            {
                Ok(Ok(id)) => Ok(id),
                Err(Ok(e)) => Err(e),
                other => panic!("unexpected mint result: {other:?}"),
            }
        })
        .value
    }

    /// The agent's passkey consent for card draws (§4.2 step 4).
    pub fn enable_card(&self, agent: &Address) -> Outcome<()> {
        self.signed(
            &[sig(
                agent,
                Call::new(&self.pool.address, "enable_card", (agent.clone(),)),
            )],
            || self.pool.enable_card(agent),
        )
    }

    /// A fresh card authorization reference (sha256 of the Lithic token in
    /// production).
    pub fn auth_ref(&self) -> BytesN<32> {
        let n = self.refs.get() + 1;
        self.refs.set(n);
        let mut bytes = [0xC4u8; 32];
        bytes[..4].copy_from_slice(&n.to_be_bytes());
        BytesN::from_array(&self.env, &bytes)
    }

    fn draw_sig(&self, agent: &Address, amount: i128, auth_ref: &BytesN<32>) -> Sig {
        sig(
            &self.operator,
            Call::new(
                &self.pool.address,
                "card_draw",
                (agent.clone(), amount, auth_ref.clone()),
            ),
        )
    }

    /// `card_draw` signed by the operator (the pool pays `card_settlement`
    /// with its own invoker auth).
    pub fn draw_with_ref(
        &self,
        agent: &Address,
        amount: i128,
        auth_ref: &BytesN<32>,
    ) -> Outcome<DrawResult> {
        self.signed(&[self.draw_sig(agent, amount, auth_ref)], || {
            self.pool.card_draw(agent, &amount, auth_ref)
        })
    }

    pub fn draw(&self, agent: &Address, amount: i128) -> Outcome<DrawResult> {
        self.draw_with_ref(agent, amount, &self.auth_ref())
    }

    pub fn try_draw_with_ref(&self, agent: &Address, amount: i128, auth_ref: &BytesN<32>) -> Error {
        self.authorize(&[self.draw_sig(agent, amount, auth_ref)]);
        self.step(|| contract_error(self.pool.try_card_draw(agent, &amount, auth_ref)))
            .value
    }

    pub fn try_draw(&self, agent: &Address, amount: i128) -> Error {
        self.try_draw_with_ref(agent, amount, &self.auth_ref())
    }

    /// Demo fast-forward of the protocol clock (admin).
    pub fn advance_days(&self, days: u64) -> Outcome<()> {
        let secs = days * DAY;
        self.signed(
            &[sig(
                &self.admin,
                Call::new(&self.pool.address, "advance_clock", (secs,)),
            )],
            || self.pool.advance_clock(&secs),
        )
    }

    /// Escritura: signed by the operator and by the treasury, whose tree
    /// includes the commission transfer to the pool.
    pub fn settle(&self, note_id: u32) -> Outcome<()> {
        let total = self.notes.get(&note_id).total_commission;
        let call = Call::new(&self.pool.address, "settle", (note_id,));
        self.signed(
            &[
                sig(&self.operator, call.clone()),
                sig(
                    &self.treasury,
                    call.then(Call::new(
                        &self.token.address,
                        "transfer",
                        (self.treasury.clone(), self.pool.address.clone(), total),
                    )),
                ),
            ],
            || self.pool.settle(&note_id),
        )
    }

    /// The buyer walked away (operator).
    pub fn cancel(&self, note_id: u32) -> Outcome<()> {
        self.signed(
            &[sig(
                &self.operator,
                Call::new(&self.pool.address, "cancel", (note_id,)),
            )],
            || self.pool.cancel(&note_id),
        )
    }

    fn write_off_sig(&self, agent: &Address) -> Sig {
        sig(
            &self.operator,
            Call::new(&self.pool.address, "write_off", (agent.clone(),)),
        )
    }

    /// Writes off the agent's carried debt after the grace period (operator).
    pub fn write_off(&self, agent: &Address) -> Outcome<()> {
        self.signed(&[self.write_off_sig(agent)], || self.pool.write_off(agent))
    }

    pub fn try_write_off(&self, agent: &Address) -> Error {
        self.authorize(&[self.write_off_sig(agent)]);
        self.step(|| contract_error(self.pool.try_write_off(agent)))
            .value
    }

    /// explorador's first-loss capital (treasury, incl. the transfer).
    pub fn junior_deposit(&self, amount: i128) -> Outcome<()> {
        self.signed(
            &[sig(
                &self.treasury,
                Call::new(&self.pool.address, "junior_deposit", (amount,)).then(Call::new(
                    &self.token.address,
                    "transfer",
                    (self.treasury.clone(), self.pool.address.clone(), amount),
                )),
            )],
            || self.pool.junior_deposit(&amount),
        )
    }

    /// SEP-56 deposit by `investor` for themselves (Freighter signs the
    /// deposit and the tEURC transfer it makes).
    pub fn deposit(&self, investor: &Address, assets: i128) -> Outcome<i128> {
        let me = investor.clone();
        self.signed(
            &[sig(
                investor,
                Call::new(
                    &self.pool.address,
                    "deposit",
                    (assets, me.clone(), me.clone(), me.clone()),
                )
                .then(Call::new(
                    &self.token.address,
                    "transfer",
                    (me.clone(), self.pool.address.clone(), assets),
                )),
            )],
            || self.pool.deposit(&assets, &me, &me, &me),
        )
    }

    /// SEP-56 redeem of `shares` by `investor` to themselves.
    pub fn redeem(&self, investor: &Address, shares: i128) -> Outcome<i128> {
        let me = investor.clone();
        self.signed(
            &[sig(
                investor,
                Call::new(
                    &self.pool.address,
                    "redeem",
                    (shares, me.clone(), me.clone(), me.clone()),
                ),
            )],
            || self.pool.redeem(&shares, &me, &me, &me),
        )
    }

    /// The agent moves card balance to their own account (passkey).
    pub fn withdraw_balance(&self, agent: &Address, amount: i128, to: &Address) -> Outcome<()> {
        self.signed(
            &[sig(
                agent,
                Call::new(
                    &self.pool.address,
                    "withdraw_balance",
                    (agent.clone(), amount, to.clone()),
                ),
            )],
            || self.pool.withdraw_balance(agent, &amount, to),
        )
    }

    /// Treasury takes capital out of the junior tranche (the pool pays).
    pub fn junior_withdraw(&self, amount: i128) -> Outcome<()> {
        self.signed(
            &[sig(
                &self.treasury,
                Call::new(&self.pool.address, "junior_withdraw", (amount,)),
            )],
            || self.pool.junior_withdraw(&amount),
        )
    }

    /// Protocol fees to the treasury.
    pub fn claim_fees(&self, amount: i128) -> Outcome<()> {
        self.signed(
            &[sig(
                &self.treasury,
                Call::new(&self.pool.address, "claim_fees", (amount,)),
            )],
            || self.pool.claim_fees(&amount),
        )
    }
}
