import { describe, expect, it } from "vitest";

import {
  addressKind,
  EXPLORER_BASE,
  explorerAccountUrl,
  explorerAddressUrl,
  explorerContractUrl,
  explorerLedgerUrl,
  explorerTxUrl,
  truncateAddress,
  truncateHash,
} from "./address";

const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHG4XQA";
const ACCOUNT = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("truncation", () => {
  it("truncates addresses as `CDLZ…4XQA`", () => {
    expect(CONTRACT).toHaveLength(56);
    expect(truncateAddress(CONTRACT)).toBe("CDLZ…4XQA");
    expect(truncateAddress(ACCOUNT, 6, 6)).toBe("GBRPYH…C7OX2H");
  });

  it("leaves short strings alone", () => {
    expect(truncateAddress("")).toBe("");
    expect(truncateAddress("GABCDEFGH")).toBe("GABCDEFGH");
  });

  it("truncates hashes 6 + 4", () => {
    expect(truncateHash(HASH)).toBe("a1b2c3…8f90");
  });
});

describe("explorer links", () => {
  it("classifies addresses", () => {
    expect(addressKind(CONTRACT)).toBe("contract");
    expect(addressKind(ACCOUNT)).toBe("account");
    expect(addressKind("MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAAGZFQ")).toBe("muxed");
    expect(addressKind("0xdead")).toBe("unknown");
  });

  it("builds stellar.expert testnet URLs", () => {
    expect(EXPLORER_BASE).toBe("https://stellar.expert/explorer/testnet");
    expect(explorerTxUrl(HASH)).toBe(`https://stellar.expert/explorer/testnet/tx/${HASH}`);
    expect(explorerAccountUrl(ACCOUNT)).toBe(`https://stellar.expert/explorer/testnet/account/${ACCOUNT}`);
    expect(explorerContractUrl(CONTRACT)).toBe(`https://stellar.expert/explorer/testnet/contract/${CONTRACT}`);
    expect(explorerLedgerUrl(123456)).toBe("https://stellar.expert/explorer/testnet/ledger/123456");
  });

  it("picks the page from the address prefix and accepts a custom base", () => {
    expect(explorerAddressUrl(CONTRACT)).toContain("/contract/");
    expect(explorerAddressUrl(ACCOUNT)).toContain("/account/");
    expect(explorerTxUrl("abc", "https://example.test/explorer/")).toBe("https://example.test/explorer/tx/abc");
  });
});
