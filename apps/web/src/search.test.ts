import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanSearchInput,
  matchesProductSearch,
  normalizeVietnameseSearch,
} from "./search.js";

const coffee = {
  name: "Cà phê Đắk Lắk",
  subtitle: "Đậm đà một miền cao nguyên",
  description: "Hương rang ấm, pha phin theo cách quen thuộc.",
  origin: "Đắk Lắk",
  category: { name: "Trà & cà phê" },
};

test("chuẩn hóa dấu tiếng Việt, chữ đ và khoảng trắng", () => {
  assert.equal(
    normalizeVietnameseSearch("  CÀ   PHÊ ĐẮK LẮK  "),
    "ca phe dak lak",
  );
  assert.equal(cleanSearchInput("  trà   sen  "), "trà sen");
});

test("tìm sản phẩm bằng từ khóa không dấu và nhiều từ", () => {
  assert.equal(matchesProductSearch(coffee, "ca phe"), true);
  assert.equal(matchesProductSearch(coffee, "dak lak ca phe"), true);
  assert.equal(matchesProductSearch(coffee, "  CA   PHE  "), true);
});

test("tìm trong phụ đề nhưng không lẫn nội dung mô tả hoặc danh mục", () => {
  assert.equal(matchesProductSearch(coffee, "cao nguyen"), true);
  assert.equal(matchesProductSearch(coffee, "pha phin"), false);
  assert.equal(matchesProductSearch(coffee, "tra ca phe"), false);
});

test("không trả về sản phẩm không khớp đủ các từ", () => {
  assert.equal(matchesProductSearch(coffee, "ca phe tay ho"), false);
});
