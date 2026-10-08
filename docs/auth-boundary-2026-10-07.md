# Authentication boundary — local pilot

Nguyên nhân: localhost cookie chia sẻ theo host, không theo port. Portal trước đây gọi commerce login/me/logout và bvv_session, nên đăng nhập/logout thay phiên Website. Admin component cũng được mount trước guard route.

Không thay schema/migration, role, circuit, G1, credential schema, evidence encryption, CLI key handling hoặc Delivery protocol. Không tiếp tục LOT trong checkpoint này.

## Phiên độc lập

Commerce giữ bvv_session, lookup hash(token), chỉ CUSTOMER/ADMIN. Issuer dùng issuer_session, lookup hash("issuer:" + token), chỉ ISSUER_OPERATOR. Prefix tạo audience binding trong opaque session lookup mà không thay bảng Session; không dùng JWT. Đổi tên cookie không vượt audience vì lookup khác nhau. Session cũ của operator ở bvv_session bị bỏ qua, phải đăng nhập lại Portal.

Cả hai session: host-only, Path=/, HttpOnly, SameSite=Strict, Secure khi NODE_ENV=production, TTL/Max-Age24h. CSRF riêng bvv_csrf và issuer_csrf. Production cần HTTPS và origin cấu hình exact, không wildcard. Cookie không được cô lập theo port; không dựa cookie name đơn thuần để authorize. Logout chỉ xóa session/cookie của audience đó.

Issuer auth trên API3001: GET /api/issuer/auth/csrf, POST /api/issuer/auth/login, GET /api/issuer/auth/me, POST /api/issuer/auth/logout. Login xác minh Argon2id và role trước cấp session; CUSTOMER/ADMIN/unknown/wrong password cùng401 và cùng thông báo chung. Unknown user dùng dummy Argon2id hash để tránh nhánh bỏ verification; rate15/minute. Issuer browser origin duy nhất được phép cho auth/operator.

Commerce auth hiện hữu không cấp session cho ISSUER_OPERATOR. /api/me bỏ qua issuer_session. Operator endpoints legacy /api/admin/age-credential-requests chỉ đọc issuerActor; commerce /api/admin/products/users/lots dùng commerce actor ADMIN. API direct HTTP vẫn kiểm audience/expiry/role, không tin role từ client. Role hợp lệ audience nhưng sai quyền403; thiếu/wrong audience401; ownership404.

Issuer evidence operator3002 dùng issuer_session audience + issuer_csrf riêng qua /issuer/operator/csrf. Customer submission/Delivery vẫn dùng commerce/customer session và ownership, không sửa token protocol hoặc mã hóa. Portal customer continuation /submit-age và /receive-age lấy dữ liệu phiên tối thiểu qua /api/issuer/customer/me; đây là business customer context, không phải operator login/me. Portal operator chỉ gọi issuer auth. Context chuyển route phải tải xong phiên trước render.

## Route guards

Website /admin và /quan-tri: chưa sessionReady chỉ loading; thiếu commerce user → /login với returnUrl nội bộ; role khácADMIN → 404 chung. Chỉ sau guard mới mount Admin và effect/API admin. Menu chỉ ADMIN từ server /me. Return URL chặn //, backslash/control characters. Issuer /operator thiếu issuer session → /login nội bộ; không mount dashboard trước me/context ready.

## Kiểm chứng và phần còn thiếu

Auth integration trên g2_test_20261007 dùng fixture hư cấu/password ngẫu nhiên riêng, không lấy dữ liệu xác thực owner. Test audience/cookie rename replay, role rejection, logout independence, cookie flags local/production và route mount guard. Test AGE/LOT/Wallet cũ vẫn giữ nguyên nghiệp vụ.

Browser hiện chỉ có một Codex in-app profile; Chrome không khả dụng. Đã kiểm tra thực tế http://127.0.0.1:5173/admin chuyển /login?returnUrl=%2Fadmin, không admin shell; http://127.0.0.1:5175/operator chuyển /login, không dashboard. Console warn/error0 trên lần kiểm tra cuối. Chưa kiểm Browser ba profile riêng hoặc đăng nhập bằng password owner; không đọc cookie/token/value hoặc private key. Không tuyên bố toàn bộ auth boundary PASS cho bước LOT trước khi phần Browser được xác minh.

Owner dùng ba browser profiles riêng CUSTOMER/ADMIN/ISSUER_OPERATOR: mỗi profile login đúng ứng dụng; CUSTOMER/ADMIN đăng nhập Portal phải lỗi chung, không issuer session; operator login Website bị từ chối; /admin chỉ ADMIN; /operator chỉ issuer authenticated. Trong profile có cả hai loại session, logout từng bên và reload bên còn lại phải giữ phiên. DevTools chỉ xem tên/flags, không chụp giá trị. Sau đó mới tiếp tục LOT request/evidence.

Kết quả cuối: toàn bộ107 test PASS trên g2_test_20261007; Website/Wallet/Issuer Portal build và tsc --noEmit PASS. G1 static45/45, witness evidence71/71 được bảo toàn (không chạy lại harness owner). Public vẫn10 migration finished/0 failed, drift NONE. Không tạo migration hoặc đổi role/public schema. Vite vẫn cảnh báo bundle lớn. Browser ba profile riêng chưa được kiểm chứng; không gộp API integration PASS thành Browser PASS.

File sửa: apps/api/src/app.ts, apps/issuer/delivery-service.ts, apps/issuer-portal/src/api.ts, App.tsx, evidence.tsx, flow.test.ts; apps/web/src/App.tsx; test runner và checkout/evidence tests. Test mới: apps/api/tests/auth-boundary.test.ts, apps/web/src/auth-guard.test.ts. Screenshot anonymous guards ở docs/evidence/auth-boundary-20261007. Không chỉnh schema/migration, Wallet, private key, credential hoặc G1 artifact.
