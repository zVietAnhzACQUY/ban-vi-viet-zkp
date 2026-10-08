export function canonicalOrigin(value: string) {
  const origin = new URL(value).origin;
  if (origin !== value) throw new Error(`Origin không canonical: ${value}`);
  return origin;
}

export function configuredWebOrigins(): Set<string> {
  if (!import.meta.env.VITE_WEB_ORIGINS && import.meta.env.PROD)
    throw new Error("Thiếu VITE_WEB_ORIGINS cho Wallet production.");
  const raw = String(
    import.meta.env.VITE_WEB_ORIGINS || "http://127.0.0.1:5173",
  );
  return new Set(
    raw
      .split(",")
      .map((value: string) => value.trim())
      .filter(Boolean)
      .map(canonicalOrigin),
  );
}

export function configuredApiOrigin() {
  if (!import.meta.env.VITE_API_ORIGIN && import.meta.env.PROD)
    throw new Error("Thiếu VITE_API_ORIGIN cho Wallet production.");
  return canonicalOrigin(
    String(import.meta.env.VITE_API_ORIGIN || "http://127.0.0.1:3001"),
  );
}

export function configuredIssuerDeliveryOrigin() {
  if (!import.meta.env.VITE_ISSUER_DELIVERY_ORIGIN && import.meta.env.PROD)
    throw new Error("Thiếu VITE_ISSUER_DELIVERY_ORIGIN cho Wallet production.");
  return canonicalOrigin(
    String(import.meta.env.VITE_ISSUER_DELIVERY_ORIGIN || "http://127.0.0.1:3002"),
  );
}
