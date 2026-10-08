-- Read-only. Before 202610070001: no legacy approved/in-flight requests may be silently grandfathered.
\set ON_ERROR_STOP on
SELECT 'unfinished_migrations' AS check_name,count(*) AS violations FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SELECT to_regclass('"AgeVerificationEvidence"') IS NOT NULL AS evidence_exists \gset
\if :evidence_exists
 SELECT 'approved_missing_review' AS check_name,count(*) AS violations FROM "AgeCredentialRequest" WHERE status IN ('APPROVED','ISSUING') AND ("recordSubmittedAt" IS NULL OR "recordReviewedAt" IS NULL OR "operatorId" IS NULL OR "consentAt" IS NULL);
 SELECT 'evidence_owner_mismatch' AS check_name,count(*) AS violations FROM "AgeVerificationEvidence" e JOIN "AgeCredentialRequest" r ON r.id=e."requestId" WHERE e."ownerUserId"<>r."userId";
 SELECT 'duplicate_active_evidence' AS check_name,count(*) AS violations FROM (SELECT "requestId" FROM "AgeVerificationEvidence" WHERE "deletedAt" IS NULL GROUP BY "requestId" HAVING count(*)>1) x;
\else
 SELECT 'legacy_approved_or_issuing_requires_operator_resolution' AS check_name,count(*) AS violations FROM "AgeCredentialRequest" WHERE status IN ('APPROVED','ISSUING');
\endif
