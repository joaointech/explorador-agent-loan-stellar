//! Events of `advance_pool` (spec §7.3). Default `#[contractevent]` layout:
//! the only topic is the snake_case struct name (`card_draw`, …) and every
//! field goes in the data map. SEP-56 `deposit` / `withdraw` events come from
//! `stellar_tokens::vault` (OpenZeppelin's SEP-56 layout).

use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CardEnabled {
    pub agent: Address,
    pub enabled: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CardDraw {
    pub agent: Address,
    pub amount: i128,
    pub from_balance: i128,
    pub from_credit: i128,
    pub auth_ref: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LineOpened {
    pub note_id: u32,
    pub agent: Address,
    pub credit_limit: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteSettled {
    pub note_id: u32,
    pub agent: Address,
    pub total_commission: i128,
    /// Line debt repaid from the agent's half (principal + interest).
    pub debt_repaid: i128,
    /// Interest part of `debt_repaid`.
    pub interest_paid: i128,
    /// Carried debt repaid from what was left of the agent's half.
    pub carried_repaid: i128,
    /// Credited to the agent's card balance.
    pub agent_payout: i128,
    /// explorador's half, added to the junior tranche.
    pub junior_deposit: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteCancelled {
    pub note_id: u32,
    pub agent: Address,
    /// Line debt moved into the agent's carried debt (before any repayment
    /// from the card balance).
    pub debt_carried: i128,
    pub grace_deadline: Option<u64>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DebtWrittenOff {
    pub agent: Address,
    /// Carried debt removed from the book.
    pub amount: i128,
    pub junior_loss: i128,
    pub senior_loss: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BalanceWithdrawn {
    pub agent: Address,
    pub amount: i128,
    pub to: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JuniorDeposit {
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JuniorWithdraw {
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeesClaimed {
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClockAdvanced {
    pub secs: u64,
    pub protocol_now: u64,
}
