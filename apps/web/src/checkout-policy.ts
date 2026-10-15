export function cartRequiresAgeProof(
  items: readonly { product: { requiresAgeProof: boolean } }[],
) {
  return items.some((item) => item.product.requiresAgeProof);
}

export function tryBeginAgeVerification(guard: { current: boolean }) {
  if (guard.current) return false;
  guard.current = true;
  return true;
}
