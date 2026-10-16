import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, unlink, stat, lstat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export type EvidenceStorage = { directory: string; key: Buffer };
export function evidenceStorage(): EvidenceStorage {
  const directory = process.env.AGE_EVIDENCE_STORAGE_DIR;
  const encoded = process.env.AGE_EVIDENCE_ENCRYPTION_KEY;
  if (!directory || !encoded || !isAbsolute(directory)) throw new Error("Evidence storage configuration required.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded || encoded === process.env.AGE_DELIVERY_ENCRYPTION_KEY) throw new Error("Evidence key configuration invalid.");
  const repo = resolve(import.meta.dirname, "../..");
  const rel = relative(repo, resolve(directory));
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("Evidence must be outside repository.");
  return { directory: resolve(directory), key };
}
export function inspectEvidence(data: Buffer, name: string) {
  if (!data.length || data.length > MAX_EVIDENCE_BYTES) throw new Error("FILE_SIZE");
  const clean = name.normalize("NFC");
  if (!/^[\p{L}\p{N}_ -]{1,100}\.(pdf|jpg|jpeg|png)$/iu.test(clean)) throw new Error("FILE_NAME");
  const ext = clean.split(".").pop()!.toLowerCase();
  const mime = data.subarray(0,5).equals(Buffer.from("%PDF-")) ? "application/pdf"
    : data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
    : data.subarray(0,3).equals(Buffer.from([255,216,255])) ? "image/jpeg" : null;
  if (!mime || (ext === "pdf") !== (mime === "application/pdf") || (ext === "png") !== (mime === "image/png")) throw new Error("FILE_TYPE");
  return { originalName: clean, detectedMimeType: mime, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}
export type EvidenceDomain = "AGE" | "LOT";
function path(storage: EvidenceStorage, key: string, domain: EvidenceDomain = "AGE") {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage identifier");
  return resolve(storage.directory, key + (domain === "LOT" ? ".lotenc" : ".ageenc"));
}
export async function saveEvidence(storage: EvidenceStorage, key: string, data: Buffer, domain: EvidenceDomain = "AGE") {
  if (!(await stat(storage.directory)).isDirectory()) throw new Error("Storage unavailable");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", storage.key, iv);
  cipher.setAAD(Buffer.from(domain === "LOT" ? "LOT:" + key : key));
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  await writeFile(path(storage,key,domain), Buffer.concat([Buffer.from(domain === "LOT" ? "LOTE1" : "AGEE1"),iv,cipher.getAuthTag(),encrypted]), { flag:"wx", mode:0o600 });
}
export async function openEvidence(storage: EvidenceStorage,key:string,domain: EvidenceDomain = "AGE") {
  const data = await readFile(path(storage,key,domain));
  if (data.length < 34 || data.length > MAX_EVIDENCE_BYTES+33 || data.subarray(0,5).toString() !== (domain === "LOT" ? "LOTE1" : "AGEE1")) throw new Error("Invalid encrypted envelope");
  const cipher = createDecipheriv("aes-256-gcm",storage.key,data.subarray(5,17));
  cipher.setAAD(Buffer.from(domain === "LOT" ? "LOT:" + key : key)); cipher.setAuthTag(data.subarray(17,33));
  return Buffer.concat([cipher.update(data.subarray(33)),cipher.final()]);
}
// Only inspect the configured storage/domain; do not follow a file symlink or decrypt evidence.
export async function hasEvidenceCiphertext(storage: EvidenceStorage, key: string, domain: EvidenceDomain) {
  try { return (await lstat(path(storage, key, domain))).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function removeEvidence(storage:EvidenceStorage,key:string,domain: EvidenceDomain = "AGE",options:{requireExisting?:boolean}={}) {
  try { await unlink(path(storage,key,domain)); } catch(error) {
    if (options.requireExisting || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
