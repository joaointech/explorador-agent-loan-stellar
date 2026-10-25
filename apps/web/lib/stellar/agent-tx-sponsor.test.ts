import { randomBytes } from "node:crypto";

import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Operation,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  xdr,
} from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";

import {
  describeHostError,
  deriveContractId,
  errorFromDiagnostics,
  invokeContractFunc,
  sponsorEnvelope,
  sponsorKeypair,
} from "./agent-tx-sponsor";

let sponsor: Keypair;

beforeAll(() => {
  process.env.SPONSOR_SECRET = Keypair.random().secret();
  sponsor = sponsorKeypair();
});

const op = () =>
  Operation.invokeHostFunction({ func: invokeContractFunc(StrKey.encodeContract(randomBytes(32)), "enable_card", []), auth: [] });
const data = (resourceFee: bigint) => new SorobanDataBuilder().setResources(1_000_000, 0, 200).setResourceFee(resourceFee).build();

function sorobanDataOf(tx: Transaction): xdr.SorobanTransactionData {
  const envelope = tx.toEnvelope();
  if (envelope.type !== "envelopeTypeTx" || envelope.v1.tx.ext.type !== "sorobanData") throw new Error("not a soroban tx");
  return envelope.v1.tx.ext.sorobanData;
}

const signedBySponsor = (tx: Transaction | FeeBumpTransaction) =>
  tx.signatures.some((s) => sponsor.verify(Buffer.from(tx.hash()), Buffer.from(s.signature.value)));

describe("sponsorEnvelope", () => {
  it("builds a plain sponsor-signed transaction when the fee fits uint32", () => {
    const tx = sponsorEnvelope(new Account(sponsor.publicKey(), "41"), op(), data(25_000_000n));
    expect(tx).toBeInstanceOf(Transaction);
    const plain = tx as Transaction;
    expect(plain.source).toBe(sponsor.publicKey());
    expect(plain.sequence).toBe("42");
    expect(plain.fee).toBe(String(1000 + 25_000_000));
    expect(sorobanDataOf(plain).resourceFee).toBe(25_000_000n);
    expect(signedBySponsor(plain)).toBe(true);
  });

  it("wraps the transaction in a fee bump when the resource fee exceeds the uint32 fee field", () => {
    const resourceFee = 4_864_761_277n; // a real testnet WASM-upload quote
    const tx = sponsorEnvelope(new Account(sponsor.publicKey(), "41"), op(), data(resourceFee));
    expect(tx).toBeInstanceOf(FeeBumpTransaction);
    const bump = tx as FeeBumpTransaction;
    expect(bump.feeSource).toBe(sponsor.publicKey());
    expect(BigInt(bump.fee)).toBe(resourceFee + 2000n); // inclusion fee × (ops + 1) + resource fee
    expect(signedBySponsor(bump)).toBe(true);

    const inner = bump.innerTransaction;
    expect(inner.sequence).toBe("42");
    expect(sorobanDataOf(inner).resourceFee).toBe(resourceFee);
    expect(signedBySponsor(inner)).toBe(true);
  });
});

describe("describeHostError", () => {
  it("names smart account and verifier errors", () => {
    expect(describeHostError("HostError: Error(Contract, #3016)")).toBe("UnauthorizedSigner (#3016)");
    expect(describeHostError("Error(Contract, #3117) in check_auth")).toBe("WebAuthnVerifiedBitNotSet (#3117)");
  });

  it("names explorador advance errors only when asked", () => {
    expect(describeHostError("Error(Contract, #7)", { advanceCodes: true })).toBe("CardNotEnabled (#7)");
    expect(describeHostError("Error(Contract, #7)")).toBe("contract error #7");
  });

  it("summarizes auth, budget and other failures", () => {
    expect(describeHostError("HostError: Error(Auth, InvalidAction)")).toBe("authorization failed (InvalidAction)");
    expect(describeHostError("HostError: Error(Budget, ExceededLimit)")).toBe("resource limit exceeded (ExceededLimit)");
    expect(describeHostError("\nsomething odd happened\nmore")).toBe("something odd happened");
    expect(describeHostError("x".repeat(500))).toHaveLength(241);
  });
});

describe("errorFromDiagnostics", () => {
  const event = (topics: xdr.ScVal[]) =>
    new xdr.DiagnosticEvent({
      inSuccessfulContractCall: false,
      event: new xdr.ContractEvent({
        ext: xdr.ExtensionPoint.v0(),
        contractId: null,
        type: xdr.ContractEventType.diagnostic,
        body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data: xdr.ScVal.scvVoid() })),
      }),
    });

  it("renders the first error topic like the host does", () => {
    const events = [
      event([xdr.ScVal.scvSymbol("fn_call")]),
      event([xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(3003))]),
    ];
    expect(errorFromDiagnostics(events)).toBe("Error(Contract, #3003)");
    const auth = [event([xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceAuth(xdr.ScErrorCode.scecInvalidAction))])];
    expect(errorFromDiagnostics(auth)).toBe("Error(Auth, InvalidAction)");
    expect(describeHostError(errorFromDiagnostics(auth)!)).toBe("authorization failed (InvalidAction)");
    expect(errorFromDiagnostics([])).toBeNull();
    expect(errorFromDiagnostics(undefined)).toBeNull();
  });
});

describe("deriveContractId", () => {
  it("is deterministic per (deployer, salt) and requires a 32-byte salt", () => {
    const salt = new Uint8Array(randomBytes(32));
    const id = deriveContractId(sponsor.publicKey(), salt);
    expect(StrKey.isValidContract(id)).toBe(true);
    expect(deriveContractId(sponsor.publicKey(), salt)).toBe(id);
    expect(deriveContractId(Keypair.random().publicKey(), salt)).not.toBe(id);
    expect(deriveContractId(sponsor.publicKey(), new Uint8Array(randomBytes(32)))).not.toBe(id);
    expect(() => deriveContractId(sponsor.publicKey(), new Uint8Array(31))).toThrow();
  });
});
