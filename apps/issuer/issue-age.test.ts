import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgeIssuerMode } from "./issue-age.js";

test("pilot Issuer CLI requires a tracked request", () => {
  assert.throws(() => validateAgeIssuerMode(undefined, false, "development"), /bắt buộc --request/);
  assert.doesNotThrow(() => validateAgeIssuerMode("00000000-0000-4000-8000-000000000001", false, "production"));
});

test("untracked demo issuance is fail-closed in production", () => {
  assert.doesNotThrow(() => validateAgeIssuerMode(undefined, true, "development"));
  assert.throws(() => validateAgeIssuerMode(undefined, true, "production"), /bị cấm/);
});
