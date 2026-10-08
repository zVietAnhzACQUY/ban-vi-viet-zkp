import { z } from "zod";
import {
  AGE_CREDENTIAL_DOMAIN,
  AGE_PUBLIC_SIGNALS,
  FIELD_MODULUS,
} from "./g3.js";

export const AGE_WALLET_PROTOCOL_VERSION = 1 as const;
export const AGE_WALLET_REQUEST_TYPE = "BVV_AGE_PROOF_REQUEST" as const;
export const AGE_WALLET_RESPONSE_TYPE = "BVV_AGE_PROOF_RESPONSE" as const;
export const AGE_WALLET_READY_TYPE = "BVV_AGE_WALLET_READY" as const;
export const AGE_REQUESTER_NAME = "Bản Vị Việt" as const;
export const AGE_REQUEST_PURPOSE = "Đặt mua sản phẩm hạn chế độ tuổi" as const;

const decimal = /^(0|[1-9][0-9]*)$/;
const fieldSchema = z
  .string()
  .regex(decimal)
  .refine((value) => BigInt(value) < FIELD_MODULUS);
const timestampSchema = z
  .string()
  .regex(decimal)
  .refine((value) => BigInt(value) <= 253402300799n);
const coordinate = z.string().regex(/^(0|[1-9][0-9]{0,79})$/);
const canonicalOrigin = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.origin === value && parsed.pathname === "/";
  }, "Origin phải ở dạng scheme://host[:port].");

export const ageCredentialMetadataSchema = z
  .object({
    domain: z.literal(AGE_CREDENTIAL_DOMAIN),
    schemaVersion: z.literal(1),
    circuitVersion: z.literal(1),
    credentialId: z.string().uuid(),
    issuerId: z.string().uuid(),
    commitment: fieldSchema,
    userIdHash: fieldSchema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    issuerKeyVersion: z.literal(1),
  })
  .strict();

export const ageCredentialFileSchema = z
  .object({
    type: z.literal("AGE"),
    privateInputs: z
      .object({
        dobDay: fieldSchema,
        salt: fieldSchema,
        holderSecret: fieldSchema,
      })
      .strict(),
    metadata: ageCredentialMetadataSchema,
    issuerFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();

export const agePublicCredentialSchema = z
  .object({
    metadata: ageCredentialMetadataSchema,
    issuerFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();

export const groth16ProofSchema = z
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

export const ageProofBundleSchema = z
  .object({
    challengeId: z.string().uuid(),
    credential: agePublicCredentialSchema,
    proof: groth16ProofSchema,
    publicSignals: z.tuple([
      fieldSchema,
      fieldSchema,
      fieldSchema,
      fieldSchema,
    ]),
  })
  .strict();

const artifactSchema = z
  .object({
    circuitVersion: z.literal(1),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    signalSchemaSha256: z.string().regex(/^[0-9a-f]{64}$/),
    publicSignals: z.tuple([
      z.literal(AGE_PUBLIC_SIGNALS[0]),
      z.literal(AGE_PUBLIC_SIGNALS[1]),
      z.literal(AGE_PUBLIC_SIGNALS[2]),
      z.literal(AGE_PUBLIC_SIGNALS[3]),
    ]),
    wasmUrl: z.string().url(),
    zkeyUrl: z.string().url(),
  })
  .strict();

export const ageProofRequestSchema = z
  .object({
    type: z.literal(AGE_WALLET_REQUEST_TYPE),
    protocolVersion: z.literal(AGE_WALLET_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    challengeId: z.string().uuid(),
    requestHash: fieldSchema,
    cutoffDay: fieldSchema,
    minimumAge: z.number().int().min(1).max(120),
    subjectHash: fieldSchema,
    requesterOrigin: canonicalOrigin,
    returnOrigin: canonicalOrigin,
    requesterName: z.literal(AGE_REQUESTER_NAME),
    purpose: z.literal(AGE_REQUEST_PURPOSE),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    artifact: artifactSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.requesterOrigin !== value.returnOrigin)
      context.addIssue({
        code: "custom",
        message: "returnOrigin phải trùng requesterOrigin.",
        path: ["returnOrigin"],
      });
    if (
      new Date(value.issuedAt).getTime() >= new Date(value.expiresAt).getTime()
    )
      context.addIssue({
        code: "custom",
        message: "Thời hạn proof request không hợp lệ.",
        path: ["expiresAt"],
      });
    if (
      new Date(value.expiresAt).getTime() -
        new Date(value.issuedAt).getTime() !==
      300_000
    )
      context.addIssue({
        code: "custom",
        message: "AGE proof request phải có TTL đúng 300 giây.",
        path: ["expiresAt"],
      });
  });

export const ageProofTimingsSchema = z
  .object({
    cache: z.enum(["cold", "warm"]),
    wasmLoadMs: z.number().nonnegative(),
    zkeyLoadMs: z.number().nonnegative(),
    proofMs: z.number().nonnegative(),
    walletTotalMs: z.number().nonnegative(),
    consentedAtEpochMs: z.number().int().nonnegative(),
  })
  .strict();

export const ageProofSuccessResponseSchema = z
  .object({
    type: z.literal(AGE_WALLET_RESPONSE_TYPE),
    protocolVersion: z.literal(AGE_WALLET_PROTOCOL_VERSION),
    status: z.literal("SUCCESS"),
    requestId: z.string().uuid(),
    challengeId: z.string().uuid(),
    proofBundle: ageProofBundleSchema,
    timings: ageProofTimingsSchema,
  })
  .strict();

export const walletErrorResponseSchema = z
  .object({
    type: z.literal(AGE_WALLET_RESPONSE_TYPE),
    protocolVersion: z.literal(AGE_WALLET_PROTOCOL_VERSION),
    status: z.enum(["REJECTED", "ERROR"]),
    requestId: z.string().uuid(),
    challengeId: z.string().uuid(),
    code: z.enum([
      "USER_REJECTED",
      "NO_CREDENTIAL",
      "CREDENTIAL_INVALID",
      "REQUEST_INVALID",
      "REQUEST_EXPIRED",
      "REQUEST_REPLAY",
      "PROOF_FAILED",
    ]),
    message: z.string().min(1).max(300),
  })
  .strict();

export const ageProofResponseSchema = z.discriminatedUnion("status", [
  ageProofSuccessResponseSchema,
  walletErrorResponseSchema,
]);

export const walletReadySchema = z
  .object({
    type: z.literal(AGE_WALLET_READY_TYPE),
    protocolVersion: z.literal(AGE_WALLET_PROTOCOL_VERSION),
  })
  .strict();

export type AgeCredentialFile = z.infer<typeof ageCredentialFileSchema>;
export type AgeProofBundle = z.infer<typeof ageProofBundleSchema>;
export type AgeProofRequest = z.infer<typeof ageProofRequestSchema>;
export type AgeProofResponse = z.infer<typeof ageProofResponseSchema>;
export type AgeProofSuccessResponse = z.infer<
  typeof ageProofSuccessResponseSchema
>;
export type WalletErrorResponse = z.infer<typeof walletErrorResponseSchema>;
