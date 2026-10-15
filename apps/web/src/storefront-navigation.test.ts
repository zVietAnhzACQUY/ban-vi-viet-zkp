import test from "node:test";
import assert from "node:assert/strict";
import { storefrontTab } from "./storefront-navigation";
test("storefront active tab follows route, category and search", () => {
  assert.equal(storefrontTab("/"), "home");
  assert.equal(storefrontTab("/", "", "#thuc-qua"), "shop");
  assert.equal(storefrontTab("/", "?category=qua-tang"), "gifts");
  assert.equal(storefrontTab("/cua-hang", "?category=qua-tang"), "gifts");
  assert.equal(storefrontTab("/gifts"), "gifts");
  assert.equal(storefrontTab("/gioi-thieu"), "about");
  assert.equal(storefrontTab("/san-pham/tra-sen-tay-ho"), "shop");
  assert.equal(storefrontTab("/tai-khoan"), null);
});
