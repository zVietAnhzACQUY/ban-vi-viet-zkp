import { groth16 } from "snarkjs";
import {
  LOT_ALLOWED_CODE,
  LOT_ISSUER_FINGERPRINT,
  LOT_PUBLIC_SIGNALS,
  LOT_SIGNAL_SCHEMA_SHA256,
  LOT_VERIFICATION_KEY_SHA256,
  lotCodeHash,
  lotCredentialMessage,
  productIdHash,
} from "../../shared/g4";
import { G1_MANIFEST_SHA256 } from "../../shared/g3";
import type { LotProofStatus } from "./api";

function base64url(value: string) {
  const encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(encoded + "=".repeat((4 - (encoded.length % 4)) % 4));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function buffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", buffer(bytes)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyLotStatus(
  response: LotProofStatus,
  productId: string,
  lotCode: string,
) {
  if (response.status !== "ACTIVE" || !response.bundle)
    throw new Error(response.reason || "Lô chưa có proof đang hiệu lực.");
  const bundle = response.bundle;
  if (
    response.productId !== productId ||
    response.lotCode !== lotCode ||
    bundle.productId !== productId ||
    bundle.lotCode !== lotCode
  )
    throw new Error("Proof bundle không thuộc sản phẩm/lô đang xem.");
  if (
    bundle.manifestSha256 !== G1_MANIFEST_SHA256 ||
    bundle.signalSchemaSha256 !== LOT_SIGNAL_SCHEMA_SHA256 ||
    JSON.stringify(response.publicSignals) !==
      JSON.stringify(LOT_PUBLIC_SIGNALS)
  )
    throw new Error("Cấu hình xác minh lô không khớp phiên bản được tin cậy.");
  const metadata = bundle.credential.metadata;
  const expectedProductHash = await productIdHash(productId);
  const expectedLotHash = await lotCodeHash(productId, lotCode);
  if (
    metadata.productIdHash !== expectedProductHash ||
    metadata.lotCodeHash !== expectedLotHash ||
    metadata.publicAllowedCode !== LOT_ALLOWED_CODE ||
    bundle.publicSignals[0] !== metadata.commitment ||
    bundle.publicSignals[1] !== LOT_ALLOWED_CODE ||
    bundle.publicSignals[2] !== expectedLotHash
  )
    throw new Error(
      "Metadata/public signals không gắn đúng product, lô và policy.",
    );
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    Number(metadata.issuedAt) > nowSeconds ||
    Number(metadata.expiresAt) <= nowSeconds
  )
    throw new Error("Credential lô chưa có hiệu lực hoặc đã hết hạn.");
  const publicKeyBytes = base64url(response.issuerPublicKey || "");
  if (
    response.issuerFingerprint !== LOT_ISSUER_FINGERPRINT ||
    bundle.credential.issuerFingerprint !== LOT_ISSUER_FINGERPRINT ||
    (await sha256Hex(publicKeyBytes)) !== LOT_ISSUER_FINGERPRINT
  )
    throw new Error("Khóa của đơn vị xác nhận lô không khớp cấu hình tin cậy.");
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
      buffer(base64url(bundle.credential.signature)),
      buffer(lotCredentialMessage(metadata)),
    ))
  )
    throw new Error("Chữ ký Issuer LOT không hợp lệ trong trình duyệt.");
  const keyResponse = await fetch("/api/zkp/lot/verification-key", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!keyResponse.ok) throw new Error("Không tải được verification key LOT.");
  const keyBytes = new Uint8Array(await keyResponse.arrayBuffer());
  const verificationKeyHash = await sha256Hex(keyBytes);
  if (verificationKeyHash !== LOT_VERIFICATION_KEY_SHA256)
    throw new Error("Khóa kiểm tra lô không khớp phiên bản được tin cậy.");
  const verificationKey = JSON.parse(new TextDecoder().decode(keyBytes));
  if (
    !(await groth16.verify(verificationKey, bundle.publicSignals, bundle.proof))
  )
    throw new Error("Groth16 proof lô không hợp lệ trong trình duyệt.");
  return {
    checkedAt: response.checkedAt,
    expiresAt: response.expiresAt!,
    publicAllowedCode: metadata.publicAllowedCode,
  };
}
