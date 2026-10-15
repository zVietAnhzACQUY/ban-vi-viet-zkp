import { Link } from "react-router-dom";
import { ArrowRight, Leaf, Package, ShieldCheck, Truck } from "lucide-react";

export function FeaturedCategories() {
  return (
    <section
      className="featured-categories section"
      aria-labelledby="category-heading"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">TÌM MỘT CHÚT THÂN QUEN</span>
          <h2 id="category-heading">Thức quà cho mỗi dịp</h2>
        </div>
        <Link className="text-link" to="/cua-hang#thuc-qua">
          Xem cửa hàng <ArrowRight size={16} />
        </Link>
      </div>
      <div className="category-grid">
        {[
          {
            title: "Trà & cà phê",
            detail: "Chậm lại cùng một hương vị quen.",
            slug: "tra-ca-phe",
            icon: Leaf,
          },
          {
            title: "Thức quà Việt",
            detail: "Một chút ngọt bùi để sẻ chia.",
            slug: "thuc-qua",
            icon: Package,
          },
          {
            title: "Quà tặng & rượu",
            detail: "Gói lời cảm ơn thành một món quà.",
            slug: "qua-tang",
            icon: ShieldCheck,
          },
        ].map(({ title, detail, slug, icon: Icon }) => (
          <Link
            className="category-tile"
            key={slug}
            to={
              (slug === "qua-tang" ? "/gifts" : "/cua-hang") +
              "?category=" +
              slug +
              "#thuc-qua"
            }
          >
            <Icon size={28} />
            <div>
              <h3>{title}</h3>
              <p>{detail}</p>
            </div>
            <ArrowRight size={18} />
          </Link>
        ))}
      </div>
    </section>
  );
}
export function StorefrontBenefits() {
  return (
    <section
      className="store-benefits section"
      aria-labelledby="benefits-heading"
    >
      <span className="eyebrow">CHỈN CHU TỪ NHỮNG ĐIỀU NHỎ</span>
      <h2 id="benefits-heading">An tâm chọn, nhẹ lòng trao</h2>
      <div className="benefit-grid">
        <article>
          <Leaf />
          <h3>Hương vị có câu chuyện</h3>
          <p>
            Khám phá thức quà từ nhiều miền đất Việt, với thông tin xuất xứ và
            quy cách dễ tìm.
          </p>
        </article>
        <article>
          <ShieldCheck />
          <h3>Thông tin rõ ràng</h3>
          <p>
            Trạng thái xác minh được trình bày riêng để bạn hiểu đúng thông tin
            của từng lô hàng.
          </p>
        </article>
        <article>
          <Truck />
          <h3>Mua sắm thuận tiện</h3>
          <p>
            Quản lý địa chỉ, theo dõi đơn hàng và thanh toán khi nhận hàng ngay
            trong tài khoản.
          </p>
        </article>
      </div>
    </section>
  );
}
export function AboutPage() {
  return (
    <div className="about-page">
      <section className="about-hero section">
        <span className="eyebrow">CÂU CHUYỆN BẢN VỊ VIỆT</span>
        <h1>
          Mỗi miền một vị.
          <br />
          <em>Mỗi món quà một lời thương.</em>
        </h1>
        <p>
          Chúng tôi bắt đầu từ những điều quen thuộc: tách cà phê đầu ngày, chén
          trà thơm và thức quà được chia sẻ quanh một chiếc bàn.
        </p>
        <Link className="button" to="/cua-hang#thuc-qua">
          Khám phá thức quà <ArrowRight size={18} />
        </Link>
      </section>
      <section className="section about-story">
        <div>
          <span className="eyebrow">KẾT NỐI NHỮNG MIỀN ĐẤT VIỆT</span>
          <h2>Mang hương vị gần hơn với cuộc sống mỗi ngày</h2>
        </div>
        <div>
          <p>
            Bản Vị Việt kết nối trà, cà phê, thức quà và quà tặng Việt Nam trong
            một trải nghiệm mua sắm dễ sử dụng. Chúng tôi mong mỗi lựa chọn đều
            bắt đầu từ thông tin rõ ràng và sự trân trọng dành cho người nhận.
          </p>
          <p>
            Đây là thương hiệu hư cấu trong phạm vi đồ án. Nội dung xác minh
            trên Website không phải chứng nhận của cơ quan nhà nước.
          </p>
        </div>
      </section>
      <FeaturedCategories />
      <StorefrontBenefits />
      <section
        className="section policy-grid"
        aria-label="Thông tin hỗ trợ và chính sách"
      >
        <article className="panel" id="thong-tin-san-pham">
          <Package />
          <h2>Thông tin sản phẩm</h2>
          <p>
            Quy cách, giá, tồn kho và thông tin lô được hiển thị tại trang sản
            phẩm. Chỉ thông tin xác minh đang hiệu lực mới có nhãn đã xác minh.
          </p>
        </article>
        <article className="panel" id="quyen-rieng-tu">
          <ShieldCheck />
          <h2>Quyền riêng tư</h2>
          <p>
            Website thương mại không thu thập hồ sơ định danh hoặc ngày sinh để
            xác minh tuổi. Ví giữ thông tin được mã hóa trên thiết bị và chỉ
            chia sẻ bằng chứng khi bạn đồng ý.
          </p>
        </article>
        <article className="panel" id="giao-hang">
          <Truck />
          <h2>Giao hàng & thanh toán</h2>
          <p>
            Chọn địa chỉ nhận hàng và kiểm tra tổng tiền trước khi đặt COD. Bạn
            có thể theo dõi trạng thái đơn hàng trong tài khoản.
          </p>
          <Link className="text-link" to="/don-hang">
            Theo dõi đơn hàng <ArrowRight size={15} />
          </Link>
        </article>
        <article className="panel" id="lien-he">
          <Leaf />
          <h2>Liên hệ & hỗ trợ</h2>
          <p>
            Thông tin liên hệ hư cấu dành cho đồ án: hello@banviviet.example.
            Hãy dùng trang tài khoản để quản lý địa chỉ, đơn hàng và yêu cầu xác
            minh.
          </p>
          <Link className="text-link" to="/tai-khoan">
            Mở tài khoản <ArrowRight size={15} />
          </Link>
        </article>
      </section>
    </div>
  );
}
