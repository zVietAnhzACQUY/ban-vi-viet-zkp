import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";
import type { PrismaClient } from "../generated/client/index.js";
import { ageProofBundleSchema } from "../../shared/age-wallet.js";
import {
  AGE_ISSUER_ID,
  AGE_PUBLIC_SIGNALS,
  AGE_SIGNAL_SCHEMA_SHA256,
  FIELD_MODULUS,
  G1_MANIFEST_SHA256,
  ageCredentialMessage,
  ageRequestHash,
  cartSnapshotHash,
  cutoffDay,
  userIdHash,
  type AgeCredentialMetadata,
  type CartHashItem,
} from "../../shared/g3.js";
import { fail, hash } from "./commerce.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifestPath = root + "artifacts/manifest.json";
const issuerPath = root + "artifacts/issuer-public.json";
const wasmPath =
  root + ".work/build/age/age_eligibility_js/age_eligibility.wasm";
const zkeyPath = root + ".work/setup/owner/age_contributed.zkey";
const verificationKeyPath = root + "artifacts/owner/age.verification_key.json";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const shaFile = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
export type TrustedAgeIssuer = {
  issuerId: string;
  keyVersion: 1;
  publicKey: string;
  fingerprint: string;
};

export type AgeServiceOptions = {
  issuer?: TrustedAgeIssuer;
  now?: () => Date;
};

function trustedIssuer(): TrustedAgeIssuer {
  const entry = readJson(issuerPath).issuers.find(
    (item: any) => item.type === "AGE",
  );
  if (!entry) throw new Error("AGE Issuer public key is missing.");
  return {
    issuerId: AGE_ISSUER_ID,
    keyVersion: 1,
    publicKey: entry.publicKey,
    fingerprint: entry.fingerprint,
  };
}

function randomField() {
  for (;;) {
    const bytes = randomBytes(32);
    const value = BigInt("0x" + bytes.toString("hex"));
    if (value > 0n && value < FIELD_MODULUS) return value.toString();
  }
}

function secureEqual(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}

function cartItems(cart: any): CartHashItem[] {
  return cart.items.map((item: any) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPriceVND: item.product.price.toString(),
    requiresAgeProof: item.product.requiresAgeProof,
    minimumAge: item.product.minimumAge,
  }));
}

async function currentCart(db: PrismaClient, userId: string) {
  const cart = await db.cart.findUnique({
    where: { userId },
    include: {
      items: { include: { product: true }, orderBy: { productId: "asc" } },
    },
  });
  if (!cart?.items.length) fail("CART_EMPTY", "Giỏ hàng đang trống.");
  if (cart.items.some((item) => !item.product.published))
    fail(
      "PRODUCT_UNAVAILABLE",
      "Một sản phẩm đã ngừng bán. Hãy cập nhật giỏ hàng.",
    );
  const minimumAge = Math.max(
    0,
    ...cart.items
      .filter((item) => item.product.requiresAgeProof)
      .map((item) => item.product.minimumAge),
  );
  if (!minimumAge)
    fail(
      "AGE_NOT_REQUIRED",
      "Giỏ hàng này không yêu cầu chứng minh tuổi.",
      400,
    );
  return {
    cart,
    minimumAge,
    snapshotHash: await cartSnapshotHash(cartItems(cart)),
  };
}

function loadArtifacts() {
  const manifestSha256 = shaFile(manifestPath);
  if (manifestSha256 !== G1_MANIFEST_SHA256)
    throw new Error("G1 manifest hash mismatch.");
  const manifest = readJson(manifestPath);
  const circuit = manifest.circuits.find(
    (item: any) => item.type === "AGE" && item.version === 1,
  );
  if (!circuit) throw new Error("AGE v1 artifact is missing from manifest.");
  if (
    JSON.stringify(circuit.publicSignals) !== JSON.stringify(AGE_PUBLIC_SIGNALS)
  )
    throw new Error("AGE public signal order differs from decisions.md.");
  if (circuit.signalSchemaSha256 !== AGE_SIGNAL_SCHEMA_SHA256)
    throw new Error("AGE public signal schema hash mismatch.");
  for (const [path, expected] of [
    [wasmPath, circuit.wasm.sha256],
    [zkeyPath, circuit.zkey.sha256],
    [verificationKeyPath, circuit.verificationKey.sha256],
  ]) {
    if (shaFile(path) !== expected)
      throw new Error(`G1 artifact hash mismatch: ${path}`);
  }
  return {
    manifestSha256,
    verificationKey: readJson(verificationKeyPath),
  };
}

export function createAgeService(
  db: PrismaClient,
  options: AgeServiceOptions = {},
) {
  const issuer = options.issuer ?? trustedIssuer();
  const now = options.now ?? (() => new Date());
  const artifacts = loadArtifacts();
  const publicKeyBytes = Buffer.from(issuer.publicKey, "base64url");
  if (publicKeyBytes.length !== 32)
    throw new Error("AGE Issuer public key must be 32 bytes.");
  if (
    createHash("sha256").update(publicKeyBytes).digest("hex") !==
    issuer.fingerprint
  )
    throw new Error("AGE Issuer fingerprint mismatch.");
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: issuer.publicKey } as JsonWebKey,
    format: "jwk",
  });

  async function challenge(userId: string) {
    const { minimumAge, snapshotHash } = await currentCart(db, userId);
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + 300_000);
    const cutoff = cutoffDay(issuedAt, minimumAge);
    const nonceField = randomField();
    const subjectHash = await userIdHash(userId);
    const requestHash = await ageRequestHash(
      nonceField,
      subjectHash,
      snapshotHash,
      cutoff,
    );
    const saved = await db.ageChallenge.create({
      data: {
        userId,
        nonceField,
        cartSnapshotHash: snapshotHash,
        cutoffDay: cutoff,
        minimumAge,
        requestHash,
        issuedAt,
        expiresAt,
      },
    });
    return {
      id: saved.id,
      cutoffDay: String(cutoff),
      requestHash,
      subjectHash,
      minimumAge,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      artifact: {
        circuitVersion: 1 as const,
        manifestSha256: artifacts.manifestSha256,
        signalSchemaSha256: AGE_SIGNAL_SCHEMA_SHA256,
        publicSignals: AGE_PUBLIC_SIGNALS,
        wasmUrl: "/api/zkp/age/wasm",
        zkeyUrl: "/api/zkp/age/zkey",
      },
    };
  }

  async function verifyForCheckout(userId: string, rawBundle: unknown) {
    const bundle = ageProofBundleSchema.parse(rawBundle);
    const checkTime = now();
    const existingChallenge = await db.ageChallenge.findFirst({
      where: { id: bundle.challengeId, userId },
      include: { verification: true },
    });
    if (!existingChallenge)
      fail("CHALLENGE_NOT_FOUND", "Challenge không thuộc tài khoản.", 404);
    if (existingChallenge.expiresAt <= checkTime)
      fail(
        "CHALLENGE_EXPIRED",
        "Challenge đã hết hạn. Vui lòng tạo proof mới.",
      );
    const { minimumAge, snapshotHash } = await currentCart(db, userId);
    if (
      snapshotHash !== existingChallenge.cartSnapshotHash ||
      minimumAge !== existingChallenge.minimumAge
    )
      fail("CART_CHANGED", "Giỏ hàng đã thay đổi sau khi phát challenge.");
    const currentCutoff = cutoffDay(checkTime, minimumAge);
    if (currentCutoff !== existingChallenge.cutoffDay)
      fail(
        "CHALLENGE_STALE_DATE",
        "Ngày UTC đã thay đổi. Vui lòng tạo challenge mới.",
      );
    const expectedRequestHash = await ageRequestHash(
      existingChallenge.nonceField,
      await userIdHash(userId),
      snapshotHash,
      currentCutoff,
    );
    if (!secureEqual(expectedRequestHash, existingChallenge.requestHash))
      fail("REQUEST_HASH_INVALID", "requestHash không khớp nội dung giỏ.");

    const metadata = bundle.credential.metadata as AgeCredentialMetadata;
    if (
      metadata.issuerId !== issuer.issuerId ||
      metadata.issuerKeyVersion !== issuer.keyVersion ||
      bundle.credential.issuerFingerprint !== issuer.fingerprint
    )
      fail("ISSUER_NOT_TRUSTED", "Issuer hoặc phiên bản khóa không được pin.");
    if (metadata.userIdHash !== (await userIdHash(userId)))
      fail(
        "CREDENTIAL_ACCOUNT_MISMATCH",
        "Credential không thuộc tài khoản này.",
      );
    const lifecycle = await db.ageCredentialRequest.findUnique({
      where: { credentialId: metadata.credentialId },
    });
    const allowUntracked =
      process.env.NODE_ENV !== "production" &&
      (process.env.G2_TEST === "1" ||
        process.env.ALLOW_UNTRACKED_AGE_CREDENTIALS === "1");
    if (!lifecycle && !allowUntracked)
      fail(
        "CREDENTIAL_LIFECYCLE_NOT_FOUND",
        "Credential chưa được Issuer Portal ghi nhận.",
        403,
      );
    if (lifecycle) {
      const expectedKeyId = `${issuer.issuerId}:v${issuer.keyVersion}`;
      if (
        lifecycle.userId !== userId ||
        lifecycle.status !== "ISSUED" ||
        !lifecycle.operatorId ||
        lifecycle.credentialId !== metadata.credentialId ||
        lifecycle.issuerKeyId !== expectedKeyId ||
        lifecycle.circuitVersion !== metadata.circuitVersion ||
        !lifecycle.issuedAt ||
        !lifecycle.expiresAt ||
        Math.floor(lifecycle.issuedAt.getTime() / 1000) !== Number(metadata.issuedAt) ||
        Math.floor(lifecycle.expiresAt.getTime() / 1000) !== Number(metadata.expiresAt) ||
        lifecycle.expiresAt <= checkTime
      )
        fail(
          "CREDENTIAL_LIFECYCLE_INVALID",
          "Credential đã thu hồi, hết hạn hoặc không thuộc yêu cầu hiện hành.",
          403,
        );
    }
    const issuedAtSeconds = Number(metadata.issuedAt);
    const expiresAtSeconds = Number(metadata.expiresAt);
    const nowSeconds = Math.floor(checkTime.getTime() / 1000);
    if (issuedAtSeconds > nowSeconds)
      fail("CREDENTIAL_NOT_YET_VALID", "Credential chưa có hiệu lực.");
    if (expiresAtSeconds <= nowSeconds || issuedAtSeconds >= expiresAtSeconds)
      fail("CREDENTIAL_EXPIRED", "Credential đã hết hạn.");
    const signature = Buffer.from(bundle.credential.signature, "base64url");
    if (
      signature.length !== 64 ||
      !verify(null, ageCredentialMessage(metadata), publicKey, signature)
    )
      fail("ISSUER_SIGNATURE_INVALID", "Chữ ký Issuer không hợp lệ.");

    const expectedSignals = [
      metadata.commitment,
      String(existingChallenge.cutoffDay),
      existingChallenge.requestHash,
      bundle.publicSignals[3],
    ];
    if (
      expectedSignals.some(
        (signal, index) => signal !== bundle.publicSignals[index],
      )
    )
      fail(
        "PUBLIC_SIGNALS_INVALID",
        "Public signals không khớp challenge/credential.",
      );
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
    if (!proofValid) fail("PROOF_INVALID", "Proof tuổi không hợp lệ.");
    const normalized = {
      proof: bundle.proof,
      publicSignals: bundle.publicSignals,
    };
    const proofHash = hash(JSON.stringify(normalized));
    const expiresAt = new Date(
      Math.min(existingChallenge.expiresAt.getTime(), expiresAtSeconds * 1000),
    );

    try {
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "AgeChallenge" WHERE id=${existingChallenge.id}::uuid FOR UPDATE`;
        const locked = await tx.ageChallenge.findUniqueOrThrow({
          where: { id: existingChallenge.id },
          include: { verification: true },
        });
        if (locked.userId !== userId)
          fail("CHALLENGE_NOT_FOUND", "Challenge không thuộc tài khoản.", 404);
        if (locked.expiresAt <= now())
          fail("CHALLENGE_EXPIRED", "Challenge đã hết hạn.");
        if (locked.verification) {
          fail("CHALLENGE_REPLAY", "Challenge đã được xác minh trước đó.");
        }
        if (locked.status !== "ISSUED")
          fail("CHALLENGE_REPLAY", "Challenge đã được sử dụng.");
        const verifiedAt = now();
        const verification = await tx.ageVerification.create({
          data: {
            challengeId: locked.id,
            userId,
            nullifier: bundle.publicSignals[3],
            credentialId: metadata.credentialId,
            commitment: metadata.commitment,
            credentialExpiresAt: new Date(expiresAtSeconds * 1000),
            issuerId: metadata.issuerId,
            issuerKeyVersion: metadata.issuerKeyVersion,
            issuerFingerprint: issuer.fingerprint,
            proofHash,
            verifiedAt,
            expiresAt,
          },
        });
        await tx.ageChallenge.update({
          where: { id: locked.id },
          data: { status: "VERIFIED", verifiedAt },
        });
        return verification;
      });
    } catch (error: any) {
      if (error?.code === "P2002")
        fail("NULLIFIER_REPLAY", "Nullifier đã được sử dụng.");
      throw error;
    }
  }

  return {
    trust: issuer,
    challenge,
    verifyForCheckout,
    artifact(path: "wasm" | "zkey") {
      return createReadStream(path === "wasm" ? wasmPath : zkeyPath);
    },
  };
}
