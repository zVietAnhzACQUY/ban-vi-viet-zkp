ALTER TABLE "AgeVerification"
  ADD COLUMN "issuerId" UUID;

UPDATE "AgeVerification"
SET "issuerId" = '2b097683-48f1-4dc9-8006-056b305c6473'::uuid
WHERE "issuerId" IS NULL;

ALTER TABLE "AgeVerification"
  ALTER COLUMN "issuerId" SET NOT NULL;
