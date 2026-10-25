use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CardEnabled {
    #[topic]
    pub agent: Address,
    pub enabled: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CardDraw {
    #[topic]
    pub agent: Address,
    pub amount: i128,
    pub from_balance: i128,
    pub from_credit: i128,
    pub auth_ref: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LineOpened {
    #[topic]
    pub note_id: u32,
    #[topic]
    pub agent: Address,
    pub credit_limit: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteSettled {
    #[topic]
    pub note_id: u32,
    #[topic]
    pub agent: Address,
    pub total_commission: i128,
    pub debt_repaid: i128,
    pub interest_paid: i128,
    pub carried_repaid: i128,
    pub agent_payout: i128,
    pub junior_deposit: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NoteCancelled {
    #[topic]
    pub note_id: u32,
    #[topic]
    pub agent: Address,
    pub debt_carried: i128,
    pub grace_deadline: Option<u64>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DebtWrittenOff {
    #[topic]
    pub agent: Address,
    pub amount: i128,
    pub junior_loss: i128,
    pub senior_loss: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BalanceWithdrawn {
    #[topic]
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

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BlockedSet {
    #[topic]
    pub agent: Address,
    pub blocked: bool,
}
