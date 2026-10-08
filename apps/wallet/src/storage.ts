import type { AgeCredentialFile } from "../../shared/age-wallet";

const DATABASE = "ban-vi-viet-zkp-wallet";
const STORE = "credentials";
const AGE_KEY = "AGE-v2-encrypted";
const LEGACY_KEY = "AGE-v1";
export const WALLET_KDF_ITERATIONS = 310_000;

export type EncryptedCredential = {
  version: 2;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

async function keyFromPin(pin: string, salt: Uint8Array, iterations: number) {
  if (pin.length < 8 || pin.length > 64)
    throw new Error("PIN/passphrase Ví phải có 8–64 ký tự.");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptCredential(
  credential: AgeCredentialFile,
  pin: string,
): Promise<EncryptedCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPin(pin, salt, WALLET_KDF_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(credential)),
  );
  return {
    version: 2,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: WALLET_KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptCredential(
  envelope: EncryptedCredential,
  pin: string,
): Promise<AgeCredentialFile> {
  if (
    envelope.version !== 2 ||
    envelope.algorithm !== "AES-GCM" ||
    envelope.kdf !== "PBKDF2-SHA-256" ||
    envelope.iterations !== WALLET_KDF_ITERATIONS
  )
    throw new Error("Định dạng dữ liệu Ví không được hỗ trợ.");
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error("invalid envelope");
    const key = await keyFromPin(pin, salt, envelope.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      base64ToBytes(envelope.ciphertext) as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("PIN không đúng hoặc dữ liệu Ví đã bị thay đổi.");
  }
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      let result: T;
      request.onsuccess = () => void (result = request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const ageCredentialStore = {
  get: () =>
    transaction<EncryptedCredential | undefined>("readonly", (store) =>
      store.get(AGE_KEY),
    ),
  save: (envelope: EncryptedCredential) =>
    transaction("readwrite", (store) => store.put(envelope, AGE_KEY)),
  remove: async () => {
    await transaction("readwrite", (store) => store.delete(AGE_KEY));
    await transaction("readwrite", (store) => store.delete(LEGACY_KEY));
  },
  hasLegacyPlaintext: async () =>
    Boolean(
      await transaction("readonly", (store) => store.get(LEGACY_KEY)),
    ),
};

export type AgeCredentialStore = typeof ageCredentialStore;
