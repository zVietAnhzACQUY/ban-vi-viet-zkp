import { useEffect, useMemo, useRef, useState } from "react";
import { BusyButton } from "../../shared/BusyButton";
import {
  Building2,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  LockKeyhole,
  Sparkles,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
  UserRound,
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
  encryptAndSaveCredential,
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
    ? "Credential Issuer được Ví tin cậy"
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
  const [showPin, setShowPin] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [requestFinished, setRequestFinished] = useState<"success" | "rejected" | null>(null);
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
  const unlockedPassphrase = useRef("");
  const unlockDialog = useRef<HTMLElement | null>(null);
  const unlockInput = useRef<HTMLInputElement | null>(null);

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

  const checkoutUnlockOpen = Boolean(request && stored.state === "locked");
  useEffect(() => {
    if (!checkoutUnlockOpen) return;
    setUnlockError("");
    const focusTimer = window.setTimeout(() => unlockInput.current?.focus(), 0);
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        rejectRequest();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...(unlockDialog.current?.querySelectorAll<HTMLElement>(
        'input,button,[href],[tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => !element.hasAttribute("disabled"));
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", trapFocus);
    };
  }, [checkoutUnlockOpen]);

  useEffect(() => {
    if (!request || stored.state !== "empty") return;
    markRequestProcessed(request.requestId);
    respond({
      type: AGE_WALLET_RESPONSE_TYPE,
      protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
      status: "ERROR",
      requestId: request.requestId,
      challengeId: request.challengeId,
      code: "NO_CREDENTIAL",
      message: "Ví chưa có thông tin xác minh tuổi.",
    });
    pendingRequestId.current = null;
    setRequest(null);
    setMessage("Ví chưa có thông tin xác minh tuổi.");
  }, [request, stored.state]);

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
    if (pin !== pinConfirm) return setError("Hai lần nhập mã khóa chưa khớp.");
    try {
      await validateAgeCredential(candidate);
      await ageCredentialStore.save(await encryptCredential(candidate, pin));
      unlockedPassphrase.current = pin;
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
    if (stored.state === "locked")
      return setError("Mở khóa Ví trước khi lưu credential đang nhận.");
    const passphrase = stored.state === "empty" ? pin : unlockedPassphrase.current;
    if (passphrase.length < 8 || passphrase.length > 64)
      return setError("Mã khóa Ví phải có 8–64 ký tự.");
    if (stored.state === "empty" && pin !== pinConfirm)
      return setError("Hai lần nhập mã khóa chưa khớp.");
    if (stored.state === "valid" && !replaceConfirmed)
      return setError("Hãy xác nhận thay thế credential đang có trong Ví.");
    setClaiming(true);
    try {
      const redeemed = await deliveryCall<{ credential: unknown }>(
        "/issuer/age/claims/redeem",
        claimToken,
      );
      const credential = ageCredentialFileSchema.parse(redeemed.credential);
      await validateAgeCredential(credential);
      await encryptAndSaveCredential(credential, passphrase);
      setStored({ state: "valid", credential });
      unlockedPassphrase.current = passphrase;
      setClaimSaved(true);
      await deliveryCall("/issuer/age/claims/ack", claimToken);
      window.history.replaceState(null, "", window.location.pathname);
      setClaimSaved(false);
      setClaimComplete(true);
      setPin("");
      setPinConfirm("");
      setReplaceConfirmed(false);
      setMessage("Credential đã được Issuer chuyển, xác minh và mã hóa trong Ví.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setClaiming(false);
    }
  }

  async function unlockWallet() {
    if (stored.state !== "locked") return;
    if (pin.length < 8 || pin.length > 64) {
      const message = "Mã khóa Ví phải có từ 8 đến 64 ký tự.";
      return checkoutUnlockOpen ? setUnlockError(message) : setError(message);
    }
    setError("");
    setUnlockError("");
    try {
      const credential = await decryptCredential(stored.envelope, pin);
      const parsed = ageCredentialFileSchema.parse(credential);
      await validateAgeCredential(parsed);
      unlockedPassphrase.current = pin;
      setStored({ state: "valid", credential: parsed });
      setPin("");
      setMessage("Ví đã được mở khóa trên thiết bị này.");
    } catch (reason) {
      const message = (reason as Error).message;
      checkoutUnlockOpen ? setUnlockError(message) : setError(message);
    }
  }

  async function lockWallet(automatic = false) {
    const envelope = await ageCredentialStore.get();
    if (envelope) setStored({ state: "locked", envelope });
    unlockedPassphrase.current = "";
    setPin("");
    setMessage(automatic ? "Ví đã tự khóa sau thời gian không hoạt động." : "Ví đã khóa.");
  }

  async function removeCredential() {
    await ageCredentialStore.remove();
    setStored({ state: "empty" });
    setCandidate(null);
    unlockedPassphrase.current = "";
    setDeleteOpen(false);
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
    setRequestFinished("rejected");
    setMessage("Bạn đã từ chối yêu cầu. Có thể đóng cửa sổ Ví.");
  }

  async function consentAndProve() {
    if (!request || stored.state !== "valid") return;
    setError("");
    setMessage("");
    setProving(true);
    setProvingStatus("Đang kiểm tra thông tin xác minh đã lưu…");
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
      markRequestProcessed(request.requestId);
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
      setRequestFinished("success");
    } catch (reason) {
      setError(`${(reason as Error).message} Bạn có thể thử lại khi yêu cầu còn hiệu lực.`);
    } finally {
      setProving(false);
      setProvingStatus("");
    }
  }

  const current =
    stored.state === "valid" || stored.state === "invalid"
      ? stored.credential
      : null;
  const proofSteps = [
    "Chuẩn bị",
    "Tải dữ liệu xác minh",
    "Tạo bằng chứng",
    "Gửi kết quả",
  ];
  const proofStep = !proving
    ? -1
    : /gửi|hoàn tất/i.test(provingStatus)
      ? 3
      : /bằng chứng|witness|proof/i.test(provingStatus)
        ? 2
        : /tải|wasm|zkey|khóa/i.test(provingStatus)
          ? 1
          : 0;

  return (
    <main className="wallet-shell">
      <header className="wallet-header">
        <div className="mark" aria-hidden="true">
          <ShieldCheck size={25} />
          <span />
        </div>
        <div>
          <strong>Ví xác minh</strong>
          <span>Lưu giữ thông tin xác minh và tạo bằng chứng theo sự đồng ý của bạn</span>
        </div>
        <span className={"security-badge " + (stored.state === "valid" ? "unlocked" : "locked")}>
          {stored.state === "valid" ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />}
          {stored.state === "valid" ? "Ví đã mở" : stored.state === "empty" ? "Ví chưa có thông tin" : stored.state === "invalid" ? "Cần kiểm tra thông tin" : "Ví đang khóa"}
        </span>
      </header>

      {request ? (
        <section className="card request-card" aria-hidden={checkoutUnlockOpen || undefined}>
          <span className="eyebrow">YÊU CẦU TỪ WEBSITE</span>
          <h1>Chứng minh bạn đáp ứng điều kiện từ {request.minimumAge} tuổi</h1>
          <p className="lead"><strong>{request.requesterName}</strong> đang yêu cầu xác minh. Website chỉ nhận kết quả đủ hoặc không đủ tuổi cùng dữ liệu công khai cần thiết; ngày sinh không được gửi đi.</p>
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
          {stored.state === "locked" && (
            <p className="warning">
              Ví đang khóa. Vui lòng nhập mã khóa để tiếp tục.
            </p>
          )}
          {stored.state === "empty" && <p className="warning">Ví chưa có thông tin xác minh tuổi.</p>}
          {stored.state === "invalid" && <p className="warning">{stored.message.toLowerCase().includes("thu hồi") ? "Thông tin xác minh tuổi không còn hiệu lực." : "Thông tin xác minh tuổi đã hết hạn."}</p>}
          <div className="consent-box">
            <ShieldCheck size={20} />
            <div><strong>Phạm vi dữ liệu được chia sẻ</strong><p>Kết quả điều kiện tuổi, commitment, nullifier và dữ liệu công khai của proof. Không gồm ngày sinh hoặc dữ liệu bí mật.</p></div>
          </div>
          <div className="actions">
            <BusyButton
              className="primary"
              busy={proving}
              busyLabel="Đang xác minh trên thiết bị…"
              disabled={proving || stored.state !== "valid"}
              onClick={consentAndProve}
            >
              Đồng ý và tạo bằng chứng
            </BusyButton>
            <button disabled={proving} onClick={rejectRequest}>
              Từ chối
            </button>
          </div>
          {proving && (
            <div className="progress" role="status">
              <ol className="proof-steps">
                {proofSteps.map((step, index) => <li className={index < proofStep ? "done" : index === proofStep ? "active" : ""} key={step}><span>{index < proofStep ? <CheckCircle2 size={15}/> : index + 1}</span><div><strong>{step}</strong>{index === proofStep && <small>{provingStatus}</small>}</div></li>)}
              </ol>
              <p><span className="spinner" /> Vui lòng giữ cửa sổ này mở.</p>
            </div>
          )}
        </section>
      ) : (
        <section className="intro">
          <span className="eyebrow">RIÊNG TƯ THUỘC VỀ BẠN</span>
          <h1>Thông tin xác minh, được giữ trong tay bạn.</h1>
          <p>
            Credential được mã hóa trên thiết bị. Ví chỉ tạo và chia sẻ bằng chứng
            khi bạn chủ động đồng ý.
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
        {stored.state === "empty" && !claimToken && !candidate && (
          <div className="empty-state">
            <div className="empty-icon"><KeyRound size={25} /></div>
            <div>
              <h3>Bắt đầu bằng một credential từ Issuer</h3>
              <p>Gửi yêu cầu xác minh tại Website, sau đó tiếp tục nhận credential tại Credential Issuer. Ví sẽ kiểm tra và mã hóa credential trước khi lưu.</p>
              <div className="empty-hints">
                <span><ShieldCheck size={15} /> Lưu mã hóa trên thiết bị</span>
                <span><UserRound size={15} /> Chỉ chia sẻ khi bạn đồng ý</span>
              </div>
            </div>
          </div>
        )}
        {claimToken && !claimComplete && (
          <div className="candidate">
            <span className="badge info"><ShieldCheck size={14} /> TỪ CREDENTIAL ISSUER</span>
            <h3>{claimSaved ? "Credential đã lưu, chờ xác nhận" : "Credential AGE sẵn sàng để nhận"}</h3>
            <p>{claimSaved
              ? "Credential đã được mã hóa trong Ví nhưng chưa gửi được xác nhận. Hãy thử xác nhận lại."
              : "Liên kết nhận dùng một lần và có hiệu lực 5 phút. Credential chỉ được tải sau khi bạn mở khóa Ví."}</p>
            <dl className="receive-summary"><div><dt>Đơn vị phát hành</dt><dd>Credential Issuer được Ví tin cậy</dd></div><div><dt>Loại</dt><dd>AGE · Xác minh thuộc tính tuổi</dd></div><div><dt>Tài khoản nhận</dt><dd>Tài khoản đã mở liên kết tại Issuer</dd></div><div><dt>Thời hạn</dt><dd>Được kiểm tra trước khi lưu</dd></div></dl>
            {!claimSaved && stored.state === "empty" && <fieldset className="key-setup"><legend>Tạo mã khóa Ví</legend><label>Mã khóa<span className="password-field"><input aria-label="Tạo mã khóa Ví" type={showPin ? "text" : "password"} autoComplete="new-password" placeholder="8–64 ký tự" value={pin} onChange={(event) => setPin(event.target.value)} /><button type="button" className="icon-button" aria-label={showPin ? "Ẩn mã khóa" : "Hiện mã khóa"} onClick={() => setShowPin(!showPin)}>{showPin ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label><label>Xác nhận mã khóa<input aria-label="Xác nhận mã khóa Ví" type={showPin ? "text" : "password"} autoComplete="new-password" placeholder="Nhập lại mã khóa" value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value)} /></label><p className="pin-warning">Hãy ghi nhớ mã khóa. Ví không lưu mã khóa và không thể khôi phục nếu bạn quên.</p></fieldset>}
            {!claimSaved && stored.state === "locked" && <p className="pin-warning">Ví đang khóa. Hãy mở khóa bên dưới trước khi lưu credential.</p>}
            {!claimSaved && stored.state === "valid" && <label className="replace-confirm"><input type="checkbox" checked={replaceConfirmed} onChange={event=>setReplaceConfirmed(event.target.checked)}/>Tôi hiểu credential mới sẽ thay thế credential AGE hiện có sau khi được kiểm tra và lưu an toàn.</label>}
            {(claimSaved || stored.state !== "locked") && <BusyButton className="primary" busy={claiming} busyLabel="Đang lưu an toàn…" disabled={claiming || (stored.state === "valid" && !claimSaved && !replaceConfirmed)} onClick={claimCredential}>
              {claimSaved ? "Gửi lại xác nhận đã lưu" : "Lưu vào Ví"}
            </BusyButton>}
          </div>
        )}
        {stored.state === "locked" && !request && (
          <div className="unlock-panel">
            <div className="unlock-copy"><div className="empty-icon"><LockKeyhole size={24}/></div><div><h3>Mở khóa credential</h3><p>Credential chỉ được giải mã trong bộ nhớ của phiên này.</p></div></div>
            <label>Mã khóa Ví<span className="password-field"><input
              aria-label="Mã khóa Ví"
              type={showPin ? "text" : "password"}
              autoComplete="current-password"
              placeholder="8–64 ký tự"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            /><button type="button" className="icon-button" aria-label={showPin ? "Ẩn mã khóa" : "Hiện mã khóa"} onClick={() => setShowPin(!showPin)}>{showPin ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
            <div className="actions">
              <button className="primary" disabled={pin.length < 8 || pin.length > 64} onClick={unlockWallet}>
                <UnlockKeyhole size={16} /> Mở khóa
              </button>
              <button className="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={16} /> Xóa credential
              </button>
            </div>
          </div>
        )}
        {stored.state === "legacy" && (
          <div className="unlock-panel">
            <p>Bản lưu cũ chưa được mã hóa và không còn được sử dụng.</p>
            <button className="danger" onClick={() => setDeleteOpen(true)}>
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
            <button className="danger" disabled={proving} onClick={() => setDeleteOpen(true)}>
              <Trash2 size={16} /> Xóa credential
            </button>
          </div>
        )}
        <p className="fineprint">
          Credential được mã hóa bằng mã khóa trước khi lưu và Ví tự khóa sau 5 phút
          không hoạt động. Cơ chế này không chống được malware khi Ví đang mở.
          Kết quả xác minh không thay thế giấy tờ pháp lý.
        </p>
        <details className="technical-details">
          <summary>Thông tin lưu trữ và bảo mật</summary>
          <p>
            IndexedDB chỉ lưu bản mã AES-GCM. Khóa được dẫn xuất từ mã khóa Ví bằng
            PBKDF2-SHA-256 với salt ngẫu nhiên; mã khóa và khóa thô không được lưu.
            Website bán hàng không thể đọc credential.
          </p>
        </details>
      </section>

      <section className="privacy-grid" aria-label="Cam kết riêng tư của Ví">
        <article><LockKeyhole size={20} /><strong>Khóa cục bộ</strong><span>Mã khóa và khóa giải mã không rời thiết bị.</span></article>
        <article><ShieldCheck size={20} /><strong>Tiết lộ tối thiểu</strong><span>Website chỉ nhận kết quả và dữ liệu proof công khai.</span></article>
        <article><Sparkles size={20} /><strong>Bạn chủ động</strong><span>Mọi yêu cầu đều cần sự đồng ý rõ ràng.</span></article>
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
            aria-label="Tạo mã khóa Ví"
            inputMode="numeric"
            type={showPin ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Mã khóa 8–64 ký tự"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
          <input
            aria-label="Xác nhận mã khóa Ví"
            inputMode="numeric"
            type={showPin ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Nhập lại mã khóa"
            value={pinConfirm}
            onChange={(event) => setPinConfirm(event.target.value)}
          />
          <div className="actions">
            <button className="primary" onClick={saveCandidate}>
              Lưu trên thiết bị
            </button>
            <button onClick={() => setCandidate(null)}>Hủy</button>
            <button type="button" className="text-button" onClick={() => setShowPin(!showPin)}>{showPin ? <EyeOff size={16}/> : <Eye size={16}/>} {showPin ? "Ẩn mã khóa" : "Hiện mã khóa"}</button>
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
          <a href={websiteReturnUrl}>Quay lại tài khoản Website</a>
        </p>
      )}
      {requestFinished && (
        <p className="message return-message">
          <a href={websiteReturnUrl}>{requestFinished === "success" ? "Quay lại Website xem kết quả" : "Quay lại Website"}</a>
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
      {checkoutUnlockOpen && (
        <div className="modal-backdrop unlock-modal-backdrop" role="presentation">
          <section ref={unlockDialog} className="modal unlock-modal" role="dialog" aria-modal="true" aria-labelledby="unlock-title" aria-describedby="unlock-description">
            <div className="modal-icon"><LockKeyhole size={22}/></div>
            <h2 id="unlock-title">Mở khóa Ví để tiếp tục</h2>
            <p id="unlock-description">Thông tin xác minh đang được mã hóa trên thiết bị này</p>
            <label>Mã khóa Ví<span className="password-field"><input ref={unlockInput} aria-label="Mã khóa Ví" type={showPin ? "text" : "password"} autoComplete="current-password" minLength={8} maxLength={64} placeholder="8–64 ký tự" value={pin} onChange={(event) => { setPin(event.target.value); setUnlockError(""); }}/><button type="button" className="icon-button" aria-label={showPin ? "Ẩn mã khóa" : "Hiện mã khóa"} onClick={() => setShowPin(!showPin)}>{showPin ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
            {unlockError && <p className="error" role="alert">{unlockError}</p>}
            <div className="actions unlock-actions">
              <button className="primary" disabled={pin.length < 8 || pin.length > 64} onClick={unlockWallet}><UnlockKeyhole size={16}/> Mở khóa và tiếp tục</button>
              <button onClick={rejectRequest}>Hủy xác minh</button>
            </div>
          </section>
        </div>
      )}
      {deleteOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-icon"><Trash2 size={22} /></div>
            <h2 id="delete-title">Xóa credential khỏi thiết bị?</h2>
            <p>Thao tác này xóa bản mã trong Ví. Bạn sẽ cần nhận lại credential từ Issuer trước khi tạo bằng chứng mới.</p>
            <div className="actions">
              <button autoFocus onClick={() => setDeleteOpen(false)}>Giữ lại</button>
              <button className="danger solid" onClick={removeCredential}>Xóa credential</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
