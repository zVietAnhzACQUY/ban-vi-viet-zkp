import {
  AGE_REQUESTER_NAME,
  AGE_REQUEST_PURPOSE,
  AGE_WALLET_PROTOCOL_VERSION,
  AGE_WALLET_REQUEST_TYPE,
  ageProofResponseSchema,
  walletReadySchema,
  type AgeProofRequest,
  type AgeProofSuccessResponse,
} from "../../shared/age-wallet";
import type { AgeChallenge } from "./api";

function configuredOrigin(value: string | undefined, developmentDefault: string) {
  if (!value && import.meta.env.PROD)
    throw new Error("Thiếu cấu hình origin cho giao thức Ví ZKP.");
  return new URL(value || developmentDefault).origin;
}

export const walletOrigin = () =>
  configuredOrigin(
    import.meta.env.VITE_WALLET_ORIGIN,
    "http://127.0.0.1:5174",
  );

export class WalletPopupBlockedError extends Error {
  constructor() {
    super("Trình duyệt đã chặn cửa sổ Ví. Hãy cho phép cửa sổ bật lên cho Website và thử lại.");
    this.name = "WalletPopupBlockedError";
  }
}

export class WalletResponseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WalletResponseError";
  }
}

export class WalletFlowAbortedError extends Error {
  constructor() {
    super("Phiên xác minh đã được hủy khi bạn rời trang thanh toán.");
    this.name = "WalletFlowAbortedError";
  }
}

const apiOrigin = () =>
  configuredOrigin(
    import.meta.env.VITE_API_ORIGIN,
    "http://127.0.0.1:3001",
  );

export class WalletRequestGuard {
  private settled = false;

  constructor(
    readonly request: AgeProofRequest,
    private readonly popup: Window,
    private readonly trustedOrigin: string,
  ) {}

  accept(
    event: Pick<MessageEvent, "data" | "origin" | "source">,
    now = Date.now(),
  ) {
    if (this.settled) throw new Error("Yêu cầu Ví đã kết thúc.");
    if (event.origin !== this.trustedOrigin)
      throw new Error("Phản hồi không đến từ origin Ví đã cấu hình.");
    if (event.source !== this.popup)
      throw new Error("Phản hồi không đến từ cửa sổ Ví đã mở.");
    const ready = walletReadySchema.safeParse(event.data);
    if (ready.success) return { kind: "READY" as const };
    const response = ageProofResponseSchema.parse(event.data);
    if (
      response.requestId !== this.request.requestId ||
      response.challengeId !== this.request.challengeId
    )
      throw new Error("Phản hồi Ví không khớp request ID hoặc challenge ID.");
    if (now >= new Date(this.request.expiresAt).getTime())
      throw new Error("Challenge đã hết hạn trước khi nhận phản hồi từ Ví.");
    if (
      response.status === "SUCCESS" &&
      response.proofBundle.challengeId !== this.request.challengeId
    )
      throw new Error("Kết quả không thuộc yêu cầu xác minh đang chờ.");
    this.settled = true;
    return { kind: "RESPONSE" as const, response };
  }

  abort(reason: "closed" | "ready-timeout" | "proof-timeout" | "unmount") {
    if (this.settled) throw new Error("Yêu cầu Ví đã kết thúc.");
    this.settled = true;
    return new Error(
      reason === "closed"
        ? "Bạn đã đóng Ví trước khi hoàn tất xác minh."
        : reason === "ready-timeout"
          ? "Không nhận được phản hồi khởi tạo từ Ví. Vui lòng thử lại."
          : reason === "proof-timeout"
            ? "Không nhận được kết quả xác minh từ Ví trước khi hết thời gian."
          : "Phiên xác minh đã được hủy.",
    );
  }
}

export function openWalletPopup() {
  const popup = window.open(
    "about:blank",
    "bvv-zkp-wallet",
    "popup,width=520,height=760",
  );
  if (!popup)
    throw new WalletPopupBlockedError();
  return popup;
}

export function buildAgeProofRequest(challenge: AgeChallenge): AgeProofRequest {
  const requesterOrigin = window.location.origin;
  return {
    type: AGE_WALLET_REQUEST_TYPE,
    protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    challengeId: challenge.id,
    requestHash: challenge.requestHash,
    cutoffDay: challenge.cutoffDay,
    minimumAge: challenge.minimumAge,
    subjectHash: challenge.subjectHash,
    requesterOrigin,
    returnOrigin: requesterOrigin,
    requesterName: AGE_REQUESTER_NAME,
    purpose: AGE_REQUEST_PURPOSE,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    artifact: {
      ...challenge.artifact,
      publicSignals: challenge.artifact
        .publicSignals as AgeProofRequest["artifact"]["publicSignals"],
      wasmUrl: new URL(challenge.artifact.wasmUrl, apiOrigin()).href,
      zkeyUrl: new URL(challenge.artifact.zkeyUrl, apiOrigin()).href,
    },
  };
}

type WalletMessageListener = (event: MessageEvent) => void;
export type WalletTransportRuntime = {
  now: () => number;
  addMessageListener: (listener: WalletMessageListener) => void;
  removeMessageListener: (listener: WalletMessageListener) => void;
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (id: number) => void;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (id: number) => void;
  navigate: (popup: Window, url: string) => void;
};

const browserTransport: WalletTransportRuntime = {
  now: () => Date.now(),
  addMessageListener: (listener) => window.addEventListener("message", listener),
  removeMessageListener: (listener) =>
    window.removeEventListener("message", listener),
  setInterval: (callback, delay) => window.setInterval(callback, delay),
  clearInterval: (id) => window.clearInterval(id),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (id) => window.clearTimeout(id),
  navigate: (popup, url) => popup.location.replace(url),
};

export function waitForWalletProof(
  request: AgeProofRequest,
  popup: Window,
  trustedOrigin: string,
  runtime: WalletTransportRuntime = browserTransport,
  signal?: AbortSignal,
): Promise<AgeProofSuccessResponse> {
  const guard = new WalletRequestGuard(request, popup, trustedOrigin);
  return new Promise((resolve, reject) => {
    const remaining = new Date(request.expiresAt).getTime() - runtime.now();
    const timeoutMs = Math.max(1, Math.min(remaining, 300_000));
    let sent = false;
    let settled = false;
    let closedTimer = 0;
    let readyTimer = 0;
    let proofTimer = 0;
    const cleanup = () => {
      runtime.removeMessageListener(receive);
      runtime.clearInterval(closedTimer);
      runtime.clearTimeout(readyTimer);
      runtime.clearTimeout(proofTimer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    };
    const receive = (event: MessageEvent) => {
      try {
        const accepted = guard.accept(event, runtime.now());
        if (accepted.kind === "READY") {
          if (!sent) {
            sent = true;
            runtime.clearTimeout(readyTimer);
            proofTimer = runtime.setTimeout(
              () => fail(guard.abort("proof-timeout")),
              Math.max(1, Math.min(new Date(request.expiresAt).getTime() - runtime.now(), 300_000)),
            );
            popup.postMessage(request, trustedOrigin);
          }
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        if (accepted.response.status !== "SUCCESS")
          return reject(new WalletResponseError(accepted.response.code, accepted.response.message));
        resolve(accepted.response);
      } catch (reason) {
        // Messages from unrelated windows/origins are ignored; they never advance state.
        if (event.source === popup) fail(reason);
      }
    };
    const abort = () => fail(new WalletFlowAbortedError());
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    runtime.addMessageListener(receive);
    closedTimer = runtime.setInterval(() => {
      if (popup.closed) fail(guard.abort("closed"));
    }, 300);
    readyTimer = runtime.setTimeout(
      () => fail(guard.abort("ready-timeout")),
      Math.min(timeoutMs, 15_000),
    );
    try {
      runtime.navigate(popup, trustedOrigin + "/");
    } catch (reason) {
      fail(reason);
    }
  });
}

export async function requestProofFromWallet(
  challenge: AgeChallenge,
  popup: Window,
  signal?: AbortSignal,
): Promise<AgeProofSuccessResponse> {
  const trustedOrigin = walletOrigin();
  const request = buildAgeProofRequest(challenge);
  return waitForWalletProof(request, popup, trustedOrigin, browserTransport, signal);
}
