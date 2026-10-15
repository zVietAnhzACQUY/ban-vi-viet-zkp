import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preferredAddressId } from "./checkout-address";
import type { Address } from "./api";

const address = (id: string, isDefault = false): Address => ({
  id, name: `Người nhận ${id}`, phone: "0900000000", line: `${id} Đường kiểm thử`, city: "TP.HCM", isDefault,
});

test("checkout keeps a valid selection, otherwise prefers default then stable first", () => {
  const addresses = [address("first"), address("default", true), address("last")];
  assert.equal(preferredAddressId(addresses, "last"), "last");
  assert.equal(preferredAddressId(addresses, "missing"), "default");
  assert.equal(preferredAddressId(addresses.map((item) => ({ ...item, isDefault: false })), ""), "first");
  assert.equal(preferredAddressId([], "missing"), "");
});

test("checkout presents one selected card and opens choices only on demand", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const checkout = app.slice(app.indexOf("function CartPage"), app.indexOf("function AuthPrompt"));
  assert.match(checkout, /selected-address-card/);
  assert.match(checkout, /Thay đổi địa chỉ/);
  assert.match(checkout, /Sử dụng địa chỉ này/);
  assert.match(checkout, /Thêm địa chỉ nhận hàng/);
  assert.match(checkout, /disabled=\{busy \|\| !addressId/);
  assert.doesNotMatch(checkout.slice(checkout.indexOf("selected-address-card"), checkout.indexOf("address-empty-state")), /type="radio"/);
  assert.doesNotMatch(checkout, /invalidateAgeVerification\(\);\s*setAddress/);
});
