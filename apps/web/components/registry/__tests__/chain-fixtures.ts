// Test-only: the cpcv_note views (`get`, `attester_params`, `verification_key`)
// for the committed fixture notes, encoded as the contract returns them
// (#[contracttype] structs are ScMaps with symbol keys), plus a fake RPC.

import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

import { fromHex } from "@/lib/zk/field";
import { vkToSorobanHex } from "@/lib/zk/format";

import type { ChainSnapshot, ViewCall } from "../chain-note";
import { fixtureNotes, loadServedVerificationKey, type FixtureNote } from "./fixtures";

export const NOTE_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** TEST attester parameters of the fixture (public inputs 6–8). */
export function fixtureAttesterHex() {
  const [, , , , , , ax, ay, nsc] = fixtureNotes()[0].publicInputs.map((d) => BigInt(d).toString(16).padStart(64, "0"));
  return { attesterAx: ax, attesterAy: ay, nullifierSecretCommitment: nsc };
}

const sym = (type: "u32" | "u64" | "i128" | "address" | "bytes"): ["symbol", typeof type] => ["symbol", type];

export function noteScVal(n: FixtureNote, id: number): xdr.ScVal {
  const total = n.totalCommissionCents * 100_000n;
  const agent = n.agentCommissionCents * 100_000n;
  const proof = nativeToScVal({ a: fromHex(n.proof.a), b: fromHex(n.proof.b), c: fromHex(n.proof.c) }, { type: { a: sym("bytes"), b: sym("bytes"), c: sym("bytes") } });
  return nativeToScVal(
    {
      id,
      agent: n.agent,
      total_commission: total,
      agent_commission: agent,
      explorador_commission: total - agent,
      escritura_day: n.escrituraDay,
      commitment: fromHex(n.commitment),
      nullifier: fromHex(n.nullifier),
      proof,
      minted_at: BigInt((n.escrituraDay - 90) * 86_400),
      status: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Active")]),
    },
    {
      type: {
        id: sym("u32"),
        agent: sym("address"),
        total_commission: sym("i128"),
        agent_commission: sym("i128"),
        explorador_commission: sym("i128"),
        escritura_day: sym("u32"),
        commitment: sym("bytes"),
        nullifier: sym("bytes"),
        proof: sym("bytes"),
        minted_at: sym("u64"),
        status: sym("bytes"),
      },
    },
  );
}

export function attesterScVal(a = fixtureAttesterHex()): xdr.ScVal {
  return nativeToScVal(
    { attester_ax: fromHex(a.attesterAx), attester_ay: fromHex(a.attesterAy), nullifier_secret_commitment: fromHex(a.nullifierSecretCommitment) },
    { type: { attester_ax: sym("bytes"), attester_ay: sym("bytes"), nullifier_secret_commitment: sym("bytes") } },
  );
}

export function vkScVal(): xdr.ScVal {
  const vk = vkToSorobanHex(loadServedVerificationKey());
  return nativeToScVal(
    {
      alpha: fromHex(vk.alpha),
      beta: fromHex(vk.beta),
      gamma: fromHex(vk.gamma),
      delta: fromHex(vk.delta),
      ic: vk.ic.map((p) => nativeToScVal(fromHex(p))),
    },
    { type: { alpha: sym("bytes"), beta: sym("bytes"), gamma: sym("bytes"), delta: sym("bytes"), ic: sym("bytes") } },
  );
}

/** A ViewCall answering like cpcv_note for fixture note `index` stored under `id`. */
export function fakeView(index = 0, id = 1): ViewCall {
  return async (method, args = []) => {
    if (method === "get") {
      const asked = args[0] ? Number(scValToNative(args[0])) : NaN;
      if (asked !== id) throw new Error(`no note ${asked}`);
      return noteScVal(fixtureNotes()[index], id);
    }
    if (method === "attester_params") return attesterScVal();
    if (method === "verification_key") return vkScVal();
    throw new Error(`unexpected view ${method}`);
  };
}

/** The decoded snapshot for fixture note `index` (what readChainSnapshot should return). */
export function fixtureSnapshot(index = 0, id = 1): ChainSnapshot {
  const n = fixtureNotes()[index];
  return {
    contractId: NOTE_CONTRACT,
    note: {
      id,
      agent: n.agent,
      totalCommission: n.totalCommissionCents * 100_000n,
      agentCommission: n.agentCommissionCents * 100_000n,
      escrituraDay: n.escrituraDay,
      commitment: n.commitment,
      nullifier: n.nullifier,
      proof: n.proof,
    },
    attester: fixtureAttesterHex(),
    vk: vkToSorobanHex(loadServedVerificationKey()),
  };
}
