import {
  AGE_ISSUER_FINGERPRINT,
  AGE_ISSUER_ID,
  AGE_ISSUER_PUBLIC_KEY,
  ageCommitment,
  ageCredentialMessage,
} from "../../shared/g3";
import {
  ageCredentialFileSchema,
  type AgeCredentialFile,
} from "../../shared/age-wallet";

function base64url(value: string) {
  const encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(encoded + "=".repeat((4 - (encoded.length % 4)) % 4));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function buffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", buffer(bytes)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseAgeCredential(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Tệp thông tin xác minh không đúng định dạng JSON.");
  }
  const parsed = ageCredentialFileSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("Tệp thông tin xác minh tuổi không đúng định dạng.");
  return parsed.data;
}

export async function validateAgeCredential(
  credential: AgeCredentialFile,
  options: {
    now?: Date;
    issuerId?: string;
    publicKey?: string;
    fingerprint?: string;
  } = {},
) {
  credential = ageCredentialFileSchema.parse(credential);
  const now = options.now ?? new Date();
  const issuerId = options.issuerId ?? AGE_ISSUER_ID;
  const trustedPublicKey = options.publicKey ?? AGE_ISSUER_PUBLIC_KEY;
  const trustedFingerprint = options.fingerprint ?? AGE_ISSUER_FINGERPRINT;
  const metadata = credential.metadata;
  if (
    metadata.issuerId !== issuerId ||
    metadata.issuerKeyVersion !== 1 ||
    credential.issuerFingerprint !== trustedFingerprint
  )
    throw new Error("Đơn vị xác nhận hoặc phiên bản khóa không được Ví tin cậy.");
  const publicKeyBytes = base64url(trustedPublicKey);
  if ((await sha256Hex(publicKeyBytes)) !== trustedFingerprint)
    throw new Error("Public key AGE không khớp fingerprint đã pin.");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Number(metadata.issuedAt) > nowSeconds)
    throw new Error("Thông tin xác minh chưa có hiệu lực.");
  if (
    Number(metadata.expiresAt) <= nowSeconds ||
    Number(metadata.issuedAt) >= Number(metadata.expiresAt)
  )
    throw new Error("Thông tin xác minh tuổi đã hết hạn.");
  const publicKey = await crypto.subtle.importKey(
    "raw",
    buffer(publicKeyBytes),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      buffer(base64url(credential.signature)),
      buffer(ageCredentialMessage(metadata)),
    ))
  )
    throw new Error("Chữ ký của đơn vị xác nhận không hợp lệ.");
  const commitment = await ageCommitment(
    credential.privateInputs.dobDay,
    credential.privateInputs.salt,
    credential.privateInputs.holderSecret,
  );
  if (commitment !== metadata.commitment)
    throw new Error("Dữ liệu trong tệp không khớp nội dung đã được ký.");
  return credential;
}

export async function readAndValidateAgeCredential(
  text: string,
  options: Parameters<typeof validateAgeCredential>[1] = {},
) {
  return validateAgeCredential(parseAgeCredential(text), options);
}

export async function saveValidatedAgeCredential(
  store: { save: (credential: AgeCredentialFile) => Promise<unknown> },
  credential: AgeCredentialFile,
  options: Parameters<typeof validateAgeCredential>[1] = {},
) {
  await validateAgeCredential(credential, options);
  await store.save(credential);
  return credential;
}
