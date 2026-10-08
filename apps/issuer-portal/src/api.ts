import type { AgeStatus } from "./flow";
import { configuredWebsiteOrigin } from "./navigation";

export type User = { id: string; name: string; email: string; role: "CUSTOMER" | "ADMIN" | "ISSUER_OPERATOR" };
export type AgeRequestStatus = { id: string; status: AgeStatus; createdAt: string };
export type OperatorAgeRequest = AgeRequestStatus & {
  reviewedAt?: string | null;
  revokedAt?: string | null;
  issuedAt?: string | null; expiresAt?: string | null; revocationReason?: string | null;
  circuitVersion: number; user?: { id: string; name: string; email: string };
  operator?: { id: string; name: string } | null;
};

const apiOrigin = () => (import.meta.env.VITE_API_ORIGIN || "http://127.0.0.1:3001").replace(/\/$/, "");
export const deliveryOrigin = () => (import.meta.env.VITE_ISSUER_DELIVERY_ORIGIN || "http://127.0.0.1:3002").replace(/\/$/, "");
export const websiteOrigin = () => configuredWebsiteOrigin(import.meta.env.VITE_WEBSITE_ORIGIN, import.meta.env.PROD);
let csrf = "", deliveryCsrf = "";

export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (method !== "GET" && !csrf) {
    const response = await fetch(apiOrigin() + "/api/issuer/auth/csrf", { credentials: "include" });
    const value = await response.json();
    if (!response.ok) throw new ApiError(value.message || "Không thể khởi tạo phiên bảo vệ.", response.status);
    csrf = value.token;
  }
  const response = await fetch(apiOrigin() + "/api" + path, {
    method, credentials: "include",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(method === "GET" ? {} : { "x-csrf-token": csrf }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new ApiError(value.message || "Không thể xử lý yêu cầu.", response.status);
  return value;
}
export async function claimCredential(requestId: string) {
  const origin = deliveryOrigin();
  if (!deliveryCsrf) {
    const response = await fetch(origin + "/issuer/csrf", { credentials: "include" });
    const value = await response.json();
    if (!response.ok) throw new ApiError(value.message || "Không thể kết nối Issuer Delivery.", response.status);
    deliveryCsrf = value.token;
  }
  const response = await fetch(origin + "/issuer/age/claims", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", "x-csrf-token": deliveryCsrf },
    body: JSON.stringify({ requestId }),
  });
  const value = await response.json();
  if (!response.ok) throw new ApiError(value.message || "Credential chưa sẵn sàng.", response.status);
  return value as { claimUrl: string; expiresAt: string };
}
