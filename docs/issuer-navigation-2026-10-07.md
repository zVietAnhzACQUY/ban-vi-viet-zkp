# Issuer navigation UI

Operator Login/Home/Denied/Review chỉ có liên kết nội bộ Issuer; không logo/nav/link thương mại. Logout vẫn về /login của Issuer, auth/session/role không đổi.

Customer return destinations được dựng từ origin cấu hình duy nhất, không từ query returnUrl:

| Context | Nhãn | Website path |
|---|---|---|
| AGE | Quay lại theo dõi yêu cầu | /account/age-verification/{UUID} |
| Receive | Quay lại tài khoản | /tai-khoan |
| LOT | Quay lại quản lý lô hàng | /quan-tri?tab=lots |

AGE id sai định dạng trên trang lỗi chỉ có đích tài khoản cố định; không điều hướng ra origin khác. /submit-lot chưa tồn tại trong source, nên chỉ chuẩn hóa helper/policy cho LOT, không tạo uploader hoặc luồng LOT mới. Website tab query chỉ nhận lots cố định để deep-link thực sự mở danh sách lô; không ảnh hưởng API/role guard.

Checkpoint tiếp theo đã bổ sung /submit-lot/{requestId} theo cùng policy return cố định, không nhận query returnUrl. Xem [luồng LOT request/evidence](lot-request-evidence-2026-10-07.md); ghi chú “chưa tồn tại” phía trên là trạng thái của lượt chỉnh navigation trước đó.

Production build bắt buộc WEBSITE_ORIGIN (ví dụ exact http://127.0.0.1:5173 cho local build, domain HTTPS thực tế khi triển khai). Thiếu biến sẽ dừng build; origin chứa wildcard, credential, path/query/hash hoặc protocol không HTTP(S) bị từ chối. Vite chỉ đưa origin đã kiểm tra vào VITE_WEBSITE_ORIGIN, không expose các biến môi trường khác. Development mới có fallback local. Không đổi apps/.env; build kiểm chứng bằng WEBSITE_ORIGIN riêng trong tiến trình.

Kiểm tra: 11 test điều hướng/guard PASS; build Issuer Portal và TypeScript PASS. Không thay auth, role, database/schema/migration, circuits/G1, credential/evidence encryption hoặc Delivery protocol.

Files: apps/issuer-portal/src/navigation.ts, navigation.test.ts, api.ts, App.tsx, evidence.tsx; vite.config.ts; apps/web/src/App.tsx (LOT tab deep-link); test runner đăng ký navigation tests.
