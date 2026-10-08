# Kết quả repair legacy LOT và migration pilot — 05/10/2026

## Repair BP-2026-03

Tool: `apps/issuer/repair-legacy-lot-key-id.ts`. Mặc định dry-run; apply cần đúng một `--lot-id` hoặc `--credential-id`, `--actor-id` và `--apply`. Tool không nhận issuerKeyId từ CLI.

Dry-run PASS cho Lot `95c8f9f3…`, credential `1040b23f…`:

- liên kết Lot/Credential/Proof và trạng thái ACTIVE;
- strict public bundle schema;
- product/lotCode binding;
- issuer ID, key version, fingerprint và public-key fingerprint đã pin;
- circuit v1, issuedAt < expiresAt, policy/publicAllowedCode;
- Ed25519 signature trên canonical message;
- productIdHash/lotCodeHash tính lại;
- public signal order/binding;
- manifest, signal schema, verification key G1;
- stored proofHash và Groth16 proof.

Canonical ID được suy ra từ signed metadata: `a4381e8c-505f-4e9a-a94a-b482685e919e:v1`. Dry-run giữ DB nguyên vẹn (`LOT-v1=1`, audit repair=0).

Apply PASS trong transaction Serializable: khóa Lot/Credential/Proof, xác nhận key ID vẫn là `LOT-v1`, snapshot không đổi, update đúng một credential và tạo đúng một audit `LOT_LEGACY_ISSUER_KEY_ID_CANONICALIZED`. Không cập nhật các trường issuer/version legacy trên Lot vì thiết kế cuối không dùng chúng làm nguồn xác minh.

Row count: Lot 3→3, LotCredential 1→1, LotProof 1→1, AuditLog 3→4. Sau repair: legacy key ID 0, canonical key ID 1, repair audit 1.

## Preflight và migration

Preflight sau repair và sau migration: tất cả 18 check đều 0. Backup owner 715331 byte còn tồn tại và `pg_restore -l` PASS. Migration 003 SHA-256 `17c926e466de5de4ca8804b8b9abfb6f9a51b0f8649be0010bb7ebe71896e8b9`.

001, 002, 003 đều finished, không rolled back. `Lot.status` default DRAFT; các updatedAt/issuerKeyId default đã bỏ đúng thiết kế; canonical/version/time/AGE constraints tồn tại. Prisma migrate status up to date và migrate diff báo `No difference detected`.

## Hồi quy

- Application tests trên schema cô lập `g2_test_20261005`: 71 PASS, 0 FAIL; gồm AGE, LOT, database/concurrency, Wallet và web policy.
- Build web/wallet + TypeScript: PASS; chỉ còn cảnh báo bundle size.
- G1 static: 45/45 unchanged.
- Witness evidence: 71/71 PASS.
- HTTP smoke: Website 200, Wallet 200, API health 200.
- Browser E2E: NOT RUN vì runtime điều khiển in-app Browser bắt buộc của skill không có trong phiên; không thay bằng browser automation ngoài luồng và không dùng owner credential.

Schema `g2_test` cũ có dữ liệu test tích lũy legacy; lần migration 003 thất bại đã được đánh dấu `--rolled-back`, không `--applied`. Không bulk-repair hoặc reset schema cũ. Hồi quy chạy trên schema mới cô lập, không xóa dữ liệu.

## Public LOT cuối

- BP-2026-03: ACTIVE, có bundle.
- DL-2026-01: UNVERIFIED, không bundle.
- TH-2025-02: UNVERIFIED, không bundle.

Trạng thái proof không tự thay đổi tồn kho hoặc khả năng checkout của Lot vận hành ACTIVE.
