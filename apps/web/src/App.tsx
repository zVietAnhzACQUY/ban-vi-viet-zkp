import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  ShoppingBag,
  Search,
  Menu,
  X,
  Leaf,
  Package,
  ShieldCheck,
  Truck,
  Plus,
  Minus,
  LogOut,
  UserRound,
  Check,
  MapPin,
  ChevronRight,
  LockKeyhole,
  CreditCard,
  Trash2,
  Mail,
  Phone,
  CircleCheck,
} from "lucide-react";
import Art from "./Art";
import { PasswordField } from "./PasswordField";
import { BusyButton } from "../../shared/BusyButton";
import {
  AboutPage,
  FeaturedCategories,
  StorefrontBenefits,
} from "./StorefrontSections";
import { storefrontTab } from "./storefront-navigation";
import { ConfirmationProvider, useConfirmation } from "./ConfirmationDialog";
import { LotRequestAction } from "./lot-request";
import {
  api,
  issuerPortalOrigin,
  ApiError,
  ApiTimeoutError,
  type User,
  type Product,
  type Cart,
  type Address,
  type Order,
  type AgeChallenge,
  type AgeVerificationResult,
  type AgeCredentialStatus,
  type LotProofStatus,
} from "./api";
import {
  openWalletPopup,
  requestProofFromWallet,
  WalletFlowAbortedError,
  WalletPopupBlockedError,
  WalletResponseError,
} from "./wallet";
import { verifyLotStatus } from "./lot";
import {
  cleanSearchInput,
  matchesProductSearch,
  normalizeVietnameseSearch,
} from "./search";
import {
  cartRequiresAgeProof,
  tryBeginAgeVerification,
} from "./checkout-policy";
import { preferredAddressId } from "./checkout-address";
import {
  ageDetailPath,
  ageStatusCopy,
  issuerReceiveUrl,
  startAgePolling,
  terminalAgeStatus,
} from "./age-request-flow";
const money = (n: string | number) => BigInt(n).toLocaleString("vi-VN") + " ₫";
const status: Record<string, string> = {
  PENDING: "Chờ xác nhận",
  CONFIRMED: "Đã xác nhận",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};
const lotStatusCopy: Record<string, { title: string; detail: string }> = {
  UNVERIFIED: {
    title: "Không có thông tin xác minh",
    detail: "Lô hàng này chưa có thông tin xác minh đang hiệu lực.",
  },
  EXPIRED: {
    title: "Thông tin đã hết hạn",
    detail: "Thời hạn của thông tin xác minh lô đã kết thúc.",
  },
  REVOKED: {
    title: "Thông tin đã bị thu hồi",
    detail: "Đơn vị xác nhận đã thu hồi thông tin của lô hàng này.",
  },
  STALE: {
    title: "Thông tin cần được cập nhật",
    detail: "Bản xác minh hiện tại không còn phù hợp với trạng thái mới nhất.",
  },
};
const field = (f: HTMLFormElement) => Object.fromEntries(new FormData(f));
const displayName = (name: string) =>
  name.replace(/(?:\s*\((?:demo|test)\)|\s+(?:demo|test))\s*$/i, "").trim();
const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function scrollToCatalog() {
  requestAnimationFrame(() =>
    document.getElementById("thuc-qua")?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    }),
  );
}
function ScrollToTop() {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target = hash ? document.getElementById(hash.slice(1)) : null;
      if (target) target.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, search, hash]);
  return null;
}
function useData<T>(path: string) {
  const [result, set] = useState<{ path: string; data: T } | null>(null),
    [error, err] = useState(""),
    [rev, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    err("");
    api<T>(path, "GET", undefined, { signal: controller.signal, timeoutMs: 15000 })
      .then((data) => {
        if (alive) set({ path, data });
      })
      .catch((e) => {
        if (alive) err(e.message);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [path, rev]);
  return {
    data: result?.path === path ? result.data : null,
    error,
    reload: () => bump((x) => x + 1),
  };
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      {children}
    </div>
  );
}
function Loading({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <div className="empty">
      {error ? (
        <>
          <h2>Chưa tải được dữ liệu</h2>
          <p role="alert">Không kết nối được dịch vụ. Vui lòng thử lại sau hoặc tải lại trang.</p>
          {retry && <button className="button secondary" onClick={retry}>Thử tải lại</button>}
        </>
      ) : (
        <div className="loading-state" role="status" aria-live="polite">
          <span className="spinner" />
          <div>
            <h2>Đang chuẩn bị nội dung</h2>
            <p>Xin chờ một chút…</p>
          </div>
        </div>
      )}
    </div>
  );
}
function Card({ p, onAdd }: { p: Product; onAdd: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  return (
    <article className="product-card">
      <Link className="art-link" to={"/san-pham/" + p.slug}>
        <Art kind={p.art} name={p.name} tone={p.tone} />
        {p.requiresAgeProof && <span className="age-tag">18+</span>}
      </Link>
      <div className="product-meta">
        <span>{p.category.name}</span>
        <span>{p.weight}</span>
      </div>
      <Link className="product-name" to={"/san-pham/" + p.slug}>
        {p.name}
      </Link>
      <div className="card-bottom">
        <div>
          <strong>{money(p.price)}</strong>
          <small className={p.stock ? "product-stock" : "product-stock out"}>
            {p.stock ? "Còn hàng" : "Tạm hết hàng"}
          </small>
        </div>
        <button
          className="icon round"
          disabled={!p.stock || adding}
          aria-busy={adding}
          onClick={async () => {
            if (addingRef.current) return;
            addingRef.current = true; setAdding(true);
            try { await onAdd(p.id); }
            finally { addingRef.current = false; setAdding(false); }
          }}
          aria-label={adding ? "Đang thêm vào giỏ" : "Thêm " + p.name + " vào giỏ"}
        >
          {adding ? <span className="spinner" aria-hidden="true" /> : <Plus size={18} />}
        </button>
      </div>
    </article>
  );
}
function ProductSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeQuery = new URLSearchParams(location.search).get("q") || "";
  const [value, setValue] = useState(activeQuery);

  useEffect(() => setValue(activeQuery), [activeQuery]);

  function goToResults(nextValue: string) {
    const query = cleanSearchInput(nextValue);
    navigate({
      pathname: "/cua-hang",
      search: query ? "?q=" + encodeURIComponent(query) : "",
      hash: "#thuc-qua",
    });
  }

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        goToResults(value);
      }}
    >
      <input
        name="q"
        type="search"
        value={value}
        maxLength={80}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
        aria-label="Tìm sản phẩm"
        placeholder="Tìm một thức quà…"
      />
      {value && (
        <button
          type="button"
          className="icon search-clear"
          aria-label="Xóa từ khóa tìm kiếm"
          onClick={() => {
            setValue("");
            goToResults("");
          }}
        >
          <X size={14} />
        </button>
      )}
      <button type="submit" className="icon" aria-label="Tìm kiếm">
        <Search size={17} />
      </button>
    </form>
  );
}
function Home({ onAdd }: { onAdd: (id: string) => void }) {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    location = useLocation(),
    category = params.get("category") || params.get("danh-muc") || "",
    query = params.get("q") || "";
  const [sortBy, setSortBy] = useState("featured");
  const landing = location.pathname === "/" && !category && !query;
  const { data, error, reload } = useData<{
    products: Product[];
    categories: { id: string; slug: string; name: string }[];
  }>("/products");
  const products = data?.products
    .filter(
      (p) =>
        (!category || p.category.slug === category) &&
        matchesProductSearch(p, query),
    )
    .sort((a, b) => {
      if (sortBy === "price-asc")
        return Number(BigInt(a.price) - BigInt(b.price));
      if (sortBy === "price-desc")
        return Number(BigInt(b.price) - BigInt(a.price));
      if (sortBy === "name") return a.name.localeCompare(b.name, "vi");
      return 0;
    });
  function chooseCategory(nextCategory: string) {
    const search = new URLSearchParams();
    if (nextCategory) search.set("category", nextCategory);
    if (query) search.set("q", query);
    navigate({
      pathname: nextCategory === "qua-tang" ? "/gifts" : "/cua-hang",
      search: search.toString() ? `?${search}` : "",
      hash: "#thuc-qua",
    });
    if (location.hash === "#thuc-qua") scrollToCatalog();
  }
  return (
    <>
      {landing && (
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> TỪ NHỮNG MIỀN ĐẤT VIỆT
            </div>
            <h1>
              Gói một miền thương.
              <br />
              <em>Trao một vị Việt.</em>
            </h1>
            <p>
              Những thức quà mộc mạc, mang theo câu chuyện của đất và người.
              Chọn cho mình, gửi đến người thương.
            </p>
            <Link className="button" to="/cua-hang#thuc-qua">
              Khám phá thức quà <ArrowRight size={18} />
            </Link>
            <Link
              className="hero-secondary"
              to="/gifts?category=qua-tang#thuc-qua"
            >
              Chọn quà cho người thương <ArrowRight size={16} />
            </Link>
            <div className="hero-foot">
              <span>CHỌN LỌC TỪ TÂM</span>
              <span>•</span>
              <span>ĐẬM VỊ QUÊ NHÀ</span>
            </div>
          </div>
          <div className="hero-scene">
            <div className="sun-mark">
              BẢN VỊ VIỆT
              <br />
              <Leaf size={30} />
              <small>GÌN GIỮ VỊ QUEN</small>
            </div>
            <div className="hero-pack pack-one">
              <Art kind="tea" name="Trà sen" tone="#678069" priority />
            </div>
            <div className="hero-pack pack-two">
              <Art kind="coffee" name="Cà phê" tone="#a76642" priority />
            </div>
            <div className="hero-caption">
              <span>01 / BỘ SƯU TẬP</span>
              <strong>Hương vị từ những điều giản dị</strong>
            </div>
          </div>
        </section>
      )}
      <div className="promise-strip">
        <span>
          <Leaf /> Thức quà Việt được chọn lọc
        </span>
        <span>
          <Package /> Gói ghém bằng sự chỉn chu
        </span>
        <span>
          <Truck /> Thanh toán khi nhận hàng
        </span>
      </div>
      {landing && <FeaturedCategories />}
      <section className="catalog section" id="thuc-qua">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MỖI VÙNG ĐẤT, MỘT DẤU VỊ</span>
            {landing ? (
              <h2>Thức quà được yêu thích</h2>
            ) : (
              <h1 className="catalog-title">
                {category === "qua-tang"
                  ? "Quà tặng từ những miền thương"
                  : "Cửa hàng thức quà Việt"}
              </h1>
            )}
          </div>
          <p>
            Một chút thân quen cho ngày thường.
            <br />
            Một món quà nhỏ cho dịp đặc biệt.
          </p>
        </div>
        <div className="catalog-tools">
          <div className="tabs">
            <button
              className={!category ? "active" : ""}
              onClick={() => chooseCategory("")}
            >
              Tất cả thức quà
            </button>
            {data?.categories.map((c) => (
              <button
                key={c.id}
                className={category === c.slug ? "active" : ""}
                onClick={() => chooseCategory(c.slug)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="catalog-sort">
            <label htmlFor="sort-products">Sắp xếp</label>
            <select
              id="sort-products"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
            >
              <option value="featured">Gợi ý cho bạn</option>
              <option value="name">Tên A–Z</option>
              <option value="price-asc">Giá thấp đến cao</option>
              <option value="price-desc">Giá cao đến thấp</option>
            </select>
            <span className="count">{products?.length || 0} sản phẩm</span>
          </div>
        </div>
        {query && (
          <div className="search-summary" role="status">
            <span>
              Kết quả cho <strong>“{cleanSearchInput(query)}”</strong>
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => setParams(category ? { category } : {})}
            >
              Xóa tìm kiếm
            </button>
          </div>
        )}
        {!data ? (
          <Loading error={error} retry={reload} />
        ) : products?.length ? (
          <div className="product-grid">
            {products.map((p) => (
              <Card key={p.id} p={p} onAdd={onAdd} />
            ))}
          </div>
        ) : (
          <div className="empty catalog-empty">
            <Search size={38} />
            <h2>Chưa tìm thấy thức quà phù hợp</h2>
            <p>Hãy thử từ khóa khác hoặc xem lại tất cả danh mục.</p>
            <button
              type="button"
              className="button"
              onClick={() => navigate("/cua-hang#thuc-qua")}
            >
              Xem tất cả sản phẩm
            </button>
          </div>
        )}
      </section>
      {landing && <StorefrontBenefits />}
      {landing && <section className="story">
        <div className="story-seal" aria-label="Bản Vị Việt">
          <span>bản vị</span>
          <em>việt</em>
        </div>
        <div>
          <span className="eyebrow">CHÚNG TÔI TIN RẰNG</span>
          <h2>
            Món quà đẹp nhất
            <br />
            là món quà có câu chuyện.
          </h2>
          <p>
            Từ tách trà đầu ngày đến hộp quà dành tặng, Bản Vị Việt muốn giữ lại
            những hương vị thân thuộc. Mộc mạc trong lựa chọn, chỉn chu trong
            từng gói quà.
          </p>
          <Link to="/gifts?category=qua-tang#thuc-qua">
            Chọn quà cho người thương <ArrowRight size={17} />
          </Link>
        </div>
      </section>}
    </>
  );
}
function ProductPage({
  onAdd,
}: {
  onAdd: (id: string, quantity?: number) => void;
}) {
  const { slug } = useParams();
  const { data: p, error, reload } = useData<Product>("/products/" + slug);
  const related = useData<{ products: Product[] }>("/products");
  const [lotOpen, open] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [lotChecks, setLotChecks] = useState<
    Record<
      string,
      {
        state: "checking" | "valid" | "invalid";
        message: string;
        checkedAt?: string;
        expiresAt?: string;
      }
    >
  >({});
  if (!p) return <Loading error={error} retry={reload} />;
  async function checkLot(lotId: string, lotCode: string) {
    setLotChecks((current) => ({
      ...current,
      [lotId]: { state: "checking", message: "Đang kiểm tra thông tin lô…" },
    }));
    try {
      const response = await api<LotProofStatus>(
        "/lots/" + lotId + "/proof-bundle",
      );
      if (response.status !== "ACTIVE") {
        const copy = lotStatusCopy[response.status] || {
          title: "Xác minh không thành công",
          detail: "Chưa thể xác minh thông tin lô vào lúc này.",
        };
        return setLotChecks((current) => ({
          ...current,
          [lotId]: {
            state: "invalid",
            message: `${copy.title}. ${copy.detail}`,
          },
        }));
      }
      const result = await verifyLotStatus(response, p!.id, lotCode);
      setLotChecks((current) => ({
        ...current,
        [lotId]: {
          state: "valid",
          message: "Đã xác minh thông tin vùng của lô hàng",
          checkedAt: result.checkedAt,
          expiresAt: result.expiresAt,
        },
      }));
    } catch (error) {
      setLotChecks((current) => ({
        ...current,
        [lotId]: {
          state: "invalid",
          message:
            "Xác minh không thành công. Thông tin lô chưa thể được xác nhận vào lúc này.",
        },
      }));
    }
  }
  return (
    <section className="section">
      <div className="breadcrumbs">
        <Link to="/">Thức quà</Link>
        <ChevronRight size={14} />
        <span>{p.name}</span>
      </div>
      <div className="product-detail">
        <Art kind={p.art} name={p.name} tone={p.tone} />
        <div className="detail-copy">
          <span className="eyebrow">
            {p.origin} / {p.category.name}
          </span>
          <h1>{p.name}</h1>
          <p className="subtitle">{p.subtitle}</p>
          <strong className="price">{money(p.price)}</strong>
          <p>{p.description}</p>
          <div className="detail-facts">
            <span>
              Quy cách <b>{p.weight}</b>
            </span>
            <span>
              Tình trạng{" "}
              <b>
                {p.stock > 0 ? "Còn " + p.stock + " sản phẩm" : "Tạm hết hàng"}
              </b>
            </span>
          </div>
          {p.requiresAgeProof && (
            <Notice>
              <ShieldCheck size={21} />
              <div>
                <strong>Sản phẩm dành cho người đủ 18 tuổi</strong>
                <p>
                  Bạn sẽ xác minh điều kiện tuổi bằng Ví riêng trước khi đặt
                  hàng. Cửa hàng không nhận ngày sinh của bạn.
                </p>
              </div>
            </Notice>
          )}
          <div className="purchase-row">
            <div className="quantity detail-quantity" aria-label="Số lượng">
              <button
                type="button"
                aria-label="Giảm số lượng"
                disabled={quantity <= 1}
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              >
                <Minus size={15} />
              </button>
              <span>{quantity}</span>
              <button
                type="button"
                aria-label="Tăng số lượng"
                disabled={quantity >= p.stock}
                onClick={() =>
                  setQuantity((value) => Math.min(p.stock, value + 1))
                }
              >
                <Plus size={15} />
              </button>
            </div>
            <button
              className="button full"
              disabled={!p.stock}
              onClick={() => onAdd(p.id, quantity)}
            >
              <ShoppingBag size={18} /> Thêm {quantity} sản phẩm vào giỏ
            </button>
          </div>
          <p className="muted small">
            Thanh toán khi nhận hàng · Giá và tồn kho được xác nhận khi đặt đơn
          </p>
          <div className="lot-section">
            <button
              className="disclosure"
              onClick={() => open(!lotOpen)}
              aria-expanded={lotOpen}
            >
              <span>
                <Package size={20} /> Thông tin lô sản phẩm
              </span>
              {lotOpen ? <Minus size={18} /> : <Plus size={18} />}
            </button>
            {lotOpen && (
              <div className="lot-content">
                <p>
                  Kiểm tra thông tin vùng đã được đơn vị xác nhận ký cho từng lô
                  và đối chiếu với trạng thái hiện tại.
                </p>
                {p.lots?.length ? (
                  p.lots.map((l) => (
                    <div className="lot-row" key={l.id}>
                      <strong>{l.lotCode}</strong>
                      <small>Tồn lô hiện tại: {l.stock}</small>
                      <button
                        type="button"
                        className="text-button lot-check-button"
                        disabled={lotChecks[l.id]?.state === "checking"}
                        onClick={() => checkLot(l.id, l.lotCode)}
                      >
                        <ShieldCheck size={15} /> Kiểm tra thông tin lô hàng
                      </button>
                      {lotChecks[l.id] && (
                        <div
                          className={
                            "lot-result " +
                            (lotChecks[l.id].state === "valid"
                              ? "verified"
                              : lotChecks[l.id].state === "invalid"
                                ? "unverified"
                                : "")
                          }
                          role="status"
                        >
                          <strong>{lotChecks[l.id].message}</strong>
                          {lotChecks[l.id].checkedAt && (
                            <small>
                              Kiểm tra lúc{" "}
                              {new Date(
                                lotChecks[l.id].checkedAt!,
                              ).toLocaleString("vi-VN")}
                              . Thông tin có hiệu lực đến{" "}
                              {new Date(
                                lotChecks[l.id].expiresAt!,
                              ).toLocaleString("vi-VN")}
                              .
                            </small>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p>Chưa công bố thông tin lô.</p>
                )}
                <details className="verification-details">
                  <summary>Xem phạm vi xác minh</summary>
                  <p>
                    Đơn vị xác nhận của hệ thống do Bản Vị Việt vận hành. Kết
                    quả cho biết dữ liệu lô đã ký đáp ứng điều kiện vùng được
                    công bố; đây không phải chứng nhận của cơ quan nhà nước và
                    không chứng minh trực tiếp nguồn gốc vật lý.
                  </p>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
      <section className="related-products" aria-labelledby="related-heading">
        <div className="section-heading">
          <h2 id="related-heading">Thêm một chút thân quen</h2>
          <Link className="text-link" to="/cua-hang#thuc-qua">
            Xem cửa hàng <ArrowRight size={16} />
          </Link>
        </div>
        <div className="product-grid">
          {related.data?.products
            .filter(
              (item) => item.id !== p.id && item.category.id === p.category.id,
            )
            .slice(0, 4)
            .map((item) => (
              <Card key={item.id} p={item} onAdd={onAdd} />
            ))}
        </div>
      </section>
    </section>
  );
}
function CartPage({
  user,
  onCount,
  notify,
}: {
  user: User | null;
  onCount: () => void;
  notify: (s: string) => void;
}) {
  const confirmAction = useConfirmation();
  const nav = useNavigate();
  const { data, error, reload } = useData<Cart & { quote: string }>("/cart");
  const addressData = useData<Address[]>("/me/addresses");
  const [addressId, setAddress] = useState(""),
    [addressPickerOpen, setAddressPickerOpen] = useState(false),
    [draftAddressId, setDraftAddressId] = useState(""),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState(""),
    [ageVerification, setAgeVerification] =
      useState<AgeVerificationResult | null>(null),
    [verificationTiming, setVerificationTiming] = useState(""),
    [proofStatus, setProofStatus] = useState(""),
    [missingCredential, setMissingCredential] = useState(false),
    [popupBlocked, setPopupBlocked] = useState(false);
  const key = useRef(crypto.randomUUID());
  const verificationGuard = useRef(false);
  const verificationPopup = useRef<Window | null>(null);
  const verificationAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      verificationAbort.current?.abort();
      const popup = verificationPopup.current;
      if (popup && !popup.closed) popup.close();
      verificationPopup.current = null;
    },
    [],
  );
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, [data?.quote, addressId]);
  useEffect(() => {
    if (!addressData.data) return;
    setAddress((current) => preferredAddressId(addressData.data!, current));
  }, [addressData.data]);
  const selectedAddress =
    addressData.data?.find((address) => address.id === addressId) ?? null;
  function openAddressPicker() {
    setDraftAddressId(
      addressId || preferredAddressId(addressData.data ?? [], ""),
    );
    setAddressPickerOpen(true);
  }
  function applyAddress() {
    if (!draftAddressId) return;
    setAddress(draftAddressId);
    setAddressPickerOpen(false);
  }
  const restricted = Boolean(data && cartRequiresAgeProof(data.items));
  useEffect(() => {
    if (!user || !data || !restricted) {
      if (data && !restricted) setAgeVerification(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    api<AgeVerificationResult | null>(
      "/age/verifications/current",
      "GET",
      undefined,
      {
        signal: controller.signal,
        timeoutMs: 10_000,
      },
    )
      .then((verification) => {
        if (!active) return;
        if (verification) {
          setAgeVerification(verification);
          setVerificationTiming(
            "Đã khôi phục kết quả xác minh còn hiệu lực cho giỏ hàng này.",
          );
        }
      })
      .catch((reason) => {
        if (active && (reason as Error).name !== "AbortError")
          setErr(
            "Chưa thể kiểm tra kết quả xác minh trước đó. Bạn vẫn có thể thử xác minh lại.",
          );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [user?.id, data?.quote, restricted]);
  if (!user) return <AuthPrompt />;
  if (!data) return <Loading error={error} retry={reload} />;
  function invalidateAgeVerification(showMessage = true) {
    if (ageVerification && showMessage)
      setErr("Thông tin đơn hàng đã thay đổi. Vui lòng xác minh lại độ tuổi.");
    setAgeVerification(null);
    setVerificationTiming("");
  }
  async function change(id: string, quantity: number) {
    try {
      invalidateAgeVerification();
      await api(
        "/cart/items/" + id,
        quantity ? "PATCH" : "DELETE",
        quantity ? { quantity } : undefined,
      );
      reload();
      onCount();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function verifyAge() {
    if (!addressId)
      return setErr("Hãy chọn địa chỉ nhận hàng trước khi xác minh độ tuổi.");
    if (!tryBeginAgeVerification(verificationGuard)) return;
    setBusy(true);
    setErr("");
    setMissingCredential(false);
    setPopupBlocked(false);
    setProofStatus("Đang khởi tạo phiên xác minh an toàn…");
    let popup: Window | null = null;
    let challenge: AgeChallenge | null = null;
    const controller = new AbortController();
    verificationAbort.current = controller;
    try {
      // Mở đồng bộ từ thao tác bấm để trình duyệt không chặn popup.
      popup = openWalletPopup();
      verificationPopup.current = popup;
      challenge = await api<AgeChallenge>(
        "/age/challenges",
        "POST",
        {},
        {
          signal: controller.signal,
          timeoutMs: 15_000,
        },
      );
      if (controller.signal.aborted) throw new WalletFlowAbortedError();
      setProofStatus("Đang chờ bạn xác nhận trong Ví…");
      const walletResponse = await requestProofFromWallet(
        challenge,
        popup,
        controller.signal,
      );
      setProofStatus("Đang kiểm tra kết quả xác minh…");
      const verified = await api<AgeVerificationResult>(
        "/age/verifications",
        "POST",
        walletResponse.proofBundle,
        { signal: controller.signal, timeoutMs: 30_000 },
      );
      if (verified.challengeId !== challenge.id)
        throw new Error("Kết quả không thuộc yêu cầu xác minh đang chờ.");
      if (!mounted.current) return;
      setAgeVerification(verified);
      const cacheLabel =
        walletResponse.timings.cache === "cold" ? "cache lạnh" : "cache ấm";
      setVerificationTiming(
        `${cacheLabel} · tải WASM: ${Math.round(walletResponse.timings.wasmLoadMs)} ms · tải zkey: ${Math.round(walletResponse.timings.zkeyLoadMs)} ms · tạo witness + proof: ${Math.round(walletResponse.timings.proofMs)} ms · Ví: ${Math.round(walletResponse.timings.walletTotalMs)} ms · API verify: ${Math.round(verified.serverVerificationMs ?? 0)} ms · tổng sau đồng ý: ${Math.max(0, Date.now() - walletResponse.timings.consentedAtEpochMs)} ms`,
      );
      if (!popup.closed) popup.close();
    } catch (e) {
      if (popup && !popup.closed) popup.close();
      if (!mounted.current || e instanceof WalletFlowAbortedError) return;
      if (
        (e instanceof ApiTimeoutError || (e as Error).name === "TypeError") &&
        challenge
      ) {
        try {
          const recovered = await api<AgeVerificationResult | null>(
            "/age/verifications/current",
            "GET",
            undefined,
            { timeoutMs: 10_000 },
          );
          if (mounted.current && recovered?.challengeId === challenge.id) {
            setAgeVerification(recovered);
            setVerificationTiming(
              "Máy chủ đã xác nhận kết quả cho giỏ hàng này.",
            );
            setErr("");
            return;
          }
        } catch {
          /* Giữ lỗi ban đầu nếu không thể khôi phục. */
        }
      }
      setAgeVerification(null);
      setVerificationTiming("");
      if (e instanceof WalletResponseError && e.code === "NO_CREDENTIAL") {
        setMissingCredential(true);
        setErr("Bạn chưa có thông tin xác minh tuổi trong Ví.");
      } else if (
        e instanceof WalletResponseError &&
        e.code === "USER_REJECTED"
      ) {
        setErr("Bạn đã từ chối yêu cầu xác minh trong Ví.");
      } else if (
        e instanceof WalletResponseError &&
        e.code === "PROOF_FAILED"
      ) {
        setErr(
          "Ví chưa thể hoàn tất xác minh. Hãy kiểm tra thông tin trong Ví và thử lại.",
        );
      } else if (e instanceof WalletPopupBlockedError) {
        setPopupBlocked(true);
        setErr(e.message);
      } else if (e instanceof ApiTimeoutError) {
        setErr(
          "Không nhận được phản hồi từ máy chủ xác minh. Vui lòng thử lại.",
        );
      } else if (e instanceof ApiError && e.code === "CHALLENGE_EXPIRED") {
        setErr("Yêu cầu xác minh đã hết hạn. Vui lòng thử lại.");
      } else if (
        e instanceof ApiError &&
        [
          "PROOF_INVALID",
          "PUBLIC_SIGNALS_INVALID",
          "ISSUER_SIGNATURE_INVALID",
        ].includes(e.code)
      ) {
        setErr("Kết quả xác minh không hợp lệ. Vui lòng thử lại từ Ví.");
      } else if (e instanceof ApiError && e.code === "CART_CHANGED") {
        setErr("Giỏ hàng đã thay đổi. Vui lòng xác minh lại.");
      } else if (
        e instanceof ApiError &&
        ["CREDENTIAL_LIFECYCLE_INVALID", "CREDENTIAL_EXPIRED"].includes(e.code)
      ) {
        setErr(
          "Thông tin xác minh trong Ví đã hết hạn hoặc bị thu hồi. Vui lòng nhận thông tin mới.",
        );
      } else if (e instanceof ApiError && e.status >= 500) {
        setErr("Không kết nối được API xác minh. Vui lòng thử lại.");
      } else setErr((e as Error).message);
    } finally {
      verificationGuard.current = false;
      verificationAbort.current = null;
      verificationPopup.current = null;
      if (mounted.current) {
        setBusy(false);
        setProofStatus("");
      }
    }
  }
  async function checkout() {
    setBusy(true);
    setErr("");
    try {
      if (restricted && !ageVerification)
        throw new Error("Hãy xác minh đủ tuổi bằng Ví ZKP trước khi đặt hàng.");
      const o = await api<Order>("/orders", "POST", {
        addressId,
        idempotencyKey: key.current,
        quote: data!.quote,
        ...(ageVerification
          ? { ageVerificationId: ageVerification.verificationId }
          : {}),
      });
      onCount();
      notify("Đơn hàng đã được ghi nhận");
      nav("/don-hang/" + o.id);
    } catch (e) {
      if (
        e instanceof ApiError &&
        [
          "CART_CHANGED",
          "AGE_PROOF_EXPIRED",
          "AGE_VERIFICATION_NOT_FOUND",
          "AGE_PROOF_REPLAY",
          "ISSUER_NOT_TRUSTED",
        ].includes(e.code)
      )
        invalidateAgeVerification(false);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setProofStatus("");
    }
  }
  return (
    <section className="section">
      <div className="eyebrow">MANG CHÚT VIỆT VỀ NHÀ</div>
      <h1 className="page-title">Giỏ hàng của bạn</h1>
      <div className="checkout-steps">
        <b>01 · Giỏ hàng</b>
        <span>02 · Giao nhận & xác minh</span>
        <span>03 · Xác nhận đơn COD</span>
      </div>
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
      {!data.items.length ? (
        <div className="empty">
          <ShoppingBag size={40} />
          <h2>Giỏ hàng còn đang chờ một thức quà</h2>
          <Link className="button" to="/">
            Khám phá sản phẩm <ArrowRight size={18} />
          </Link>
        </div>
      ) : (
        <div className="checkout-layout">
          <div className="checkout-main">
            <section className="panel checkout-flow-section">
              <div className="flow-heading">
                <span>1</span>
                <div>
                  <h3>
                    <MapPin size={20} /> Địa chỉ nhận hàng
                  </h3>
                  <p>Chọn nơi bạn muốn nhận đơn.</p>
                </div>
              </div>
              {addressData.error && (
                <p className="error">{addressData.error}</p>
              )}
              {selectedAddress ? (
                <div className="selected-address-card">
                  <div>
                    <strong>{selectedAddress.name}</strong>
                    {selectedAddress.isDefault && (
                      <span className="address-default-badge">Mặc định</span>
                    )}
                  </div>
                  <span>{selectedAddress.phone}</span>
                  <p>
                    {selectedAddress.line}, {selectedAddress.city}
                  </p>
                </div>
              ) : (
                <div className="address-empty-state">
                  <MapPin size={28} />
                  <div>
                    <strong>Chưa có địa chỉ nhận hàng</strong>
                    <p>Thêm địa chỉ để tiếp tục đặt đơn.</p>
                  </div>
                </div>
              )}
              {selectedAddress ? (
                <button
                  type="button"
                  className="text-button address-change"
                  onClick={openAddressPicker}
                >
                  Thay đổi địa chỉ
                </button>
              ) : (
                <Link className="button" to="/dia-chi">
                  Thêm địa chỉ nhận hàng <ArrowRight size={16} />
                </Link>
              )}
            </section>

            <section className="checkout-flow-section">
              <div className="flow-heading">
                <span>2</span>
                <div>
                  <h3>Sản phẩm trong đơn</h3>
                  <p>{data.items.length} sản phẩm đã chọn</p>
                </div>
              </div>
              <div className="cart-list">
                {data.items.map((i) => (
                  <article className="cart-item" key={i.product.id}>
                    <Link to={"/san-pham/" + i.product.slug}>
                      <Art
                        kind={i.product.art}
                        name={i.product.name}
                        tone={i.product.tone}
                      />
                    </Link>
                    <div className="cart-item-copy">
                      <Link to={"/san-pham/" + i.product.slug}>
                        {i.product.name}
                      </Link>
                      <small>
                        {i.product.weight}
                        {i.product.requiresAgeProof ? " · Yêu cầu 18+" : ""}
                      </small>
                      <div className="quantity">
                        <button
                          aria-label={"Giảm " + i.product.name}
                          disabled={busy}
                          onClick={() => change(i.product.id, i.quantity - 1)}
                        >
                          <Minus size={14} />
                        </button>
                        <span>{i.quantity}</span>
                        <button
                          aria-label={"Tăng " + i.product.name}
                          disabled={busy || i.quantity >= i.product.stock}
                          onClick={() => change(i.product.id, i.quantity + 1)}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="cart-price">
                      <strong>
                        {money(
                          (
                            BigInt(i.product.price) * BigInt(i.quantity)
                          ).toString(),
                        )}
                      </strong>
                      <small>{money(i.product.price)} / sản phẩm</small>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirmAction({
                              title: `Xóa ${i.product.name} khỏi giỏ hàng?`,
                            })
                          )
                            change(i.product.id, 0);
                        }}
                      >
                        <Trash2 size={14} /> Xóa
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel checkout-flow-section payment-panel">
              <div className="flow-heading">
                <span>3</span>
                <div>
                  <h3>
                    <CreditCard size={20} /> Phương thức thanh toán
                  </h3>
                  <p>Thanh toán bằng tiền mặt khi nhận hàng.</p>
                </div>
              </div>
              <div className="payment selected-payment">
                <Truck size={23} />
                <span>
                  <b>Thanh toán khi nhận hàng</b>
                  <small>COD · Không thu tiền khi đặt đơn</small>
                </span>
                <Check size={16} />
              </div>
            </section>

            <section
              className={
                "checkout-flow-section age-checkout " +
                (restricted ? "required" : "optional")
              }
            >
              <div className="flow-heading">
                <span>4</span>
                <div>
                  <h3>
                    <ShieldCheck size={20} /> Xác minh điều kiện tuổi
                  </h3>
                  <p>
                    {restricted
                      ? "Đơn hàng có sản phẩm dành cho người đủ 18 tuổi."
                      : "Đơn hàng này không cần xác minh tuổi."}
                  </p>
                </div>
              </div>
              {restricted ? (
                <div className="age-checkout-body">
                  <p>
                    Ví xác minh tuổi chạy ở cửa sổ riêng và chỉ gửi kết quả cần
                    thiết sau khi bạn đồng ý. Một lần xác minh áp dụng cho toàn
                    bộ đơn hàng này.
                  </p>
                  <div className="credential-picker">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={verifyAge}
                    >
                      <ShieldCheck size={18} />
                      {ageVerification
                        ? "Xác minh lại điều kiện tuổi"
                        : "Xác minh điều kiện tuổi"}
                    </button>
                    {ageVerification && (
                      <small className="credential-ok" role="status">
                        <CircleCheck size={16} /> Đã xác minh điều kiện tuổi cho
                        đơn hàng này
                      </small>
                    )}
                  </div>
                  {missingCredential && (
                    <div className="verification-help">
                      <p>Bạn chưa có thông tin xác minh tuổi trong Ví.</p>
                      <Link
                        className="button secondary"
                        to="/tai-khoan#age-verification-management"
                      >
                        Xem hướng dẫn nhận thông tin xác minh
                      </Link>
                    </div>
                  )}
                  {popupBlocked && (
                    <div className="verification-help">
                      <p>
                        Hãy cho phép cửa sổ bật lên cho địa chỉ Website này
                        trong cài đặt trình duyệt, sau đó bấm lại “Xác minh điều
                        kiện tuổi”.
                      </p>
                    </div>
                  )}
                  {proofStatus && (
                    <div className="verification-progress" role="status">
                      <span className="spinner" /> {proofStatus}
                    </div>
                  )}
                  <details className="verification-details">
                    <summary>Xem thông tin riêng tư và kỹ thuật</summary>
                    <p>
                      Website chỉ nhận kết quả công khai cần để kiểm tra và
                      không nhận ngày sinh, dữ liệu bí mật hoặc dữ liệu trung
                      gian dùng để tạo bằng chứng.
                    </p>
                    {verificationTiming && (
                      <p className="technical-timing">{verificationTiming}</p>
                    )}
                  </details>
                </div>
              ) : (
                <p className="credential-ok">
                  <CircleCheck size={16} /> Bạn có thể tiếp tục đặt hàng COD.
                </p>
              )}
            </section>
          </div>
          <aside className="order-summary">
            <span className="eyebrow">5 · TỔNG TIỀN</span>
            <h2>Tóm tắt đơn hàng</h2>
            <div>
              <span>Tạm tính</span>
              <strong>{money(data.total)}</strong>
            </div>
            <div>
              <span>Phí giao hàng</span>
              <span>Miễn phí</span>
            </div>
            <div className="summary-total">
              <span>Tổng thanh toán</span>
              <strong>{money(data.total)}</strong>
            </div>
            <BusyButton
              className="button full"
              busy={busy}
              busyLabel={proofStatus || "Đang đặt đơn…"}
              disabled={busy || !addressId || (restricted && !ageVerification)}
              onClick={checkout}
            >
              Xác nhận đặt hàng
              <ArrowRight size={18} />
            </BusyButton>
            {!addressId ? (
              <p className="checkout-gate" role="status">
                Chọn địa chỉ nhận hàng để tiếp tục.
              </p>
            ) : restricted && !ageVerification ? (
              <p className="checkout-gate" role="status">
                Hoàn tất xác minh điều kiện tuổi trước khi đặt đơn.
              </p>
            ) : (
              <p className="checkout-ready" role="status">
                Đơn hàng đã sẵn sàng để xác nhận.
              </p>
            )}
            <p className="muted small">
              Giá và tồn kho được cửa hàng kiểm tra lại ngay trước khi ghi nhận
              đơn hàng.
            </p>
            <Link className="back-link" to="/">
              <ArrowLeft size={15} /> Tiếp tục chọn quà
            </Link>
          </aside>
          {addressPickerOpen && (
            <div
              className="checkout-modal-backdrop"
              role="presentation"
              onMouseDown={() => setAddressPickerOpen(false)}
            >
              <section
                className="checkout-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="address-picker-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="checkout-modal-heading">
                  <div>
                    <span className="eyebrow">GIAO HÀNG</span>
                    <h2 id="address-picker-title">Chọn địa chỉ nhận hàng</h2>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Đóng"
                    onClick={() => setAddressPickerOpen(false)}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="address-options">
                  {addressData.data?.map((address) => (
                    <label
                      className={
                        "address-choice " +
                        (draftAddressId === address.id ? "selected" : "")
                      }
                      key={address.id}
                    >
                      <input
                        type="radio"
                        name="checkout-address"
                        checked={draftAddressId === address.id}
                        onChange={() => setDraftAddressId(address.id)}
                      />
                      <span>
                        <strong>
                          {address.name} · {address.phone}
                        </strong>
                        <small>
                          {address.line}, {address.city}
                        </small>
                        {address.isDefault && <em>Mặc định</em>}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="checkout-modal-actions">
                  <Link className="text-link" to="/dia-chi">
                    Quản lý hoặc thêm địa chỉ
                  </Link>
                  <button
                    className="button"
                    disabled={!draftAddressId}
                    onClick={applyAddress}
                  >
                    Sử dụng địa chỉ này
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
function AuthPrompt() {
  return (
    <div className="empty">
      <UserRound size={38} />
      <h2>Mời bạn đăng nhập</h2>
      <p>Giỏ hàng, địa chỉ và đơn hàng được lưu theo tài khoản.</p>
      <Link className="button" to="/dang-nhap">
        Đăng nhập <ArrowRight size={17} />
      </Link>
    </div>
  );
}
function Auth({
  register,
  onUser,
}: {
  register?: boolean;
  onUser: (u: User) => void;
}) {
  const nav = useNavigate(),
    [params] = useSearchParams(),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const submitting = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ user: User }>(
        "/auth/" + (register ? "register" : "login"),
        "POST",
        field(e.currentTarget),
      );
      onUser(r.user);
      const returnUrl = params.get("returnUrl");
      nav(
        returnUrl?.startsWith("/") &&
          !returnUrl.startsWith("//") &&
          !/[\\\x00-\x1f]/.test(returnUrl)
          ? returnUrl
          : "/",
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="auth-layout section">
      <div className="auth-story">
        <span className="eyebrow">BẢN VỊ VIỆT</span>
        <h1>
          Một chỗ nhỏ
          <br />
          cho những
          <br />
          <em>điều thân quen.</em>
        </h1>
        <Leaf size={60} />
        <p>
          Lưu những lựa chọn của bạn.
          <br />
          Gửi những món quà đến đúng người thương.
        </p>
      </div>
      <form className="form-panel" onSubmit={submit} aria-busy={busy}>
        <span className="eyebrow">CHÀO BẠN GHÉ THĂM</span>
        <h2>{register ? "Tạo tài khoản" : "Mừng bạn trở lại"}</h2>
        <p>
          {register
            ? "Đăng ký để bắt đầu chọn quà."
            : "Đăng nhập để tiếp tục mua sắm."}
        </p>
        {err && (
          <p className="error" role="alert">
            {err}
          </p>
        )}
        {register && (
          <label>
            Họ và tên
            <input
              name="name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
            />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <PasswordField label="Mật khẩu"
            name="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete={register ? "new-password" : "current-password"}
          />
        {register && (
          <small className="muted">
            Dùng ít nhất 10 ký tự và không sử dụng lại mật khẩu ở dịch vụ khác.
          </small>
        )}
        <BusyButton className="button full" busy={busy} busyLabel="Đang xử lý…" disabled={busy}>
          {register ? "Đăng ký" : "Đăng nhập"}
          <ArrowRight size={18} />
        </BusyButton>
        <p className="small">
          {register ? "Đã có tài khoản?" : "Lần đầu ghé thăm?"}{" "}
          <Link to={(register ? "/dang-nhap" : "/dang-ky") + (params.toString() ? "?" + params.toString() : "")}>
            {register ? "Đăng nhập" : "Tạo tài khoản"}
          </Link>
        </p>
      </form>
    </section>
  );
}
function CredentialRequestPanel() {
  const {
    data: latest,
    error,
    reload,
  } = useData<AgeCredentialStatus | null>("/me/age-credential-status");
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  useEffect(() => {
    const refetch = () => reload();
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, []);
  async function createRequest() {
    setBusy(true);
    setCreateError("");
    try {
      const request = await api<AgeCredentialStatus>(
        "/me/age-credential-requests",
        "POST",
        {},
      );
      window.location.assign(
        issuerPortalOrigin() + "/submit-age/" + encodeURIComponent(request.id),
      );
    } catch (reason) {
      setCreateError((reason as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="panel" id="age-verification-management">
      <span className="eyebrow">XÁC MINH ĐỘ TUỔI</span>
      <h2>Yêu cầu xác minh tuổi</h2>
      <p>
        Theo dõi yêu cầu xác minh tuổi và nhận thông tin xác minh khi Issuer
        hoàn tất xử lý.
      </p>
      {error && <p className="error">{error}</p>}
      {createError && <p className="error">{createError}</p>}
      {latest && (
        <div className="age-request-summary">
          <p>
            <strong>Mã yêu cầu: {latest.id.slice(0, 8).toUpperCase()}</strong>
            <br />
            <small>
              Gửi lúc {new Date(latest.createdAt).toLocaleString("vi-VN")}
            </small>
            <br />
            <small>
              Trạng thái:{" "}
              {latest.status === "PENDING"
                ? latest.recordSubmitted
                  ? "Đã gửi hồ sơ – đang chờ xử lý"
                  : "Chưa cung cấp hồ sơ"
                : latest.status === "ISSUED" && latest.walletReceived
                  ? "Đã nhận vào Ví"
                  : ageStatusCopy[latest.status]}
            </small>
          </p>
          <Link className="button secondary" to={ageDetailPath(latest.id)}>
            Xem chi tiết
          </Link>
          {latest.status === "PENDING" && !latest.recordSubmitted && (
            <a
              className="button"
              href={
                issuerPortalOrigin() +
                "/submit-age/" +
                encodeURIComponent(latest.id)
              }
            >
              Tiếp tục cung cấp hồ sơ
            </a>
          )}
        </div>
      )}
      {!latest && (
        <BusyButton
          className="button"
          busy={busy}
          busyLabel="Đang gửi yêu cầu…"
          disabled={busy}
          onClick={() => void createRequest()}
        >
          Gửi yêu cầu xác minh
        </BusyButton>
      )}
    </div>
  );
}

function AgeVerificationDetail({ user }: { user: User | null }) {
  const { id = "" } = useParams();
  const [request, setRequest] = useState<AgeCredentialStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      setRequest(
        await api<AgeCredentialStatus>("/me/age-credential-requests/" + id),
      );
      setError("");
    } catch (reason) {
      setRequest(null);
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [id, user?.id]);
  useEffect(() => {
    if (!user) return;
    const refetch = () => void refresh();
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [id, user?.id]);
  useEffect(() => {
    if (!user || !request || terminalAgeStatus(request.status)) return;
    return startAgePolling(() => void refresh());
  }, [id, request?.status, user?.id]);

  if (!user) return <AuthPrompt />;

  const stages = ["PENDING", "APPROVED", "ISSUING", "ISSUED"] as const;
  const position = request
    ? stages.indexOf(request.status as (typeof stages)[number])
    : -1;
  return (
    <section className="section age-verification-detail">
      <span className="eyebrow">TÀI KHOẢN · XÁC MINH ĐỘ TUỔI</span>
      <h1 className="page-title">Tiến trình yêu cầu AGE</h1>
      <p>
        Hồ sơ được đối chiếu ngoài Website. Bản Vị Việt không thu thập ảnh giấy
        tờ hoặc ngày sinh.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {request && (
        <div className="panel">
          <div className="age-detail-meta">
            <div>
              <small>Mã yêu cầu</small>
              <strong>{request.id.slice(0, 8).toUpperCase()}</strong>
            </div>
            <div>
              <small>Thời gian gửi</small>
              <strong>
                {new Date(request.createdAt).toLocaleString("vi-VN")}
              </strong>
            </div>
            <div>
              <small>Trạng thái</small>
              <strong>
                {request.status === "PENDING"
                  ? request.recordSubmitted
                    ? "Đã gửi hồ sơ – đang chờ xử lý"
                    : "Chưa cung cấp hồ sơ"
                  : request.status === "ISSUED" && request.walletReceived
                    ? "Đã nhận vào Ví"
                    : ageStatusCopy[request.status]}
              </strong>
            </div>
          </div>
          <ol className="age-progress">
            {stages.map((stage, index) => (
              <li className={index <= position ? "done" : ""} key={stage}>
                <span>{index + 1}</span>
                <div>
                  <strong>{stage}</strong>
                  <small>{ageStatusCopy[stage]}</small>
                </div>
              </li>
            ))}
          </ol>
          <div className="age-detail-guidance">
            <strong>Hướng dẫn</strong>
            <p>
              {request.status === "ISSUED" && request.walletReceived
                ? "Thông tin xác minh đã được lưu trong Ví. Hiệu lực vẫn được kiểm tra lại khi bạn sử dụng tại checkout."
                : ageStatusCopy[request.status]}
            </p>
          </div>
          <div className="age-detail-actions">
            {request.status === "PENDING" && !request.recordSubmitted && (
              <a
                className="button"
                href={
                  issuerPortalOrigin() +
                  "/submit-age/" +
                  encodeURIComponent(request.id)
                }
              >
                Tiếp tục cung cấp hồ sơ
              </a>
            )}
            {!terminalAgeStatus(request.status) && (
              <BusyButton
                className="button secondary"
                busy={busy}
                busyLabel="Đang cập nhật…"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Cập nhật trạng thái
              </BusyButton>
            )}
            {request.status === "ISSUED" && !request.walletReceived && (
              <a
                className="button"
                href={issuerReceiveUrl(issuerPortalOrigin(), request.id)}
              >
                Tiếp tục nhận tại Issuer
              </a>
            )}
            <Link className="text-link" to="/tai-khoan">
              Quay lại tài khoản
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function Account({ user }: { user: User | null }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  if (!user) return <AuthPrompt />;
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = field(form) as Record<string, string>;
    setError("");
    setMessage("");
    if (values.newPassword !== values.confirmPassword)
      return setError("Mật khẩu nhập lại chưa khớp.");
    setBusy(true);
    try {
      await api("/me/password", "PATCH", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.reset();
      setMessage("Mật khẩu đã được cập nhật.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section account-page">
      <span className="eyebrow">TÀI KHOẢN CỦA BẠN</span>
      <h1 className="page-title">Thông tin tài khoản</h1>
      <div className="two-column account-grid">
        <div className="panel profile-card">
          <div className="profile-avatar" aria-hidden="true">
            {displayName(user.name).slice(0, 1).toLocaleUpperCase("vi")}
          </div>
          <div>
            <small>Họ và tên</small>
            <h2>{displayName(user.name)}</h2>
            <p>
              <Mail size={16} /> {user.email}
            </p>
          </div>
          <div className="account-links">
            <Link to="/dia-chi">
              <MapPin size={17} /> Quản lý địa chỉ
            </Link>
            <Link to="/don-hang">
              <Package size={17} /> Theo dõi đơn hàng
            </Link>
          </div>
        </div>
        <form className="form-panel" onSubmit={changePassword}>
          <span className="eyebrow">BẢO MẬT TÀI KHOẢN</span>
          <h2>Đổi mật khẩu</h2>
          <p>Mật khẩu mới cần có ít nhất 10 ký tự.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && <Notice>{message}</Notice>}
          <PasswordField label="Mật khẩu hiện tại"
              name="currentPassword"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          <PasswordField label="Mật khẩu mới"
              name="newPassword"
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
            />
          <PasswordField label="Nhập lại mật khẩu mới"
              name="confirmPassword"
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
            />
          <BusyButton className="button full" busy={busy} busyLabel="Đang cập nhật…" disabled={busy}>
            <LockKeyhole size={17} />
            Cập nhật mật khẩu
          </BusyButton>
        </form>
      </div>
      <CredentialRequestPanel />
    </section>
  );
}
function Addresses({ user }: { user: User | null }) {
  const confirmAction = useConfirmation();
  const { data, error, reload } = useData<Address[]>("/me/addresses");
  const [edit, setEdit] = useState<Address | null>(null),
    [err, setErr] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  if (!user) return <AuthPrompt />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setErr("");
    setMessage("");
    try {
      await api(
        "/me/addresses" + (edit ? "/" + edit.id : ""),
        edit ? "PATCH" : "POST",
        field(form),
      );
      form.reset();
      setEdit(null);
      reload();
      setMessage(edit ? "Đã cập nhật địa chỉ." : "Đã thêm địa chỉ mới.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <span className="eyebrow">TÀI KHOẢN CỦA BẠN</span>
      <h1 className="page-title">Gửi đến một nơi thân quen</h1>
      <div className="two-column">
        <div>
          {error && <p className="error">{error}</p>}
          {message && <Notice>{message}</Notice>}
          {data?.map((a) => (
            <article className="panel" key={a.id}>
              <h3>{displayName(a.name)}</h3>
              <p>
                {a.phone}
                <br />
                {a.line}, {a.city}
              </p>
              <button className="text-button" onClick={() => setEdit(a)}>
                Chỉnh sửa
              </button>
              <button
                className="text-button danger"
                onClick={async () => {
                  if (
                    !(await confirmAction({
                      title: `Xóa địa chỉ của ${a.name}?`,
                    }))
                  )
                    return;
                  try {
                    await api("/me/addresses/" + a.id, "DELETE");
                    reload();
                    setMessage("Đã xóa địa chỉ.");
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                Xóa
              </button>
            </article>
          ))}
          {data?.length === 0 && (
            <Notice>Thêm địa chỉ đầu tiên để đặt hàng COD.</Notice>
          )}
          <Link className="text-link" to="/gio-hang">
            Về giỏ hàng <ArrowRight size={16} />
          </Link>
        </div>
        <form className="form-panel" key={edit?.id || "new"} onSubmit={submit}>
          <h2>{edit ? "Chỉnh sửa địa chỉ" : "Thêm địa chỉ"}</h2>
          {err && (
            <p className="error" role="alert">
              {err}
            </p>
          )}
          <label>
            Người nhận
            <input
              name="name"
              defaultValue={edit?.name}
              required
              maxLength={80}
            />
          </label>
          <label>
            Số điện thoại
            <input
              name="phone"
              defaultValue={edit?.phone}
              required
              pattern="[0-9+ ()-]{8,20}"
            />
          </label>
          <label>
            Địa chỉ cụ thể
            <input
              name="line"
              defaultValue={edit?.line}
              required
              minLength={5}
              maxLength={250}
            />
          </label>
          <label>
            Tỉnh / thành phố
            <input
              name="city"
              defaultValue={edit?.city}
              required
              maxLength={80}
            />
          </label>
          <button className="button" disabled={busy}>
            Lưu địa chỉ <Check size={17} />
          </button>
          {edit && (
            <button
              type="button"
              className="text-button"
              onClick={() => setEdit(null)}
            >
              Hủy chỉnh sửa
            </button>
          )}
        </form>
      </div>
    </section>
  );
}
function Orders({
  user,
  detail = false,
}: {
  user: User | null;
  detail?: boolean;
}) {
  const confirmAction = useConfirmation();
  const { id } = useParams(),
    { data, error, reload } = useData<any>(
      detail ? "/me/orders/" + id : "/me/orders",
    );
  const [err, setErr] = useState("");
  if (!user) return <AuthPrompt />;
  if (!data) return <Loading error={error} retry={reload} />;
  const list: Order[] = detail ? [data] : data;
  return (
    <section className="section">
      <span className="eyebrow">NHỮNG MÓN QUÀ ĐÃ CHỌN</span>
      <h1 className="page-title">
        {detail ? "Chi tiết đơn hàng" : "Đơn hàng của bạn"}
      </h1>
      {err && <p className="error">{err}</p>}
      {!list.length && (
        <div className="empty">
          <Package size={36} />
          <h2>Bạn chưa có đơn hàng</h2>
          <Link to="/" className="button">
            Chọn thức quà đầu tiên
          </Link>
        </div>
      )}
      {list.map((o) => (
        <article className="order-card" key={o.id}>
          <div className="order-header">
            <div>
              <Link to={"/don-hang/" + o.id}>
                <strong>{o.code}</strong>
              </Link>
              <small>{new Date(o.createdAt).toLocaleString("vi-VN")}</small>
            </div>
            <span className={"status status-" + o.status}>
              {status[o.status]}
            </span>
          </div>
          {o.items.map((i) => (
            <div className="order-line" key={i.id}>
              <span>
                {i.name} <small>× {i.quantity}</small>
                {i.lotCode && <small> · Lô {i.lotCode}</small>}
              </span>
              <b>
                {money((BigInt(i.unitPrice) * BigInt(i.quantity)).toString())}
              </b>
            </div>
          ))}
          <div className="order-total">
            COD · Tổng cộng <strong>{money(o.total)}</strong>
          </div>
          {detail && (
            <>
              <div className="two-column">
                <div>
                  <h3>Thông tin nhận hàng</h3>
                  <p>
                    {o.address.name} · {o.address.phone}
                    <br />
                    {o.address.line}, {o.address.city}
                  </p>
                  <p className="order-payment-copy">
                    <CreditCard size={16} /> Thanh toán khi nhận hàng (COD)
                  </p>
                </div>
                <div>
                  <h3>Lịch sử đơn hàng</h3>
                  {o.history.map((h, i) => (
                    <p className="history" key={i}>
                      <Check size={15} />
                      {status[h.status]}{" "}
                      <small>
                        {new Date(h.createdAt).toLocaleString("vi-VN")}
                      </small>
                    </p>
                  ))}
                </div>
              </div>
              <small className="muted">
                {o.status === "COMPLETED"
                  ? "Đơn hàng đã hoàn thành và được ghi nhận thanh toán COD."
                  : "Đơn hàng chưa ghi nhận thanh toán COD."}
              </small>
              {o.status === "PENDING" && (
                <button
                  className="text-button danger"
                  onClick={async () => {
                    if (!(await confirmAction({ title: "Hủy đơn hàng này?" })))
                      return;
                    try {
                      await api("/me/orders/" + o.id + "/cancel", "POST", {});
                      reload();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  Hủy đơn hàng
                </button>
              )}
            </>
          )}
        </article>
      ))}
    </section>
  );
}
function Admin({ user }: { user: User | null }) {
  const confirmAction = useConfirmation();
  const [tab, setTab] = useState(() =>
      new URLSearchParams(window.location.search).get("tab") === "lots"
        ? "lots"
        : "products",
    ),
    [edit, setEdit] = useState<any>(null),
    [err, setErr] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [adminQuery, setAdminQuery] = useState(""),
    [adminPage, setAdminPage] = useState(1);
  const { data, error, reload } = useData<any>("/admin/" + tab);
  const cats = useData<any>("/products");
  const adminProducts = useData<Product[]>("/admin/products");
  const normalizedAdminQuery = normalizeVietnameseSearch(adminQuery);
  const rows = Array.isArray(data)
    ? data.filter((row: any) => {
        if (!normalizedAdminQuery) return true;
        return normalizeVietnameseSearch(
          [
            row.name,
            row.slug,
            row.lotCode,
            row.code,
            row.email,
            row.status,
            row.product?.name,
            row.user?.email,
          ]
            .filter(Boolean)
            .join(" "),
        ).includes(normalizedAdminQuery);
      })
    : [];
  const adminPageSize = 6;
  const adminPageCount = Math.max(1, Math.ceil(rows.length / adminPageSize));
  const safeAdminPage = Math.min(adminPage, adminPageCount);
  const visibleRows = rows.slice(
    (safeAdminPage - 1) * adminPageSize,
    safeAdminPage * adminPageSize,
  );
  if (!user || user.role !== "ADMIN")
    return (
      <div className="empty">
        <h2>Khu vực quản trị</h2>
        <p>Bạn cần đăng nhập bằng tài khoản quản trị.</p>
        <Link className="button" to="/dang-nhap">
          Đăng nhập
        </Link>
      </div>
    );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMessage("");
    const f = field(e.currentTarget);
    let payload: any = f;
    if (tab === "products")
      payload = {
        ...f,
        stock: Number(f.stock),
        minimumAge: f.requiresAgeProof === "on" ? 18 : 0,
        requiresAgeProof: f.requiresAgeProof === "on",
        published: f.published === "on",
      };
    else if (tab === "lots") payload = { ...f, stock: Number(f.stock) };
    try {
      await api(
        "/admin/" + tab + (edit?.id ? "/" + edit.id : ""),
        edit?.id ? "PATCH" : "POST",
        payload,
      );
      setEdit(null);
      reload();
      cats.reload();
      adminProducts.reload();
      setMessage(edit?.id ? "Đã lưu thay đổi." : "Đã thêm mục mới.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <span className="eyebrow">QUẢN TRỊ BẢN VỊ VIỆT</span>
      <div className="section-heading">
        <h1 className="page-title">Chăm chút cửa hàng</h1>
        {tab !== "orders" && tab !== "users" && (
          <button
            className="button"
            disabled={busy}
            onClick={() => setEdit({})}
          >
            <Plus size={16} /> Thêm mới
          </button>
        )}
      </div>
      <div className="tabs admin-tabs">
        {[
          ["products", "Sản phẩm"],
          ["categories", "Danh mục"],
          ["lots", "Lô hàng"],
          ["orders", "Đơn hàng"],
          ["users", "Người dùng"],
        ].map(([v, t]) => (
          <button
            key={v}
            className={tab === v ? "active" : ""}
            disabled={busy}
            onClick={() => {
              setTab(v);
              setEdit(null);
              setErr("");
              setMessage("");
              setAdminQuery("");
              setAdminPage(1);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={adminQuery}
            onChange={(event) => {
              setAdminQuery(event.target.value);
              setAdminPage(1);
            }}
            placeholder="Tìm trong mục đang xem…"
            aria-label="Tìm trong dữ liệu quản trị"
          />
          {adminQuery && (
            <button
              type="button"
              className="icon"
              aria-label="Xóa tìm kiếm quản trị"
              onClick={() => {
                setAdminQuery("");
                setAdminPage(1);
              }}
            >
              <X size={15} />
            </button>
          )}
        </label>
        <span className="admin-count" role="status">
          {data ? `${rows.length} mục` : "Đang tải…"}
        </span>
      </div>
      {(err || error) && (
        <p className="error" role="alert">
          {err || error}
        </p>
      )}
      {message && <Notice>{message}</Notice>}
      {!data && !error && (
        <div className="admin-loading" role="status">
          <span className="spinner" /> Đang tải dữ liệu quản trị…
        </div>
      )}
      {edit && (
        <form
          className="form-panel admin-form"
          onSubmit={save}
          key={tab + (edit.id || "new")}
        >
          <h2>{edit.id ? "Chỉnh sửa" : "Thêm mới"}</h2>
          {tab === "products" ? (
            <>
              <label>
                Tên
                <input name="name" defaultValue={edit.name} required />
              </label>
              <label>
                Slug
                <input
                  name="slug"
                  defaultValue={edit.slug}
                  required
                  pattern="[a-z0-9-]+"
                />
              </label>
              <label>
                Dòng giới thiệu
                <input name="subtitle" defaultValue={edit.subtitle} required />
              </label>
              <label>
                Mô tả
                <textarea
                  name="description"
                  defaultValue={edit.description}
                  required
                />
              </label>
              <label>
                Giá (đồng)
                <input
                  name="price"
                  inputMode="numeric"
                  defaultValue={edit.price}
                  required
                  pattern="[0-9]+"
                />
              </label>
              <label>
                Tồn kho
                <input
                  name="stock"
                  type="number"
                  min="0"
                  max="1000000"
                  defaultValue={edit.stock || 0}
                  required
                />
              </label>
              <label>
                Quy cách
                <input name="weight" defaultValue={edit.weight} required />
              </label>
              <label>
                Địa phương
                <input name="origin" defaultValue={edit.origin} required />
              </label>
              <label>
                Danh mục
                <select name="categoryId" defaultValue={edit.categoryId}>
                  {cats.data?.categories.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Minh họa
                <select name="art" defaultValue={edit.art || "coffee"}>
                  {[
                    "coffee",
                    "tea",
                    "cashew",
                    "ginger",
                    "gift",
                    "cake",
                    "wine",
                    "ricewine",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Màu bao bì
                <input
                  type="color"
                  name="tone"
                  defaultValue={edit.tone || "#45664c"}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="requiresAgeProof"
                  defaultChecked={edit.requiresAgeProof}
                />{" "}
                Yêu cầu đủ 18 tuổi
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={edit.published ?? true}
                />{" "}
                Công bố sản phẩm
              </label>
            </>
          ) : tab === "categories" ? (
            <>
              <label>
                Tên danh mục
                <input name="name" defaultValue={edit.name} required />
              </label>
              <label>
                Slug
                <input
                  name="slug"
                  defaultValue={edit.slug}
                  required
                  pattern="[a-z0-9-]+"
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Sản phẩm
                <select
                  name="productId"
                  defaultValue={edit.productId}
                  disabled={!!edit.id}
                >
                  {adminProducts.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {edit.id && (
                <input type="hidden" name="productId" value={edit.productId} />
              )}
              <label>
                Mã lô
                <input
                  name="lotCode"
                  defaultValue={edit.lotCode}
                  required
                  pattern="[A-Z0-9-]+"
                />
              </label>
              <label>
                Trạng thái lô
                <select name="status" defaultValue={edit.status || "DRAFT"}>
                  <option value="DRAFT">Bản nháp</option>
                  <option value="ACTIVE">Đang vận hành</option>
                  <option value="ARCHIVED">Lưu trữ</option>
                </select>
              </label>
              <label>
                Tồn của lô
                <input
                  name="stock"
                  type="number"
                  min="0"
                  max="1000000"
                  defaultValue={edit.stock || 0}
                  required
                />
              </label>
              <Notice>
                Bằng chứng chỉ được ghi khi tệp công khai vượt qua kiểm tra chữ
                ký, liên kết lô, thời hạn, chính sách và Groth16 tại API. Form
                này không có cờ xác minh thủ công.
              </Notice>
            </>
          )}
          <div className="form-actions">
            <button className="button" disabled={busy}>
              Lưu thay đổi
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setEdit(null)}
            >
              Đóng
            </button>
          </div>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                {tab === "orders"
                  ? "Đơn hàng"
                  : tab === "users"
                    ? "Người dùng"
                    : tab === "lots"
                      ? "Mã lô"
                      : "Tên"}
              </th>
              <th>Thông tin</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <strong>
                    {tab === "users"
                      ? displayName(r.name)
                      : r.name || r.lotCode || r.code}
                  </strong>
                  <small>
                    {r.slug || r.product?.name || r.user?.email || r.email}
                  </small>
                </td>
                <td>
                  {tab === "products" ? (
                    <>
                      {money(r.price)}
                      <small>
                        Tồn: {r.stock} · {r.published ? "Công bố" : "Ẩn"}
                        {r.requiresAgeProof ? " · 18+" : ""}
                      </small>
                    </>
                  ) : tab === "orders" ? (
                    <>
                      {money(r.total)}
                      <small>{status[r.status]}</small>
                    </>
                  ) : tab === "lots" ? (
                    <>
                      {r.status} · tồn {r.stock}
                      <small>
                        {r.credentials?.[0]
                          ? `${r.credentials[0].status} · hết hạn ${new Date(
                              r.credentials[0].expiresAt,
                            ).toLocaleString("vi-VN")}`
                          : "Chưa có tệp xác minh lô"}
                      </small>
                    </>
                  ) : tab === "users" ? (
                    <>
                      {r.role === "ADMIN" ? "Quản trị viên" : "Khách hàng"}
                      <small>
                        {r._count.addresses} địa chỉ · {r._count.orders} đơn ·
                        tham gia{" "}
                        {new Date(r.createdAt).toLocaleDateString("vi-VN")}
                      </small>
                    </>
                  ) : (
                    "Danh mục sản phẩm"
                  )}
                </td>
                <td>
                  {tab === "orders" ? (
                    <select
                      aria-label={"Trạng thái " + r.code}
                      value={r.status}
                      disabled={busy}
                      onChange={async (e) => {
                        const nextStatus = e.target.value;
                        setBusy(true);
                        setErr("");
                        try {
                          await api(
                            "/admin/orders/" + r.id + "/status",
                            "PATCH",
                            { status: nextStatus },
                          );
                          reload();
                          setMessage("Đã cập nhật trạng thái đơn hàng.");
                        } catch (e) {
                          setErr((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"].map(
                        (v) => (
                          <option key={v} value={v}>
                            {status[v]}
                          </option>
                        ),
                      )}
                    </select>
                  ) : tab === "users" ? (
                    <span className="muted small">Thông tin tài khoản</span>
                  ) : (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setEdit(r)}
                      >
                        Sửa
                      </button>
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            !(await confirmAction({
                              title: "Xóa hoặc lưu trữ mục này?",
                              description:
                                "Kiểm tra mục đã chọn trước khi xác nhận.",
                            }))
                          )
                            return;
                          setBusy(true);
                          setErr("");
                          try {
                            await api("/admin/" + tab + "/" + r.id, "DELETE");
                            reload();
                            setMessage(
                              tab === "categories"
                                ? "Đã xóa danh mục."
                                : "Đã lưu trữ mục đã chọn.",
                            );
                          } catch (e) {
                            setErr((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {tab === "categories" ? "Xóa" : "Lưu trữ"}
                      </button>
                      {tab === "lots" && (
                        <>
                          <LotRequestAction lotId={r.id} />
                          <label
                            className={
                              "text-button proof-import " +
                              (busy ? "disabled" : "")
                            }
                          >
                            Nạp tệp xác minh lô
                            <input
                              type="file"
                              disabled={busy}
                              accept="application/json,.json"
                              onChange={async (event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (!file) return;
                                setErr("");
                                setBusy(true);
                                try {
                                  const bundle = JSON.parse(await file.text());
                                  await api(
                                    "/admin/lots/" + r.id + "/proof-bundle",
                                    "POST",
                                    bundle,
                                  );
                                  reload();
                                  setMessage(
                                    "Đã nhập và xác minh thông tin lô.",
                                  );
                                } catch (error) {
                                  setErr((error as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            />
                          </label>
                          {r.credentials?.[0]?.status === "ACTIVE" && (
                            <button
                              type="button"
                              className="text-button danger"
                              disabled={busy}
                              onClick={async () => {
                                const reason = await confirmAction({
                                  title: "Thu hồi thông tin xác minh lô?",
                                  description:
                                    "Kết quả cũ sẽ không còn được công nhận.",
                                  reason: true,
                                });
                                if (!reason) return;
                                setBusy(true);
                                setErr("");
                                try {
                                  await api(
                                    "/admin/lots/" + r.id + "/revoke",
                                    "POST",
                                    { reason },
                                  );
                                  reload();
                                  setMessage(
                                    "Đã thu hồi thông tin xác minh lô.",
                                  );
                                } catch (error) {
                                  setErr((error as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Thu hồi credential
                            </button>
                          )}
                        </>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {data && !rows.length && (
              <tr>
                <td colSpan={3} className="table-empty">
                  Không tìm thấy dữ liệu phù hợp.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > adminPageSize && (
        <nav
          className="admin-pagination"
          aria-label="Phân trang dữ liệu quản trị"
        >
          <button
            type="button"
            className="text-button"
            disabled={safeAdminPage === 1 || busy}
            onClick={() => setAdminPage((page) => Math.max(1, page - 1))}
          >
            Trang trước
          </button>
          <span aria-live="polite">
            Trang {safeAdminPage} / {adminPageCount}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={safeAdminPage === adminPageCount || busy}
            onClick={() =>
              setAdminPage((page) => Math.min(adminPageCount, page + 1))
            }
          >
            Trang sau
          </button>
        </nav>
      )}
    </section>
  );
}
function NotFound() {
  return (
    <div className="empty">
      <h1>Không tìm thấy trang</h1>
      <Link to="/">Về cửa hàng</Link>
    </div>
  );
}
function AppContent() {
  const [sessionReady, setSessionReady] = useState(false);
  const [user, setUser] = useState<User | null>(null),
    [count, setCount] = useState(0),
    [toast, setToast] = useState(""),
    [menu, setMenu] = useState(false),
    [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = storefrontTab(
    location.pathname,
    location.search,
    location.hash,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addingProducts = useRef(new Set<string>());
  useEffect(() => { setMenu(false); }, [location.pathname, location.search]);
  function notify(s: string) {
    setToast(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  }
  function refreshCount() {
    api<Cart>("/cart")
      .then((c) => setCount(c.items.reduce((n, i) => n + i.quantity, 0)))
      .catch(() => setCount(0));
  }
  useEffect(() => {
    api<{ user: User | null }>("/me")
      .then((r) => {
        setUser(r.user);
        if (r.user) refreshCount();
      })
      .catch(() => {})
      .finally(() => setSessionReady(true));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    const syncHeader = () => setScrolled(window.scrollY > 8);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    syncHeader();
    window.addEventListener("scroll", syncHeader, { passive: true });
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("scroll", syncHeader);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  async function add(id: string, quantity = 1) {
    if (!user) {
      notify("Đăng nhập để lưu giỏ hàng của bạn");
      navigate("/dang-nhap?returnUrl=" + encodeURIComponent(location.pathname + location.search + location.hash));
      return;
    }
    if (addingProducts.current.has(id)) return;
    addingProducts.current.add(id);
    try {
      await api("/cart/items", "POST", { productId: id, quantity });
      refreshCount();
      notify("Đã thêm thức quà vào giỏ hàng");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      addingProducts.current.delete(id);
    }
  }
  function signed(u: User) {
    setUser(u);
    refreshCount();
  }
  return (
    <>
      <a className="skip" href="#main">
        Đến nội dung chính
      </a>
      <ScrollToTop />
      <div className="announcement">
        ĐẶC SẢN VÀ QUÀ TẶNG VIỆT{" "}
        <span>Miễn phí giao hàng · Thanh toán COD</span>
      </div>
      <header className={scrolled ? "scrolled" : ""}>
        <div className="header-inner">
          <Link className="brand" to="/" aria-label="Bản Vị Việt — Trang chủ">
            <Leaf size={30} />
            <span>
              Bản Vị Việt<small>THỨC QUÀ TỪ ĐẤT VIỆT</small>
            </span>
          </Link>
          <nav id="store-navigation" className={menu ? "open" : ""} aria-label="Điều hướng chính">
            {[
              ["home", "/", "Trang chủ"],
              ["shop", "/cua-hang#thuc-qua", "Cửa hàng"],
              ["gifts", "/gifts?category=qua-tang#thuc-qua", "Quà tặng"],
              ["about", "/gioi-thieu", "Giới thiệu"],
            ].map(([tab, path, label]) => (
              <Link
                key={tab}
                to={path}
                className={activeTab === tab ? "active" : ""}
                aria-current={activeTab === tab ? "page" : undefined}
                onClick={() => setMenu(false)}
              >
                {label}
              </Link>
            ))}
            {user && (
              <>
                <NavLink to="/don-hang" onClick={() => setMenu(false)}>
                  Đơn hàng
                </NavLink>
                <NavLink to="/dia-chi" onClick={() => setMenu(false)}>
                  Địa chỉ
                </NavLink>
              </>
            )}
            {user?.role === "ADMIN" && (
              <NavLink to="/quan-tri" onClick={() => setMenu(false)}>
                Quản trị
              </NavLink>
            )}
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                <Link
                  className="icon account"
                  to="/tai-khoan"
                  aria-label="Tài khoản"
                  title={user.name}
                >
                  <UserRound size={20} />
                </Link>
                <button
                  className="icon logout"
                  aria-label="Đăng xuất"
                  title="Đăng xuất"
                  onClick={async () => {
                    try {
                      await api("/auth/logout", "POST", {});
                      setUser(null);
                      setCount(0);
                      navigate("/");
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  <LogOut size={19} />
                </button>
              </>
            ) : (
              <Link className="icon" to="/dang-nhap" aria-label="Đăng nhập">
                <UserRound size={21} />
              </Link>
            )}
            <Link
              className="cart-link"
              to="/gio-hang"
              aria-label={`Giỏ hàng, ${count} sản phẩm`}
            >
              <ShoppingBag size={20} />
              <span>Giỏ hàng</span>
              <b>{count}</b>
            </Link>
            <button
              className="icon mobile-toggle"
              aria-label={menu ? "Đóng menu" : "Mở menu"}
              aria-expanded={menu}
              aria-controls="store-navigation"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        <div className="search-row">
          <span>Hương vị Việt, từ những điều giản dị.</span>
          <ProductSearch />
        </div>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<Home onAdd={add} />} />
          <Route path="/cua-hang" element={<Home onAdd={add} />} />
          <Route path="/gioi-thieu" element={<AboutPage />} />
          <Route path="/gifts" element={<Home onAdd={add} />} />
          <Route path="/san-pham/:slug" element={<ProductPage onAdd={add} />} />
          <Route
            path="/gio-hang"
            element={
              <CartPage user={user} onCount={refreshCount} notify={notify} />
            }
          />
          <Route path="/dang-nhap" element={<Auth onUser={signed} />} />
          <Route path="/login" element={<Auth onUser={signed} />} />
          <Route path="/dang-ky" element={<Auth register onUser={signed} />} />
          <Route path="/tai-khoan" element={<Account user={user} />} />
          <Route
            path="/account/age-verification/:id"
            element={<AgeVerificationDetail user={user} />}
          />
          <Route path="/dia-chi" element={<Addresses user={user} />} />
          <Route path="/don-hang" element={<Orders user={user} />} />
          <Route path="/don-hang/:id" element={<Orders user={user} detail />} />
          <Route
            path="/quan-tri"
            element={
              !sessionReady ? (
                <div role="status">Đang kiểm tra phiên…</div>
              ) : !user ? (
                <Navigate to="/login?returnUrl=%2Fquan-tri" replace />
              ) : user.role === "ADMIN" ? (
                <Admin user={user} />
              ) : (
                <NotFound />
              )
            }
          />
          <Route
            path="/admin"
            element={
              !sessionReady ? (
                <div role="status">Đang kiểm tra phiên…</div>
              ) : !user ? (
                <Navigate to="/login?returnUrl=%2Fadmin" replace />
              ) : user.role === "ADMIN" ? (
                <Admin user={user} />
              ) : (
                <NotFound />
              )
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer>
        <div>
          <Link className="brand" to="/">
            <Leaf />
            <span>
              Bản Vị Việt<small>GÓI MỘT MIỀN THƯƠNG</small>
            </span>
          </Link>
          <p>
            Chọn bằng sự tử tế.
            <br />
            Trao bằng cả tấm lòng.
          </p>
        </div>
        <div>
          <strong>Mua sắm</strong>
          <Link to="/cua-hang#thuc-qua">Tất cả thức quà</Link>
          <Link to="/gifts?category=qua-tang#thuc-qua">Quà tặng Việt</Link>
          <Link
            to={
              user
                ? "/don-hang"
                : "/dang-nhap?returnUrl=" + encodeURIComponent("/don-hang")
            }
          >
            Theo dõi đơn hàng
          </Link>
        </div>
        <div>
          <strong>Hỗ trợ khách hàng</strong>
          <Link to="/tai-khoan">Tài khoản của bạn</Link>
          <Link to="/dia-chi">Địa chỉ nhận hàng</Link>
          <Link to="/gioi-thieu#lien-he">Liên hệ & hỗ trợ</Link>
          <p className="footer-contact">
            <a href="mailto:hello@banviviet.example">
              <Mail size={14} /> hello@banviviet.example
            </a>
            <br />
            Thông tin liên hệ hư cấu của đồ án
          </p>
        </div>
        <div>
          <strong>Về Bản Vị Việt</strong>
          <Link to="/gioi-thieu">Câu chuyện thương hiệu</Link>
          <strong className="footer-policy-title">Chính sách</strong>
          <Link to="/gioi-thieu#quyen-rieng-tu">Quyền riêng tư</Link>
          <Link to="/gioi-thieu#giao-hang">Giao hàng & thanh toán</Link>
          <Link to="/gioi-thieu#thong-tin-san-pham">Thông tin sản phẩm</Link>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Bản Vị Việt</span>
          <span>Được chăm chút tại Việt Nam</span>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="icon"
            aria-label="Đóng thông báo"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
export default function App() {
  return (
    <ConfirmationProvider>
      <AppContent />
    </ConfirmationProvider>
  );
}
