//! Types, errors and cross-contract interfaces shared by `cpcv_note` and
//! `advance_pool` (spec §7). Contract-specific types live in each contract.
#![no_std]

pub mod errors;
pub mod groth16;
pub mod interfaces;
pub mod math;
pub mod types;

pub use errors::Error;
pub use types::{Groth16Proof, Note, NoteStatus, VerificationKey};
