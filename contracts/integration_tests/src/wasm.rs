//! Deployment checks on the optimized wasm that `stellar contract build`
//! produces (every scenario also runs on it as `<scenario>::wasm`): contract
//! sizes, and the metered cost of each transaction type next to the native
//! run. On the wasm all three contracts execute in the Soroban VM, so VM
//! instantiation and the cross-contract calls are metered too. Ignored by
//! default because it needs the build:
//!
//! ```text
//! cd contracts && stellar contract build
//! cargo test -p integration_tests -- --ignored --nocapture
//! ```

use crate::{defaults, harness::*, worked_example};

#[test]
#[ignore = "needs the optimized wasm: cd contracts && stellar contract build"]
fn contract_sizes_fit_the_network_limit() {
    let wasm = Wasm::load();
    for (name, code) in [
        ("teurc", &wasm.teurc),
        ("cpcv_note", &wasm.cpcv_note),
        ("advance_pool", &wasm.advance_pool),
    ] {
        std::println!(
            "{name}.wasm: {} bytes ({:.1}% of the {} byte limit)",
            code.len(),
            100.0 * code.len() as f64 / limits::CONTRACT_MAX_SIZE_BYTES as f64,
            limits::CONTRACT_MAX_SIZE_BYTES
        );
        assert!(
            code.len() <= limits::CONTRACT_MAX_SIZE_BYTES,
            "{name}.wasm is too large"
        );
    }
}

#[test]
#[ignore = "needs the optimized wasm: cd contracts && stellar contract build"]
fn transaction_costs_fit_the_testnet_limits() {
    let wasm = Wasm::load();
    let mut mint_instructions = std::vec::Vec::new();
    for code in [Code::Native, Code::Wasm(&wasm)] {
        let paid = worked_example::run(&Ctx::deploy(code));
        let lost = defaults::buyer_walks_away(&Ctx::deploy(code));
        for (what, cost) in [
            ("cpcv_note.mint + advance_pool.open_line", &paid.mint),
            ("advance_pool.card_draw", &paid.draw),
            ("advance_pool.settle + cpcv_note.set_status", &paid.settle),
            ("advance_pool.cancel + cpcv_note.set_status", &lost.cancel),
            ("advance_pool.write_off", &lost.write_off),
        ] {
            let what = std::format!("{what} ({})", code.label());
            std::println!("{}", cost.report(&what));
            cost.assert_fits_testnet(&what);
        }
        mint_instructions.push(paid.mint.instructions);
    }
    // The wasm adds the contracts' own execution and VM instantiation on top
    // of the host functions (BN254 pairings dominate the mint).
    assert!(mint_instructions[1] > mint_instructions[0]);
    assert!(mint_instructions[1] < limits::TX_MAX_INSTRUCTIONS / 10);
}
