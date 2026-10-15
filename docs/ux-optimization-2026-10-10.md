# Tối ưu trải nghiệm — 10/10/2026

## Các điểm đã sửa

| Điểm gây khó khăn | Thay đổi |
| --- | --- |
| Reset danh mục vẫn giữ từ khóa khiến kết quả tiếp tục rỗng | “Xem tất cả sản phẩm” xóa cả bộ lọc và từ khóa |
| Lỗi tải chỉ yêu cầu refresh toàn trang | Nút thử tải lại trên catalog, sản phẩm, giỏ và đơn hàng |
| GET có thể chờ lâu hoặc chạy sau unmount | Timeout 15 giây và AbortController cleanup trong useData |
| Thêm giỏ thiếu phản hồi và có thể nhấn liên tiếp | Loading tại card và guard đồng bộ theo sản phẩm |
| Người chưa đăng nhập mất vị trí mua sắm | Giữ returnUrl qua đăng nhập/đăng ký, tiếp tục dùng kiểm tra URL nội bộ hiện có |
| Đăng nhập có thể submit liên tiếp | Guard đồng bộ, aria-busy, nút hiện/ẩn mật khẩu |
| Dialog chỉ trap Tab nhưng nền vẫn tương tác được | inert nền, khóa scroll, cleanup và phục hồi focus |
| Menu mobile còn mở khi route đổi | Tự đóng theo route/query, aria-controls |
| Trang catalog lặp lại story không cần thiết | Story chỉ hiển thị trang chủ |
| Wallet empty vẫn báo đang khóa | Phân biệt chưa có thông tin, đang khóa, cần kiểm tra và đã mở |
| Mobile/bàn phím khó thao tác | Touch target, focus ring, input 16px và nội dung không tràn |

## File của lượt này

- apps/web/src/App.tsx
- apps/web/src/ConfirmationDialog.tsx
- apps/web/src/main.tsx
- apps/web/src/experience.css
- apps/web/src/experience.test.ts
- apps/web/src/auth-guard.test.ts
- apps/issuer-portal/src/navigation.test.ts
- apps/issuer-portal/src/styles.css
- apps/wallet/src/App.tsx
- apps/wallet/src/styles.css
- docs/ux-optimization-2026-10-10.md

Hai test source guard được sửa để không phụ thuộc vào whitespace sau format; vẫn giữ kiểm tra phân quyền và link không thuộc vùng operator.

## Kiểm chứng và giới hạn

- Test tập trung: 59/59 PASS, gồm Wallet cryptographic/storage/protocol fixture và Website/Portal navigation/guards.
- Ba build frontend và TypeScript PASS (WEBSITE_ORIGIN local cấu hình rõ ràng); còn warning bundle lớn.
- G1 hash static 45/45 không đổi. Báo cáo witness đã có 71/71 PASS, không chạy lại witness.
- Browser trực tiếp /dang-nhap tại 390×844, không tràn ngang; nút hiện mật khẩu thao tác được.
- Không thay API nghiệp vụ, database, schema, migration, ZKP, Delivery hoặc private-key handling.

Chưa chứng minh toàn bộ UX/E2E có dữ liệu, checkout COD, operator review và proof thật. Không chạy runner npm test vì runner deploy migration và ghi fixture DB. Cần phiên test riêng với API hoạt động và schema test được xác nhận; không dùng dữ liệu hoặc credential owner. Không gọi toàn bộ trải nghiệm đã hoàn tất.
