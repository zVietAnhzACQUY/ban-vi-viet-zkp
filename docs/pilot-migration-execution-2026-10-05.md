# Báo cáo migration pilot LOCAL/TEST — 05/10/2026

## Kết luận

Database được xác nhận là PostgreSQL local/test trong container `ban-vi-viet-db-1`, publish duy nhất tại `127.0.0.1:5434`. Migration 001 và 002 đã được áp dụng thành công. Sau rà soát thiết kế, blocker giả “mọi LOT ACTIVE phải có issuer” đã bị loại bỏ. Migration 003 **vẫn không được áp dụng** vì còn một blocker thật: credential ACTIVE dùng `issuerKeyId = LOT-v1`, không khớp canonical signed metadata. Không tự sửa dữ liệu.

## Backup

- Tạo bằng database owner `bvv`, custom-format (`pg_dump -Fc`).
- File: `.work/backups/banviviet-owner-before-pilot-20261005.dump` (gitignored).
- Kích thước: 715331 byte.
- `pg_restore -l`: PASS.
- Không đọc hoặc xuất nội dung bản ghi/secret.

## Cơ chế áp dụng chọn lọc 001/002

1. Ghi nhận SHA-256 của 003.
2. Di chuyển nguyên thư mục 003 sang `.work` bằng đường dẫn tuyệt đối đã kiểm tra.
3. Chạy `prisma migrate deploy`; Prisma chỉ thấy và áp dụng 001, 002.
4. Khôi phục 003 trong khối PowerShell `finally`, kể cả khi deploy lỗi.
5. Xác nhận SHA-256 của 003 sau khôi phục không đổi.

Không dùng `migrate resolve --applied`, `migrate reset`, `docker compose down -v`, DROP, TRUNCATE hoặc DELETE.

## Checksum

| Migration | SHA-256 local | SHA-256 trong `_prisma_migrations` |
|---|---|---|
| 202610040001_pilot_issuer_lifecycle | `ec9bb386d173bcd99ca7a38d557a63e491d6a354f506d8f1c9e811f64ab7c608` | khớp |
| 202610040002_pilot_age_status_values | `f8e05bcce7bb9ab8882c244ac54260db39234cd104bfe261bd6a6de35110f86a` | khớp |
| 202610040003_pilot_lifecycle_consistency | `17c926e466de5de4ca8804b8b9abfb6f9a51b0f8649be0010bb7ebe71896e8b9` | chưa áp dụng; checksum đổi có chủ đích sau review LOT/default drift |

001 không có thao tác phá hủy. 002 chỉ thêm `ISSUING` và `ISSUED` trong transaction/migration riêng, nên không sử dụng enum value mới trong transaction tạo enum của 001. 001 và 002 không phụ thuộc vào thay đổi của 003.

## Migration status

Trước: bốn migration `202609280001` đến `202609280004`, đều finished, không rolled back.

Sau: thêm 001 và 002, đều finished, không rolled back. Không có migration failed/rolled back. Prisma `migrate status` báo duy nhất 003 pending.

## Row count

| Bảng cũ | Trước | Sau 001/002 |
|---|---:|---:|
| Address | 1 | 1 |
| AgeChallenge | 4 | 4 |
| AgeVerification | 2 | 2 |
| AuditLog | 3 | 3 |
| Cart | 2 | 2 |
| CartItem | 0 | 0 |
| Category | 3 | 3 |
| InventoryMovement | 4 | 4 |
| Lot | 3 | 3 |
| LotCredential | 1 | 1 |
| LotProof | 1 | 1 |
| Order | 4 | 4 |
| OrderHistory | 6 | 6 |
| OrderItem | 4 | 4 |
| Product | 8 | 8 |
| Session | 4 | 4 |
| User | 2 | 2 |

`AgeCredentialRequest` được tạo mới với 0 row. Không bảng cũ nào giảm row count.

## Preflight sau 001/002

| Check | Violations |
|---|---:|
| age_table_missing | 0 |
| age_open_duplicates | 0 |
| age_issuing_or_issued_missing_fields | 0 |
| age_revoked_missing_reason | 0 |
| age_invalid_version | 0 |
| age_credential_id_duplicates | 0 |
| lot_table_missing | 0 |
| lot_invalid_operational_state | 0 |
| revoked_lot_missing_reason | 0 |
| lot_credential_table_missing | 0 |
| lot_credential_invalid_state | 0 |
| lot_credential_invalid_version_or_time | 0 |
| **lot_credential_invalid_issuer_key** | **1** |
| revoked_credential_missing_reason | 0 |
| lot_proof_table_missing | 0 |
| lot_proof_invalid_state | 0 |
| lot_proof_invalid_version | 0 |
| active_proof_without_active_credential | 0 |

Enum AGE thực tế có đủ: PENDING, APPROVED, REJECTED, REVOKED, EXPIRED, ISSUING, ISSUED. Các cột lifecycle/version của AGE/LOT tồn tại. `credentialId` chưa tồn tại đúng như thiết kế trước 003.

## Drift và cổng tiếp theo

Migration 003 mới xử lý có chủ đích drift `AgeCredentialRequest.updatedAt`, `Lot.updatedAt` và bắt buộc bỏ default `LotCredential.issuerKeyId = LOT-v1`. Migration còn thêm constraint canonical issuer key, circuit v1 và thời gian credential. Không có DROP TABLE/TYPE/INDEX, TRUNCATE hoặc DELETE.

Phân loại public sau sửa code: `BP-2026-03` = STALE/no bundle do key ID legacy; `DL-2026-01` và `TH-2025-02` = UNVERIFIED/no bundle. Cả ba vẫn là LOT vận hành ACTIVE; không đổi tồn kho hoặc khả năng checkout. Owner cần quyết định tái cấp/import credential hợp lệ cho `BP-2026-03`; không backfill giả. Build/typecheck PASS, nhưng integration migration/test chưa chạy do 003 còn bị chặn.
