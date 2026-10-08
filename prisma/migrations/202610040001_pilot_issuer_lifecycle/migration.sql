ALTER TYPE "LotStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "LotStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "LotStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "LotStatus" ADD VALUE IF NOT EXISTS 'REVOKED';
ALTER TYPE "LotStatus" ADD VALUE IF NOT EXISTS 'STALE';

CREATE TYPE "AgeCredentialRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED');

ALTER TABLE "Lot"
  ADD COLUMN "revokedAt" TIMESTAMPTZ(3),
  ADD COLUMN "revocationReason" TEXT,
  ADD COLUMN "issuerKeyId" TEXT,
  ADD COLUMN "circuitVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "LotCredential"
  ADD COLUMN "revocationReason" TEXT,
  ADD COLUMN "issuerKeyId" TEXT NOT NULL DEFAULT 'LOT-v1',
  ADD COLUMN "circuitVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "LotProof"
  ADD COLUMN "circuitVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "AgeCredentialRequest" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "AgeCredentialRequestStatus" NOT NULL DEFAULT 'PENDING',
  "operatorId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "issuedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "revocationReason" TEXT,
  "issuerKeyId" TEXT,
  "circuitVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgeCredentialRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgeCredentialRequest_dates" CHECK ("expiresAt" IS NULL OR "issuedAt" IS NULL OR "issuedAt" < "expiresAt"),
  CONSTRAINT "AgeCredentialRequest_circuit_version" CHECK ("circuitVersion" > 0)
);

CREATE INDEX "AgeCredentialRequest_userId_createdAt_idx" ON "AgeCredentialRequest"("userId", "createdAt");
CREATE INDEX "AgeCredentialRequest_status_createdAt_idx" ON "AgeCredentialRequest"("status", "createdAt");
CREATE INDEX "AgeCredentialRequest_operatorId_reviewedAt_idx" ON "AgeCredentialRequest"("operatorId", "reviewedAt");

ALTER TABLE "AgeCredentialRequest" ADD CONSTRAINT "AgeCredentialRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgeCredentialRequest" ADD CONSTRAINT "AgeCredentialRequest_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
