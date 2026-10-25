declare module "circomlibjs" {
  export function buildPoseidon(): Promise<any>;
  export function buildEddsa(): Promise<any>;
  export function buildBabyjub(): Promise<any>;
}

declare module "snarkjs" {
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasm: string | Uint8Array, zkey: string | Uint8Array): Promise<{ proof: any; publicSignals: string[] }>;
    verify(vk: any, publicSignals: string[], proof: any): Promise<boolean>;
  };
}
