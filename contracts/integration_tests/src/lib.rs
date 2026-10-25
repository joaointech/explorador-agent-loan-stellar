//! End-to-end tests of the three real contracts — `teurc`, `cpcv_note` and
//! `advance_pool` — deployed and wired together in one Soroban test
//! environment (spec §7.4), driven with the real snarkjs Groth16 proofs of
//! `contracts/shared/fixtures/groth16_fixture.rs` (spec §12.1).
//!
//! Every role-gated call runs with strict authorization: only the signatures
//! the backend (operator, treasury, admin), an investor or the agent's passkey
//! would provide, never `mock_all_auths`, so contract-to-contract calls
//! (`open_line`, `set_status`) must pass on invoker auth exactly as on the
//! network. The §5.3 invariant is checked after every step.
//!
//! Each scenario is a module with two tests: `native` (the contract crates
//! linked as rlibs; always runs) and `wasm` (the same scenario on the
//! optimized wasm from `stellar contract build`; ignored unless built, run
//! with `cargo test -p integration_tests -- --ignored`). `wasm.rs` adds the
//! contract sizes and a cost table against the testnet limits.
#![cfg(test)]

mod fixture;
mod harness;

mod defaults;
mod lifecycle;
mod mint;
mod wasm;
mod worked_example;
