//! Fixed-point helpers for pool accounting (spec §5.2). Owned by the pool
//! workstream. Rounding always favours the pool: debts round up, shares issued
//! and assets paid out round down.

/// 1e18 fixed-point scale (borrow index, share price).
pub const SCALE: i128 = 1_000_000_000_000_000_000;
/// Seconds in a (365-day) year.
pub const YEAR: i128 = 31_536_000;
/// Basis points denominator.
pub const BPS: i128 = 10_000;
/// Stroops per EUR cent (tEURC has 7 decimals).
pub const STROOPS_PER_CENT: i128 = 100_000;
