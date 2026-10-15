export type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "CUSTOMER" | "ISSUER_OPERATOR";
};
export type Product = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  price: string;
  weight: string;
  origin: string;
  art: string;
  tone: string;
  stock: number;
  requiresAgeProof: boolean;
  minimumAge: number;
  published: boolean;
  category: { id: string; name: string; slug: string };
  lots?: Lot[];
};
export type Lot = {
  id: string;
  lotCode: string;
  productId?: string;
  status: string;
  stock: number;
};
export type Address = {
  id: string;
  name: string;
  phone: string;
  line: string;
  city: string;
  isDefault?: boolean;
};
export type Cart = {
  items: { product: Product; quantity: number }[];
  total: string;
};
export type AgeChallenge = import("../../shared/g3").AgeChallengeResponse;
export type AgeVerificationResult = {
  status: "VERIFIED";
  verificationId: string;
  challengeId: string;
  verifiedAt: string;
  expiresAt: string;
  requestHash: string;
  cartSnapshotHash: string;
  serverVerificationMs?: number;
};
export type AgeCredentialStatus = {
  recordSubmitted: boolean;
  walletReceived: boolean;
  walletReceivedAt: string | null;
  id: string;
  status: "PENDING" | "APPROVED" | "ISSUING" | "ISSUED" | "REJECTED" | "REVOKED" | "EXPIRED";
  createdAt: string;
};
export type Order = {
  id: string;
  code: string;
  status: string;
  total: string;
  createdAt: string;
  address: Address;
  items: {
    id: string;
    name: string;
    quantity: number;
    unitPrice: string;
    lotId: string | null;
    lotCode: string | null;
  }[];
  history: { status: string; createdAt: string }[];
};
export type LotProofStatus = {
  lotId: string;
  productId: string;
  productName: string;
  lotCode: string;
  checkedAt: string;
  status: "ACTIVE" | "UNVERIFIED" | "EXPIRED" | "REVOKED" | "STALE";
  reason: string;
  expiresAt?: string;
  publicAllowedCode?: string;
  issuerPublicKey?: string;
  issuerFingerprint?: string;
  publicSignals?: readonly string[];
  bundle?: import("../../shared/g4").LotProofBundle;
};
let csrf = "";
export const issuerPortalOrigin = () =>
  (import.meta.env.VITE_ISSUER_PORTAL_ORIGIN || "http://127.0.0.1:5175").replace(/\/$/, "");
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export class ApiTimeoutError extends Error {
  constructor() {
    super("Không nhận được phản hồi từ máy chủ. Vui lòng thử lại.");
    this.name = "ApiTimeoutError";
  }
}
export async function api<T = any>(
  url: string,
  method = "GET",
  data?: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = options.timeoutMs
    ? window.setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs)
    : 0;
  try {
    if (method !== "GET" && !csrf) {
      const r = await fetch("/api/csrf", { signal: controller.signal });
      const d = await r.json();
      csrf = d.token;
    }
    const r = await fetch("/api" + url, {
      method,
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "x-csrf-token": csrf } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const d = await r.json();
    if (!r.ok)
      throw new ApiError(
        d.message || "Không thể kết nối. Vui lòng thử lại.",
        d.code || "REQUEST_FAILED",
        r.status,
      );
    return d;
  } catch (error) {
    if (timedOut) throw new ApiTimeoutError();
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

