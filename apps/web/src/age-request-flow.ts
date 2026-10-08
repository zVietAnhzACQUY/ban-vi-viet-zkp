export type AgeStatus =
  | "PENDING"
  | "APPROVED"
  | "ISSUING"
  | "ISSUED"
  | "REJECTED"
  | "REVOKED"
  | "EXPIRED";

export const ageStatusCopy: Record<AgeStatus, string> = {
  PENDING: "Issuer đang chờ đối chiếu hồ sơ",
  APPROVED: "Yêu cầu đã được phê duyệt và đang chờ phát hành",
  ISSUING: "Issuer đang phát hành thông tin xác minh",
  ISSUED: "Thông tin xác minh đã sẵn sàng để nhận",
  REJECTED: "Yêu cầu đã bị từ chối",
  REVOKED: "Thông tin xác minh đã bị thu hồi",
  EXPIRED: "Yêu cầu hoặc thông tin xác minh đã hết hiệu lực",
};

export const terminalAgeStatus = (status: AgeStatus) =>
  ["ISSUED", "REJECTED", "REVOKED", "EXPIRED"].includes(status);

export const ageDetailPath = (id: string) =>
  `/account/age-verification/${encodeURIComponent(id)}`;

export const issuerReceiveUrl = (origin: string, id: string) =>
  `${origin.replace(/\/$/, "")}/receive-age/${encodeURIComponent(id)}`;

export function startAgePolling(
  refresh: () => void,
  interval = 7000,
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setInterval> = setInterval,
  cancel: (timer: ReturnType<typeof setInterval>) => void = clearInterval,
) {
  const timer = schedule(refresh, interval);
  return () => cancel(timer);
}
