use soroban_sdk::contracterror;

/// Error codes shared by all explorador advance contracts (§7.3).
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
    // Additional codes not listed in the spec (see DECISIONS.md).
    MathOverflow = 19,
    DemoModeDisabled = 20,
    InvalidParams = 21,
    ClockAdvanceTooLarge = 22,
    FaucetLimitExceeded = 23,
    InsufficientBalance = 24,
    ExceedsMaximum = 25,
    PoolNotSet = 26,
    NonCanonicalField = 27,
}
