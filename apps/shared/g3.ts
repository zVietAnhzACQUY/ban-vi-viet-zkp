export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const AGE_DOMAIN = 1n;
export const NULLIFIER_DOMAIN = 3n;
export const REQUEST_DOMAIN = 4n;
export const CIRCUIT_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const AGE_CREDENTIAL_DOMAIN = "BVV-AGE-CREDENTIAL";
export const AGE_ISSUER_ID = "2b097683-48f1-4dc9-8006-056b305c6473";
export const AGE_ISSUER_PUBLIC_KEY =
  "kkHOk7P-p3bnIOvvoDNyXJ-hTos8gWPYmwNf20uya64";
export const AGE_ISSUER_FINGERPRINT =
  "19aaf06a064ed73d970f3585b07bdae9c53c99f2f6705fe03b4010f810bf7263";
export const AGE_PUBLIC_SIGNALS = [
  "commitment",
  "cutoffDay",
  "requestHash",
  "nullifier",
] as const;
export const AGE_SIGNAL_SCHEMA_SHA256 =
  "616c508dd1cf9c2c8b704130ceda1f14133126c96f464fb22d7f6ead6e65d5e2";
export const AGE_WASM_SHA256 =
  "6cfa2c24602376b839a726aff67e3782ed8c220e6b096d393a5746c5c43613c8";
export const AGE_ZKEY_SHA256 =
  "f23ed79af1b4fb14f055a586ea8f6e8a396e86ea95df1a1e1799c0477775f95c";
export const G1_MANIFEST_SHA256 =
  "c942cffd8a412652f8df829fa842c3cfee972b0129d08b690fdada8cd7c511dc";

export type CartHashItem = {
  productId: string;
  quantity: number;
  unitPriceVND: string;
  requiresAgeProof: boolean;
  minimumAge: number;
};

export type AgeCredentialMetadata = {
  domain: typeof AGE_CREDENTIAL_DOMAIN;
  schemaVersion: 1;
  circuitVersion: 1;
  credentialId: string;
  issuerId: string;
  commitment: string;
  userIdHash: string;
  issuedAt: string;
  expiresAt: string;
  issuerKeyVersion: 1;
};

export type AgeCredentialFile = {
  type: "AGE";
  privateInputs: { dobDay: string; salt: string; holderSecret: string };
  metadata: AgeCredentialMetadata;
  issuerFingerprint: string;
  signature: string;
};

export type AgeChallengeResponse = {
  id: string;
  cutoffDay: string;
  requestHash: string;
  subjectHash: string;
  minimumAge: number;
  issuedAt: string;
  expiresAt: string;
  artifact: {
    circuitVersion: 1;
    manifestSha256: string;
    signalSchemaSha256: string;
    publicSignals: readonly string[];
    wasmUrl: string;
    zkeyUrl: string;
  };
};

const encoder = new TextEncoder();
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function canonicalUuid(value: string) {
  if (!UUID.test(value))
    throw new Error("UUID không ở dạng canonical lowercase.");
  return value;
}

export function parseField(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error("Field phải là chuỗi thập phân canonical.");
  const result = BigInt(value);
  if (result >= FIELD_MODULUS)
    throw new Error("Field nằm ngoài BN254 scalar field.");
  return result;
}

export function unsigned(value: bigint | number | string, bytes: number) {
  const n = BigInt(value);
  if (n < 0n || n >= 1n << BigInt(bytes * 8))
    throw new Error(`Giá trị không vừa unsigned ${bytes * 8} bit.`);
  const out = new Uint8Array(bytes);
  let rest = n;
  for (let index = bytes - 1; index >= 0; index--) {
    out[index] = Number(rest & 255n);
    rest >>= 8n;
  }
  return out;
}

export function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function encodeString(value: string) {
  const bytes = encoder.encode(value);
  return concat([unsigned(bytes.length, 4), bytes]);
}

export function encodeField(value: string) {
  return unsigned(parseField(value), 32);
}

async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", copy.buffer),
  );
}

function os2ip(bytes: Uint8Array) {
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

export async function h2f(tag: string, payload: Uint8Array) {
  const bytes = concat([
    encodeString("BVV-H2F-v1"),
    encodeString(tag),
    unsigned(payload.length, 4),
    payload,
  ]);
  return (os2ip(await sha256(bytes)) % FIELD_MODULUS).toString();
}

export async function userIdHash(userId: string) {
  return h2f("user", encodeString(canonicalUuid(userId)));
}

export async function cartSnapshotHash(items: CartHashItem[]) {
  const sorted = [...items].sort((a, b) =>
    canonicalUuid(a.productId).localeCompare(canonicalUuid(b.productId)),
  );
  const lines = sorted.map((item) => {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 2147483647
    )
      throw new Error("Quantity ngoài miền snapshot v1.");
    if (
      !Number.isInteger(item.minimumAge) ||
      item.minimumAge < 0 ||
      item.minimumAge > 120
    )
      throw new Error("Minimum age ngoài miền snapshot v1.");
    const price = BigInt(item.unitPriceVND);
    if (price < 0n || price > 9223372036854775807n)
      throw new Error("Giá ngoài miền snapshot v1.");
    if (item.requiresAgeProof !== item.minimumAge > 0)
      throw new Error("Cờ tuổi và ngưỡng tuổi không nhất quán.");
    return concat([
      encodeString(item.productId),
      unsigned(item.quantity, 4),
      unsigned(price, 8),
      unsigned(item.requiresAgeProof ? 1 : 0, 1),
      unsigned(item.minimumAge, 4),
    ]);
  });
  return h2f("cart", concat([unsigned(lines.length, 4), ...lines]));
}

let poseidonPromise: Promise<any> | undefined;
async function poseidon(values: Array<bigint | string | number>) {
  poseidonPromise ||= import("circomlibjs").then((module) =>
    module.buildPoseidon(),
  );
  const instance = await poseidonPromise;
  return instance.F.toString(instance(values.map(BigInt)));
}

export function ageCommitment(
  dobDay: string,
  salt: string,
  holderSecret: string,
) {
  return poseidon([
    AGE_DOMAIN,
    parseField(dobDay),
    parseField(salt),
    parseField(holderSecret),
  ]);
}

export function ageNullifier(holderSecret: string, requestHash: string) {
  return poseidon([
    NULLIFIER_DOMAIN,
    parseField(holderSecret),
    parseField(requestHash),
  ]);
}

export function ageRequestHash(
  nonceField: string,
  accountHash: string,
  snapshotHash: string,
  cutoff: number,
) {
  return poseidon([
    REQUEST_DOMAIN,
    parseField(nonceField),
    parseField(accountHash),
    parseField(snapshotHash),
    cutoff,
    CIRCUIT_VERSION,
  ]);
}

function validDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  )
    throw new Error("Ngày Gregorian không hợp lệ.");
  return value;
}

export function dayIndex(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Ngày phải có dạng YYYY-MM-DD.");
  const value = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  const index = Math.floor((value.getTime() - Date.UTC(1900, 0, 1)) / 86400000);
  if (index < 0 || index > 73413) throw new Error("Ngày ngoài miền 1900–2100.");
  return index;
}

export function cutoffDay(now: Date, minimumAge: number) {
  if (!Number.isInteger(minimumAge) || minimumAge < 1 || minimumAge > 120)
    throw new Error("Ngưỡng tuổi phải trong 1–120.");
  const year = now.getUTCFullYear() - minimumAge;
  const month = now.getUTCMonth() + 1;
  const day = Math.min(
    now.getUTCDate(),
    new Date(Date.UTC(year, month, 0)).getUTCDate(),
  );
  const value = validDate(year, month, day);
  const index = Math.floor((value.getTime() - Date.UTC(1900, 0, 1)) / 86400000);
  if (index < 0 || index > 73413)
    throw new Error("Cutoff ngoài miền circuit v1.");
  return index;
}

export function ageCredentialMessage(metadata: AgeCredentialMetadata) {
  canonicalUuid(metadata.credentialId);
  canonicalUuid(metadata.issuerId);
  if (metadata.domain !== AGE_CREDENTIAL_DOMAIN)
    throw new Error("Sai domain AGE.");
  if (metadata.schemaVersion !== 1 || metadata.circuitVersion !== 1)
    throw new Error("Sai version AGE.");
  if (metadata.issuerKeyVersion !== 1) throw new Error("Sai key version AGE.");
  return concat([
    encodeString(metadata.domain),
    unsigned(metadata.schemaVersion, 4),
    unsigned(metadata.circuitVersion, 4),
    encodeString(metadata.credentialId),
    encodeString(metadata.issuerId),
    encodeField(metadata.commitment),
    encodeField(metadata.userIdHash),
    unsigned(metadata.issuedAt, 8),
    unsigned(metadata.expiresAt, 8),
    unsigned(metadata.issuerKeyVersion, 4),
  ]);
}
