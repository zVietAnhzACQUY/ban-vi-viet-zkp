ALTER TABLE "Lot" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Prisma supplies @updatedAt values. Remove defaults introduced by migration 001
-- so database behavior matches the checked-in Prisma schema.
ALTER TABLE "AgeCredentialRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Lot" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Never synthesize issuer identity from a shared fallback such as LOT-v1.
-- Import code must derive <issuerId>:v<issuerKeyVersion> from signed metadata.
ALTER TABLE "LotCredential" ALTER COLUMN "issuerKeyId" DROP DEFAULT;

ALTER TABLE "AgeCredentialRequest" ADD COLUMN "credentialId" UUID;
CREATE UNIQUE INDEX "AgeCredentialRequest_credentialId_key"
  ON "AgeCredentialRequest"("credentialId");

-- At most one request may be awaiting review or issuance for one account.
CREATE UNIQUE INDEX "AgeCredentialRequest_one_open_per_user"
  ON "AgeCredentialRequest"("userId")
  WHERE "status" IN ('PENDING', 'APPROVED', 'ISSUING');

ALTER TABLE "AgeCredentialRequest"
  ADD CONSTRAINT "AgeCredentialRequest_version_positive" CHECK ("circuitVersion" > 0),
  ADD CONSTRAINT "AgeCredentialRequest_issued_fields" CHECK (
    "status" NOT IN ('ISSUING', 'ISSUED') OR
    ("operatorId" IS NOT NULL AND "credentialId" IS NOT NULL AND
     "issuedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND
     "issuerKeyId" IS NOT NULL AND "issuedAt" < "expiresAt")
  ),
  ADD CONSTRAINT "AgeCredentialRequest_revocation_reason" CHECK (
    "status" <> 'REVOKED' OR
    ("revokedAt" IS NOT NULL AND length(trim("revocationReason")) > 0)
  );

ALTER TABLE "LotCredential"
  ADD CONSTRAINT "LotCredential_issuer_key_canonical" CHECK (
    "issuerKeyId" = "issuerId"::text || ':v' || "issuerKeyVersion"::text
  ),
  ADD CONSTRAINT "LotCredential_version_supported" CHECK ("circuitVersion" = 1),
  ADD CONSTRAINT "LotCredential_time_valid" CHECK ("issuedAt" < "expiresAt");

ALTER TABLE "LotProof"
  ADD CONSTRAINT "LotProof_version_supported" CHECK ("circuitVersion" = 1);
