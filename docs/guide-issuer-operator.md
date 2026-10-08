# Hướng dẫn Issuer operator mô phỏng

1. Chỉ dùng dữ liệu hư cấu và máy được kiểm soát. Không gửi private key/credential vào chat, email hay repository.
2. Portal không giữ khóa; private key AGE/LOT ở ngoài repo và chỉ CLI đọc.
3. AGE: sau khi request APPROVED, chạy `npm --prefix apps run issuer:age -- --request <request-id> --out <đường-dẫn-ngoài-repo>`. Nhập DOB hư cấu tại terminal. CLI từ chối request chưa duyệt hoặc đã phát hành.
4. Sau khi CLI hoàn tất request thành `ISSUED`, người dùng tự nhận qua Issuer Delivery bằng token một lần, TTL 5 phút và đúng tài khoản. Operator không chuyển credential thủ công; không chép token hoặc credential vào log/ticket.
5. LOT: chạy Issuer CLI và prover theo README, rồi để SME operator import public bundle.
6. Xoay khóa/đổi circuit cần version mới và kế hoạch xử lý credential cũ; không ghi đè artifact G1 v1.

Đây là mô phỏng phân vai, không phải Issuer độc lập có HSM, KYC hay thẩm quyền pháp lý.
# AGE delivery pilot

Trước khi phát hành, cấu hình `AGE_DELIVERY_ENCRYPTION_KEY` là đúng 32 byte base64 và giữ ngoài Git/log. `ISSUER_DELIVERY_ORIGIN`, `ISSUER_PORTAL_ORIGIN` và `WALLET_ORIGIN` phải là origin chính xác; không dùng wildcard. CLI phát hành request đã theo dõi sẽ tạo/cập nhật envelope delivery trong cùng transaction hoàn tất `ISSUED`; dịch vụ delivery chạy riêng bằng `tsx issuer/delivery-server.ts` (mặc định cổng 3002).

Không chép token, credential, PIN hoặc private input vào ticket/audit. Khi xử lý sự cố, chỉ kiểm trạng thái request/claim, timestamps và ID rút gọn. Migration `202610050001_age_credential_delivery` là cộng dồn; không reset database.

Operator đăng nhập trực tiếp tại `http://127.0.0.1:5175/login`, sau đó làm việc ở `/operator`; người chưa đăng nhập được chuyển nội bộ về `/login`. Pilot tái sử dụng tài khoản ADMIN hiện hữu, còn CUSTOMER bị chặn khỏi danh sách và endpoint operator. Trước khi phê duyệt, tích xác nhận đã đối chiếu hồ sơ giả lập ngoài hệ thống; browser không hỏi DOB. DOB hư cấu chỉ nhập trong Issuer CLI khi ký request đã `APPROVED`.

Issuer Portal được tách origin để mô phỏng ranh giới tin cậy nhưng pilot vẫn dùng chung API xác thực và PostgreSQL. Khi triển khai thực tế, Issuer cần tổ chức, tài khoản, API, cơ sở dữ liệu và hạ tầng quản lý khóa độc lập.

# Review AGE evidence (07/10/2026)

Trước APPROVE, mở metadata/file tại Portal, đối chiếu phương thức khách đã nộp và hoàn tất năm checkbox. API chặn chưa submission/consent, sai revision hoặc evidence không active. Review lưu operatorId/timestamps cùng transaction. CLI chỉ claim APPROVED đã review; không nhập DOB tại Portal, không đọc evidence trong CLI. Không dùng giấy tờ thật. Cleanup24h sau terminal: chạy dry-run, owner duyệt mới `--apply --owner-approved`. [Quy trình và giới hạn](age-evidence-2026-10-07.md).

# Tách role operator 07/10/2026

Checkpoint mới thay thế hướng dẫn dùng ADMIN làm AGE operator bên dưới. Chỉ ISSUER_OPERATOR được vào dashboard và review AGE; ADMIN thương mại bị chặn. Owner tạo tài khoản riêng bằng prompt ẩn sau migration role: [lệnh và quy trình](issuer-operator-checkpoint-2026-10-07.md). LOT request/evidence chưa thuộc checkpoint này.

# Phiên Issuer riêng 07/10/2026

Portal operator dùng issuer_session và /api/issuer/auth/*, không còn dùng login/me/logout của Website. Phiên CUSTOMER/ADMIN thương mại không truy cập được operator. Luồng khách nộp/nhận AGE vẫn dùng commerce ownership trong customer context riêng. Logout Portal không đăng xuất Website và ngược lại. Xem [kiểm chứng và checklist ba profile](auth-boundary-2026-10-07.md).

