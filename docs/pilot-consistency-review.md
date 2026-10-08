# Rà soát nhất quán pilot trước migration

Ngày rà soát code: 04/10/2026. Cập nhật migration ngày 05/10/2026: 001 và 002 đã áp dụng trên LOCAL/TEST; 003 đang dừng do preflight phát hiện 3 LOT ACTIVE thiếu `issuerKeyId`. Xem `docs/pilot-migration-execution-2026-10-05.md`.

## Bất nhất đã sửa

1. CLI pilot trước đây vẫn ký không request: nay bắt buộc `--request`; fixture phải dùng `--allow-untracked-demo`, bị cấm trong production.
2. AGE thiếu trạng thái phát hành và claim nguyên tử: thêm `ISSUING`, `ISSUED`, `credentialId UNIQUE`, conditional claim và recovery.
3. Revocation AGE trước đây chỉ là trạng thái Portal: verifier nay tra lifecycle online theo credentialId/user/status/key/circuit/time.
4. Request có thể tạo trùng: API khóa row User trong transaction và migration thêm partial unique index cho PENDING/APPROVED/ISSUING. Credential ISSUED còn hạn chặn yêu cầu mới.
5. LOT mặc định ACTIVE và chuyển trạng thái tùy ý: nay mặc định DRAFT, chỉ PENDING nhận proof; ACTIVE không thể đặt tay; ARCHIVED terminal.
6. Wallet chấp nhận PIN 6 số và reset timer khi hidden: nay yêu cầu 8–64 ký tự, khóa ngay khi hidden và có nút xóa legacy plaintext.
7. Baseline trộn evidence timestamp: báo cáo nay tách 45/45 baseline bất biến và `witness-tests.json` động 71/71 PASS.

## AGE state machine

| Từ | Hành động | Đến | Chủ thể/điều kiện |
|---|---|---|---|
| — | tạo request | PENDING | Customer; một open request/user |
| PENDING | approve | APPROVED | ADMIN + xác nhận hồ sơ mô phỏng |
| PENDING/APPROVED | reject | REJECTED | ADMIN + lý do |
| APPROVED | conditional claim | ISSUING | Issuer CLI; operatorId tồn tại; đúng một process thắng |
| ISSUING | ghi file `wx` + finalize DB/audit | ISSUED | credentialId/user/signature/time khớp |
| ISSUING | ghi file thất bại | APPROVED | rollback đúng credentialId |
| ISSUING | file đã ghi, finalize lỗi | ISSUING | chạy lại cùng `--request --out` để verify file và finalize |
| ISSUED | revoke | REVOKED | ADMIN + lý do |
| ISSUED | hết hạn theo giờ server | EXPIRED (effective) | Không được verify/cấp lại khi còn hạn |

REJECTED, REVOKED và EXPIRED không chuyển sang ISSUING/ISSUED. Verifier production/pilot không cho credential untracked; bypass chỉ có khi non-production và `G2_TEST=1` hoặc cờ dev rõ ràng.

## LOT state machine

| Từ | Chuyển thủ công hợp lệ | Chuyển tự động |
|---|---|---|
| DRAFT | PENDING, ARCHIVED | — |
| PENDING | DRAFT, ARCHIVED | ACTIVE khi bundle hợp lệ |
| ACTIVE | ARCHIVED | STALE khi lotCode đổi; REVOKED khi revoke |
| STALE | PENDING, ARCHIVED | — |
| EXPIRED | ARCHIVED | kết luận public EXPIRED theo credential/time |
| REVOKED | ARCHIVED | — |
| ARCHIVED | chỉ ARCHIVED | Không phục hồi ACTIVE |

Proof sai giữ PENDING. Public status chỉ trả bundle khi toàn bộ dữ liệu DB hiện tại, issuer, policy, binding, expiry và proof đều ACTIVE.

## Concurrent issuance

CLI tạo credential trong memory sau khi operator nhập DOB, rồi `updateMany` có điều kiện `APPROVED + issuedAt null + credentialId null + operatorId not null`. Chỉ process có `count=1` được ghi file. Ghi file dùng `flag: wx`; lỗi ghi hoàn nguyên claim. Nếu file đã ghi nhưng finalize DB lỗi, request giữ ISSUING cùng credentialId/issuedAt/expiresAt; chạy lại kiểm schema, user binding, issuer, thời gian và chữ ký của đúng file trước khi finalize. File và PostgreSQL không được mô tả là một transaction nguyên tử.

## Migration cuối

- `001_pilot_issuer_lifecycle`: mô hình pilot ban đầu.
- `002_pilot_age_status_values`: chỉ thêm enum ISSUING/ISSUED; commit riêng.
- `003_pilot_lifecycle_consistency`: default DRAFT, credentialId/index/partial unique/constraint version-time.
- Không có statement DROP, TRUNCATE hoặc DELETE.
- Các constraint có thể xung đột dữ liệu cũ (active lot thiếu issuer/revoked thiếu reason) chưa được thêm; preflight chỉ báo candidate để owner backfill/duyệt trước.

Kiểm tra trạng thái migration trước mọi thay đổi: `docs/pilot-migration-status.sql`. Sau khi áp dụng 001 + 002 trên test DB, chạy data preflight tại `docs/pilot-migration-preflight.sql` trước migration 003. Backup phải đặt ngoài repository hoặc trong thư mục gitignore. Không dùng `migrate reset` hay `docker compose down -v`.

## Kết quả hiện tại

| Nhóm | Kết quả |
|---|---|
| Build web/wallet + TypeScript | PASS |
| Wallet crypto/protocol/policy | 20/20 PASS |
| Issuer CLI mode unit test | 2/2 PASS |
| Issuer/AGE DB integration | NOT RUN — DB offline, migration chưa apply |
| LOT DB integration | NOT RUN — DB offline, migration chưa apply |
| Full `npm --prefix apps test` | NOT RUN |
| Migration table/preflight/backup | NOT RUN — không kết nối được PostgreSQL |
| G1 protected/static baseline | 45/45 unchanged |
| G1 dynamic witness evidence | 71/71 PASS; timestamp/report không thuộc immutable hash gate mới |

## Hạn chế còn lại

- Delivery service một lần/TTL/user binding vẫn PENDING; import file chỉ là đường pilot nâng cao.
- Chưa có kết quả integration cho concurrent request/claim, online revocation và LOT transitions dù test đã được viết.
- Chưa có AGE owner E2E và không sử dụng credential/private key owner.
- Không production-ready; còn cần backup, test DB, HTTPS/CSP, secret manager/HSM, least privilege, monitoring và review pháp lý/quyền riêng tư.
