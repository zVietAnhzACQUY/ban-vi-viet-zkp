import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";
import { z } from "zod";
import type { PrismaClient } from "../generated/client/index.js";
import {
  LOT_ALLOWED_CODE,
  LOT_CREDENTIAL_DOMAIN,
  LOT_ISSUER_FINGERPRINT,
  LOT_ISSUER_ID,
  LOT_POLICY_VERSION,
  LOT_PUBLIC_SIGNALS,
  LOT_SIGNAL_SCHEMA_SHA256,
  LOT_VERIFICATION_KEY_SHA256,
  LOT_WASM_SHA256,
  LOT_ZKEY_SHA256,
  lotCodeHash,
  lotCredentialMessage,
  productIdHash,
  type LotCredentialMetadata,
  type LotProofBundle,
} from "../../shared/g4.js";
import {
  G1_MANIFEST_SHA256,
  canonicalUuid,
  parseField,
} from "../../shared/g3.js";
import { fail, hash } from "./commerce.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifestPath = root + "artifacts/manifest.json";
const issuerPath = root + "artifacts/issuer-public.json";
const wasmPath = root + ".work/build/lot/lot_origin_js/lot_origin.wasm";
const zkeyPath = root + ".work/setup/owner/lot_contributed.zkey";
const verificationKeyPath = root + "artifacts/owner/lot.verification_key.json";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const shaFile = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const decimal = /^(0|[1-9][0-9]*)$/;
const fieldSchema = z
  .string()
  .regex(decimal)
  .refine((value) => {
    try {
      parseField(value);
      return true;
    } catch {
      return false;
    }
  });
const timestampSchema = z
  .string()
  .regex(decimal)
  .refine((value) => BigInt(value) <= 253402300799n);
const coordinate = z.string().regex(/^(0|[1-9][0-9]{0,79})$/);
const proofSchema = z
  .object({
    pi_a: z.tuple([coordinate, coordinate, coordinate]),
    pi_b: z.tuple([
      z.tuple([coordinate, coordinate]),
      z.tuple([coordinate, coordinate]),
      z.tuple([coordinate, coordinate]),
    ]),
    pi_c: z.tuple([coordinate, coordinate, coordinate]),
    protocol: z.literal("groth16"),
    curve: z.literal("bn128"),
  })
  .strict();
const metadataSchema = z
  .object({
    domain: z.literal(LOT_CREDENTIAL_DOMAIN),
    schemaVersion: z.literal(1),
    circuitVersion: z.literal(1),
    credentialId: z.string().uuid(),
    issuerId: z.string().uuid(),
    commitment: fieldSchema,
    productIdHash: fieldSchema,
    lotCodeHash: fieldSchema,
    policyVersion: z.literal(1),
    publicAllowedCode: fieldSchema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    issuerKeyVersion: z.literal(1),
  })
  .strict();
export const lotProofBundleSchema = z
  .object({
    type: z.literal("LOT_PROOF_BUNDLE"),
    productId: z.string().uuid(),
    lotCode: z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,63}$/),
    generatedAt: z.string().datetime(),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    signalSchemaSha256: z.string().regex(/^[0-9a-f]{64}$/),
    publicSignals: z.tuple([fieldSchema, fieldSchema, fieldSchema]),
    proof: proofSchema,
    credential: z
      .object({
        metadata: metadataSchema,
        issuerFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
      })
      .strict(),
  })
  .strict();

export type TrustedLotIssuer = {
  issuerId: string;
  keyVersion: 1;
  publicKey: string;
  fingerprint: string;
};

export type LotServiceOptions = {
  issuer?: TrustedLotIssuer;
  now?: () => Date;
};

export function canonicalLotIssuerKeyId(issuerId: string, keyVersion: number) {
  canonicalUuid(issuerId);
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0)
    throw new Error("LOT issuer key version must be a positive integer.");
  return `${issuerId}:v${keyVersion}`;
}

function trustedIssuer(): TrustedLotIssuer {
  const entry = readJson(issuerPath).issuers.find(
    (item: any) => item.type === "LOT",
  );
  if (!entry) throw new Error("LOT Issuer public key is missing.");
  return {
    issuerId: LOT_ISSUER_ID,
    keyVersion: 1,
    publicKey: entry.publicKey,
    fingerprint: entry.fingerprint,
  };
}

function secureEqual(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}

function loadArtifacts() {
  if (shaFile(manifestPath) !== G1_MANIFEST_SHA256)
    throw new Error("G1 manifest hash mismatch.");
  const manifest = readJson(manifestPath);
  const circuit = manifest.circuits.find(
    (item: any) => item.type === "LOT" && item.version === 1,
  );
  if (!circuit) throw new Error("LOT v1 artifact is missing from manifest.");
  if (
    JSON.stringify(circuit.publicSignals) !== JSON.stringify(LOT_PUBLIC_SIGNALS)
  )
    throw new Error("LOT public signal order differs from decisions.md.");
  if (
    circuit.signalSchemaSha256 !== LOT_SIGNAL_SCHEMA_SHA256 ||
    circuit.wasm.sha256 !== LOT_WASM_SHA256 ||
    circuit.zkey.sha256 !== LOT_ZKEY_SHA256 ||
    circuit.verificationKey.sha256 !== LOT_VERIFICATION_KEY_SHA256
  )
    throw new Error("LOT manifest metadata differs from pinned G1 values.");
  for (const [path, expected] of [
    [wasmPath, LOT_WASM_SHA256],
    [zkeyPath, LOT_ZKEY_SHA256],
    [verificationKeyPath, LOT_VERIFICATION_KEY_SHA256],
  ])
    if (shaFile(path) !== expected)
      throw new Error(`G1 LOT artifact hash mismatch: ${path}`);
  return { verificationKey: readJson(verificationKeyPath) };
}

export function createLotService(
  db: PrismaClient,
  options: LotServiceOptions = {},
) {
  const issuer = options.issuer ?? trustedIssuer();
  const now = options.now ?? (() => new Date());
  const artifacts = loadArtifacts();
  const publicKeyBytes = Buffer.from(issuer.publicKey, "base64url");
  if (publicKeyBytes.length !== 32)
    throw new Error("LOT Issuer public key must be 32 bytes.");
  if (
    createHash("sha256").update(publicKeyBytes).digest("hex") !==
    issuer.fingerprint
  )
    throw new Error("LOT Issuer fingerprint mismatch.");
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: issuer.publicKey } as JsonWebKey,
    format: "jwk",
  });

  async function validateBundle(lotId: string, raw: unknown) {
    const bundle = lotProofBundleSchema.parse(raw) as LotProofBundle;
    const lot = await db.lot.findUnique({ where: { id: lotId } });
    if (!lot) fail("LOT_NOT_FOUND", "Không tìm thấy lô.", 404);
    if (lot.status !== "ACTIVE")
      fail("LOT_NOT_ACTIVE", "Chỉ lô đang vận hành ACTIVE mới được nhập proof.");
    if (bundle.productId !== lot.productId || bundle.lotCode !== lot.lotCode)
      fail("LOT_BINDING_MISMATCH", "Proof bundle không thuộc đúng lô.");
    if (
      bundle.manifestSha256 !== G1_MANIFEST_SHA256 ||
      bundle.signalSchemaSha256 !== LOT_SIGNAL_SCHEMA_SHA256
    )
      fail(
        "LOT_ARTIFACT_MISMATCH",
        "Bundle không dùng artifact LOT G1 đã pin.",
      );
    const metadata = bundle.credential.metadata;
    canonicalUuid(metadata.credentialId);
    const issuerKeyId = canonicalLotIssuerKeyId(
      metadata.issuerId,
      metadata.issuerKeyVersion,
    );
    if (
      metadata.issuerId !== issuer.issuerId ||
      metadata.issuerKeyVersion !== issuer.keyVersion ||
      bundle.credential.issuerFingerprint !== issuer.fingerprint
    )
      fail(
        "ISSUER_NOT_TRUSTED",
        "Issuer LOT hoặc phiên bản khóa không được pin.",
      );
    const checkTime = now();
    const nowSeconds = Math.floor(checkTime.getTime() / 1000);
    const issuedAt = Number(metadata.issuedAt);
    const expiresAt = Number(metadata.expiresAt);
    if (issuedAt > nowSeconds)
      fail("CREDENTIAL_NOT_YET_VALID", "Credential lô chưa có hiệu lực.");
    if (expiresAt <= nowSeconds || issuedAt >= expiresAt)
      fail("CREDENTIAL_EXPIRED", "Credential lô đã hết hạn.");
    if (
      metadata.policyVersion !== LOT_POLICY_VERSION ||
      metadata.publicAllowedCode !== LOT_ALLOWED_CODE
    )
      fail("LOT_POLICY_STALE", "Credential không thuộc policy vùng hiện hành.");
    const expectedProductHash = await productIdHash(lot.productId);
    const expectedLotHash = await lotCodeHash(lot.productId, lot.lotCode);
    if (
      metadata.productIdHash !== expectedProductHash ||
      metadata.lotCodeHash !== expectedLotHash
    )
      fail("LOT_BINDING_MISMATCH", "Metadata không gắn đúng product/lot.");
    const signature = Buffer.from(bundle.credential.signature, "base64url");
    if (
      signature.length !== 64 ||
      !verify(null, lotCredentialMessage(metadata), publicKey, signature)
    )
      fail("ISSUER_SIGNATURE_INVALID", "Chữ ký Issuer LOT không hợp lệ.");
    const expectedSignals = [
      metadata.commitment,
      LOT_ALLOWED_CODE,
      expectedLotHash,
    ];
    if (
      expectedSignals.some(
        (signal, index) => signal !== bundle.publicSignals[index],
      )
    )
      fail("PUBLIC_SIGNALS_INVALID", "Public signals LOT không đúng binding.");
    let proofValid = false;
    try {
      proofValid = await groth16.verify(
        artifacts.verificationKey,
        bundle.publicSignals,
        bundle.proof,
      );
    } catch {
      proofValid = false;
    }
    if (!proofValid) fail("PROOF_INVALID", "Proof lô không hợp lệ.");
    return { bundle, lot, metadata, issuerKeyId, checkTime };
  }

  async function importProof(lotId: string, raw: unknown, actorId: string) {
    const { bundle, lot, metadata, issuerKeyId, checkTime } = await validateBundle(
      lotId,
      raw,
    );
    const proofHash = hash(
      JSON.stringify({
        proof: bundle.proof,
        publicSignals: bundle.publicSignals,
      }),
    );
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${lotId}::uuid FOR UPDATE`;
      const locked = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
      if (
        locked.status !== "ACTIVE" ||
        locked.productId !== lot.productId ||
        locked.lotCode !== lot.lotCode
      )
        fail("LOT_CHANGED", "Lô đã thay đổi trong lúc kiểm proof.");
      const existing = await tx.lotCredential.findUnique({
        where: { id: metadata.credentialId },
        include: { proof: true },
      });
      const issuanceRequest=await tx.lotCredentialRequest.findUnique({where:{credentialId:metadata.credentialId}});
      if(issuanceRequest && (issuanceRequest.status!=="ISSUED" || issuanceRequest.lotId!==lotId || issuanceRequest.productId!==lot.productId || issuanceRequest.lotCode!==lot.lotCode || issuanceRequest.issuerKeyId!==issuerKeyId || issuanceRequest.issuedAt?.getTime()!==Number(metadata.issuedAt)*1000 || issuanceRequest.expiresAt?.getTime()!==Number(metadata.expiresAt)*1000))
        fail("LOT_REQUEST_BINDING_INVALID","Yêu cầu phát hành không còn hợp lệ cho credential này.");
      if (existing) {
        if (existing.lotId !== lotId || existing.proof?.proofHash !== proofHash)
          fail("CREDENTIAL_CONFLICT", "Credential ID đã dùng cho bundle khác.");
        return existing.proof;
      }
      const old = await tx.lotCredential.findMany({
        where: { lotId, status: "ACTIVE" },
        select: { id: true },
      });
      if (old.length) {
        await tx.lotCredential.updateMany({
          where: { id: { in: old.map((item) => item.id) } },
          data: { status: "SUPERSEDED" },
        });
        await tx.lotProof.updateMany({
          where: { credentialId: { in: old.map((item) => item.id) } },
          data: { status: "STALE" },
        });
      }
      const credential = await tx.lotCredential.create({
        data: {
          id: metadata.credentialId,
          lotId,
          commitment: metadata.commitment,
          productIdHash: metadata.productIdHash,
          lotCodeHash: metadata.lotCodeHash,
          policyVersion: metadata.policyVersion,
          publicAllowedCode: metadata.publicAllowedCode,
          issuedAt: new Date(Number(metadata.issuedAt) * 1000),
          expiresAt: new Date(Number(metadata.expiresAt) * 1000),
          issuerId: metadata.issuerId,
          issuerKeyVersion: metadata.issuerKeyVersion,
          issuerFingerprint: bundle.credential.issuerFingerprint,
          issuerKeyId,
          circuitVersion: metadata.circuitVersion,
          signature: bundle.credential.signature,
          proof: {
            create: {
              lotId,
              proof: bundle.proof as any,
              publicSignals: bundle.publicSignals,
              proofHash,
              manifestSha256: bundle.manifestSha256,
              signalSchemaSha256: bundle.signalSchemaSha256,
              generatedAt: new Date(bundle.generatedAt),
              verifiedAt: checkTime,
              circuitVersion: metadata.circuitVersion,
            },
          },
        },
        include: { proof: true },
      });
      await tx.auditLog.create({
        data: { actorId, action: "LOT_PROOF_IMPORTED", objectId: lotId },
      });
      return credential.proof;
    });
  }

  async function status(lotId: string) {
    const checkedAt = now();
    const lot = await db.lot.findUnique({
      where: { id: lotId },
      include: {
        product: { select: { id: true, name: true } },
        credentials: {
          where: { status: { in: ["ACTIVE", "REVOKED", "SUPERSEDED"] } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          include: { proof: true },
        },
      },
    });
    if (!lot) fail("LOT_NOT_FOUND", "Không tìm thấy lô.", 404);
    const base = {
      lotId: lot.id,
      productId: lot.productId,
      productName: lot.product.name,
      lotCode: lot.lotCode,
      checkedAt: checkedAt.toISOString(),
    };
    const credential = lot.credentials[0];
    if (!credential)
      return {
        ...base,
        status: "UNVERIFIED" as const,
        reason: "Chưa có proof lô.",
      };
    if (credential.status === "REVOKED")
      return {
        ...base,
        status: "REVOKED" as const,
        reason: "Credential đã bị thu hồi.",
      };
    if (credential.expiresAt <= checkedAt)
      return {
        ...base,
        status: "EXPIRED" as const,
        reason: "Credential đã hết hạn.",
      };
    const expectedProductHash = await productIdHash(lot.productId);
    const expectedLotHash = await lotCodeHash(lot.productId, lot.lotCode);
    const expectedIssuerKeyId = canonicalLotIssuerKeyId(
      credential.issuerId,
      credential.issuerKeyVersion,
    );
    if (
      credential.status !== "ACTIVE" ||
      credential.issuerId !== issuer.issuerId ||
      credential.issuerKeyVersion !== issuer.keyVersion ||
      credential.issuerKeyId !== expectedIssuerKeyId ||
      credential.circuitVersion !== 1 ||
      credential.issuerFingerprint !== issuer.fingerprint ||
      credential.policyVersion !== LOT_POLICY_VERSION ||
      credential.publicAllowedCode !== LOT_ALLOWED_CODE ||
      credential.productIdHash !== expectedProductHash ||
      credential.lotCodeHash !== expectedLotHash ||
      !credential.proof ||
      credential.proof.status !== "ACTIVE" ||
      credential.proof.credentialId !== credential.id ||
      credential.proof.lotId !== lot.id ||
      credential.proof.circuitVersion !== credential.circuitVersion ||
      credential.proof.manifestSha256 !== G1_MANIFEST_SHA256 ||
      credential.proof.signalSchemaSha256 !== LOT_SIGNAL_SCHEMA_SHA256
    )
      return {
        ...base,
        status: "STALE" as const,
        reason: "Proof không còn khớp trạng thái hoặc policy hiện hành.",
      };
    const metadata: LotCredentialMetadata = {
      domain: LOT_CREDENTIAL_DOMAIN,
      schemaVersion: 1,
      circuitVersion: 1,
      credentialId: credential.id,
      issuerId: credential.issuerId,
      commitment: credential.commitment,
      productIdHash: credential.productIdHash,
      lotCodeHash: credential.lotCodeHash,
      policyVersion: 1,
      publicAllowedCode: credential.publicAllowedCode,
      issuedAt: String(Math.floor(credential.issuedAt.getTime() / 1000)),
      expiresAt: String(Math.floor(credential.expiresAt.getTime() / 1000)),
      issuerKeyVersion: 1,
    };
    const bundle: LotProofBundle = {
      type: "LOT_PROOF_BUNDLE",
      productId: lot.productId,
      lotCode: lot.lotCode,
      generatedAt: credential.proof.generatedAt.toISOString(),
      manifestSha256: credential.proof.manifestSha256,
      signalSchemaSha256: LOT_SIGNAL_SCHEMA_SHA256,
      publicSignals: credential.proof.publicSignals as [string, string, string],
      proof: credential.proof.proof as any,
      credential: {
        metadata,
        issuerFingerprint: credential.issuerFingerprint,
        signature: credential.signature,
      },
    };
    return {
      ...base,
      status: "ACTIVE" as const,
      reason: "Proof và trạng thái online đang hợp lệ.",
      expiresAt: credential.expiresAt.toISOString(),
      publicAllowedCode: credential.publicAllowedCode,
      issuerPublicKey: issuer.publicKey,
      issuerFingerprint: issuer.fingerprint,
      publicSignals: LOT_PUBLIC_SIGNALS,
      bundle,
    };
  }

  async function revoke(
    lotId: string,
    actorId: string,
    reason = "Thu hồi theo yêu cầu operator",
  ) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${lotId}::uuid FOR UPDATE`;
      const lot = await tx.lot.findUnique({ where: { id: lotId } });
      if (!lot) fail("LOT_NOT_FOUND", "Không tìm thấy lô.", 404);
      const active = await tx.lotCredential.findMany({
        where: { lotId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!active.length) return;
      const revokedAt = now();
      await tx.lotCredential.updateMany({
        where: { id: { in: active.map((item) => item.id) } },
        data: { status: "REVOKED", revokedAt, revocationReason: reason },
      });
      await tx.lotProof.updateMany({
        where: { credentialId: { in: active.map((item) => item.id) } },
        data: { status: "STALE" },
      });
      await tx.auditLog.create({
        data: { actorId, action: "LOT_CREDENTIAL_REVOKED", objectId: lotId },
      });
    });
    return status(lotId);
  }

  return {
    trust: issuer,
    importProof,
    status,
    revoke,
    verificationKey: artifacts.verificationKey,
    verificationKeyBytes: readFileSync(verificationKeyPath),
  };
}
