-- READ-ONLY data preflight. Chạy bằng psql SAU migration 001 + 002 và TRƯỚC 003.
-- Script chỉ dùng SELECT/CTE và psql conditionals; không tạo/sửa/xóa dữ liệu.
-- Nếu bảng pilot chưa tồn tại, age_table_missing = 1 và các truy vấn phụ thuộc
-- được bỏ qua có thông báo rõ ràng. Không được coi kết quả đó là PASS.
\set ON_ERROR_STOP on

SELECT to_regclass('"AgeCredentialRequest"') IS NOT NULL AS age_table_exists \gset
SELECT to_regclass('"Lot"') IS NOT NULL AS lot_table_exists \gset
SELECT to_regclass('"LotCredential"') IS NOT NULL AS lot_credential_table_exists \gset
SELECT to_regclass('"LotProof"') IS NOT NULL AS lot_proof_table_exists \gset

SELECT 'age_table_missing' AS check_name,
       CASE WHEN :'age_table_exists'::boolean THEN 0 ELSE 1 END AS violations;

\if :age_table_exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AgeCredentialRequest'
      AND column_name = 'credentialId'
  ) AS age_credential_id_exists \gset

  SELECT 'age_open_duplicates' AS check_name, count(*) AS violations
  FROM (
    SELECT "userId" FROM "AgeCredentialRequest"
    WHERE status IN ('PENDING', 'APPROVED', 'ISSUING')
    GROUP BY "userId" HAVING count(*) > 1
  ) duplicate_users;

  -- Trước 003 chưa có credentialId. Mọi ISSUING/ISSUED row vì thế là blocker.
  SELECT 'age_issuing_or_issued_missing_fields' AS check_name, count(*) AS violations
  FROM "AgeCredentialRequest"
  WHERE status IN ('ISSUING', 'ISSUED') AND (
    "operatorId" IS NULL OR "issuedAt" IS NULL OR "expiresAt" IS NULL OR
    "issuerKeyId" IS NULL OR "issuedAt" >= "expiresAt" OR
    NOT :'age_credential_id_exists'::boolean
  );

  SELECT 'age_revoked_missing_reason' AS check_name, count(*) AS violations
  FROM "AgeCredentialRequest"
  WHERE status = 'REVOKED' AND (
    "revokedAt" IS NULL OR "revocationReason" IS NULL OR
    length(trim("revocationReason")) = 0
  );

  SELECT 'age_invalid_version' AS check_name, count(*) AS violations
  FROM "AgeCredentialRequest"
  WHERE "circuitVersion" IS NULL OR "circuitVersion" <= 0;

  \if :age_credential_id_exists
    SELECT 'age_credential_id_duplicates' AS check_name, count(*) AS violations
    FROM (
      SELECT "credentialId" FROM "AgeCredentialRequest"
      WHERE "credentialId" IS NOT NULL
      GROUP BY "credentialId" HAVING count(*) > 1
    ) duplicate_credentials;
  \else
    SELECT 'age_credential_id_duplicates' AS check_name, 0::bigint AS violations;
  \endif
\else
  \echo 'BLOCKER: AgeCredentialRequest does not exist; apply only 001 and 002, then rerun preflight.'
\endif

SELECT 'lot_table_missing' AS check_name,
       CASE WHEN :'lot_table_exists'::boolean THEN 0 ELSE 1 END AS violations;
\if :lot_table_exists
  SELECT 'lot_invalid_operational_state' AS check_name, count(*) AS violations
  FROM "Lot"
  WHERE status::text NOT IN ('DRAFT', 'ACTIVE', 'ARCHIVED');

  SELECT 'revoked_lot_missing_reason' AS check_name, count(*) AS violations
  FROM "Lot" WHERE status = 'REVOKED' AND (
    "revokedAt" IS NULL OR "revocationReason" IS NULL OR
    length(trim("revocationReason")) = 0
  );
\endif

SELECT 'lot_credential_table_missing' AS check_name,
       CASE WHEN :'lot_credential_table_exists'::boolean THEN 0 ELSE 1 END AS violations;
\if :lot_credential_table_exists
  SELECT 'lot_credential_invalid_state' AS check_name, count(*) AS violations
  FROM "LotCredential"
  WHERE status::text NOT IN ('ACTIVE', 'REVOKED', 'SUPERSEDED');

  SELECT 'lot_credential_invalid_version_or_time' AS check_name, count(*) AS violations
  FROM "LotCredential"
  WHERE "circuitVersion" IS NULL OR "circuitVersion" <> 1 OR
        "issuedAt" IS NULL OR "expiresAt" IS NULL OR "issuedAt" >= "expiresAt";

  SELECT 'lot_credential_invalid_issuer_key' AS check_name, count(*) AS violations
  FROM "LotCredential"
  WHERE "issuerKeyId" IS NULL OR
        "issuerKeyId" <> ("issuerId"::text || ':v' || "issuerKeyVersion"::text);

  SELECT 'revoked_credential_missing_reason' AS check_name, count(*) AS violations
  FROM "LotCredential" WHERE status = 'REVOKED' AND (
    "revokedAt" IS NULL OR "revocationReason" IS NULL OR
    length(trim("revocationReason")) = 0
  );
\endif

SELECT 'lot_proof_table_missing' AS check_name,
       CASE WHEN :'lot_proof_table_exists'::boolean THEN 0 ELSE 1 END AS violations;
\if :lot_proof_table_exists
  SELECT 'lot_proof_invalid_state' AS check_name, count(*) AS violations
  FROM "LotProof"
  WHERE status::text NOT IN ('ACTIVE', 'STALE');

  SELECT 'lot_proof_invalid_version' AS check_name, count(*) AS violations
  FROM "LotProof" WHERE "circuitVersion" IS NULL OR "circuitVersion" <> 1;

  SELECT 'active_proof_without_active_credential' AS check_name, count(*) AS violations
  FROM "LotProof" p
  LEFT JOIN "LotCredential" c ON c.id = p."credentialId"
  WHERE p.status = 'ACTIVE' AND (
    c.id IS NULL OR c.status <> 'ACTIVE' OR c."lotId" <> p."lotId" OR
    c."circuitVersion" <> p."circuitVersion"
  );
\endif
