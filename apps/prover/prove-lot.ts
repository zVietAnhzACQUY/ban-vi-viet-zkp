import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";
import {
  LOT_ALLOWED_CODE,
  LOT_ISSUER_ID,
  LOT_PUBLIC_SIGNALS,
  LOT_SIGNAL_SCHEMA_SHA256,
  LOT_VERIFICATION_KEY_SHA256,
  LOT_WASM_SHA256,
  LOT_ZKEY_SHA256,
  lotCodeHash,
  lotCommitment,
  lotCredentialMessage,
  productIdHash,
  type LotCredentialFile,
  type LotProofBundle,
} from "../shared/g4.js";
import { G1_MANIFEST_SHA256, parseField } from "../shared/g3.js";

const shaFile = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export function parseLotCredential(text: string): LotCredentialFile {
  const value = JSON.parse(text) as LotCredentialFile;
  if (
    value?.type !== "LOT" ||
    !value.productId ||
    !value.lotCode ||
    !value.privateInputs ||
    !value.metadata ||
    value.metadata.issuerId !== LOT_ISSUER_ID ||
    value.metadata.schemaVersion !== 1 ||
    value.metadata.circuitVersion !== 1 ||
    value.metadata.policyVersion !== 1 ||
    value.metadata.issuerKeyVersion !== 1 ||
    !/^[0-9a-f]{64}$/.test(value.issuerFingerprint) ||
    !/^[A-Za-z0-9_-]{86}$/.test(value.signature)
  )
    throw new Error("Credential LOT v1 không đúng định dạng.");
  for (const field of [
    value.privateInputs.originCode,
    value.privateInputs.supplierIdHash,
    value.privateInputs.salt,
    value.privateInputs.privateLotCodeHash,
    value.metadata.commitment,
    value.metadata.productIdHash,
    value.metadata.lotCodeHash,
    value.metadata.publicAllowedCode,
  ])
    parseField(field);
  return value;
}

export async function createLotProof(
  credential: LotCredentialFile,
  options: {
    wasmPath: string;
    zkeyPath: string;
    publicKeyBase64url: string;
    fingerprint: string;
    manifestSha256?: string;
    nowSeconds?: number;
  },
) {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    Number(credential.metadata.issuedAt) > now ||
    Number(credential.metadata.expiresAt) <= now
  )
    throw new Error("Credential LOT chưa có hiệu lực hoặc đã hết hạn.");
  if (
    credential.issuerFingerprint !== options.fingerprint ||
    credential.metadata.issuerId !== LOT_ISSUER_ID
  )
    throw new Error("Issuer LOT không khớp cấu hình tin cậy.");
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: options.publicKeyBase64url },
    format: "jwk",
  });
  if (
    !verify(
      null,
      lotCredentialMessage(credential.metadata),
      publicKey,
      Buffer.from(credential.signature, "base64url"),
    )
  )
    throw new Error("Chữ ký Issuer LOT không hợp lệ.");
  const expectedProductHash = await productIdHash(credential.productId);
  const expectedLotHash = await lotCodeHash(
    credential.productId,
    credential.lotCode,
  );
  if (
    credential.metadata.productIdHash !== expectedProductHash ||
    credential.metadata.lotCodeHash !== expectedLotHash ||
    credential.privateInputs.privateLotCodeHash !== expectedLotHash
  )
    throw new Error("Credential không gắn đúng product/lot.");
  const commitment = await lotCommitment(
    credential.privateInputs.originCode,
    credential.privateInputs.supplierIdHash,
    credential.privateInputs.salt,
    credential.privateInputs.privateLotCodeHash,
  );
  if (commitment !== credential.metadata.commitment)
    throw new Error("Dữ liệu kín LOT không mở đúng commitment.");
  if (credential.metadata.publicAllowedCode !== LOT_ALLOWED_CODE)
    throw new Error("Credential không thuộc policy vùng v1 hiện hành.");
  const { proof, publicSignals } = await groth16.fullProve(
    {
      originCode: credential.privateInputs.originCode,
      supplierIdHash: credential.privateInputs.supplierIdHash,
      salt: credential.privateInputs.salt,
      privateLotCodeHash: credential.privateInputs.privateLotCodeHash,
      commitment,
      publicAllowedCode: credential.metadata.publicAllowedCode,
      lotCodeHash: expectedLotHash,
    },
    options.wasmPath,
    options.zkeyPath,
  );
  const expected = [commitment, LOT_ALLOWED_CODE, expectedLotHash];
  if (JSON.stringify(publicSignals) !== JSON.stringify(expected))
    throw new Error(
      `Public signals không theo thứ tự ${LOT_PUBLIC_SIGNALS.join(", ")}.`,
    );
  const bundle: LotProofBundle = {
    type: "LOT_PROOF_BUNDLE",
    productId: credential.productId,
    lotCode: credential.lotCode,
    generatedAt: new Date(now * 1000).toISOString(),
    manifestSha256: options.manifestSha256 ?? G1_MANIFEST_SHA256,
    signalSchemaSha256: LOT_SIGNAL_SCHEMA_SHA256,
    publicSignals: publicSignals as [string, string, string],
    proof: proof as LotProofBundle["proof"],
    credential: {
      metadata: credential.metadata,
      issuerFingerprint: credential.issuerFingerprint,
      signature: credential.signature,
    },
  };
  return bundle;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const repository = realpathSync(resolve(import.meta.dirname, "../.."));
  const credentialPath = resolve(argument("--credential") || "");
  const outputPath = resolve(argument("--out") || "");
  if (!argument("--credential") || !argument("--out"))
    throw new Error("Cần --credential và --out cho public proof bundle.");
  if (!existsSync(credentialPath))
    throw new Error("Không tìm thấy credential.");
  if (existsSync(outputPath)) throw new Error("Từ chối ghi đè proof bundle.");
  const wasmPath = resolve(
    repository,
    ".work/build/lot/lot_origin_js/lot_origin.wasm",
  );
  const zkeyPath = resolve(
    repository,
    ".work/setup/owner/lot_contributed.zkey",
  );
  const vkPath = resolve(
    repository,
    "artifacts/owner/lot.verification_key.json",
  );
  const manifestPath = resolve(repository, "artifacts/manifest.json");
  if (
    shaFile(wasmPath) !== LOT_WASM_SHA256 ||
    shaFile(zkeyPath) !== LOT_ZKEY_SHA256 ||
    shaFile(vkPath) !== LOT_VERIFICATION_KEY_SHA256 ||
    shaFile(manifestPath) !== G1_MANIFEST_SHA256
  )
    throw new Error("Artifact LOT không khớp G1 đã pin.");
  const ownerPublic = JSON.parse(
    readFileSync(resolve(repository, "artifacts/issuer-public.json"), "utf8"),
  ).issuers.find((item: any) => item.type === "LOT");
  const credential = parseLotCredential(readFileSync(credentialPath, "utf8"));
  const bundle = await createLotProof(credential, {
    wasmPath,
    zkeyPath,
    publicKeyBase64url: ownerPublic.publicKey,
    fingerprint: ownerPublic.fingerprint,
  });
  writeFileSync(outputPath, JSON.stringify(bundle, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(`Đã ghi public proof bundle: ${outputPath}`);
  console.log("Bundle không chứa mã nhà cung cấp, salt hoặc witness.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  await main();
