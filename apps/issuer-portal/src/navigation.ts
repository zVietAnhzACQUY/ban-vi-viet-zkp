export function configuredWebsiteOrigin(value: string | undefined, production: boolean) {
  if (!value && production) throw new Error("WEBSITE_ORIGIN is required in production.");
  const configured = value || "http://127.0.0.1:5173";
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("Invalid WEBSITE_ORIGIN."); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*'))
    throw new Error("Invalid WEBSITE_ORIGIN.");
  return url.origin;
}

export type CustomerReturnContext = "AGE" | "RECEIVE" | "LOT";
export function customerReturn(origin: string, context: CustomerReturnContext, requestId = "") {
  const base = configuredWebsiteOrigin(origin, true);
  if (context === "AGE" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
    throw new Error("Invalid request identifier.");
  return context === "AGE" ? { label: "Quay lại theo dõi yêu cầu", url: base + "/account/age-verification/" + requestId }
    : context === "RECEIVE" ? { label: "Quay lại tài khoản", url: base + "/tai-khoan" }
    : { label: "Quay lại quản lý lô hàng", url: base + "/quan-tri?tab=lots" };
}

// Query-supplied return URLs are never used. Only an exact precomputed destination is allowed.
export function allowedCustomerReturn(candidate: unknown, origin: string, context: CustomerReturnContext, id = "") {
  try { const expected = customerReturn(origin, context, id).url; return candidate === expected ? expected : null; } catch { return null; }
}
