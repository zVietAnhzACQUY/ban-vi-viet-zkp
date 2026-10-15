import { test } from "node:test";
import assert from "node:assert/strict";
import { cartRequiresAgeProof, tryBeginAgeVerification } from "./checkout-policy";
import { readFileSync } from "node:fs";

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

test("rapid checkout clicks start only one AGE verification", () => {
  const guard = { current: false };
  assert.equal(tryBeginAgeVerification(guard), true);
  assert.equal(tryBeginAgeVerification(guard), false);
  guard.current = false;
  assert.equal(tryBeginAgeVerification(guard), true);
});

test("checkout exposes one AGE verification action and contextual recovery only", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const checkout = app.slice(app.indexOf("function CartPage"), app.indexOf("function Account"));
  assert.match(checkout, /Xác minh điều kiện tuổi/);
  assert.doesNotMatch(checkout, /Mở Ví xác minh tuổi|bvv-zkp-wallet-manage|walletOrigin\(\)/);
  assert.match(checkout, /openWalletPopup\(\)/);
  assert.match(checkout, /\/age\/challenges/);
  assert.match(checkout, /requestProofFromWallet/);
  assert.match(checkout, /\/age\/verifications/);
  assert.match(checkout, /\/age\/verifications\/current/);
  assert.match(checkout, /timeoutMs: 30_000/);
  assert.match(checkout, /ApiTimeoutError/);
  assert.match(checkout, /finally\s*\{/);
  assert.match(checkout, /verificationGuard\.current = false/);
  assert.match(checkout, /setBusy\(false\)/);
  assert.match(checkout, /Bạn chưa có thông tin xác minh tuổi trong Ví\./);
  assert.match(checkout, /Xem hướng dẫn nhận thông tin xác minh/);
  assert.match(checkout, /\/tai-khoan#age-verification-management/);
  assert.match(checkout, /cho phép cửa sổ bật lên/);
});
