declare module "circomlibjs" {
  export function buildPoseidon(): Promise<any>;
}

declare module "*circomlibjs/src/poseidon_wasm.js" {
  export function buildPoseidon(): Promise<any>;
}

declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, string>,
      wasm: string | Uint8Array,
      zkey: string | Uint8Array,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(
      vkey: unknown,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;
  };
}
