-- Additive enum value only. No User creation, role conversion or data backfill.
-- Runtime provisioning occurs after this migration commits.
ALTER TYPE "Role" ADD VALUE 'ISSUER_OPERATOR';
