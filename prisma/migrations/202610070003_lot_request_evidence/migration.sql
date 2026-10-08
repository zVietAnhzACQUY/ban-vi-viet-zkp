-- Additive LOT workflow; existing lots/credentials/evidence are unchanged.
CREATE TYPE "LotCredentialRequestStatus" AS ENUM ('PENDING_EVIDENCE','PENDING_REVIEW','APPROVED','ISSUING','ISSUED','REJECTED','REVOKED','EXPIRED');
CREATE TABLE "LotCredentialRequest" (
 "id" UUID NOT NULL PRIMARY KEY,
 "userId" UUID NOT NULL,
 "lotId" UUID NOT NULL,
 "productId" UUID NOT NULL,
 "lotCode" TEXT NOT NULL,
 "status" "LotCredentialRequestStatus" NOT NULL DEFAULT 'PENDING_EVIDENCE',
 "operatorId" UUID,
 "recordSubmittedAt" TIMESTAMPTZ(3), "recordReviewedAt" TIMESTAMPTZ(3), "consentAt" TIMESTAMPTZ(3),
 "evidenceRevision" INTEGER NOT NULL DEFAULT 0,
 "reason" TEXT, "credentialId" UUID, "issuerKeyId" TEXT,
 "circuitVersion" INTEGER NOT NULL DEFAULT 1,
 "issuedAt" TIMESTAMPTZ(3), "expiresAt" TIMESTAMPTZ(3), "revokedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "LotCredentialRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LotCredentialRequest_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LotCredentialRequest_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LotRequest_valid" CHECK (
   "lotCode" ~ '^[A-Z0-9][A-Z0-9-]{0,63}$' AND "circuitVersion"=1 AND "evidenceRevision">=0
   AND ("operatorId" IS NULL OR "operatorId"<>"userId")
   AND ("status" NOT IN ('PENDING_REVIEW','APPROVED','ISSUING','ISSUED') OR ("recordSubmittedAt" IS NOT NULL AND "consentAt" IS NOT NULL))
   AND ("status" NOT IN ('APPROVED','ISSUING','ISSUED') OR ("recordReviewedAt" IS NOT NULL AND "operatorId" IS NOT NULL))
   AND ("status" NOT IN ('ISSUING','ISSUED') OR ("credentialId" IS NOT NULL AND "issuerKeyId" IS NOT NULL AND "issuedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "issuedAt"<"expiresAt"))
   AND ("status" NOT IN ('REJECTED','REVOKED') OR ("reason" IS NOT NULL AND length(trim("reason"))>0))
   AND ("status"<>'REVOKED' OR "revokedAt" IS NOT NULL)
 )
);
CREATE UNIQUE INDEX "LotCredentialRequest_credentialId_key" ON "LotCredentialRequest"("credentialId");
CREATE UNIQUE INDEX "LotRequest_one_open" ON "LotCredentialRequest"("lotId") WHERE "status" IN ('PENDING_EVIDENCE','PENDING_REVIEW','APPROVED','ISSUING');
CREATE INDEX "LotCredentialRequest_userId_createdAt_idx" ON "LotCredentialRequest"("userId","createdAt");
CREATE INDEX "LotCredentialRequest_lotId_status_idx" ON "LotCredentialRequest"("lotId","status");
CREATE INDEX "LotCredentialRequest_status_createdAt_idx" ON "LotCredentialRequest"("status","createdAt");
CREATE TABLE "LotVerificationEvidence" (
 "id" UUID NOT NULL PRIMARY KEY, "requestId" UUID NOT NULL, "ownerUserId" UUID NOT NULL, "storageKey" UUID NOT NULL,
 "originalName" TEXT NOT NULL, "detectedMimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "sha256" TEXT NOT NULL,
 "encryptionVersion" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewedAt" TIMESTAMPTZ(3), "deletedAt" TIMESTAMPTZ(3),
 CONSTRAINT "LotVerificationEvidence_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LotCredentialRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LotVerificationEvidence_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LotEvidence_file_valid" CHECK ("size">0 AND "size"<=5242880 AND "detectedMimeType" IN ('application/pdf','image/jpeg','image/png') AND "sha256" ~ '^[a-f0-9]{64}$' AND "encryptionVersion"=1)
);
CREATE UNIQUE INDEX "LotVerificationEvidence_storageKey_key" ON "LotVerificationEvidence"("storageKey");
CREATE UNIQUE INDEX "LotEvidence_one_active" ON "LotVerificationEvidence"("requestId") WHERE "deletedAt" IS NULL;
CREATE INDEX "LotVerificationEvidence_requestId_deletedAt_idx" ON "LotVerificationEvidence"("requestId","deletedAt");
CREATE INDEX "LotVerificationEvidence_ownerUserId_createdAt_idx" ON "LotVerificationEvidence"("ownerUserId","createdAt");
