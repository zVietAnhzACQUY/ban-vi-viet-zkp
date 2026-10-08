import {
  AGE_WALLET_PROTOCOL_VERSION,
  AGE_WALLET_READY_TYPE,
  ageProofRequestSchema,
  type AgeProofRequest,
} from "../../shared/age-wallet";

const SESSION_KEY = "bvv-age-wallet-processed-v1";

export function processedRequestIds(storage: Storage = sessionStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(SESSION_KEY) || "[]");
    return new Set<string>(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

export function markRequestProcessed(
  requestId: string,
  storage: Storage = sessionStorage,
) {
  const ids = processedRequestIds(storage);
  ids.add(requestId);
  storage.setItem(SESSION_KEY, JSON.stringify([...ids].slice(-100)));
}

export function validateIncomingProofRequest(input: {
  data: unknown;
  origin: string;
  source: MessageEventSource | null;
  opener: Window | null;
  allowedOrigins: Set<string>;
  artifactOrigin: string;
  now?: Date;
  processed?: Set<string>;
}) {
  if (!input.allowedOrigins.has(input.origin))
    throw new Error("Nguồn website không nằm trong allowlist của Ví.");
  if (!input.opener || input.source !== input.opener)
    throw new Error("Cửa sổ gửi yêu cầu không phải website đã mở Ví.");
  const request = ageProofRequestSchema.parse(input.data);
  if (
    request.requesterOrigin !== input.origin ||
    request.returnOrigin !== input.origin
  )
    throw new Error("Origin trong yêu cầu không khớp cửa sổ gửi.");
  if (
    new URL(request.artifact.wasmUrl).origin !== input.artifactOrigin ||
    new URL(request.artifact.zkeyUrl).origin !== input.artifactOrigin
  )
    throw new Error("Tệp xác minh không đến từ máy chủ đã được cấu hình.");
  const now = (input.now ?? new Date()).getTime();
  if (
    now < new Date(request.issuedAt).getTime() ||
    now >= new Date(request.expiresAt).getTime()
  )
    throw new Error("Yêu cầu chứng minh đã hết hạn hoặc chưa có hiệu lực.");
  if ((input.processed ?? processedRequestIds()).has(request.requestId))
    throw new Error("Request ID này đã được Ví xử lý trong phiên.");
  return request as AgeProofRequest;
}

export function readyMessage() {
  return {
    type: AGE_WALLET_READY_TYPE,
    protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
  } as const;
}
