export function cartRequiresAgeProof(
  items: readonly { product: { requiresAgeProof: boolean } }[],
) {
  return items.some((item) => item.product.requiresAgeProof);
}
