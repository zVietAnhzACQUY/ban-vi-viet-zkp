import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
dotenv.config({ quiet: true });
const url = process.env.TEST_DATABASE_URL;
const schema = url ? new URL(url).searchParams.get("schema") : null;
if (!url || schema !== "g2_test_20261007")
  throw new Error("TEST_DATABASE_URL must use a dedicated g2_test schema.");
process.env.DATABASE_URL = url;
process.env.G2_TEST = "1";
for (const args of [
  ["--import", "tsx", "--test", "api/tests/login-rate-limit.test.ts"],
  [
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
    "--schema",
    "../prisma/schema.prisma",
  ],
  ["--import", "tsx", "--test", "web/src/search.test.ts"],
  ["--import", "tsx", "--test", "web/src/checkout-policy.test.ts"],
  ["--import", "tsx", "--test", "web/src/checkout-address.test.ts"],
  ["--import", "tsx", "--test", "web/src/auth-guard.test.ts"],
  ["--import", "tsx", "--test", "web/src/age-request-flow.test.ts"],
  ["--import", "tsx", "--test", "issuer-portal/src/flow.test.ts"],
  ["--import", "tsx", "--test", "issuer-portal/src/navigation.test.ts"],
  ["--import", "tsx", "--test", "issuer-portal/src/lot.test.ts"],
  ["--import", "tsx", "--test", "wallet/src/wallet.test.ts"],
  ["--import", "tsx", "--test", "issuer/issue-age.test.ts"],
  ["--import", "tsx", "--test", "issuer/provision-operator.test.ts"],
  ["--import", "tsx", "--test", "issuer/delivery-service.test.ts"],
  ["--import", "tsx", "--test", "issuer/evidence-service.test.ts"],
  ["--import", "tsx", "--test", "issuer/lot-request.test.ts"],
  ["--import", "tsx", "--test", "api/tests/checkout.test.ts"],
  ["--import", "tsx", "--test", "api/tests/auth-boundary.test.ts"],
  ["--import", "tsx", "--test", "api/tests/age.test.ts"],
  ["--import", "tsx", "--test", "api/tests/lot.test.ts"],
]) {
  const p = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
  if (p.status !== 0) process.exit(p.status || 1);
}
