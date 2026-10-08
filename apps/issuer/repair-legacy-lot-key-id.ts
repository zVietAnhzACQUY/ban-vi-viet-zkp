import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";
import { db } from "../api/src/db.js";
import {
  canonicalLotIssuerKeyId,
  lotProofBundleSchema,
} from "../api/src/lot.js";
import { hash } from "../api/src/commerce.js";
import {
  LOT_ALLOWED_CODE,
  LOT_CREDENTIAL_DOMAIN,
  LOT_ISSUER_FINGERPRINT,
  LOT_ISSUER_ID,
  LOT_POLICY_VERSION,
  LOT_PUBLIC_SIGNALS,
  LOT_SIGNAL_SCHEMA_SHA256,
  LOT_VERIFICATION_KEY_SHA256,
  lotCodeHash,
  lotCredentialMessage,
  productIdHash,
  type LotProofBundle,
} from "../shared/g4.js";
import { G1_MANIFEST_SHA256, canonicalUuid } from "../shared/g3.js";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const manifestPath = resolve(repository, "artifacts/manifest.json");
const issuerPath = resolve(repository, "artifacts/issuer-public.json");
const verificationKeyPath = resolve(
  repository,
  "artifacts/owner/lot.verification_key.json",
);
const LEGACY_KEY_ID = "LOT-v1";
const ACTION = "LOT_LEGACY_ISSUER_KEY_ID_CANONICALIZED";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…`;
}

function shaFile(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function equal(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function pass(label: string) {
  console.log(`PASS  ${label}`);
}

function requireCheck(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${label}`);
  pass(label);
}

type Candidate = NonNullable<Awaited<ReturnType<typeof loadCandidate>>>;

async function loadCandidate(target: { lotId?: string; credentialId?: string }) {
  return db.lotCredential.findFirst({
    where: target.credentialId
      ? { id: target.credentialId }
      : { lotId: target.lotId },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    include: { lot: true, proof: true },
  });
}

function publicSnapshot(candidate: Candidate) {
  const { lot, proof } = candidate;
  return hash(
    JSON.stringify({
      lot: {
        id: lot.id,
        productId: lot.productId,
        lotCode: lot.lotCode,
        status: lot.status,
      },
      credential: {
        id: candidate.id,
        lotId: candidate.lotId,
        commitment: candidate.commitment,
        productIdHash: candidate.productIdHash,
        lotCodeHash: candidate.lotCodeHash,
        policyVersion: candidate.policyVersion,
        publicAllowedCode: candidate.publicAllowedCode,
        issuedAt: candidate.issuedAt.toISOString(),
        expiresAt: candidate.expiresAt.toISOString(),
        issuerId: candidate.issuerId,
        issuerKeyVersion: candidate.issuerKeyVersion,
        issuerFingerprint: candidate.issuerFingerprint,
        signature: candidate.signature,
        status: candidate.status,
        issuerKeyId: candidate.issuerKeyId,
        circuitVersion: candidate.circuitVersion,
      },
      proof: proof && {
        id: proof.id,
        lotId: proof.lotId,
        credentialId: proof.credentialId,
        proof: proof.proof,
        publicSignals: proof.publicSignals,
        proofHash: proof.proofHash,
        manifestSha256: proof.manifestSha256,
        signalSchemaSha256: proof.signalSchemaSha256,
        generatedAt: proof.generatedAt.toISOString(),
        status: proof.status,
        circuitVersion: proof.circuitVersion,
      },
    }),
  );
}

async function verifyCandidate(candidate: Candidate) {
  const { lot, proof } = candidate;
  requireCheck(lot.id === candidate.lotId, "lot/credential relation");
  requireCheck(!!proof, "proof exists");
  requireCheck(
    proof!.lotId === lot.id && proof!.credentialId === candidate.id,
    "proof/credential/lot relation",
  );
  requireCheck(
    candidate.status === "ACTIVE" && proof!.status === "ACTIVE",
    "credential and proof status ACTIVE",
  );

  const bundle: LotProofBundle = {
    type: "LOT_PROOF_BUNDLE",
    productId: lot.productId,
    lotCode: lot.lotCode,
    generatedAt: proof!.generatedAt.toISOString(),
    manifestSha256: proof!.manifestSha256,
    signalSchemaSha256: proof!.signalSchemaSha256 as typeof LOT_SIGNAL_SCHEMA_SHA256,
    publicSignals: proof!.publicSignals as [string, string, string],
    proof: proof!.proof as LotProofBundle["proof"],
    credential: {
      metadata: {
        domain: LOT_CREDENTIAL_DOMAIN,
        schemaVersion: 1,
        circuitVersion: candidate.circuitVersion as 1,
        credentialId: candidate.id,
        issuerId: candidate.issuerId,
        commitment: candidate.commitment,
        productIdHash: candidate.productIdHash,
        lotCodeHash: candidate.lotCodeHash,
        policyVersion: candidate.policyVersion as 1,
        publicAllowedCode: candidate.publicAllowedCode,
        issuedAt: String(Math.floor(candidate.issuedAt.getTime() / 1000)),
        expiresAt: String(Math.floor(candidate.expiresAt.getTime() / 1000)),
        issuerKeyVersion: candidate.issuerKeyVersion as 1,
      },
      issuerFingerprint: candidate.issuerFingerprint,
      signature: candidate.signature,
    },
  };

  let parsed: LotProofBundle;
  try {
    parsed = lotProofBundleSchema.parse(bundle) as LotProofBundle;
  } catch {
    throw new Error("Verification failed: strict public bundle schema");
  }
  pass("strict public bundle schema");
  canonicalUuid(parsed.credential.metadata.credentialId);
  requireCheck(
    parsed.productId === lot.productId && parsed.lotCode === lot.lotCode,
    "product and lotCode binding",
  );

  const issuerArtifact = JSON.parse(readFileSync(issuerPath, "utf8")).issuers.find(
    (item: any) => item.type === "LOT",
  );
  requireCheck(
    parsed.credential.metadata.issuerId === LOT_ISSUER_ID &&
      parsed.credential.metadata.issuerKeyVersion === 1,
    "pinned issuerId and supported key version",
  );
  requireCheck(
    issuerArtifact?.fingerprint === LOT_ISSUER_FINGERPRINT &&
      parsed.credential.issuerFingerprint === issuerArtifact.fingerprint,
    "issuer fingerprint",
  );
  requireCheck(
    parsed.credential.metadata.circuitVersion === 1 &&
      proof!.circuitVersion === 1,
    "supported circuit version",
  );
  requireCheck(
    Number(parsed.credential.metadata.issuedAt) <
      Number(parsed.credential.metadata.expiresAt),
    "issuedAt before expiresAt",
  );
  requireCheck(
    parsed.credential.metadata.policyVersion === LOT_POLICY_VERSION &&
      parsed.credential.metadata.publicAllowedCode === LOT_ALLOWED_CODE,
    "policy and publicAllowedCode",
  );

  const publicKeyBytes = Buffer.from(issuerArtifact.publicKey, "base64url");
  requireCheck(
    createHash("sha256").update(publicKeyBytes).digest("hex") ===
      issuerArtifact.fingerprint,
    "pinned public key fingerprint",
  );
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: issuerArtifact.publicKey } as JsonWebKey,
    format: "jwk",
  });
  const signature = Buffer.from(parsed.credential.signature, "base64url");
  requireCheck(
    signature.length === 64 &&
      verify(
        null,
        lotCredentialMessage(parsed.credential.metadata),
        publicKey,
        signature,
      ),
    "Ed25519 signature over canonical message",
  );

  const expectedProductHash = await productIdHash(lot.productId);
  const expectedLotHash = await lotCodeHash(lot.productId, lot.lotCode);
  requireCheck(
    parsed.credential.metadata.productIdHash === expectedProductHash &&
      parsed.credential.metadata.lotCodeHash === expectedLotHash,
    "recomputed productIdHash and lotCodeHash",
  );
  requireCheck(
    parsed.publicSignals.length === LOT_PUBLIC_SIGNALS.length &&
      parsed.publicSignals[0] === parsed.credential.metadata.commitment &&
      parsed.publicSignals[1] === LOT_ALLOWED_CODE &&
      parsed.publicSignals[2] === expectedLotHash,
    "public signal order and binding",
  );
  requireCheck(
    shaFile(manifestPath) === G1_MANIFEST_SHA256 &&
      parsed.manifestSha256 === G1_MANIFEST_SHA256 &&
      parsed.signalSchemaSha256 === LOT_SIGNAL_SCHEMA_SHA256 &&
      shaFile(verificationKeyPath) === LOT_VERIFICATION_KEY_SHA256,
    "pinned G1 manifest, signal schema and verification key",
  );
  requireCheck(
    proof!.proofHash ===
      hash(JSON.stringify({ proof: parsed.proof, publicSignals: parsed.publicSignals })),
    "stored proofHash",
  );
  const verificationKey = JSON.parse(readFileSync(verificationKeyPath, "utf8"));
  requireCheck(
    await groth16.verify(verificationKey, parsed.publicSignals, parsed.proof),
    "Groth16 proof",
  );

  return {
    canonicalIssuerKeyId: canonicalLotIssuerKeyId(
      parsed.credential.metadata.issuerId,
      parsed.credential.metadata.issuerKeyVersion,
    ),
    snapshot: publicSnapshot(candidate),
  };
}

export async function repairLegacyLotKeyId(input: {
  lotId?: string;
  credentialId?: string;
  actorId?: string;
  apply: boolean;
}) {
  if (!!input.lotId === !!input.credentialId)
    throw new Error("Provide exactly one --lot-id or --credential-id.");
  if (input.lotId) canonicalUuid(input.lotId);
  if (input.credentialId) canonicalUuid(input.credentialId);
  if (input.apply && !input.actorId)
    throw new Error("--actor-id is required with --apply.");
  if (input.actorId) canonicalUuid(input.actorId);

  const candidate = await loadCandidate(input);
  if (!candidate) throw new Error("Target credential was not found.");
  console.log(`Mode: ${input.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Lot: ${candidate.lot.lotCode} (${shortId(candidate.lot.id)})`);
  console.log(`Credential: ${shortId(candidate.id)}`);
  requireCheck(candidate.issuerKeyId === LEGACY_KEY_ID, "legacy key ID is exactly LOT-v1");
  const verified = await verifyCandidate(candidate);
  console.log(`Canonical issuerKeyId: ${verified.canonicalIssuerKeyId}`);

  if (!input.apply) {
    console.log("DRY-RUN PASS — database unchanged.");
    return { applied: false, lotId: candidate.lot.id, credentialId: candidate.id };
  }

  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${candidate.lot.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "LotCredential" WHERE id=${candidate.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "LotProof" WHERE "credentialId"=${candidate.id}::uuid FOR UPDATE`;
      const locked = await tx.lotCredential.findUnique({
        where: { id: candidate.id },
        include: { lot: true, proof: true },
      });
      requireCheck(!!locked, "locked credential still exists");
      requireCheck(locked!.issuerKeyId === LEGACY_KEY_ID, "locked key ID is still LOT-v1");
      requireCheck(
        equal(publicSnapshot(locked!), verified.snapshot),
        "verified snapshot unchanged after row locks",
      );
      const changed = await tx.lotCredential.updateMany({
        where: { id: candidate.id, issuerKeyId: LEGACY_KEY_ID },
        data: { issuerKeyId: verified.canonicalIssuerKeyId },
      });
      requireCheck(changed.count === 1, "single credential compare-and-swap update");
      await tx.auditLog.create({
        data: {
          actorId: input.actorId!,
          action: ACTION,
          objectId: `${candidate.lot.id}:${candidate.id}`,
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
  console.log("APPLY PASS — credential key ID and one audit record committed atomically.");
  return { applied: true, lotId: candidate.lot.id, credentialId: candidate.id };
}

async function main() {
  try {
    await repairLegacyLotKeyId({
      lotId: argument("--lot-id"),
      credentialId: argument("--credential-id"),
      actorId: argument("--actor-id"),
      apply: process.argv.includes("--apply"),
    });
  } catch (error) {
    const safe = error instanceof Error ? error.message : "Unknown repair failure.";
    console.error(safe);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
    const curve = (globalThis as any).curve_bn128;
    if (curve?.terminate) await curve.terminate();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  await main();
