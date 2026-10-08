-- Additive only. Legacy requests remain without submission; no synthetic backfill.
ALTER TABLE "AgeCredentialRequest"
 ADD COLUMN "verificationMethod" TEXT,
 ADD COLUMN "fictionalReference" TEXT,
 ADD COLUMN "recordSubmittedAt" TIMESTAMPTZ(3),
 ADD COLUMN "recordReviewedAt" TIMESTAMPTZ(3),
 ADD COLUMN "consentAt" TIMESTAMPTZ(3),
 ADD COLUMN "evidenceRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgeCredentialRequest" ADD CONSTRAINT "AgeRequest_evidence_method" CHECK (
 "verificationMethod" IS NULL OR "verificationMethod" IN ('ELECTRONIC','IN_PERSON','EXTERNAL'));
ALTER TABLE "AgeCredentialRequest" ADD CONSTRAINT "AgeRequest_submission_consistent" CHECK (
 ("verificationMethod" IS NULL AND "recordSubmittedAt" IS NULL AND "consentAt" IS NULL) OR
 ("verificationMethod" IS NOT NULL AND "recordSubmittedAt" IS NOT NULL AND "consentAt" IS NOT NULL));
CREATE TABLE "AgeVerificationEvidence" (
 "id" UUID NOT NULL PRIMARY KEY,
 "requestId" UUID NOT NULL,
 "ownerUserId" UUID NOT NULL,
 "storageKey" UUID NOT NULL,
 "originalName" TEXT NOT NULL,
 "detectedMimeType" TEXT NOT NULL,
 "size" INTEGER NOT NULL,
 "sha256" TEXT NOT NULL,
 "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewedAt" TIMESTAMPTZ(3),
 "deletedAt" TIMESTAMPTZ(3),
 CONSTRAINT "AgeVerificationEvidence_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AgeCredentialRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AgeVerificationEvidence_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AgeEvidence_file_valid" CHECK ("size" > 0 AND "size" <= 5242880 AND "detectedMimeType" IN ('application/pdf','image/jpeg','image/png') AND "sha256" ~ '^[a-f0-9]{64}$' AND "encryptionVersion"=1)
);
CREATE UNIQUE INDEX "AgeVerificationEvidence_storageKey_key" ON "AgeVerificationEvidence"("storageKey");
CREATE UNIQUE INDEX "AgeEvidence_one_active" ON "AgeVerificationEvidence"("requestId") WHERE "deletedAt" IS NULL;
CREATE INDEX "AgeVerificationEvidence_requestId_deletedAt_idx" ON "AgeVerificationEvidence"("requestId","deletedAt");
CREATE INDEX "AgeVerificationEvidence_ownerUserId_createdAt_idx" ON "AgeVerificationEvidence"("ownerUserId","createdAt");
