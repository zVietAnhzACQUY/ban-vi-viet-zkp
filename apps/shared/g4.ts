import {
  CIRCUIT_VERSION,
  FIELD_MODULUS,
  SCHEMA_VERSION,
  canonicalUuid,
  concat,
  encodeField,
  encodeString,
  h2f,
  parseField,
  unsigned,
} from "./g3.js";

export const LOT_DOMAIN = 2n;
export const LOT_CREDENTIAL_DOMAIN = "BVV-LOT-CREDENTIAL";
export const LOT_ISSUER_ID = "a4381e8c-505f-4e9a-a94a-b482685e919e";
export const LOT_POLICY_VERSION = 1;
export const LOT_ALLOWED_CODE = "1";
export const LOT_PUBLIC_SIGNALS = [
  "commitment",
  "publicAllowedCode",
  "lotCodeHash",
] as const;
export const LOT_SIGNAL_SCHEMA_SHA256 =
  "5b2ec726f1848bd688e55218aed951dee471acdb1385662082a966577483c215";
export const LOT_WASM_SHA256 =
  "dabf75c9519a0e0513265f615b79b9e828d6a752c8f3d56a2d51001fa4925198";
export const LOT_ZKEY_SHA256 =
  "07ef18d06f8fb76d77522411e8d18ced6f43cd7fb18982fe0dc14e30bd5d1d98";
export const LOT_VERIFICATION_KEY_SHA256 =
  "3d34ad71eaf23d8b5d65e3dfa2254d970875e10df7b38134fe470a5f064df44d";
export const LOT_ISSUER_FINGERPRINT =
  "6d9579c3d46bbe06d28ae7b73277d3080a6bd9a77aa4e2c4cc54e75f5c10c28d";

const CODE = /^[A-Z0-9][A-Z0-9-]{0,63}$/;

export type LotCredentialMetadata = {
  domain: typeof LOT_CREDENTIAL_DOMAIN;
  schemaVersion: 1;
  circuitVersion: 1;
  credentialId: string;
  issuerId: string;
  commitment: string;
  productIdHash: string;
  lotCodeHash: string;
  policyVersion: 1;
  publicAllowedCode: string;
  issuedAt: string;
  expiresAt: string;
  issuerKeyVersion: 1;
};

export type LotCredentialFile = {
  type: "LOT";
  productId: string;
  lotCode: string;
  privateInputs: {
    originCode: string;
    supplierIdHash: string;
    salt: string;
    privateLotCodeHash: string;
  };
  metadata: LotCredentialMetadata;
  issuerFingerprint: string;
  signature: string;
};

export type Groth16Proof = {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: "groth16";
  curve: "bn128";
};

export type LotProofBundle = {
  type: "LOT_PROOF_BUNDLE";
  productId: string;
  lotCode: string;
  generatedAt: string;
  manifestSha256: string;
  signalSchemaSha256: typeof LOT_SIGNAL_SCHEMA_SHA256;
  publicSignals: [string, string, string];
  proof: Groth16Proof;
  credential: {
    metadata: LotCredentialMetadata;
    issuerFingerprint: string;
    signature: string;
  };
};

export function canonicalCode(value: string, label: string) {
  if (!CODE.test(value))
    throw new Error(`${label} phải khớp [A-Z0-9][A-Z0-9-]{0,63}.`);
  return value;
}

export function productIdHash(productId: string) {
  return h2f("product", encodeString(canonicalUuid(productId)));
}

export function lotCodeHash(productId: string, lotCode: string) {
  return h2f(
    "lot",
    concat([
      encodeString(canonicalUuid(productId)),
      encodeString(canonicalCode(lotCode, "Mã lô")),
    ]),
  );
}

export function supplierIdHash(supplierCode: string) {
  return h2f(
    "supplier",
    encodeString(canonicalCode(supplierCode, "Mã nhà cung cấp")),
  );
}

let poseidonPromise: Promise<any> | undefined;
async function poseidon(values: Array<bigint | string | number>) {
  poseidonPromise ||= import("circomlibjs").then((module) =>
    module.buildPoseidon(),
  );
  const instance = await poseidonPromise;
  return instance.F.toString(instance(values.map(BigInt)));
}

export function lotCommitment(
  originCode: string,
  supplierHash: string,
  salt: string,
  privateLotHash: string,
) {
  return poseidon([
    LOT_DOMAIN,
    parseField(originCode),
    parseField(supplierHash),
    parseField(salt),
    parseField(privateLotHash),
  ]);
}

export function lotCredentialMessage(metadata: LotCredentialMetadata) {
  canonicalUuid(metadata.credentialId);
  canonicalUuid(metadata.issuerId);
  if (metadata.domain !== LOT_CREDENTIAL_DOMAIN)
    throw new Error("Sai domain LOT.");
  if (
    metadata.schemaVersion !== SCHEMA_VERSION ||
    metadata.circuitVersion !== CIRCUIT_VERSION ||
    metadata.policyVersion !== LOT_POLICY_VERSION ||
    metadata.issuerKeyVersion !== 1
  )
    throw new Error("Sai version LOT.");
  for (const value of [
    metadata.commitment,
    metadata.productIdHash,
    metadata.lotCodeHash,
    metadata.publicAllowedCode,
  ])
    parseField(value);
  return concat([
    encodeString(metadata.domain),
    unsigned(metadata.schemaVersion, 4),
    unsigned(metadata.circuitVersion, 4),
    encodeString(metadata.credentialId),
    encodeString(metadata.issuerId),
    encodeField(metadata.commitment),
    encodeField(metadata.productIdHash),
    encodeField(metadata.lotCodeHash),
    unsigned(metadata.policyVersion, 4),
    encodeField(metadata.publicAllowedCode),
    unsigned(metadata.issuedAt, 8),
    unsigned(metadata.expiresAt, 8),
    unsigned(metadata.issuerKeyVersion, 4),
  ]);
}

export function randomLotField(randomBytes: (size: number) => Uint8Array) {
  for (;;) {
    const bytes = randomBytes(32);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    if (value > 0n && value < FIELD_MODULUS) return value.toString();
  }
}
