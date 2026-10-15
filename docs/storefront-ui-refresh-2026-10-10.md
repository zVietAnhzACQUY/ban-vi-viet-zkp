# UI refresh — 10/10/2026

## Phạm vi đã thực hiện

- Website: navigation Trang chủ/Cửa hàng/Quà tặng/Giới thiệu, trang cửa hàng riêng, hero gọn hơn, nhóm danh mục, lợi ích, trang Giới thiệu và liên kết chính sách thực tế.
- Thống nhất typography, màu, khoảng cách, thẻ sản phẩm tỷ lệ 5:4, sản phẩm liên quan và responsive bằng lớp storefront.css.
- Thay native confirm/prompt bằng dialog có nhãn, Escape, focus trap và phục hồi focus. Các API nghiệp vụ giữ nguyên.
- Wallet và Issuer Portal: điều chỉnh spacing/responsive, giữ nhận diện độc lập và toàn bộ luồng bảo mật hiện có.
- Không thay ảnh, database, schema, migration, API, circuit, credential hoặc protocol.

## File của lượt này

- apps/web/src/App.tsx
- apps/web/src/main.tsx
- apps/web/src/StorefrontSections.tsx
- apps/web/src/ConfirmationDialog.tsx
- apps/web/src/storefront-navigation.ts
- apps/web/src/storefront-navigation.test.ts
- apps/web/src/storefront.css
- apps/wallet/src/styles.css
- apps/issuer-portal/src/styles.css
- docs/storefront-ui-refresh-2026-10-10.md

Các thay đổi có sẵn của owner trong những file khác không thuộc lượt này.

## Kiểm chứng

- 56/56 test tập trung Website/Wallet/Portal và test navigation mới PASS.
- Ba frontend build và TypeScript PASS với WEBSITE_ORIGIN=http://127.0.0.1:5173; có cảnh báo bundle lớn.
- G1 static hash 45/45 không đổi. Báo cáo witness hiện hữu 71/71 PASS; không chạy lại witness hoặc đọc private inputs.
- Browser thực tế: / và /gioi-thieu tại 1440×1000 và 390×844; không tràn ngang.
- Ảnh trước/sau Website: .work/ui-refresh-20261010/before-desktop.jpg, before-mobile.jpg, after-desktop.jpg, after-mobile.jpg; thêm about-mobile.jpg.

## Chưa được xác nhận

API local chưa phục vụ dữ liệu sản phẩm trong phiên browser. Chưa PASS E2E sản phẩm/checkout/account/admin với fixture, chưa xác nhận console sạch, BFCache hoặc browser Wallet/Portal. Không coi ảnh lỗi kết nối là bằng chứng hoàn thành catalog.

Không chạy npm test tổng vì runner gọi prisma migrate deploy và các test integration ghi fixture DB. Giữ yêu cầu không thay database của lượt UI này; cần checkpoint test riêng được phép dùng schema test đã xác nhận trước khi chạy toàn bộ integration. Không tuyên bố hoàn thành toàn bộ hoặc production-ready.
