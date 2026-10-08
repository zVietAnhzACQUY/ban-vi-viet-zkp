type SearchableProduct = {
  name: string;
  subtitle: string;
  origin: string;
};

export function cleanSearchInput(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function normalizeVietnameseSearch(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function matchesProductSearch(
  product: SearchableProduct,
  rawQuery: string,
) {
  const query = normalizeVietnameseSearch(cleanSearchInput(rawQuery));
  if (!query) return true;

  const searchableText = normalizeVietnameseSearch(
    [product.name, product.subtitle, product.origin].join(" "),
  );

  return query.split(" ").every((term) => searchableText.includes(term));
}
