import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ageCredentialFileSchema, type AgeCredentialFile } from "../shared/age-wallet.js";

export type SealedAgeCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: 1;
};

export function deliveryKey(value = process.env.AGE_DELIVERY_ENCRYPTION_KEY) {
  if (!value) throw new Error("AGE_DELIVERY_ENCRYPTION_KEY is required.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32)
    throw new Error("AGE_DELIVERY_ENCRYPTION_KEY must be 32 bytes in base64.");
  return key;
}

export function sealAgeCredential(
  credential: AgeCredentialFile,
  key: Buffer,
): SealedAgeCredential {
  const parsed = ageCredentialFileSchema.parse(credential);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(parsed), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}

export function openAgeCredential(
  sealed: SealedAgeCredential,
  key: Buffer,
): AgeCredentialFile {
  if (sealed.keyVersion !== 1) throw new Error("Unsupported delivery key version.");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(sealed.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]);
    return ageCredentialFileSchema.parse(JSON.parse(plaintext.toString("utf8")));
  } catch {
    throw new Error("Credential delivery envelope is invalid.");
  }
}
