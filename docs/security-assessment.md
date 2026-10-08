# Đánh giá an toàn thông tin có kiểm soát — Bản Vị Việt

Ngày đánh giá: 2026-10-04 (Asia/Saigon)  
Phạm vi: mã nguồn cục bộ, Website `127.0.0.1:5173`, Wallet `127.0.0.1:5174`, API `127.0.0.1:3001`, cấu hình PostgreSQL và artifact AGE/LOT.  
Phương pháp: rà soát tĩnh trước, kiểm tra dependency/build/circuit không phá hủy, thăm dò trạng thái dịch vụ localhost. Không dùng scanner trực tuyến, brute force, stress test, migration, reset/drop DB hoặc đọc nội dung bí mật.

## Tóm tắt điều hành

Mức rủi ro tổng thể: **Trung bình**.

Không phát hiện lỗ hổng Critical/High trong phạm vi đã kiểm tra. Các kiểm soát quan trọng được triển khai tốt: phân quyền được kiểm tra ở API, query theo chủ sở hữu, schema đầu vào nghiêm ngặt, câu lệnh SQL tham số hóa, CSRF kiểm tra Origin và token, session ngẫu nhiên chỉ lưu dạng băm, Argon2id, giao dịch/khóa hàng khi checkout, idempotency, chống replay AGE/LOT, pin issuer và băm artifact.

Có 4 phát hiện mức Medium và 1 mức Low. Ba ưu tiên cao nhất là: khóa seed demo khỏi production; bắt buộc HTTPS và bổ sung CSP/anti-framing cho Website/Wallet/API; giảm rủi ro lưu private input AGE dạng rõ trong IndexedDB. Không thay đổi mã ứng dụng hoặc dữ liệu trong lần đánh giá này.

## Kết quả theo mức độ

| Mức độ | Số lượng |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 4 |
| Low | 1 |
| Informational / kiểm soát đạt | 8 |

## Phạm vi và giới hạn

- Đã đọc mã nguồn, schema/migration, manifest công khai và metadata cấu hình; không đọc `.env`, private key, credential, DOB, salt, `holderSecret`, witness hoặc nội dung `.wtns`.
- `npm audit` được chạy tại root và `apps`; không gửi mã nguồn hay dữ liệu dự án cho dịch vụ quét trực tuyến.
- Website, Wallet và API đều không lắng nghe tại thời điểm kiểm tra; Docker Desktop/PostgreSQL cũng không chạy. Vì vậy kiểm thử HTTP động, hai tài khoản + admin, snapshot DB trước/sau và bộ integration phụ thuộc DB được đánh dấu **Not Tested**, không được ghi là đạt.
- Build production và circuit test không cần DB đã được chạy bằng Node 24.21.0 ghim trong dự án.
- Đây là đánh giá theo cấu hình/mã nguồn quan sát được, không phải chứng nhận pentest production hay đánh giá hạ tầng reverse proxy/TLS thực tế.

## Bề mặt tấn công

- Public API: health, CSRF bootstrap, đăng ký/đăng nhập, danh mục/sản phẩm, artifact AGE, verification key và proof bundle LOT.
- Authenticated API: hồ sơ, giỏ hàng, địa chỉ, challenge/verification AGE, checkout, lịch sử/hủy đơn, đổi mật khẩu.
- Admin API: người dùng, sản phẩm, danh mục, lô, proof bundle/revoke LOT, danh sách và chuyển trạng thái đơn.
- Browser boundary: cookie session/CSRF của Website; `window.postMessage` giữa Website và Wallet; IndexedDB/Cache Storage/Worker trong Wallet.
- Data boundary: PostgreSQL, Prisma migrations, issuer public keys, manifest và proving artifacts.

## Phát hiện chi tiết

### SEC-001 — Seed demo có thông tin đăng nhập biết trước và không có khóa production

- Mức độ: **Medium**
- Vị trí: `apps/api/src/seed.ts:4-16`, `apps/package.json` script `db:seed`
- CWE: CWE-798 (Use of Hard-coded Credentials)
- OWASP: A07 Identification and Authentication Failures; ASVS V2/V14; WSTG-CONF
- Bằng chứng: seed tạo tài khoản admin và customer demo bằng một mật khẩu cố định. Script không kiểm tra `NODE_ENV`, hostname DB hoặc cờ chấp thuận demo. Giá trị mật khẩu được cố ý lược khỏi báo cáo/evidence.
- Tác động: nếu operator chạy nhầm `db:seed` trên DB production, tài khoản biết trước có thể được tạo; `upsert update: {}` cũng không vô hiệu hóa tài khoản demo đã tồn tại.
- Khuyến nghị: fail-closed khi `NODE_ENV=production`; yêu cầu cờ rõ như `ALLOW_DEMO_SEED=true`; chỉ cho phép database/schema có tên test/dev; sinh mật khẩu một lần qua secret manager hoặc không tạo user mặc định; thêm kiểm tra CI/deploy cấm chạy seed demo.
- Kiểm tra lại: chạy seed trên cấu hình production giả phải thoát trước mọi query; chạy ở DB test với cờ cho phép vẫn hoạt động.

### SEC-002 — Chưa bắt buộc HTTPS và thiếu security headers ở lớp ứng dụng

- Mức độ: **Medium**
- Vị trí: `apps/api/src/app.ts:95-120`, `apps/wallet/src/config.ts`, HTML/Vite production output
- CWE: CWE-319 (Cleartext Transmission), CWE-1021 (Improper Restriction of Rendered UI Layers)
- OWASP: A02 Cryptographic Failures, A05 Security Misconfiguration; ASVS V9/V14; WSTG-CONF/WSTG-CLNT
- Bằng chứng: production yêu cầu khai báo origin nhưng vẫn chấp nhận origin `http:`. API chỉ đặt `Cache-Control: no-store` và `X-Content-Type-Options: nosniff`; không thấy CSP có `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy` hoặc HSTS. Cookie có `Secure` trong production, đây là kiểm soát tốt nhưng không thay thế TLS/HSTS/anti-framing.
- Tác động: cấu hình deploy sai có thể cho phép truyền dữ liệu qua HTTP; thiếu CSP/anti-framing làm tăng tác động của XSS/clickjacking, đặc biệt tại Wallet nơi người dùng phê duyệt proof.
- Khuyến nghị: từ chối origin không phải `https:` trong production (chỉ ngoại lệ loopback dev); cấu hình TLS tại reverse proxy; thêm HSTS tại HTTPS edge; CSP tối thiểu với `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` cho Wallet và allowlist chặt cho worker/connect; thêm `Referrer-Policy: no-referrer` cho Wallet, `Permissions-Policy`, và kiểm thử header trong CI.
- Kiểm tra lại: build/deploy staging HTTPS; xác nhận redirect HTTP, HSTS, CSP không phá worker/prover và Wallet không thể bị nhúng iframe.

### SEC-003 — Private input AGE được lưu dạng rõ trong IndexedDB

- Mức độ: **Medium**
- Vị trí: `apps/wallet/src/storage.ts:1-34`, `apps/wallet/src/proof.ts:150-174`
- CWE: CWE-922 (Insecure Storage of Sensitive Information)
- OWASP: A02 Cryptographic Failures; ASVS V6/V8; WSTG-CLNT-12
- Bằng chứng: toàn bộ `AgeCredentialFile`, gồm private inputs cần cho proof, được `put` trực tiếp vào IndexedDB. Không có mã hóa-at-rest, khóa do người dùng cung cấp, WebAuthn wrapping hoặc tự hết hạn/xóa. Không đọc hoặc ghi lại giá trị private input trong quá trình đánh giá.
- Tác động: XSS cùng origin, extension độc hại, malware hoặc người có quyền truy cập browser profile có thể lấy private inputs; từ đó ảnh hưởng riêng tư và khả năng tạo proof trong thời hạn credential.
- Khuyến nghị: ưu tiên mô hình không lưu dài hạn; hoặc mã hóa credential bằng khóa dẫn xuất từ passphrase với KDF mạnh/WebCrypto, cân nhắc khóa được bảo vệ bởi WebAuthn/OS; thêm auto-lock, TTL, nút xóa rõ ràng và CSP nghiêm ngặt. Ghi nhận rằng mã hóa phía client không bảo vệ được khi XSS đang chạy sau khi mở khóa.
- Kiểm tra lại: credential trong IndexedDB không chứa plaintext; reload yêu cầu mở khóa; logout/xóa dữ liệu loại bỏ bản mã và key material theo thiết kế.

### SEC-004 — Witness/proving intermediates nhạy cảm tồn tại lâu trên đĩa

- Mức độ: **Medium**
- Vị trí: `.work/tests/*.wtns`, `.work/setup/development/*.ptau`, `.gitignore`
- CWE: CWE-459 (Incomplete Cleanup), CWE-922
- OWASP: A02 Cryptographic Failures; ASVS V8; WSTG-CRYP
- Bằng chứng: nhiều file witness `.wtns` tồn tại trong `.work/tests`. Chúng đã được gitignore và nội dung không được mở trong đánh giá. Gitignore ngăn commit nhưng không bảo vệ khỏi backup, đồng bộ ổ đĩa, malware hoặc người dùng cục bộ khác.
- Tác động: witness thực tế có thể chứa dữ liệu riêng tư dùng cho ZKP. Các vector test hiện tại có thể chỉ là dữ liệu giả, nhưng quy trình tương tự trong production có nguy cơ để lại private inputs.
- Khuyến nghị: tạo witness trong thư mục tạm có ACL hẹp; xóa theo `finally`; không đưa witness thật vào workspace/backup; tách rõ test vector giả và dữ liệu thật; cân nhắc prover trong memory/worker cô lập. Không dựa vào “secure delete” trên SSD như biện pháp duy nhất.
- Kiểm tra lại: chạy proof test và xác nhận không còn `.wtns` ngoài fixture giả được phê duyệt.

### SEC-005 — Rate limiting chỉ ở bộ nhớ tiến trình và chưa có cấu hình proxy rõ ràng

- Mức độ: **Low**
- Vị trí: `apps/api/src/app.ts:92-108` và cấu hình từng route auth/AGE
- CWE: CWE-307 (Improper Restriction of Excessive Authentication Attempts)
- OWASP: A07 Identification and Authentication Failures; ASVS V2/V11; WSTG-ATHN-03
- Bằng chứng: API có global limit và limit chặt hơn cho register/login/password/AGE — đây là điểm tốt. Không thấy Redis/shared store hoặc cấu hình `trustProxy`/key strategy cho deployment nhiều instance.
- Tác động: limit có thể không đồng nhất giữa nhiều instance; cấu hình reverse proxy sai có thể gom nhiều người dùng vào một IP hoặc làm sai nhận diện client.
- Khuyến nghị: tài liệu hóa topology; cấu hình trusted proxy cụ thể; dùng shared rate-limit store khi scale ngang; thêm metric/alert và kiểm thử staging với proxy. Không cho phép client tự quyết định IP qua header không tin cậy.
- Kiểm tra lại: test giới hạn qua proxy staging với hai IP giả lập hợp lệ và hai API instance.

## Kiểm soát đã xác minh

1. **Auth/session:** token 256-bit ngẫu nhiên, DB chỉ giữ SHA-256, cookie HttpOnly/SameSite và Secure ở production; lỗi login không phân biệt email/mật khẩu; Argon2id; đổi mật khẩu cần mật khẩu hiện tại và hủy session khác.
2. **Authorization/IDOR:** actor và vai trò được kiểm tra server-side; địa chỉ, đơn, challenge và verification đều ràng buộc `userId`; admin route dùng guard riêng.
3. **Input/injection:** Zod strict/UUID/range; Prisma; raw SQL chỉ dùng tagged-template tham số hóa; body limit 32 KiB; không thấy `eval`, `dangerouslySetInnerHTML` hay SQL nối chuỗi trong source được rà soát.
4. **CSRF/CORS:** thao tác đổi trạng thái yêu cầu exact Origin và token so khớp constant-time; artifact AGE chỉ trả ACAO cho Wallet origin chính xác; không dùng wildcard.
5. **Wallet protocol:** kiểm tra allowlist `event.origin`, `event.source === window.opener`, origin trong payload, artifact origin, thời hạn và request replay; phản hồi dùng exact `returnOrigin`, không dùng `*`.
6. **AGE:** issuer/version/fingerprint được pin; chữ ký và artifact hash được kiểm; challenge gắn account/cart/cutoff, có expiry, lock và unique nullifier/challenge; checkout tiêu thụ proof một lần.
7. **LOT:** schema strict, binding product/lot/policy, chữ ký và Groth16 verify; credential cũ được supersede, revoke làm proof stale; trạng thái online được kiểm lại trước khi public.
8. **Commerce/DB:** checkout khóa user/product/lot theo giao dịch, kiểm lại giá/stock/state, idempotency; DB có unique/FK/check cho stock, giá, quantity, age state, replay và movement.

## Kết quả công cụ và kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| `npm audit --json` tại root | Pass — 0 advisory / 96 dependency |
| `npm audit --json` tại `apps` | Pass — 0 advisory / 354 dependency |
| `apps` production build + TypeScript | Pass; có cảnh báo bundle lớn, không phải finding bảo mật trực tiếp |
| G1 circuit test bằng Node 24.21.0 | Pass — 71 checks; không ngụ ý setup/proof ceremony |
| API integration test | Not Tested — cần Prisma engine/DB; Docker Desktop không chạy |
| Website/API/Wallet HTTP dynamic | Not Tested — cả ba cổng localhost từ chối kết nối |
| DB snapshot trước/sau | Not Tested — PostgreSQL không khả dụng; không có thao tác ghi DB |

Chi tiết máy đọc được: `docs/evidence/security/test-results.json`.

## Checklist owner trước production

- [ ] Chặn tuyệt đối seed demo trên production và xóa/khóa mọi tài khoản demo đã tồn tại.
- [ ] Bắt buộc HTTPS; cấu hình HSTS, CSP, anti-framing, Referrer-Policy và Permissions-Policy tại edge/app.
- [ ] Quyết định mô hình bảo vệ private input Wallet; tài liệu threat model và quy trình xóa/khóa.
- [ ] Không lưu witness thật trong workspace; thiết lập retention/cleanup và kiểm soát backup.
- [ ] Dùng DB role riêng, quyền tối thiểu; tách role migration khỏi runtime; xoay secret qua secret manager.
- [ ] Cấu hình `trustProxy` chính xác và shared rate-limit store nếu chạy nhiều instance.
- [ ] Khi Docker/PostgreSQL sẵn sàng: snapshot số lượng bản ghi, chạy integration test với customer A/B/admin, kiểm IDOR/CSRF/CORS/rate limit nhỏ, rồi so snapshot sau test.
- [ ] Chạy thử backup/restore trên bản sao; không thực hiện lần đầu trên production.
- [ ] Giám sát audit log, login/rate-limit anomalies, AGE/LOT verification/replay và lỗi giao dịch mà không ghi token/private input.

## Đối chiếu OWASP

- OWASP Top 10: A01 (authorization/IDOR), A02 (TLS/storage), A03 (injection), A04 (AGE/LOT/replay design), A05 (headers/deploy), A06 (dependencies), A07 (auth/rate limit), A08 (artifact/signature integrity), A09 (logging/monitoring), A10 (artifact origin/URL handling).
- ASVS 5.0 domains: V2 Authentication, V3 Session, V4 Access Control, V5 Validation, V6 Cryptography, V8 Data Protection, V9 Communications, V11 Business Logic, V12 Files/Resources, V13 API, V14 Configuration.
- WSTG: configuration/deployment, identity/authentication, authorization, session, input validation, business logic, client-side and cryptography testing. Mapping này ở cấp nhóm kiểm soát; cần baseline ASVS cụ thể của owner trước khi tuyên bố compliance.

## Threat model bổ sung — AGE delivery pilot (05/10/2026)

| Mối đe dọa | Kiểm soát |
|---|---|
| Đoán/rò claim link | Token CSPRNG 256 bit; DB chỉ giữ SHA-256; TTL đúng 5 phút; không log/audit token |
| Dùng link bằng account khác | Claim bind user/request/credential/type và Delivery API bắt buộc session cùng user |
| Replay hoặc hai tab đồng thời | Redeem chỉ cho `ACTIVE`; ACK dùng `FOR UPDATE`, chuyển một lần và retry ACK idempotent |
| Credential hết hạn/thu hồi/binding đổi | Redeem và ACK kiểm lại `ISSUED`, `revokedAt`, userId và credentialId |
| Origin lạ/CSRF | exact Issuer Portal/Wallet allowlist, credentialed CORS và double-submit CSRF |
| Credential hoặc Issuer giả | Wallet strict schema, pin issuer/key/fingerprint và xác minh Ed25519 trước save |
| Đọc trộm IndexedDB | AES-256-GCM với khóa dẫn xuất từ PIN; chính sách tự khóa hiện hữu |
| Mất mạng sau save | Không ACK trước save; giữ token và retry riêng ACK |
| XSS khi Wallet đang mở | Không được loại bỏ bởi mã hóa at-rest; Wallet origin phải cô lập và giảm script/dependency |
| Rò khóa delivery | Khóa 32 byte base64 ngoài Git; rotation/key management đầy đủ còn ngoài pilot |

Residual risks: bearer URL bị chiếm trong cửa sổ 5 phút vẫn nguy hiểm nếu session đúng account cũng bị chiếm; browser history/clipboard và máy nhiễm malware nằm ngoài bảo đảm. Đây không phải thiết kế production-ready.

## Ranh giới Issuer Portal tách origin

- Website 5173 tạo request và polling response tối thiểu gồm `id/status/createdAt`; không duyệt request hoặc tạo claim. Chỉ trạng thái `ISSUED` mới có liên kết cố định sang `/receive-age/{requestId}` ở origin 5175.
- API chỉ chấp nhận mutation origin chính xác của Website hoặc Issuer Portal; production fail closed nếu thiếu `WEB_ORIGIN`, `WALLET_ORIGIN` hoặc `ISSUER_PORTAL_ORIGIN`.
- Delivery chỉ cho Issuer Portal tạo claim và chỉ cho Wallet redeem/ACK. Website origin bị từ chối.
- Request detail dùng `userId` từ session và trả 404 khi không thuộc user để chống enumeration. Operator endpoint tiếp tục yêu cầu ADMIN, CSRF và `recordChecked=true`.
- Portal không nhận return URL tùy ý; route cũ `/verify-age/{id}` redirect về Website origin cố định. Wallet chỉ hiện link quay lại từ Website origin đã cấu hình trong allowlist.
- Pilot chia sẻ session/API/PostgreSQL giữa RP và Issuer. Đây là giới hạn triển khai có chủ đích, không mô phỏng được độc lập tổ chức đầy đủ.
# Threat model AGE evidence 07/10/2026

IDOR: ownership404; operator ADMIN phía server. CSRF/CORS: exact Portal origin + cookie/CSRF, không wildcard. File abuse: 5MB parser limit, rate limit, magic/name/extension allowlist; không HTML/SVG/archive. Storage leak: UUID, AES-256-GCM/AAD, separate key, private ACL; API không trả path/key. Race: row lock/revision/partial unique. Retention: dry-run + owner approval, idempotent unlink; orphan ciphertext sau crash cần đối chiếu. Không AV/CDR hoặc KYC thực tế; không dùng hồ sơ thật. Xem [thiết kế và giới hạn](age-evidence-2026-10-07.md).

