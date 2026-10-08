import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useLocation } from "react-router-dom";
import { ShieldCheck, ArrowRight, ArrowLeft, LogOut, RefreshCw, Eye, EyeOff, Search, LoaderCircle, Inbox, CheckCircle2, AlertCircle } from "lucide-react";
import { api, claimCredential, websiteOrigin, type AgeRequestStatus, type OperatorAgeRequest, type User } from "./api";
import { canAccessOperator, canReceiveCredential, websiteDetailUrl, type AgeStatus } from "./flow";
import { customerReturn } from "./navigation";

const labels: Record<AgeStatus, string> = {
  PENDING: "Chờ xử lý", APPROVED: "Đã phê duyệt", ISSUING: "Đang phát hành",
  ISSUED: "Đã phát hành", REJECTED: "Bị từ chối", REVOKED: "Đã thu hồi", EXPIRED: "Hết hạn",
};
const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const time = (value: string) => new Date(value).toLocaleString("vi-VN");
const denied = "Tài khoản không có quyền vận hành Credential Issuer";
function Spinner() { return <LoaderCircle className="spinner" size={18} aria-hidden="true" />; }
function ErrorMessage({ message }: { message: string }) {
  return message ? <div className="feedback error" role="alert"><AlertCircle size={18} /><span>{message}</span></div> : null;
}
function Badge({ status }: { status: AgeStatus }) { return <span className={"badge badge-" + status.toLowerCase()}>{labels[status]}</span>; }
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><Inbox size={36} /><h2>{title}</h2><p>{detail}</p></div>;
}
function Denied() {
  return <section className="card compact"><ShieldCheck className="feature-icon" size={32} /><h1>Không đủ quyền truy cập</h1><ErrorMessage message={denied} /><p>Hãy đăng xuất và sử dụng tài khoản nhân viên vận hành.</p><Link to="/login">Đăng nhập tại Issuer</Link></section>;
}

function Login({ user, onUser }: { user: User | null; onUser: (user: User) => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const submitting = useRef(false);
  if (user?.role === "ISSUER_OPERATOR") return <Navigate to="/operator" replace />;
  if (user) return <Denied />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setLoading(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const signedIn = (await api<{ user: User }>("/issuer/auth/login", "POST", data)).user;
      onUser(signedIn);
      if (signedIn.role === "ISSUER_OPERATOR") navigate("/operator", { replace: true });
      else setError(denied);
    } catch (reason) { setError((reason as Error).message); }
    finally { submitting.current = false; setLoading(false); }
  }
  return <section className="login-layout">
    <aside className="login-intro"><div className="intro-mark"><ShieldCheck size={40} /></div><span className="eyebrow">CREDENTIAL ISSUER</span><h2>Thông tin được xác minh.<br />Quy trình được kiểm soát.</h2><p>Tiếp nhận, xử lý và phát hành thông tin xác minh.</p><div className="intro-footer"><CheckCircle2 size={18} /> Cổng dành cho nhân viên vận hành</div></aside>
    <div className="login-form"><span className="eyebrow">Credential Issuer</span><h1>Đăng nhập dành cho nhân viên vận hành</h1><p>Đăng nhập để tiếp nhận và xử lý các yêu cầu xác minh thông tin.</p>
      <form onSubmit={submit}><label>Email<input name="email" type="email" required autoComplete="username" placeholder="Nhập email của bạn" disabled={loading} /></label>
        <label>Mật khẩu<span className="password-field"><input name="password" type={visible ? "text" : "password"} required autoComplete="current-password" placeholder="Nhập mật khẩu" disabled={loading} /><button type="button" className="icon-button" aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
        <ErrorMessage message={error} /><button className="primary full" disabled={loading}>{loading ? <><Spinner /> Đang đăng nhập…</> : <>Đăng nhập <ArrowRight size={18} /></>}</button>
      </form>
    </div>
  </section>;
}
function Home({ user }: { user: User | null }) {
  return <section className="card landing"><div className="feature-icon"><ShieldCheck size={40} /></div><span className="eyebrow">CỔNG NGHIỆP VỤ</span><h1>Credential Issuer</h1><p className="lead">Tiếp nhận, xử lý và phát hành thông tin xác minh.</p>
    {user && user.role !== "ISSUER_OPERATOR" && <ErrorMessage message={denied} />}
    <div className="actions">{!user && <Link className="button primary" to="/login">Đăng nhập dành cho nhân viên vận hành <ArrowRight size={18} /></Link>}{user?.role === "ISSUER_OPERATOR" && <Link className="button primary" to="/operator">Xử lý yêu cầu xác minh <ArrowRight size={18} /></Link>}</div>
  </section>;
}
function LegacyRedirect() {
  const { id = "" } = useParams();
  useEffect(() => { window.location.replace(websiteDetailUrl(websiteOrigin(), id)); }, [id]);
  return <div className="loading"><Spinner /> Đang chuyển về trang theo dõi…</div>;
}
function ReceiveAge({ user }: { user: User | null }) {
  const back = customerReturn(websiteOrigin(), "RECEIVE");
  const { id = "" } = useParams();
  const [request, setRequest] = useState<AgeRequestStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    setRequest(null); setError(""); setLoading(true);
    if (user?.role !== "CUSTOMER") { setLoading(false); return; }
    api<AgeRequestStatus>("/me/age-credential-requests/" + id).then(value => { if (active) setRequest(value); }).catch(reason => { if (active) setError((reason as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, user?.id, user?.role]);
  async function receive() {
    if (submitting.current || !request || !canReceiveCredential(request.status)) return;
    submitting.current = true; setBusy(true); setError("");
    try { const claim = await claimCredential(request.id); window.location.assign(claim.claimUrl); }
    catch (reason) { setError((reason as Error).message); submitting.current = false; setBusy(false); }
  }
  return <section className="card compact receive"><div className="feature-icon"><ShieldCheck size={32} /></div><span className="eyebrow">CREDENTIAL ISSUER</span><h1>Nhận thông tin xác minh</h1>
    {user?.role !== "CUSTOMER" ? <><ErrorMessage message="Phiên tài khoản không hợp lệ để nhận thông tin xác minh." /><p>Vui lòng quay lại Bản Vị Việt để đăng nhập bằng tài khoản đã gửi yêu cầu, sau đó thực hiện lại.</p></> : <>
      {loading && <div className="loading"><Spinner /> Đang kiểm tra yêu cầu…</div>}<ErrorMessage message={error} />
      {request && <><dl className="meta"><div><dt>Mã yêu cầu</dt><dd>{shortId(request.id)}</dd></div><div><dt>Trạng thái</dt><dd><Badge status={request.status} /></dd></div></dl>
        {canReceiveCredential(request.status) ? <><p>Thông tin xác minh đã sẵn sàng. Mở Ví và sử dụng PIN để nhận, kiểm tra và lưu an toàn trên thiết bị.</p><button className="primary full" disabled={busy} onClick={() => void receive()}>{busy ? <><Spinner /> Đang chuyển tới Ví…</> : <>Tiếp tục tới Ví <ArrowRight size={18} /></>}</button></> : <ErrorMessage message="Thông tin xác minh chưa sẵn sàng hoặc không còn hiệu lực. Vui lòng kiểm tra trạng thái yêu cầu tại Website." />}</>}
    </>}<a className="back-link" href={back.url}><ArrowLeft size={16} /> {back.label}</a>
  </section>;
}
import { SubmitAge, EvidenceReview, evidenceApi } from "./evidence";
import { SubmitLot, OperatorLot } from "./lot";
function Operator({ user }: { user: User }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<OperatorAgeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState(false);
  const [checklist, setChecklist] = useState<boolean[]>([false,false,false,false]);
  const [revision,setRevision] = useState<number|null>(null);
  const [action, setAction] = useState<"APPROVE" | "REJECT" | "REVOKE" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  async function load() {
    setLoading(true); setError("");
    try { setRequests(await api<OperatorAgeRequest[]>("/admin/age-credential-requests")); }
    catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (canAccessOperator(user.role)) void load(); }, [user.id, user.role]);
  useEffect(() => { setChecked(false); setChecklist([false,false,false,false]); setAction(null); setNotice(""); }, [id]);
  useEffect(() => {
    if (!action || busy) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setAction(null); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [action, busy]);
  if (!canAccessOperator(user.role)) return <Denied />;
  const request = requests.find(item => item.id === id);
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request || !action || submitting.current || (action === "APPROVE" && (!checked || !checklist.every(Boolean) || revision===null))) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      await api("/admin/age-credential-requests/" + request.id, "PATCH", { action, ...(action === "APPROVE" ? { recordChecked: true, evidenceRevision:revision } : { reason: reason.trim() }) });
      setAction(null); setReason(""); setNotice("Yêu cầu đã được cập nhật."); await load();
    } catch (failure) { setError((failure as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  const visible = requests.filter(item => (!filter || item.status === filter) && (item.id + " " + (item.user?.email || "")).toLocaleLowerCase("vi-VN").includes(search.trim().toLocaleLowerCase("vi-VN")));
  return <section className="dashboard">
    <div className="actions"><Link to="/operator">Yêu cầu AGE</Link><Link to="/operator/lot">Yêu cầu LOT</Link></div>
    <div className="page-heading"><div><span className="eyebrow">QUẢN LÝ YÊU CẦU</span><h1>{id ? "Chi tiết yêu cầu" : "Yêu cầu xác minh độ tuổi"}</h1><p>{id ? "Kiểm tra thông tin và cập nhật kết quả xử lý." : "Tiếp nhận hồ sơ, đối chiếu và cập nhật kết quả xử lý."}</p></div><button className="secondary" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={17} className={loading ? "spinner" : ""} /> Làm mới</button></div>
    <ErrorMessage message={error} />{notice && <div className="feedback success" role="status"><CheckCircle2 size={18} />{notice}</div>}
    {id ? <><Link className="back-link" to="/operator"><ArrowLeft size={16} /> Quay lại danh sách</Link>
      {loading ? <div className="loading card"><Spinner /> Đang tải yêu cầu…</div> : request ? <div className="card detail-card">
        <div className="detail-heading"><h2>Thông tin yêu cầu</h2><Badge status={request.status} /></div>
        <dl className="meta"><div className="wide"><dt>Mã yêu cầu</dt><dd className="request-id">{request.id}</dd></div><div><dt>Email người gửi</dt><dd>{request.user?.email || "—"}</dd></div><div><dt>Thời gian gửi</dt><dd>{time(request.createdAt)}</dd></div></dl>
        <h2>Lịch sử xử lý</h2><ul className="timeline"><li><span />Đã tiếp nhận <time>{time(request.createdAt)}</time></li>{request.reviewedAt && <li><span />Đã đối chiếu hồ sơ <time>{time(request.reviewedAt)}</time></li>}{request.issuedAt && <li><span />Đã phát hành <time>{time(request.issuedAt)}</time></li>}{request.revokedAt && <li><span />Đã thu hồi <time>{time(request.revokedAt)}</time></li>}</ul>
        {request.revocationReason && <p>Lý do: {request.revocationReason}</p>}
        <EvidenceReview key={request.id} id={request.id} onRevision={setRevision}/>
        <div className="detail-actions">{request.status === "PENDING" && <>{["Đã xác nhận đúng người gửi yêu cầu","Đã xem hồ sơ hoặc hoàn thành phương thức đối chiếu","Đã kiểm tra thuộc tính ngày sinh","Hồ sơ đáp ứng điều kiện cấp credential"].map((label,index)=><label className="check-label" key={label}><input type="checkbox" checked={checklist[index]} disabled={busy||revision===null} onChange={event=>setChecklist(previous=>previous.map((value,i)=>i===index?event.target.checked:value))}/>{label}</label>)}<label className="check-label"><input type="checkbox" checked={checked} disabled={busy||revision===null} onChange={event => setChecked(event.target.checked)} /> Tôi xác nhận đã đối chiếu hồ sơ ngoài hệ thống.</label></>}
          <div className="actions">{request.status === "PENDING" && <button className="primary" disabled={!checked || busy || revision===null || !checklist.every(Boolean)} onClick={() => { setReason(""); setAction("APPROVE"); }}>Phê duyệt</button>}{["PENDING", "APPROVED"].includes(request.status) && <button className="danger-outline" disabled={busy} onClick={() => { setReason(""); setAction("REJECT"); }}>Từ chối</button>}{request.status === "ISSUED" && <button className="danger-outline" disabled={busy} onClick={() => { setReason(""); setAction("REVOKE"); }}>Thu hồi</button>}</div>
        </div>
      </div> : <Empty title="Không tìm thấy yêu cầu" detail="Yêu cầu không tồn tại hoặc chưa có trong danh sách được tải." />}</> : <>
      <div className="stats">{(["PENDING", "APPROVED", "ISSUED", "REJECTED"] as const).map(status => <div className="stat" key={status}><span>{labels[status]}</span><strong>{loading ? "—" : requests.filter(item => item.status === status).length}</strong></div>)}</div>
      <div className="card list-card"><div className="list-toolbar"><h2>Danh sách yêu cầu</h2><span>{visible.length} yêu cầu</span></div><div className="filters"><label className="search-field"><Search size={18} /><input aria-label="Tìm kiếm yêu cầu" placeholder="Tìm theo mã yêu cầu hoặc email" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Lọc trạng thái" value={filter} onChange={event => setFilter(event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        {loading ? <div className="skeleton-list" aria-label="Đang tải danh sách">{[1, 2, 3].map(item => <div className="skeleton" key={item} />)}</div> : !visible.length ? <Empty title="Không có yêu cầu phù hợp" detail="Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm." /> : <table className="request-table"><thead><tr><th>Mã yêu cầu</th><th>Người gửi</th><th>Thời gian gửi</th><th>Trạng thái</th><th>Hành động</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td data-label="Mã yêu cầu"><strong>{shortId(item.id)}</strong></td><td data-label="Người gửi">{item.user?.email || "—"}</td><td data-label="Thời gian gửi">{time(item.createdAt)}</td><td data-label="Trạng thái"><Badge status={item.status} /></td><td><Link className="table-link" to={"/operator/" + item.id}>Xem chi tiết <ArrowRight size={15} /></Link></td></tr>)}</tbody></table>}
      </div><p className="list-note">Thống kê dựa trên danh sách yêu cầu được tải.</p>
    </>}
    {action && request && <div className="modal-backdrop"><section className="modal card" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{action === "APPROVE" ? "Phê duyệt yêu cầu?" : action === "REJECT" ? "Từ chối yêu cầu?" : "Thu hồi thông tin xác minh?"}</h2><p>Mã yêu cầu {shortId(request.id)}. Vui lòng kiểm tra trước khi xác nhận.</p><form onSubmit={confirm}>{action !== "APPROVE" && <label>Lý do<textarea autoFocus required minLength={1} maxLength={300} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>}<ErrorMessage message={error} /><div className="actions"><button type="button" className="secondary" disabled={busy} autoFocus={action === "APPROVE"} onClick={() => setAction(null)}>Hủy</button><button className={action === "APPROVE" ? "primary" : "danger"} disabled={busy || (action !== "APPROVE" && !reason.trim())}>{busy ? <><Spinner /> Đang xử lý…</> : "Xác nhận"}</button></div></form></section></div>}
  </section>;
}
function Logout({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() { setBusy(true); try { await api("/issuer/auth/logout", "POST", {}); onLogout(); navigate("/login", { replace: true }); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }
  return <div className="logout"><button className="header-button" disabled={busy} onClick={() => void logout()}>{busy ? <Spinner /> : <LogOut size={16} />} Đăng xuất</button>{error && <span role="alert">{error}</span>}</div>;
}
export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const location=useLocation();
  const context=/^\/submit-lot\//.test(location.pathname)?"business":/^\/(submit-age|receive-age)\//.test(location.pathname)?"customer":"issuer";
  const [loadedContext,setLoadedContext]=useState("");
  useEffect(() => { let active = true; const session=context==="business"?evidenceApi<{user:User|null}>("/issuer/lot/business/me"):api<{ user: User | null }>(context==="customer"?"/issuer/customer/me":"/issuer/auth/me");session.then(value => { if (active) {setUser(value.user);setLoadedContext(context);} }).catch(() => { if (active) {setUser(null);setLoadedContext(context);} }); return () => { active = false; }; }, [context]);
  if(loadedContext!==context)return <main className="portal-main"><div className="loading card compact"><Spinner/> Đang kiểm tra phiên…</div></main>;
  const operator = user ? <Operator user={user} /> : <Navigate to="/login" replace />;
  return <><header className="portal-header"><div className="header-inner"><Link className="brand" to="/"><ShieldCheck size={27} /> Credential Issuer</Link><div className="header-session">{user?.role === "ISSUER_OPERATOR" && <span className="operator-name">{user.name}</span>}{user && <Logout onLogout={() => setUser(null)} />}</div></div></header><main className="portal-main">
    {user === undefined ? <div className="loading card compact"><Spinner /> Đang mở cổng thông tin…</div> : <Routes><Route path="/" element={<Home user={user} />} /><Route path="/login" element={<Login user={user} onUser={setUser} />} /><Route path="/operator" element={operator} /><Route path="/operator/lot" element={<OperatorLot user={user}/>} /><Route path="/operator/lot/:id" element={<OperatorLot user={user}/>} /><Route path="/submit-lot/:id" element={<SubmitLot/>}/><Route path="/operator/:id" element={operator} /><Route path="/submit-age/:id" element={<SubmitAge user={user}/>} /><Route path="/receive-age/:id" element={<ReceiveAge user={user} />} /><Route path="/verify-age/:id" element={<LegacyRedirect />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>}
  </main></>;
}
