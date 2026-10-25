use soroban_sdk::contracterror;

/// Shared error numbering for all explorador advance contracts (spec §7.3).
/// Append new variants at the end; never renumber existing ones.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotAuthorized = 1,
    AlreadyInitialized = 2,
    InvalidAmount = 3,
    InsufficientCredit = 4,
    InsufficientLiquidity = 5,
    LeverageCapExceeded = 6,
    CardNotEnabled = 7,
    AgentBlocked = 8,
    LineNotActive = 9,
    GraceNotOver = 10,
    NothingToWriteOff = 11,
    DuplicateDraw = 12,
    InvalidProof = 13,
    NullifierUsed = 14,
    CommitmentUsed = 15,
    EscrituraInPast = 16,
    Soulbound = 17,
    UnknownNote = 18,
    /// `advance_clock` called while `params.demo_mode` is false.
    DemoModeDisabled = 19,
    /// `advance_clock` above the 400-day per-call cap.
    ClockAdvanceTooLarge = 20,
    /// Checked arithmetic overflowed.
    Overflow = 21,
    /// `cpcv_note.set_pool` not called yet.
    PoolNotSet = 22,
}
