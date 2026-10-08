import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";
import { lotProofBundleSchema } from "../api/src/lot.js";
import {
  LOT_ALLOWED_CODE,
  LOT_ISSUER_FINGERPRINT,
  LOT_ISSUER_ID,
  LOT_SIGNAL_SCHEMA_SHA256,
  LOT_VERIFICATION_KEY_SHA256,
  lotCodeHash,
  lotCredentialMessage,
  productIdHash,
} from "../shared/g4.js";
import { G1_MANIFEST_SHA256 } from "../shared/g3.js";

const shaFile = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export async function verifyLotBundleOffline(
  raw: unknown,
  options: {
    repository: string;
    nowSeconds?: number;
    issuer?: { publicKey: string; fingerprint: string; issuerId: string };
  },
) {
  const bundle = lotProofBundleSchema.parse(raw);
  const vkPath = resolve(
    options.repository,
    "artifacts/owner/lot.verification_key.json",
  );
  if (
    shaFile(resolve(options.repository, "artifacts/manifest.json")) !==
      G1_MANIFEST_SHA256 ||
    shaFile(vkPath) !== LOT_VERIFICATION_KEY_SHA256 ||
    bundle.manifestSha256 !== G1_MANIFEST_SHA256 ||
    bundle.signalSchemaSha256 !== LOT_SIGNAL_SCHEMA_SHA256
  )
    throw new Error("Artifact LOT không khớp G1 đã pin.");
  const issuer =
    options.issuer ??
    ({
      ...JSON.parse(
        readFileSync(
          resolve(options.repository, "artifacts/issuer-public.json"),
          "utf8",
        ),
      ).issuers.find((item: any) => item.type === "LOT"),
      issuerId: LOT_ISSUER_ID,
    } as const);
  if (
    !issuer ||
    (!options.issuer && issuer.fingerprint !== LOT_ISSUER_FINGERPRINT) ||
    bundle.credential.issuerFingerprint !== issuer.fingerprint ||
    bundle.credential.metadata.issuerId !== issuer.issuerId
  )
    throw new Error("Issuer LOT không khớp G1.");
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const metadata = bundle.credential.metadata;
  if (Number(metadata.issuedAt) > now || Number(metadata.expiresAt) <= now)
    throw new Error("Credential LOT chưa có hiệu lực hoặc đã hết hạn.");
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: issuer.publicKey },
    format: "jwk",
  });
  if (
    !verify(
      null,
      lotCredentialMessage(metadata),
      publicKey,
      Buffer.from(bundle.credential.signature, "base64url"),
    )
  )
    throw new Error("Chữ ký Issuer LOT không hợp lệ.");
  const expectedProductHash = await productIdHash(bundle.productId);
  const expectedLotHash = await lotCodeHash(bundle.productId, bundle.lotCode);
  if (
    metadata.productIdHash !== expectedProductHash ||
    metadata.lotCodeHash !== expectedLotHash ||
    metadata.publicAllowedCode !== LOT_ALLOWED_CODE ||
    bundle.publicSignals[0] !== metadata.commitment ||
    bundle.publicSignals[1] !== LOT_ALLOWED_CODE ||
    bundle.publicSignals[2] !== expectedLotHash
  )
    throw new Error("Bundle LOT không gắn đúng product/lot/policy.");
  const verificationKey = JSON.parse(readFileSync(vkPath, "utf8"));
  if (
    !(await groth16.verify(verificationKey, bundle.publicSignals, bundle.proof))
  )
    throw new Error("Groth16 proof LOT không hợp lệ.");
  return {
    valid: true,
    productId: bundle.productId,
    lotCode: bundle.lotCode,
    credentialId: metadata.credentialId,
    expiresAt: new Date(Number(metadata.expiresAt) * 1000).toISOString(),
  };
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const bundlePath = argument("--bundle");
  if (!bundlePath) throw new Error("Cần --bundle tới public proof bundle.");
  const repository = realpathSync(resolve(import.meta.dirname, "../.."));
  const result = await verifyLotBundleOffline(
    JSON.parse(readFileSync(resolve(bundlePath), "utf8")),
    { repository },
  );
  console.log(JSON.stringify(result, null, 2));
  console.log("REVOCATION NOT CHECKED");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  await main();
