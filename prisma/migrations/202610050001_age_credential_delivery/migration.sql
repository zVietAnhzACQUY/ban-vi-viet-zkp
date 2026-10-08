CREATE TABLE "AgeCredentialDelivery" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "credentialId" UUID NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgeCredentialDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgeCredentialDelivery_key_version" CHECK ("keyVersion" = 1)
);

CREATE TABLE "AgeCredentialClaim" (
  "id" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "credentialId" UUID NOT NULL,
  "credentialType" TEXT NOT NULL DEFAULT 'AGE',
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "claimedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgeCredentialClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgeCredentialClaim_type" CHECK ("credentialType" = 'AGE'),
  CONSTRAINT "AgeCredentialClaim_status" CHECK ("status" IN ('ACTIVE', 'CLAIMED')),
  CONSTRAINT "AgeCredentialClaim_expiry" CHECK ("createdAt" < "expiresAt"),
  CONSTRAINT "AgeCredentialClaim_claimed" CHECK (
    ("status" = 'ACTIVE' AND "claimedAt" IS NULL) OR
    ("status" = 'CLAIMED' AND "claimedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "AgeCredentialDelivery_requestId_key" ON "AgeCredentialDelivery"("requestId");
CREATE UNIQUE INDEX "AgeCredentialDelivery_credentialId_key" ON "AgeCredentialDelivery"("credentialId");
CREATE INDEX "AgeCredentialDelivery_userId_createdAt_idx" ON "AgeCredentialDelivery"("userId", "createdAt");
CREATE UNIQUE INDEX "AgeCredentialClaim_tokenHash_key" ON "AgeCredentialClaim"("tokenHash");
CREATE INDEX "AgeCredentialClaim_userId_status_expiresAt_idx" ON "AgeCredentialClaim"("userId", "status", "expiresAt");
CREATE INDEX "AgeCredentialClaim_deliveryId_status_idx" ON "AgeCredentialClaim"("deliveryId", "status");

ALTER TABLE "AgeCredentialDelivery" ADD CONSTRAINT "AgeCredentialDelivery_request_fkey"
  FOREIGN KEY ("requestId") REFERENCES "AgeCredentialRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgeCredentialDelivery" ADD CONSTRAINT "AgeCredentialDelivery_user_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgeCredentialClaim" ADD CONSTRAINT "AgeCredentialClaim_delivery_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "AgeCredentialDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgeCredentialClaim" ADD CONSTRAINT "AgeCredentialClaim_request_fkey"
  FOREIGN KEY ("requestId") REFERENCES "AgeCredentialRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgeCredentialClaim" ADD CONSTRAINT "AgeCredentialClaim_user_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
