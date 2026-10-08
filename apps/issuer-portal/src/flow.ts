export type AgeStatus =
  | "PENDING"
  | "APPROVED"
  | "ISSUING"
  | "ISSUED"
  | "REJECTED"
  | "REVOKED"
  | "EXPIRED";

export const canReceiveCredential = (status: AgeStatus) => status === "ISSUED";

export const receivePath = (id: string) =>
  `/receive-age/${encodeURIComponent(id)}`;

export const websiteDetailUrl = (origin: string, id: string) =>
  `${origin.replace(/\/$/, "")}/account/age-verification/${encodeURIComponent(id)}`;

export const safePortalPath = (candidate: unknown) => {
  if (candidate === "/operator") return candidate;
  if (
    typeof candidate === "string" &&
    /^\/receive-age\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
  )
    return candidate;
  return null;
};

export const loginDestination = (
  role: "CUSTOMER" | "ADMIN" | "ISSUER_OPERATOR",
  requested: unknown,
) => {
  const safe = safePortalPath(requested);
  if (safe?.startsWith("/receive-age/")) return safe;
  return role === "ISSUER_OPERATOR" ? "/operator" : "/";
};

export const canAccessOperator = (role: "CUSTOMER" | "ADMIN" | "ISSUER_OPERATOR") =>
  role === "ISSUER_OPERATOR";
