-- Enum additions are isolated because PostgreSQL cannot safely use a newly
-- added enum value in every context until the ALTER TYPE transaction commits.
ALTER TYPE "AgeCredentialRequestStatus" ADD VALUE IF NOT EXISTS 'ISSUING';
ALTER TYPE "AgeCredentialRequestStatus" ADD VALUE IF NOT EXISTS 'ISSUED';
