-- Read-only: run before and after LOT request/evidence migration. No legacy backfill.
\set ON_ERROR_STOP on
SELECT 'unfinished_migrations' AS check_name,count(*) AS violations FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
SELECT 'legacy_invalid_lot_binding' AS check_name,count(*) AS violations FROM "Lot" WHERE "lotCode" !~ '^[A-Z0-9][A-Z0-9-]{0,63}$' OR status::text NOT IN ('DRAFT','ACTIVE','ARCHIVED');
SELECT to_regclass('"LotCredentialRequest"') IS NOT NULL AS lot_request_exists \gset
\if :lot_request_exists
 SELECT 'duplicate_open_lot_request' AS check_name,count(*) AS violations FROM (SELECT "lotId" FROM "LotCredentialRequest" WHERE status IN ('PENDING_EVIDENCE','PENDING_REVIEW','APPROVED','ISSUING') GROUP BY "lotId" HAVING count(*)>1) x;
 SELECT 'open_request_binding_changed' AS check_name,count(*) AS violations FROM "LotCredentialRequest" r JOIN "Lot" l ON l.id=r."lotId" WHERE r.status IN ('PENDING_EVIDENCE','PENDING_REVIEW','APPROVED','ISSUING') AND (r."productId"<>l."productId" OR r."lotCode"<>l."lotCode");
 SELECT 'lot_evidence_owner_mismatch' AS check_name,count(*) AS violations FROM "LotVerificationEvidence" e JOIN "LotCredentialRequest" r ON r.id=e."requestId" WHERE e."ownerUserId"<>r."userId";
 SELECT 'lot_missing_review' AS check_name,count(*) AS violations FROM "LotCredentialRequest" WHERE status IN ('APPROVED','ISSUING','ISSUED') AND ("recordReviewedAt" IS NULL OR "operatorId" IS NULL OR "operatorId"="userId" OR "consentAt" IS NULL);
 SELECT 'lot_issuance_invalid' AS check_name,count(*) AS violations FROM "LotCredentialRequest" WHERE status IN ('ISSUING','ISSUED') AND ("credentialId" IS NULL OR "issuerKeyId" IS NULL OR "issuerKeyId" !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:v[1-9][0-9]*$' OR "issuedAt" IS NULL OR "expiresAt" IS NULL OR "issuedAt">="expiresAt");
 SELECT 'lot_review_without_active_evidence' AS check_name,count(*) AS violations FROM "LotCredentialRequest" r WHERE status IN ('PENDING_REVIEW','APPROVED','ISSUING') AND NOT EXISTS (SELECT 1 FROM "LotVerificationEvidence" e WHERE e."requestId"=r.id AND e."ownerUserId"=r."userId" AND e."deletedAt" IS NULL);
\else
 SELECT 'LOT request tables not yet installed; legacy checks completed' AS status;
\endif
