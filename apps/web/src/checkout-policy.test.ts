import { test } from "node:test";
import assert from "node:assert/strict";
import { cartRequiresAgeProof } from "./checkout-policy";

test("checkout only opens the AGE flow for a restricted cart", () => {
  assert.equal(
    cartRequiresAgeProof([
      { product: { requiresAgeProof: false } },
      { product: { requiresAgeProof: false } },
    ]),
    false,
  );
  assert.equal(
    cartRequiresAgeProof([
      { product: { requiresAgeProof: true } },
      { product: { requiresAgeProof: true } },
    ]),
    true,
  );
});
