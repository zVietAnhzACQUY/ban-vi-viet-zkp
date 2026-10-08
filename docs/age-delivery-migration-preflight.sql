-- READ-ONLY preflight for 202610050001_age_credential_delivery.
-- Run with psql before deploy. No credential, token or secret is selected.
\set ON_ERROR_STOP on
SELECT to_regclass('"AgeCredentialDelivery"') IS NOT NULL AS delivery_table_exists \gset
SELECT to_regclass('"AgeCredentialClaim"') IS NOT NULL AS claim_table_exists \gset
\if :delivery_table_exists
  SELECT 'issued_request_without_delivery' AS check_name, count(*) AS violations
  FROM "AgeCredentialRequest" r
  LEFT JOIN "AgeCredentialDelivery" d ON d."requestId"=r.id
  WHERE r.status='ISSUED' AND d.id IS NULL;
  SELECT 'delivery_binding_mismatch' AS check_name, count(*) AS violations
  FROM "AgeCredentialDelivery" d
  LEFT JOIN "AgeCredentialRequest" r ON r.id=d."requestId"
  WHERE r.id IS NULL OR r."userId"<>d."userId" OR r."credentialId"<>d."credentialId";
\else
  SELECT 'issued_request_without_delivery' AS check_name, count(*) AS violations
  FROM "AgeCredentialRequest" WHERE status='ISSUED';
\endif
\if :claim_table_exists
  SELECT 'claim_binding_or_ttl_invalid' AS check_name, count(*) AS violations
  FROM "AgeCredentialClaim" c
  LEFT JOIN "AgeCredentialDelivery" d ON d.id=c."deliveryId"
  WHERE d.id IS NULL OR c."userId"<>d."userId" OR c."credentialId"<>d."credentialId"
     OR c."credentialType"<>'AGE' OR c."expiresAt"-c."createdAt"<>interval '5 minutes';
\endif
