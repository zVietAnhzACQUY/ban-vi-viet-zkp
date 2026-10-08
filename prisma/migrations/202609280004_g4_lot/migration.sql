CREATE TYPE "LotCredentialStatus" AS ENUM ('ACTIVE', 'REVOKED', 'SUPERSEDED');
CREATE TYPE "LotProofStatus" AS ENUM ('ACTIVE', 'STALE');

ALTER TABLE "Lot" ADD COLUMN "stock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "lotId" UUID;
ALTER TABLE "OrderItem" ADD COLUMN "lotCode" TEXT;

WITH ranked AS (
  SELECT l.id,
         p.stock,
         ROW_NUMBER() OVER (PARTITION BY l."productId" ORDER BY l."lotCode") AS rn
  FROM "Lot" l
  JOIN "Product" p ON p.id = l."productId"
)
UPDATE "Lot" l
SET stock = CASE WHEN ranked.rn = 1 THEN ranked.stock ELSE 0 END
FROM ranked
WHERE l.id = ranked.id;

CREATE TABLE "LotCredential" (
  "id" UUID NOT NULL,
  "lotId" UUID NOT NULL,
  "commitment" TEXT NOT NULL,
  "productIdHash" TEXT NOT NULL,
  "lotCodeHash" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "publicAllowedCode" TEXT NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "issuerId" UUID NOT NULL,
  "issuerKeyVersion" INTEGER NOT NULL,
  "issuerFingerprint" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "status" "LotCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LotCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LotProof" (
  "id" UUID NOT NULL,
  "lotId" UUID NOT NULL,
  "credentialId" UUID NOT NULL,
  "proof" JSONB NOT NULL,
  "publicSignals" JSONB NOT NULL,
  "proofHash" TEXT NOT NULL,
  "manifestSha256" TEXT NOT NULL,
  "signalSchemaSha256" TEXT NOT NULL,
  "generatedAt" TIMESTAMPTZ(3) NOT NULL,
  "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "LotProofStatus" NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "LotProof_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Lot" ADD CONSTRAINT "Lot_stock_nonnegative" CHECK ("stock" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LotCredential" ADD CONSTRAINT "LotCredential_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LotProof" ADD CONSTRAINT "LotProof_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LotProof" ADD CONSTRAINT "LotProof_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "LotCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "LotProof_credentialId_key" ON "LotProof"("credentialId");
CREATE INDEX "Lot_productId_status_lotCode_idx" ON "Lot"("productId", "status", "lotCode");
CREATE INDEX "LotCredential_lotId_status_issuedAt_idx" ON "LotCredential"("lotId", "status", "issuedAt");
CREATE INDEX "LotCredential_expiresAt_status_idx" ON "LotCredential"("expiresAt", "status");
CREATE INDEX "LotProof_lotId_status_verifiedAt_idx" ON "LotProof"("lotId", "status", "verifiedAt");
CREATE INDEX "OrderItem_lotId_idx" ON "OrderItem"("lotId");
