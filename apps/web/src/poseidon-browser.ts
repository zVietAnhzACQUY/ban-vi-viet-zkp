// Use only the Poseidon WASM implementation in the browser. Importing the
// package barrel also pulls Node-only helpers that are unrelated to G3.
export { buildPoseidon } from "../../node_modules/circomlibjs/src/poseidon_wasm.js";
