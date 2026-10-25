//! TTL policy: instance and persistent records are extended to ≈ 10 days whenever they
//! drop below ≈ 6 days. Kept short on purpose: testnet's Soroban state is above its
//! target size, so rent is surcharged and long extensions are very expensive (see
//! DECISIONS.md). New entries start at the network minimum (7 days), so creation never
//! pays for an extension.

pub const DAY_IN_LEDGERS: u32 = 17_280;

pub const INSTANCE_EXTEND_TO: u32 = 10 * DAY_IN_LEDGERS;
pub const INSTANCE_THRESHOLD: u32 = 6 * DAY_IN_LEDGERS;

pub const PERSISTENT_EXTEND_TO: u32 = 10 * DAY_IN_LEDGERS;
pub const PERSISTENT_THRESHOLD: u32 = 6 * DAY_IN_LEDGERS;

use soroban_sdk::{Env, IntoVal, Val};

pub fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND_TO);
}

pub fn bump_persistent<K: IntoVal<Env, Val>>(e: &Env, key: &K) {
    e.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_THRESHOLD, PERSISTENT_EXTEND_TO);
}
