# Báo cáo nâng cấp nguyên mẫu pilot SME

> Báo cáo này đã được rà soát lại. Trạng thái hiện hành và các giới hạn chính xác nằm tại `docs/pilot-consistency-review.md`; các kết quả integration ở đây không được hiểu là đã xác minh cho migration pilot.

Ngày: 04/10/2026

## Kết quả

Mức sẵn sàng hiện tại: **đồ án nâng cao / pilot nội bộ có điều kiện**, chưa production.

Đã triển khai:

- Hàng đợi yêu cầu AGE cho khách và Issuer Portal trong khu vực admin.
- Guard chỉ ADMIN/operator được duyệt/từ chối/thu hồi; xác nhận hồ sơ mô phỏng và audit log.
- Issuer AGE CLI nhận `--request`, chỉ xử lý request APPROVED và từ chối phát hành lần hai; private key không vào browser/API.
- Wallet AES-256-GCM, PBKDF2-SHA-256 310.000 vòng, salt/IV ngẫu nhiên, khóa/mở/xóa và auto-lock 5 phút.
- Import JSON chuyển vào phần nâng cao; checkout bình thường không yêu cầu DOB/chọn credential.
- LOT lifecycle đã được cài đặt ở code nhưng **đang chờ migration và integration test trên DB test**; chưa tuyên bố PASS.
- Migration cộng dồn, tài liệu theo ba vai trò, sequence AGE/LOT, threat model và ERD.

Vẫn mô phỏng/chưa hoàn tất:

- Chưa có Issuer delivery service độc lập để “Nhận vào Ví” bằng token một lần/TTL/user binding. Pilot vẫn chuyển file credential ngoài repository; không đưa plaintext credential vào API thương mại.
- Không có KYC/CCCD/VNeID, HSM, issuer tổ chức độc lập, vận chuyển hoặc thanh toán thật.
- AGE owner E2E chưa chạy vì không sử dụng credential/private key owner.

## Migration

`prisma/migrations/202610040001_pilot_issuer_lifecycle/migration.sql` thêm enum trạng thái, bảng `AgeCredentialRequest`, lifecycle/version fields cho LOT và các index/FK/check. Migration chưa được áp dụng trong lượt này; PostgreSQL volume không bị reset hoặc thay đổi.

## Kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| Production build web/wallet + TypeScript | PASS |
| Wallet/protocol/crypto | 19/19 PASS |
| Search | 4/4 PASS |
| Checkout policy | 1/1 PASS |
| Full `npm --prefix apps test` | BLOCKED: runner tự deploy migration; không được phép thay schema DB trong phiên |
| Browser Wallet desktop/mobile | PASS trực quan |
| Browser Website mobile shell | PASS; dữ liệu API không tải vì API/DB offline |
| G1 baseline | 45/45 tệp baseline bất biến khớp; evidence động `witness-tests.json` có 71/71 PASS nhưng timestamp thay đổi |

Lưu ý G1: tách artifact/static baseline khỏi evidence động; không cập nhật baseline để ép PASS. Circuit, public signals, trusted setup, zkey, verification key và issuer public artifact không bị sửa.

## Tệp chính đã sửa

- `prisma/schema.prisma`
- `prisma/migrations/202610040001_pilot_issuer_lifecycle/migration.sql`
- `apps/api/src/app.ts`, `apps/api/src/lot.ts`
- `apps/api/tests/checkout.test.ts`
- `apps/issuer/issue-age.ts`
- `apps/wallet/src/storage.ts`, `apps/wallet/src/App.tsx`, `apps/wallet/src/wallet.test.ts`
- `apps/web/src/api.ts`, `apps/web/src/App.tsx`
- `docs/decisions.md`, `docs/api-erd.md` và các hướng dẫn pilot mới.

## Owner cần kiểm tra thủ công

1. Backup DB; kiểm migration SQL; chạy `npm --prefix apps run db:migrate` trên môi trường test trước.
2. Chạy `npm --prefix apps test`, xác minh test phân quyền request AGE và regression AGE/LOT/checkout.
3. Dùng request demo + credential owner để kiểm CLI `--request`, Wallet PIN, reload/auto-lock, proof cold/warm và retry checkout.
4. Kiểm tra cross-user/replay của delivery sau khi xây Issuer delivery service; hiện chưa được tuyên bố PASS.
5. Kiểm LOT DRAFT → PENDING → ACTIVE, expired/revoked/stale/wrong lot và trạng thái mới nhất từ DB.
6. Phục hồi hoặc chấp thuận baseline mới cho file evidence witness, rồi xác nhận lại 46/46; không thay artifact mật mã.
7. Kiểm browser desktop/mobile khi API và PostgreSQL chạy, gồm account request và admin Portal.
8. Trước production: TLS/CSP/anti-framing, secret manager/HSM, DB least privilege, backup/restore, monitoring và privacy/legal review.
