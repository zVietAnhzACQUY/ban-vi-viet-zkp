# Rà soát thiết kế trạng thái và Issuer LOT — 05/10/2026

## Quyết định

- `Lot.status` là trạng thái vận hành: API chỉ tạo/chuyển DRAFT, ACTIVE, ARCHIVED. Các enum legacy còn trong PostgreSQL để tránh migration phá hủy nhưng không còn là verification workflow.
- Trạng thái xác minh được suy ra từ `LotCredential` + `LotProof`: UNVERIFIED, ACTIVE, EXPIRED, REVOKED, STALE.
- ZKP chỉ quyết định nhãn xác minh. Checkout và tồn kho tiếp tục dựa vào LOT vận hành ACTIVE; proof thiếu/hết hạn/thu hồi/stale không tự cấm bán.
- Canonical issuer key ID: `<issuerId>:v<issuerKeyVersion>`. Giá trị được dựng từ hai trường metadata đã ký và phải khớp Issuer/key version được pin.
- Circuit version LOT hiện chỉ hỗ trợ v1; parser, verifier, DB preflight và constraint đều fail closed với giá trị khác 1.

## Phân loại dữ liệu hiện hữu

| Lot | Operational | Credential/proof | Public verification |
|---|---|---|---|
| BP-2026-03 (`95c8f9f3…`) | ACTIVE | credential `1040b23f…` ACTIVE, issuer `a4381e8c…`, key v1, key ID legacy `LOT-v1`, circuit v1; proof `86c4ca90…` ACTIVE/v1 | STALE, không trả bundle |
| DL-2026-01 (`96e5a017…`) | ACTIVE | không credential/proof | UNVERIFIED |
| TH-2025-02 (`e040c84b…`) | ACTIVE | không credential/proof | UNVERIFIED |

Không truy xuất/in supplierIdHash, salt, privateLotCodeHash, witness, private credential hoặc private key.

## Default drift và call site

- `AgeCredentialRequest.updatedAt`: migration 003 bỏ DB default; create/update đi qua Prisma và Prisma cung cấp `@updatedAt`.
- `Lot.updatedAt`: migration 003 bỏ DB default; API/Issuer dùng Prisma, không có raw INSERT call site.
- `LotCredential.issuerKeyId`: migration 003 bắt buộc bỏ `LOT-v1`; call site tạo duy nhất ở `apps/api/src/lot.ts` luôn truyền canonical ID dựng từ signed metadata.

Import proof không còn đổi `Lot.status`. Revoke chỉ đổi credential thành REVOKED và proof thành STALE. Đổi `lotCode` làm proof STALE/credential SUPERSEDED nhưng giữ operational status và tồn kho.

## Migration/preflight

Migration 003 chưa áp dụng. SHA-256 mới: `17c926e466de5de4ca8804b8b9abfb6f9a51b0f8649be0010bb7ebe71896e8b9`. Lý do đổi: xử lý ba default drift, bỏ fallback issuer, thêm canonical/version constraints và loại bỏ việc coi issuer trên `Lot` là điều kiện xác minh.

Preflight không còn chặn hai LOT ACTIVE chưa xác minh. Credential legacy của BP-2026-03 được xử lý bằng `apps/issuer/repair-legacy-lot-key-id.ts`: dry-run xác minh strict schema, issuer/key/fingerprint, Ed25519, thời gian/policy, product/lot hashes, public signals, G1 artifact hashes, stored proofHash và Groth16; apply khóa Lot/Credential/Proof, so snapshot rồi compare-and-swap và ghi một audit. Không tạo credential/proof mới và không đọc private inputs. Sau repair mọi violation bằng 0; migration 003 đã áp dụng thành công.
