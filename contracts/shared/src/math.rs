//! Fixed-point helpers for pool accounting (spec §5.2). Owned by the pool
//! workstream. Rounding always favours the pool: debts round up, shares issued
//! and assets paid out round down.
//!
//! `mul_div_floor` / `mul_div_ceil` compute `x × y / d` exactly. The product
//! is formed in `i128` when it fits and in the host's 256-bit integers
//! otherwise, so only a result outside `i128` fails (`Error::Overflow`).

use soroban_sdk::{Env, I256};

use crate::errors::Error;

/// 1e18 fixed-point scale (borrow index, share price).
pub const SCALE: i128 = 1_000_000_000_000_000_000;
/// Seconds in a (365-day) year.
pub const YEAR: i128 = 31_536_000;
/// Basis points denominator.
pub const BPS: i128 = 10_000;
/// Stroops per EUR cent (tEURC has 7 decimals).
pub const STROOPS_PER_CENT: i128 = 100_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Rounding {
    Floor,
    Ceil,
}

/// `floor(x × y / d)`. Fails with `Error::Overflow` when `d == 0` or the
/// result does not fit in an `i128`.
pub fn mul_div_floor(e: &Env, x: i128, y: i128, d: i128) -> Result<i128, Error> {
    mul_div(e, x, y, d, Rounding::Floor)
}

/// `ceil(x × y / d)`. Fails with `Error::Overflow` when `d == 0` or the
/// result does not fit in an `i128`.
pub fn mul_div_ceil(e: &Env, x: i128, y: i128, d: i128) -> Result<i128, Error> {
    mul_div(e, x, y, d, Rounding::Ceil)
}

/// Checked `a + b`.
pub fn add(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_add(b).ok_or(Error::Overflow)
}

/// Checked `a − b`.
pub fn sub(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_sub(b).ok_or(Error::Overflow)
}

/// Checked `a × b`.
pub fn mul(a: i128, b: i128) -> Result<i128, Error> {
    a.checked_mul(b).ok_or(Error::Overflow)
}

fn mul_div(e: &Env, x: i128, y: i128, d: i128, rounding: Rounding) -> Result<i128, Error> {
    if d == 0 {
        return Err(Error::Overflow);
    }
    // Make the divisor positive so that floor/ceil are Euclidean divisions.
    let (x, d) = if d < 0 {
        (
            x.checked_neg().ok_or(Error::Overflow)?,
            d.checked_neg().ok_or(Error::Overflow)?,
        )
    } else {
        (x, d)
    };
    match x.checked_mul(y) {
        // `d > 0`, so neither operation can overflow.
        Some(p) => round(p.div_euclid(d), p.rem_euclid(d) != 0, rounding),
        None => mul_div_wide(e, x, y, d, rounding),
    }
}

/// 256-bit path: `|x × y| < 2^254`, so the product always fits in an `I256`.
fn mul_div_wide(e: &Env, x: i128, y: i128, d: i128, rounding: Rounding) -> Result<i128, Error> {
    let p = I256::from_i128(e, x)
        .checked_mul(&I256::from_i128(e, y))
        .ok_or(Error::Overflow)?;
    let d = I256::from_i128(e, d);
    // Euclidean remainder in [0, d); `p − r` is an exact multiple of `d`, so the
    // (truncating) division below is exact and equals floor(p / d).
    let r = p.checked_rem_euclid(&d).ok_or(Error::Overflow)?;
    let q = p
        .checked_sub(&r)
        .and_then(|exact| exact.checked_div(&d))
        .ok_or(Error::Overflow)?
        .to_i128()
        .ok_or(Error::Overflow)?;
    round(q, r != I256::from_i32(e, 0), rounding)
}

fn round(floor: i128, inexact: bool, rounding: Rounding) -> Result<i128, Error> {
    match rounding {
        Rounding::Ceil if inexact => floor.checked_add(1).ok_or(Error::Overflow),
        _ => Ok(floor),
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::EnvTestConfig;

    fn env() -> Env {
        Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        })
    }

    #[test]
    fn small_values() {
        let e = env();
        assert_eq!(mul_div_floor(&e, 7, 3, 2), Ok(10)); // 10.5
        assert_eq!(mul_div_ceil(&e, 7, 3, 2), Ok(11));
        assert_eq!(mul_div_floor(&e, 6, 3, 2), Ok(9)); // exact
        assert_eq!(mul_div_ceil(&e, 6, 3, 2), Ok(9));
        assert_eq!(mul_div_floor(&e, 0, 5, 3), Ok(0));
        assert_eq!(mul_div_ceil(&e, 0, 5, 3), Ok(0));
        assert_eq!(mul_div_ceil(&e, 1, 1, SCALE), Ok(1));
        assert_eq!(mul_div_floor(&e, 1, 1, SCALE), Ok(0));
    }

    #[test]
    fn negative_values_round_towards_the_right_side() {
        let e = env();
        assert_eq!(mul_div_floor(&e, -7, 3, 2), Ok(-11)); // -10.5
        assert_eq!(mul_div_ceil(&e, -7, 3, 2), Ok(-10));
        assert_eq!(mul_div_floor(&e, 7, 3, -2), Ok(-11));
        assert_eq!(mul_div_ceil(&e, 7, 3, -2), Ok(-10));
        assert_eq!(mul_div_floor(&e, -7, -3, 2), Ok(10));
        assert_eq!(mul_div_ceil(&e, -7, 3, -2), Ok(11));
    }

    #[test]
    fn wide_products_use_256_bits() {
        let e = env();
        // 1e30 × 1e18 overflows i128 (~1.7e38) but the result fits.
        let x = 1_000_000_000_000_000_000_000_000_000_000i128;
        assert_eq!(mul_div_floor(&e, x, SCALE, SCALE), Ok(x));
        assert_eq!(mul_div_ceil(&e, x, SCALE, SCALE), Ok(x));
        // Inexact wide division rounds as asked: (1e30 + 1) × 1e18 / 3e18.
        assert_eq!(
            mul_div_floor(&e, x + 1, SCALE, 3 * SCALE),
            Ok(333_333_333_333_333_333_333_333_333_333)
        );
        assert_eq!(
            mul_div_ceil(&e, x + 1, SCALE, 3 * SCALE),
            Ok(333_333_333_333_333_333_333_333_333_334)
        );
        // i128::MAX × i128::MAX / i128::MAX.
        assert_eq!(
            mul_div_floor(&e, i128::MAX, i128::MAX, i128::MAX),
            Ok(i128::MAX)
        );
        assert_eq!(
            mul_div_ceil(&e, i128::MIN, i128::MAX, i128::MAX),
            Ok(i128::MIN)
        );
        // Negative wide products.
        assert_eq!(
            mul_div_floor(&e, -x - 1, SCALE, 3 * SCALE),
            Ok(-333_333_333_333_333_333_333_333_333_334)
        );
        assert_eq!(
            mul_div_ceil(&e, -x - 1, SCALE, 3 * SCALE),
            Ok(-333_333_333_333_333_333_333_333_333_333)
        );
    }

    #[test]
    fn overflow_and_zero_divisor_fail() {
        let e = env();
        assert_eq!(mul_div_floor(&e, i128::MAX, 2, 1), Err(Error::Overflow));
        assert_eq!(
            mul_div_ceil(&e, i128::MAX, i128::MAX, 2),
            Err(Error::Overflow)
        );
        assert_eq!(mul_div_floor(&e, 1, 1, 0), Err(Error::Overflow));
        assert_eq!(mul_div_ceil(&e, i128::MAX, 1, 1), Ok(i128::MAX));
        assert_eq!(mul_div_floor(&e, i128::MIN, 1, -1), Err(Error::Overflow));
        assert_eq!(add(i128::MAX, 1), Err(Error::Overflow));
        assert_eq!(sub(i128::MIN, 1), Err(Error::Overflow));
        assert_eq!(mul(i128::MAX, 2), Err(Error::Overflow));
        assert_eq!(add(2, 3), Ok(5));
        assert_eq!(sub(2, 3), Ok(-1));
        assert_eq!(mul(-2, 3), Ok(-6));
    }

    #[test]
    fn matches_reference_on_pseudo_random_inputs() {
        // Compare the i128 and I256 paths with an exact u128-based reference
        // over non-negative inputs whose products straddle the i128 limit.
        let e = env();
        let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            s
        };
        for _ in 0..2_000 {
            let x = (next() as i128) << (next() % 64);
            let y = (next() as i128) >> (next() % 64);
            let d = ((next() as i128) >> (next() % 64)).max(1);
            let (floor, ceil) = reference(x as u128, y as u128, d as u128);
            match floor {
                Some(f) if f <= i128::MAX as u128 => {
                    assert_eq!(mul_div_floor(&e, x, y, d), Ok(f as i128), "{x} {y} {d}");
                }
                _ => assert_eq!(mul_div_floor(&e, x, y, d), Err(Error::Overflow)),
            }
            match ceil {
                Some(c) if c <= i128::MAX as u128 => {
                    assert_eq!(mul_div_ceil(&e, x, y, d), Ok(c as i128), "{x} {y} {d}");
                }
                _ => assert_eq!(mul_div_ceil(&e, x, y, d), Err(Error::Overflow)),
            }
        }
    }

    /// Exact floor/ceil of x × y / d via 256-bit schoolbook arithmetic on
    /// (hi, lo) u128 halves; `None` when the quotient exceeds u128.
    fn reference(x: u128, y: u128, d: u128) -> (Option<u128>, Option<u128>) {
        // 128 × 128 → 256-bit product.
        let (x1, x0) = (x >> 64, x & u64::MAX as u128);
        let (y1, y0) = (y >> 64, y & u64::MAX as u128);
        let p00 = x0 * y0;
        let p01 = x0 * y1;
        let p10 = x1 * y0;
        let p11 = x1 * y1;
        let mid = (p00 >> 64) + (p01 & u64::MAX as u128) + (p10 & u64::MAX as u128);
        let lo = (p00 & u64::MAX as u128) | (mid << 64);
        let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
        // Long division of (hi, lo) by d, bit by bit.
        let mut q_hi: u128 = 0;
        let mut q_lo: u128 = 0;
        let mut r: u128 = 0;
        for i in (0..256).rev() {
            let bit = if i >= 128 {
                (hi >> (i - 128)) & 1
            } else {
                (lo >> i) & 1
            };
            let carry = r >> 127;
            r = (r << 1) | bit;
            if carry == 1 || r >= d {
                r = r.wrapping_sub(d);
                if i >= 128 {
                    q_hi |= 1 << (i - 128);
                } else {
                    q_lo |= 1 << i;
                }
            }
        }
        if q_hi != 0 {
            return (None, None);
        }
        let ceil = if r != 0 {
            q_lo.checked_add(1)
        } else {
            Some(q_lo)
        };
        (Some(q_lo), ceil)
    }
}
