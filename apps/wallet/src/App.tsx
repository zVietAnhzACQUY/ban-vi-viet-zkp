import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Clock3,
  FileUp,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
} from "lucide-react";
import { AGE_ISSUER_ID, type AgeCredentialMetadata } from "../../shared/g3";
import {
  AGE_WALLET_PROTOCOL_VERSION,
  AGE_WALLET_RESPONSE_TYPE,
  ageCredentialFileSchema,
  type AgeCredentialFile,
  type AgeProofRequest,
  type AgeProofResponse,
} from "../../shared/age-wallet";
import {
  readAndValidateAgeCredential,
  validateAgeCredential,
} from "./credential";
import { configuredApiOrigin, configuredIssuerDeliveryOrigin, configuredWebOrigins } from "./config";
import {
  markRequestProcessed,
  processedRequestIds,
  readyMessage,
  validateIncomingProofRequest,
} from "./protocol";
import {
  ageCredentialStore,
  decryptCredential,
  encryptCredential,
  type EncryptedCredential,
} from "./storage";
import {
  shouldLockWalletOnVisibility,
  WALLET_AUTO_LOCK_MS,
} from "./lock-policy";

type StoredState =
  | { state: "loading" }
  | { state: "empty" }
  | { state: "legacy" }
  | { state: "locked"; envelope: EncryptedCredential }
  | { state: "valid"; credential: AgeCredentialFile }
  | { state: "invalid"; credential: AgeCredentialFile; message: string };

function expires(metadata: AgeCredentialMetadata) {
  return new Date(Number(metadata.expiresAt) * 1000).toLocaleString("vi-VN", {
    timeZone: "UTC",
  });
}

function publicIssuer(metadata: AgeCredentialMetadata) {
  return metadata.issuerId === AGE_ISSUER_ID
    ? "Đơn vị xác nhận · Bản Vị Việt"
    : "Đơn vị xác nhận chưa được nhận diện";
}

export default function App() {
  const allowedOrigins = useMemo(configuredWebOrigins, []);
  const [stored, setStored] = useState<StoredState>({ state: "loading" });
  const [candidate, setCandidate] = useState<AgeCredentialFile | null>(null);
  const [request, setRequest] = useState<AgeProofRequest | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [proving, setProving] = useState(false);
  const [provingStatus, setProvingStatus] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimSaved, setClaimSaved] = useState(false);
  const [claimComplete, setClaimComplete] = useState(false);
  const claimToken = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("claim") || "";
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
  }, []);
  const websiteReturnUrl = useMemo(() => {
    const [allowedWebsite] = allowedOrigins;
    if (!allowedWebsite) throw new Error("Thiếu Website origin trong allowlist của Wallet.");
    return new URL("/tai-khoan", allowedWebsite).toString();
  }, [allowedOrigins]);
  const [lastTimings, setLastTimings] = useState<{
    cache: "cold" | "warm";
    wasmLoadMs: number;
    zkeyLoadMs: number;
    proofMs: number;
    walletTotalMs: number;
  } | null>(null);
  const pendingRequestId = useRef<string | null>(null);
  const inactivityTimer = useRef<number | null>(null);

  async function loadStored() {
    const value = await ageCredentialStore.get();
    if (!value) {
      if (await ageCredentialStore.hasLegacyPlaintext()) {
        setError("Dữ liệu Ví cũ chưa mã hóa đã bị khóa. Hãy xóa Ví và nhận lại credential.");
        return setStored({ state: "legacy" });
      }
      return setStored({ state: "empty" });
    }
    setStored({ state: "locked", envelope: value });
  }

  useEffect(() => {
    loadStored().catch(() => setStored({ state: "empty" }));
  }, []);

  function armAutoLock() {
    if (inactivityTimer.current) window.clearTimeout(inactivityTimer.current);
    inactivityTimer.current = window.setTimeout(() => lockWallet(true), WALLET_AUTO_LOCK_MS);
  }

  useEffect(() => {
    if (stored.state !== "valid") return;
    const activity = () => armAutoLock();
    const visibility = () => {
      if (shouldLockWalletOnVisibility(document.visibilityState)) void lockWallet(true);
    };
    for (const event of ["pointerdown", "keydown"])
      window.addEventListener(event, activity);
    document.addEventListener("visibilitychange", visibility);
    armAutoLock();
    return () => {
      for (const event of ["pointerdown", "keydown"])
        window.removeEventListener(event, activity);
      document.removeEventListener("visibilitychange", visibility);
      if (inactivityTimer.current) window.clearTimeout(inactivityTimer.current);
    };
  }, [stored.state]);

  useEffect(() => {
    function receive(event: MessageEvent) {
      try {
        const incoming = validateIncomingProofRequest({
          data: event.data,
          origin: event.origin,
          source: event.source,
          opener: window.opener,
          allowedOrigins,
          artifactOrigin: configuredApiOrigin(),
          processed: processedRequestIds(),
        });
        if (
          pendingRequestId.current &&
          pendingRequestId.current !== incoming.requestId
        )
          throw new Error("Ví đang xử lý một yêu cầu khác.");
        pendingRequestId.current = incoming.requestId;
        setError("");
        setMessage("");
        setRequest(incoming);
      } catch (reason) {
        if (event.source === window.opener && allowedOrigins.has(event.origin))
          setError((reason as Error).message);
      }
    }
    window.addEventListener("message", receive);
    if (window.opener)
      for (const origin of allowedOrigins)
        window.opener.postMessage(readyMessage(), origin);
    return () => window.removeEventListener("message", receive);
  }, [allowedOrigins]);

  function respond(response: AgeProofResponse) {
    if (!request || !window.opener) return;
    window.opener.postMessage(response, request.returnOrigin);
  }

  async function importCredential(file?: File) {
    setError("");
    setMessage("");
    setCandidate(null);
    if (!file) return;
    if (file.size > 16_384)
      return setError("Tệp xác minh vượt giới hạn 16 KB.");
    try {
      setCandidate(await readAndValidateAgeCredential(await file.text()));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function saveCandidate() {
    if (!candidate) return;
    setError("");
    if (pin !== pinConfirm) return setError("Hai lần nhập PIN chưa khớp.");
    try {
      await validateAgeCredential(candidate);
      await ageCredentialStore.save(await encryptCredential(candidate, pin));
      setStored({ state: "valid", credential: candidate });
      setCandidate(null);
      setPin("");
      setPinConfirm("");
      setMessage("Credential đã được mã hóa và lưu trong Ví trên thiết bị này.");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function deliveryCall<T>(path: string, token: string): Promise<T> {
    const origin = configuredIssuerDeliveryOrigin();
    const csrfResponse = await fetch(origin + "/issuer/csrf", { credentials: "include" });
    const csrfBody = await csrfResponse.json();
    if (!csrfResponse.ok) throw new Error(csrfBody.message || "Không thể kết nối Issuer.");
    const response = await fetch(origin + path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfBody.token },
      body: JSON.stringify({ token }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || "Không thể nhận credential.");
    return body;
  }

  async function claimCredential() {
    if (!claimToken) return setError("Liên kết nhận credential không hợp lệ.");
    setError("");
    setMessage("");
    if (claimSaved) {
      setClaiming(true);
      try {
        await deliveryCall("/issuer/age/claims/ack", claimToken);
        window.history.replaceState(null, "", window.location.pathname);
        setClaimSaved(false);
        setClaimComplete(true);
        setMessage("Issuer đã xác nhận credential được lưu thành công trong Ví.");
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setClaiming(false);
      }
      return;
    }
    if (pin.length < 8 || pin.length > 64)
      return setError("PIN/passphrase Ví phải có 8–64 ký tự.");
    if (stored.state === "empty" && pin !== pinConfirm)
      return setError("Hai lần nhập PIN chưa khớp.");
    setClaiming(true);
    try {
      if (stored.state === "locked") await decryptCredential(stored.envelope, pin);
      const redeemed = await deliveryCall<{ credential: unknown }>(
        "/issuer/age/claims/redeem",
        claimToken,
      );
      const credential = ageCredentialFileSchema.parse(redeemed.credential);
      await validateAgeCredential(credential);
      await ageCredentialStore.save(await encryptCredential(credential, pin));
      setStored({ state: "valid", credential });
      setClaimSaved(true);
      await deliveryCall("/issuer/age/claims/ack", claimToken);
      window.history.replaceState(null, "", window.location.pathname);
      setClaimSaved(false);
      setClaimComplete(true);
      setPin("");
      setPinConfirm("");
      setMessage("Credential đã được Issuer chuyển, xác minh và mã hóa trong Ví.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setClaiming(false);
    }
  }

  async function unlockWallet() {
    if (stored.state !== "locked") return;
    setError("");
    try {
      const credential = await decryptCredential(stored.envelope, pin);
      const parsed = ageCredentialFileSchema.parse(credential);
      await validateAgeCredential(parsed);
      setStored({ state: "valid", credential: parsed });
      setPin("");
      setMessage("Ví đã được mở khóa trên thiết bị này.");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function lockWallet(automatic = false) {
    const envelope = await ageCredentialStore.get();
    if (envelope) setStored({ state: "locked", envelope });
    setPin("");
    setMessage(automatic ? "Ví đã tự khóa sau thời gian không hoạt động." : "Ví đã khóa.");
  }

  async function removeCredential() {
    await ageCredentialStore.remove();
    setStored({ state: "empty" });
    setCandidate(null);
    setMessage("Đã xóa thông tin xác minh khỏi thiết bị.");
  }

  function rejectRequest() {
    if (!request) return;
    markRequestProcessed(request.requestId);
    respond({
      type: AGE_WALLET_RESPONSE_TYPE,
      protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
      status: "REJECTED",
      requestId: request.requestId,
      challengeId: request.challengeId,
      code: "USER_REJECTED",
      message: "Khách hàng đã từ chối tạo bằng chứng.",
    });
    pendingRequestId.current = null;
    setRequest(null);
    setMessage("Bạn đã từ chối yêu cầu. Có thể đóng cửa sổ Ví.");
  }

  async function consentAndProve() {
    if (!request || stored.state !== "valid") return;
    setError("");
    setMessage("");
    setProving(true);
    setProvingStatus("Đang kiểm tra thông tin xác minh đã lưu…");
    markRequestProcessed(request.requestId);
    const consentedAtEpochMs = Date.now();
    try {
      await validateAgeCredential(stored.credential);
      if (Date.now() >= new Date(request.expiresAt).getTime())
        throw new Error("Yêu cầu chứng minh đã hết hạn.");
      const worker = new Worker(new URL("./proof.worker.ts", import.meta.url), {
        type: "module",
      });
      const result = await new Promise<any>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          worker.terminate();
          reject(new Error("Quá trình xác minh đã vượt thời gian cho phép."));
        }, 240_000);
        worker.onmessage = (event) => {
          if (event.data.type === "PROGRESS") {
            setProvingStatus(event.data.message);
            return;
          }
          window.clearTimeout(timeout);
          worker.terminate();
          event.data.ok
            ? resolve(event.data)
            : reject(new Error(event.data.message));
        };
        worker.onerror = () => {
          window.clearTimeout(timeout);
          worker.terminate();
          reject(new Error("Không thể hoàn tất xác minh trên thiết bị."));
        };
        worker.postMessage({
          credential: stored.credential,
          request,
          consentedAtEpochMs,
        });
      });
      respond({
        type: AGE_WALLET_RESPONSE_TYPE,
        protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
        status: "SUCCESS",
        requestId: request.requestId,
        challengeId: request.challengeId,
        proofBundle: result.proofBundle,
        timings: result.timings,
      });
      setLastTimings(result.timings);
      setMessage(
        "Xác minh đã hoàn tất. Ngày sinh và dữ liệu bí mật không được gửi tới cửa hàng.",
      );
      pendingRequestId.current = null;
      setRequest(null);
    } catch (reason) {
      const text = (reason as Error).message;
      respond({
        type: AGE_WALLET_RESPONSE_TYPE,
        protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
        status: "ERROR",
        requestId: request.requestId,
        challengeId: request.challengeId,
        code: "PROOF_FAILED",
        message: "Không thể tạo bằng chứng trên thiết bị.",
      });
      pendingRequestId.current = null;
      setRequest(null);
      setError(text);
    } finally {
      setProving(false);
      setProvingStatus("");
    }
  }

  const current =
    stored.state === "valid" || stored.state === "invalid"
      ? stored.credential
      : null;

  return (
    <main>
      <header className="wallet-header">
        <div className="mark">
          <ShieldCheck size={22} />
        </div>
        <div>
          <strong>Ví xác minh tuổi</strong>
          <span>Bản Vị Việt · Dữ liệu ở lại trên thiết bị</span>
        </div>
      </header>

      {request ? (
        <section className="card request-card">
          <span className="eyebrow">YÊU CẦU XÁC MINH</span>
          <h1>Xác minh điều kiện đủ {request.minimumAge} tuổi</h1>
          <dl>
            <div>
              <dt>Bên yêu cầu</dt>
              <dd>{request.requesterName}</dd>
            </div>
            <div>
              <dt>Mục đích</dt>
              <dd>{request.purpose}</dd>
            </div>
            <div>
              <dt>Yêu cầu có hiệu lực đến</dt>
              <dd>{new Date(request.expiresAt).toLocaleString("vi-VN")}</dd>
            </div>
          </dl>
          <details className="technical-details">
            <summary>Thông tin kỹ thuật của yêu cầu</summary>
            <p>Website yêu cầu: {request.requesterOrigin}</p>
            <p>Mã yêu cầu: {request.requestId}</p>
          </details>
          {stored.state !== "valid" && (
            <p className="warning">
              Ví chưa có thông tin xác minh tuổi hợp lệ. Hãy thêm thông tin
              ngay bên dưới rồi quay lại yêu cầu này.
            </p>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={proving || stored.state !== "valid"}
              onClick={consentAndProve}
            >
              {proving
                ? "Đang xác minh trên thiết bị…"
                : "Đồng ý và xác minh"}
            </button>
            <button disabled={proving} onClick={rejectRequest}>
              Từ chối
            </button>
          </div>
          {proving && (
            <div className="progress" role="status">
              <span className="spinner" />
              <span>
                <strong>{provingStatus}</strong>
                <small>Vui lòng không đóng cửa sổ.</small>
              </span>
            </div>
          )}
        </section>
      ) : (
        <section className="intro">
          <span className="eyebrow">RIÊNG TƯ NGAY TỪ THIẾT KẾ</span>
          <h1>Thông tin tuổi ở lại trong Ví của bạn.</h1>
          <p>
            Khi bạn đồng ý xác minh, Ví chỉ gửi kết quả cần thiết cho cửa hàng.
            Ngày sinh và dữ liệu bí mật không rời khỏi thiết bị.
          </p>
        </section>
      )}

      <section className="card">
        <div className="section-title">
          <div>
            <span className="eyebrow">THÔNG TIN XÁC MINH TUỔI</span>
            <h2>
              {stored.state === "locked"
                ? "Ví đang khóa"
                : current
                ? "Thông tin đã lưu trên thiết bị"
                : "Bạn chưa thêm thông tin xác minh tuổi"}
            </h2>
          </div>
          {stored.state === "valid" && <span className="badge">Hợp lệ</span>}
          {stored.state === "invalid" && (
            <span className="badge invalid">Không hiệu lực</span>
          )}
          {stored.state === "locked" && <span className="badge">Đã mã hóa</span>}
          {stored.state === "legacy" && <span className="badge invalid">Dữ liệu cũ</span>}
        </div>
        {claimToken && (stored.state !== "valid" || claimSaved) && (
          <div className="candidate">
            <span className="badge"><ShieldCheck size={14} /> NHẬN TỪ ISSUER</span>
            <p>{claimSaved
              ? "Credential đã được mã hóa trong Ví nhưng chưa gửi được xác nhận. Hãy thử xác nhận lại."
              : "Mở khóa Ví bằng PIN để nhận credential. Liên kết chỉ có hiệu lực 5 phút."}</p>
            {!claimSaved && <input aria-label="PIN Ví để nhận credential" type="password" autoComplete="current-password" placeholder="PIN/passphrase 8–64 ký tự" value={pin} onChange={(event) => setPin(event.target.value)} />}
            {!claimSaved && stored.state === "empty" && (
              <input aria-label="Nhập lại PIN Ví khi nhận credential" type="password" autoComplete="new-password" placeholder="Nhập lại PIN" value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value)} />
            )}
            <button className="primary" disabled={claiming} onClick={claimCredential}>
              {claiming ? "Đang xử lý…" : claimSaved ? "Xác nhận đã lưu" : "Mở khóa và nhận credential"}
            </button>
          </div>
        )}
        {stored.state === "locked" && (
          <div className="unlock-panel">
            <p>Nhập PIN để mở credential trong bộ nhớ của phiên này.</p>
            <input
              aria-label="PIN Ví"
              inputMode="numeric"
              type="password"
              autoComplete="current-password"
              placeholder="PIN 6–12 chữ số"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
            <div className="actions">
              <button className="primary" onClick={unlockWallet}>
                <UnlockKeyhole size={16} /> Mở khóa
              </button>
              <button className="danger" onClick={removeCredential}>
                <Trash2 size={16} /> Xóa Ví
              </button>
            </div>
          </div>
        )}
        {stored.state === "legacy" && (
          <div className="unlock-panel">
            <p>Bản lưu cũ chưa được mã hóa và không còn được sử dụng.</p>
            <button className="danger" onClick={removeCredential}>
              <Trash2 size={16} /> Xóa dữ liệu cũ
            </button>
          </div>
        )}
        {current && (
          <dl>
            <div>
              <dt>
                <ShieldCheck size={15} /> Loại
              </dt>
              <dd>Xác nhận thuộc tính tuổi</dd>
            </div>
            <div>
              <dt>
                <Building2 size={15} /> Đơn vị xác nhận
              </dt>
              <dd>{publicIssuer(current.metadata)}</dd>
            </div>
            <div>
              <dt>
                <Clock3 size={15} /> Có hiệu lực đến
              </dt>
              <dd>{expires(current.metadata)} UTC</dd>
            </div>
          </dl>
        )}
        {stored.state === "invalid" && (
          <p className="error">{stored.message}</p>
        )}
        {stored.state !== "locked" && stored.state !== "legacy" && (
          <details className="technical-details">
            <summary>Nâng cao / Khôi phục từ tệp</summary>
            <p>Chỉ dùng để khôi phục dự phòng. Luồng chính là “Nhận vào Ví” từ Issuer.</p>
            <label className="file-button">
              <FileUp size={16} /> Chọn credential JSON
              <input
                type="file"
                accept="application/json,.json"
                disabled={proving}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  importCredential(file);
                }}
              />
            </label>
          </details>
        )}
        {current && (
          <div className="actions">
            <button disabled={proving} onClick={() => lockWallet(false)}>
              <LockKeyhole size={16} /> Khóa Ví
            </button>
            <button className="danger" disabled={proving} onClick={removeCredential}>
              <Trash2 size={16} /> Xóa Ví
            </button>
          </div>
        )}
        <p className="fineprint">
          Credential được mã hóa bằng PIN trước khi lưu và Ví tự khóa sau 5 phút
          không hoạt động. Cơ chế này không chống được malware khi Ví đang mở.
          Kết quả xác minh không thay thế giấy tờ pháp lý.
        </p>
        <details className="technical-details">
          <summary>Thông tin lưu trữ và bảo mật</summary>
          <p>
            IndexedDB chỉ lưu bản mã AES-GCM. Khóa được dẫn xuất từ PIN bằng
            PBKDF2-SHA-256 với salt ngẫu nhiên; PIN và khóa thô không được lưu.
            Website bán hàng không thể đọc credential.
          </p>
        </details>
      </section>

      {candidate && (
        <section className="card candidate">
          <span className="badge">
            <CheckCircle2 size={14} /> Thông tin hợp lệ
          </span>
          <h2>Xác nhận thuộc tính tuổi</h2>
          <p>
            Đơn vị xác nhận: {publicIssuer(candidate.metadata)}
            <br />
            Có hiệu lực đến: {expires(candidate.metadata)} UTC
          </p>
          <p className="fineprint">
            Ví không hiển thị ngày sinh hoặc dữ liệu bí mật trong tệp.
          </p>
          <input
            aria-label="Tạo PIN Ví"
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
            placeholder="PIN/passphrase 8–64 ký tự"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
          <input
            aria-label="Nhập lại PIN Ví"
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
            placeholder="Nhập lại PIN"
            value={pinConfirm}
            onChange={(event) => setPinConfirm(event.target.value)}
          />
          <div className="actions">
            <button className="primary" onClick={saveCandidate}>
              Lưu trên thiết bị
            </button>
            <button onClick={() => setCandidate(null)}>Hủy</button>
          </div>
        </section>
      )}

      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {claimComplete && (
        <p className="message">
          <a href={websiteReturnUrl}>Quay lại Bản Vị Việt</a>
        </p>
      )}
      {lastTimings && (
        <details className="technical-details timing-details">
          <summary>Chi tiết kỹ thuật lần xác minh gần nhất</summary>
          <dl>
            <div>
              <dt>Bộ nhớ đệm</dt>
              <dd>{lastTimings.cache === "warm" ? "Đã có sẵn" : "Tải mới"}</dd>
            </div>
            <div>
              <dt>Tải bộ kiểm tra</dt>
              <dd>{Math.round(lastTimings.wasmLoadMs)} ms</dd>
            </div>
            <div>
              <dt>Tải khóa tạo bằng chứng</dt>
              <dd>{Math.round(lastTimings.zkeyLoadMs)} ms</dd>
            </div>
            <div>
              <dt>Tạo bằng chứng</dt>
              <dd>{Math.round(lastTimings.proofMs)} ms</dd>
            </div>
            <div>
              <dt>Tổng thời gian trong Ví</dt>
              <dd>{Math.round(lastTimings.walletTotalMs)} ms</dd>
            </div>
          </dl>
        </details>
      )}
      {error && (
        <p className="error message" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
