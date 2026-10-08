-- CreateEnum
CREATE TYPE "AgeChallengeStatus" AS ENUM ('ISSUED', 'VERIFIED', 'CONSUMED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "ageRequestHash" TEXT,
ADD COLUMN "ageVerificationId" UUID;

-- CreateTable
CREATE TABLE "AgeChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "nonceField" TEXT NOT NULL,
    "cartSnapshotHash" TEXT NOT NULL,
    "cutoffDay" INTEGER NOT NULL,
    "minimumAge" INTEGER NOT NULL,
    "requestHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AgeChallengeStatus" NOT NULL DEFAULT 'ISSUED',
    "verifiedAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    CONSTRAINT "AgeChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgeVerification" (
    "id" UUID NOT NULL,
    "challengeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "nullifier" TEXT NOT NULL,
    "credentialId" UUID NOT NULL,
    "commitment" TEXT NOT NULL,
    "credentialExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "issuerKeyVersion" INTEGER NOT NULL,
    "issuerFingerprint" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    CONSTRAINT "AgeVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgeChallenge_nonceField_key" ON "AgeChallenge"("nonceField");
CREATE INDEX "AgeChallenge_userId_issuedAt_idx" ON "AgeChallenge"("userId", "issuedAt");
CREATE INDEX "AgeChallenge_expiresAt_status_idx" ON "AgeChallenge"("expiresAt", "status");
CREATE UNIQUE INDEX "AgeVerification_challengeId_key" ON "AgeVerification"("challengeId");
CREATE UNIQUE INDEX "AgeVerification_nullifier_key" ON "AgeVerification"("nullifier");
CREATE INDEX "AgeVerification_userId_verifiedAt_idx" ON "AgeVerification"("userId", "verifiedAt");
CREATE INDEX "AgeVerification_expiresAt_idx" ON "AgeVerification"("expiresAt");
CREATE UNIQUE INDEX "Order_ageVerificationId_key" ON "Order"("ageVerificationId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_ageVerificationId_fkey" FOREIGN KEY ("ageVerificationId") REFERENCES "AgeVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgeChallenge" ADD CONSTRAINT "AgeChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgeVerification" ADD CONSTRAINT "AgeVerification_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "AgeChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgeVerification" ADD CONSTRAINT "AgeVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- G3 protocol and state invariants.
ALTER TABLE "AgeChallenge"
  ADD CONSTRAINT "AgeChallenge_time_valid" CHECK ("issuedAt" < "expiresAt"),
  ADD CONSTRAINT "AgeChallenge_cutoff_valid" CHECK ("cutoffDay" BETWEEN 0 AND 73413),
  ADD CONSTRAINT "AgeChallenge_minimum_age_valid" CHECK ("minimumAge" BETWEEN 1 AND 120),
  ADD CONSTRAINT "AgeChallenge_state_timestamps" CHECK (
    (status = 'ISSUED' AND "verifiedAt" IS NULL AND "consumedAt" IS NULL) OR
    (status = 'VERIFIED' AND "verifiedAt" IS NOT NULL AND "consumedAt" IS NULL) OR
    (status = 'CONSUMED' AND "verifiedAt" IS NOT NULL AND "consumedAt" IS NOT NULL)
  );
ALTER TABLE "AgeVerification"
  ADD CONSTRAINT "AgeVerification_time_valid" CHECK ("verifiedAt" < "expiresAt" AND "credentialExpiresAt" >= "expiresAt"),
  ADD CONSTRAINT "AgeVerification_key_version" CHECK ("issuerKeyVersion" = 1),
  ADD CONSTRAINT "AgeVerification_fingerprint" CHECK ("issuerFingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AgeVerification_proof_hash" CHECK ("proofHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_age_binding" CHECK (("ageVerificationId" IS NULL) = ("ageRequestHash" IS NULL));
