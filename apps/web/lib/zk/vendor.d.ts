// Minimal type declarations for snarkjs 0.7 and circomlibjs 0.1 (neither
// ships types). Only what lib/zk uses. Keep this file free of top-level
// imports so the declarations stay ambient.

declare module "snarkjs" {
  export interface Groth16ProofJson {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }

  export interface ProverOptions {
    singleThread?: boolean;
  }

  export const groth16: {
    fullProve(
      input: Record<string, string | bigint | number>,
      wasmFile: string | Uint8Array,
      zkeyFileName: string | Uint8Array,
      logger?: unknown,
      wtnsCalcOptions?: unknown,
      proverOptions?: ProverOptions,
    ): Promise<{ proof: Groth16ProofJson; publicSignals: string[] }>;
    verify(
      vk: unknown,
      publicSignals: (string | bigint)[],
      proof: Groth16ProofJson | { pi_a: string[]; pi_b: string[][]; pi_c: string[] },
      logger?: unknown,
    ): Promise<boolean>;
  };
}

declare module "circomlibjs" {
  /** Field element in circomlibjs' internal (Montgomery) representation. */
  export type FieldElement = Uint8Array;

  export interface Field {
    e(value: bigint | number | string): FieldElement;
    toObject(value: FieldElement): bigint;
    eq(a: FieldElement, b: FieldElement): boolean;
  }

  export interface Signature {
    R8: [FieldElement, FieldElement];
    S: bigint;
  }

  export interface Eddsa {
    F: Field;
    poseidon: (inputs: (bigint | number | string | FieldElement)[]) => FieldElement;
    babyJub: { subOrder: bigint; inCurve(point: [FieldElement, FieldElement]): boolean };
    prv2pub(privateKey: Uint8Array): [FieldElement, FieldElement];
    signPoseidon(privateKey: Uint8Array, msg: FieldElement): Signature;
    verifyPoseidon(msg: FieldElement, signature: Signature, publicKey: [FieldElement, FieldElement]): boolean;
  }

  export function buildEddsa(): Promise<Eddsa>;
}
