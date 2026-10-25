// Client-side wallet constants (spec §4.1, §7.1). Testnet only.

import { STROOPS_PER_EUR } from "../units";

/** Passphrase of Stellar testnet; `/api/config` is authoritative, this is the fallback. */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** Friendbot funds new testnet accounts with 10,000 test XLM. */
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

/** Where to get the Freighter browser extension. */
export const FREIGHTER_INSTALL_URL = "https://www.freighter.app/";

/** "Get 10,000 tEURC": the amount requested from `teurc.faucet` (cap is 25,000 per call). */
export const FAUCET_AMOUNT = 10_000n * STROOPS_PER_EUR;

/** Server-side faucet fallback (spec §9.7). */
export const FAUCET_FALLBACK_ENDPOINT = "/api/faucet/teurc";

/** Inclusion fee in stroops (the resource fee comes from simulation): 0.001 XLM rides out testnet surges. */
export const INCLUSION_FEE = "10000";

/** Transaction time bounds: long enough to read and approve the Freighter prompt. */
export const TX_TIMEOUT_SECS = 300;

/** Polling of `getTransaction` after submission. */
export const POLL_INTERVAL_MS = 1_000;
export const POLL_TIMEOUT_MS = 60_000;

/** Simulation-only source account: it doesn't need to exist (the SDK contract client does the same). */
export const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
