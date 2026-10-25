//! Checked fixed-point helpers (§5.1 constants, §5.2 rounding rules).
//!
//! All intermediate products used by the pool stay well inside i128
//! (amounts ≤ ~10^15 stroops × SCALE 10^18 ≈ 10^33 < 1.7 × 10^38), so plain
//! checked i128 arithmetic is enough. Overflow surfaces as `Error::MathOverflow`.

use crate::errors::Error;
use soroban_sdk::{panic_with_error, Env};

pub const SCALE: i128 = 1_000_000_000_000_000_000;
pub const YEAR: i128 = 31_536_000;
pub const BPS: i128 = 10_000;
pub const DAY_SECS: u64 = 86_400;
/// 1 EUR cent in tEURC stroops (7 decimals).
pub const STROOPS_PER_CENT: i128 = 100_000;

pub fn mul_div_floor(e: &Env, x: i128, y: i128, z: i128) -> i128 {
    let r = x
        .checked_mul(y)
        .unwrap_or_else(|| panic_with_error!(e, Error::MathOverflow));
    if z == 0 {
        panic_with_error!(e, Error::MathOverflow);
    }
    let q = r / z;
    if (r % z != 0) && ((r < 0) != (z < 0)) {
        q - 1
    } else {
        q
    }
}

pub fn mul_div_ceil(e: &Env, x: i128, y: i128, z: i128) -> i128 {
    let r = x
        .checked_mul(y)
        .unwrap_or_else(|| panic_with_error!(e, Error::MathOverflow));
    if z == 0 {
        panic_with_error!(e, Error::MathOverflow);
    }
    let q = r / z;
    if (r % z != 0) && ((r < 0) == (z < 0)) {
        q + 1
    } else {
        q
    }
}

pub fn add(e: &Env, a: i128, b: i128) -> i128 {
    a.checked_add(b)
        .unwrap_or_else(|| panic_with_error!(e, Error::MathOverflow))
}

pub fn sub(e: &Env, a: i128, b: i128) -> i128 {
    a.checked_sub(b)
        .unwrap_or_else(|| panic_with_error!(e, Error::MathOverflow))
}

pub fn mul(e: &Env, a: i128, b: i128) -> i128 {
    a.checked_mul(b)
        .unwrap_or_else(|| panic_with_error!(e, Error::MathOverflow))
}

pub fn cents_to_stroops(e: &Env, cents: u64) -> i128 {
    mul(e, cents as i128, STROOPS_PER_CENT)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn rounding() {
        let e = Env::default();
        assert_eq!(mul_div_floor(&e, 7, 3, 2), 10);
        assert_eq!(mul_div_ceil(&e, 7, 3, 2), 11);
        assert_eq!(mul_div_floor(&e, 6, 3, 2), 9);
        assert_eq!(mul_div_ceil(&e, 6, 3, 2), 9);
        assert_eq!(mul_div_floor(&e, -7, 3, 2), -11);
        assert_eq!(mul_div_ceil(&e, -7, 3, 2), -10);
    }
}
