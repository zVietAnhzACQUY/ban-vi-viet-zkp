# Hiệu ứng tương tác — 12/10/2026

CSS dùng chung tại `apps/shared/interactions.css`, được import sau style của ba ứng dụng. Hover 1px trên chuột, active scale 0.98, transition 180ms, focus ring theo nhận diện từng ứng dụng. Disabled bỏ transform/shadow/filter; cảm ứng không giữ hiệu ứng hover. Reduced-motion tắt transition/transform và spinner mới.

`apps/shared/BusyButton.tsx` giữ nhãn idle trong layout, phủ spinner bằng absolute positioning, cung cấp aria-busy/aria-label và disabled. Áp dụng cho nút checkout COD, đăng nhập Website/Portal, gửi request AGE, cập nhật trạng thái/mật khẩu, Wallet consent tạo proof và lưu/ACK credential. Handler và điều kiện nghiệp vụ cũ giữ nguyên.

File sửa: ba `src/main.tsx`, Website `App.tsx`/`experience.css`, Wallet `App.tsx`/`styles.css`, Portal `App.tsx`/`styles.css`; thêm ba file shared `interactions.css`, `BusyButton.tsx`, `interactions.test.tsx` và báo cáo này.

52 test tập trung PASS. TypeScript và build ba frontend PASS; cảnh báo bundle lớn vẫn tồn tại. G1 static 45/45 không đổi. Không chạy test integration ghi DB hoặc migration. Không thay database, API, role, circuit, credential, Delivery, private key hoặc thêm dependency.

Chưa kiểm chứng bằng browser các trạng thái loading thực tế có backend. Test CSS/source và server-render xác nhận cấu trúc ổn định, không thay thế kiểm tra hình ảnh/render geometry trên desktop/mobile.
