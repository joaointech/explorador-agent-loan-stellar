// Decoding the cpcv_note views the in-browser verifier reads over Soroban RPC.

import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { NOTE_CONTRACT, attesterScVal, fakeView, fixtureSnapshot, noteScVal } from "./__tests__/chain-fixtures";
import { fixtureNotes } from "./__tests__/fixtures";
import { ChainRejectedError } from "./chain-errors";
import { decodeAttester, decodeNote, decodeVerificationKey, readChainSnapshot } from "./chain-note";

describe("cpcv_note views", () => {
  it("reads note, attester parameters and verification key as the contract returns them", async () => {
    expect(await readChainSnapshot(fakeView(0, 1), 1, NOTE_CONTRACT)).toEqual(fixtureSnapshot(0, 1));
    expect(await readChainSnapshot(fakeView(2, 7), 7, NOTE_CONTRACT)).toEqual(fixtureSnapshot(2, 7));
  });

  it("asks for the note id as a u32", async () => {
    const calls: [string, xdr.ScVal[]][] = [];
    const view = fakeView(0, 1);
    await readChainSnapshot(
      async (method, args = []) => {
        calls.push([method, args]);
        return view(method, args);
      },
      1,
      NOTE_CONTRACT,
    );
    expect(calls.map(([m]) => m).sort()).toEqual(["attester_params", "get", "verification_key"]);
    expect(calls.find(([m]) => m === "get")?.[1][0].type).toBe("scvU32");
  });

  it("rejects malformed values instead of guessing", () => {
    expect(() => decodeNote(nativeToScVal(5, { type: "u32" }))).toThrow(ChainRejectedError);
    expect(() => decodeAttester(nativeToScVal({ attester_ax: new Uint8Array(31) }, { type: { attester_ax: ["symbol", "bytes"] } }))).toThrow(/32 bytes/);
    expect(() => decodeVerificationKey(attesterScVal())).toThrow(ChainRejectedError);
    // A note whose proof point A is short.
    const n = { ...fixtureNotes()[0], proof: { ...fixtureNotes()[0].proof, a: fixtureNotes()[0].proof.a.slice(2) } };
    expect(() => decodeNote(noteScVal(n, 1))).toThrow(/proof\.a/);
  });
});
