# API, Ví ZKP và mô hình dữ liệu G5

## Bổ sung pilot SME (04/10/2026)

- `GET/POST /api/me/age-credential-requests`: khách xem/gửi yêu cầu; không nhận DOB/private input.
- `GET /api/admin/age-credential-requests`: operator xem hàng đợi.
- `PATCH /api/admin/age-credential-requests/:id`: ADMIN duyệt/từ chối/thu hồi và ghi audit.
- `POST /api/admin/lots/:id/revoke`: bắt buộc lý do và cập nhật trạng thái theo transaction.

```mermaid
erDiagram
  User ||--o{ AgeCredentialRequest : requests
  User ||--o{ AgeCredentialRequest : operates
  AgeCredentialRequest {
    uuid id PK
    uuid userId FK
    enum status
    uuid operatorId FK
    timestamptz issuedAt
    timestamptz expiresAt
    text issuerKeyId
    int circuitVersion
  }
  Lot ||--o{ LotCredential : has
  LotCredential ||--o| LotProof : proves
```

```mermaid
sequenceDiagram
  participant C as Khách hàng
  participant A as Website/API
  participant O as Issuer operator
  participant I as Issuer CLI
  participant V as Wallet
  C->>A: Gửi yêu cầu AGE
  O->>A: Duyệt hồ sơ mô phỏng, không gửi DOB
  O->>I: Ký request đã duyệt, DOB nhập cục bộ
  I-->>O: Credential ngoài repository
  C->>V: Import nâng cao + tạo PIN
  V->>V: AES-GCM vào IndexedDB
  A->>V: Proof request gắn user/cart/TTL
  V-->>A: Proof + metadata công khai
```

```mermaid
sequenceDiagram
  participant O as SME operator
  participant A as API/DB
  participant I as Issuer/Prover CLI
  participant C as Khách hàng
  O->>A: Tạo DRAFT, chuyển PENDING
  O->>I: Đối chiếu và tạo public bundle
  O->>A: Import bundle
  A->>A: Verify rồi chuyển ACTIVE
  C->>A: Query trạng thái mới nhất
  A-->>C: Kết luận hẹp + issuer + hiệu lực + checkedAt
```

API public không trả DOB, salt, holderSecret, supplierIdHash, privateLotCodeHash, private credential hoặc delivery secret.

Ngày chốt G4: 28/09/2026. Cập nhật Ví AGE tách origin: 29/09/2026. Đối chiếu G5: 30/09/2026. Circuit, public signals, khóa và mô hình dữ liệu G1–G4 giữ nguyên; G5 không tạo migration hoặc đổi schema.

## Kiến trúc chạy demo

```mermaid
flowchart LR
  IA[Issuer CLI AGE<br/>private key ngoài Git] --> CA[Credential AGE kín]
  CA --> W[Wallet origin riêng<br/>IndexedDB + Web Worker]
  R[Website / Relying Party] -->|public challenge request<br/>postMessage exact origin| W
  W -->|proof + public signals<br/>public signed envelope| R
  R -->|verify bundle / ageVerificationId| A[Fastify API]
  A --> D[(PostgreSQL 17.6)]
  I[Issuer CLI LOT<br/>private key ngoài Git] --> C[Credential LOT v1<br/>tệp kín cục bộ]
  C --> P[Prover CLI + LOT WASM/zkey G1]
  P --> U[Public proof bundle]
  U -->|admin import| A
  A -->|Ed25519 + binding + Groth16| V[LOT public key + vk G1]
  B[React browser] -->|trạng thái/proof lô hiện hành| A
  B -->|kiểm chữ ký + hash vk + Groth16 LOT| X[Hiển thị kết quả tại checkedAt]
  O[Checkout COD] -->|transaction khóa Product/Lot| D
```

Issuer và Wallet là vai trò mô phỏng. AGE credential kín chỉ nằm trong tệp nhập và IndexedDB của Wallet origin; website/API không nhận DOB, `dobDay`, salt, holderSecret, witness hoặc toàn bộ credential. LOT credential kín chứa `supplierIdHash`, salt và dữ liệu witness chỉ tồn tại trong tệp cục bộ/prover. API/DB chỉ nhận phần công khai cần xác minh/audit.

## ERD

```mermaid
erDiagram
  USER ||--o{ SESSION : has
  USER ||--o{ ADDRESS : owns
  USER ||--|| CART : owns
  CART ||--o{ CART_ITEM : contains
  CATEGORY ||--o{ PRODUCT : groups
  PRODUCT ||--o{ CART_ITEM : selected
  PRODUCT ||--o{ LOT : owns
  LOT ||--o{ LOT_CREDENTIAL : receives
  LOT ||--o{ LOT_PROOF : has
  LOT_CREDENTIAL ||--o| LOT_PROOF : proves
  USER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_ITEM : snapshots
  PRODUCT ||--o{ ORDER_ITEM : references
  LOT ||--o{ ORDER_ITEM : allocated_to
  ORDER ||--|{ ORDER_HISTORY : records
  ORDER ||--o{ INVENTORY_MOVEMENT : causes
  PRODUCT ||--o{ INVENTORY_MOVEMENT : changes
  USER ||--o{ AGE_CHALLENGE : requests
  AGE_CHALLENGE ||--o| AGE_VERIFICATION : verifies
  AGE_VERIFICATION ||--o| ORDER : consumed_by
```

### Các trường G4

| Bảng            | Trường/ràng buộc chính                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lot`           | `productId`, unique `(productId,lotCode)`, `status`, `stock >= 0`. `certificateStatus/expiresAt` cũ được giữ để migration tương thích nhưng không quyết định nhãn G4 |
| `LotCredential` | UUID credential, `lotId`, commitment, product/lot hash, policy/code, issuer/version/fingerprint, chữ ký, issued/expires, `ACTIVE/REVOKED/SUPERSEDED`, `revokedAt`    |
| `LotProof`      | unique `credentialId`, `lotId`, proof JSON công khai, đúng ba signals, proof hash, manifest/schema hash, generated/verified time, `ACTIVE/STALE`                     |
| `OrderItem`     | snapshot `lotId` nullable và `lotCode` nullable bên cạnh product/name/quantity/unitPrice                                                                             |

Migration `202609280004_g4_lot` cộng cột/bảng và backfill tồn hiện có: với mỗi sản phẩm đã có lô, lô đầu theo `lotCode` nhận tồn tổng hiện tại, các lô còn lại nhận 0. Migration không xóa order, cart hoặc volume.

## Endpoint và luồng AGE Wallet Protocol v1

| Method và path                  | Quyền           | Hành vi chính                                                                                                                                |
| ------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/age/challenges`      | Customer + CSRF | Tạo challenge 300 giây từ account/cart/cutoff server; trả requestHash, subjectHash, artifact URL/hash và đúng thứ tự signals G1              |
| `GET /api/zkp/age/wasm`         | Công khai       | Trả WASM AGE G1; CORS chỉ phản hồi cho Wallet origin cấu hình; cache immutable                                                               |
| `GET /api/zkp/age/zkey`         | Công khai       | Trả owner zkey AGE G1; CORS chỉ phản hồi cho Wallet origin cấu hình; cache immutable                                                         |
| `POST /api/age/verifications`   | Customer + CSRF | Parse public bundle nghiêm; kiểm challenge/cart/cutoff/requestHash, Issuer/signature/hạn, signals, Groth16/nullifier; tạo `VERIFIED`          |
| `POST /api/orders`              | Customer + CSRF | Nhận `ageVerificationId` thay vì proof. Trong transaction kiểm lại binding/hạn/Issuer/giá/tồn/lô, tạo đơn rồi chuyển challenge thành CONSUMED |

```mermaid
sequenceDiagram
  participant R as Website RP
  participant W as Wallet origin
  participant A as API
  participant D as PostgreSQL
  R->>A: POST age/challenges (cart hiện tại)
  A->>D: lưu ISSUED + nonce/cartHash/requestHash/TTL
  A-->>R: public challenge + subjectHash + artifact metadata
  R->>W: popup postMessage(requestId, challenge public), exact targetOrigin
  W->>W: kiểm origin/source/schema/TTL/replay; chờ consent
  W->>W: đọc IndexedDB, Web Worker witness + Groth16 proof
  W-->>R: public proof response, exact returnOrigin
  R->>A: POST age/verifications
  A->>D: lưu public audit + proofHash + nullifier, status VERIFIED
  A-->>R: ageVerificationId
  R->>A: POST orders(ageVerificationId)
  A->>D: transaction kiểm lại, trừ tồn/gán lô/tạo đơn/CONSUMED
```

Wallet và website đều kiểm exact origin, `event.source`, UUID request/challenge và expiry; request ID chỉ được Wallet xử lý một lần trong phiên. Website chỉ hiện “Đã xác minh” sau phản hồi thành công của API. Checkout thất bại trước commit không tiêu thụ verification nên có thể retry; checkout thành công tiêu thụ challenge/nullifier đúng một lần. Một snapshot giỏ có bao nhiêu sản phẩm 18+ cũng chỉ tạo một proof. Địa chỉ không thuộc requestHash AGE v1, nhưng website chủ động xóa trạng thái xác minh khi người dùng đổi địa chỉ.

## Endpoint G4

| Method và path                          | Quyền                     | Hành vi chính                                                                                                            |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/zkp/lot/verification-key`     | Công khai                 | Trả đúng bytes JSON vk LOT G1 sau khi server đã kiểm SHA-256                                                             |
| `GET /api/lots/:id/proof-bundle`        | Công khai                 | Tính trạng thái hiện tại; `Cache-Control: no-store`; chỉ `ACTIVE` mới kèm bundle/key/fingerprint                         |
| `POST /api/admin/lots/:id/proof-bundle` | Admin + CSRF              | Parse nghiêm; kiểm artifact, chữ ký, product/lô, policy, hạn, signals và Groth16; supersede proof cũ rồi lưu public data |
| `POST /api/admin/lots/:id/revoke`       | Admin + CSRF              | Trong một transaction đổi credential `REVOKED`, proof `STALE` và ghi audit                                               |
| `GET/POST/PATCH/DELETE /api/admin/lots` | Admin + CSRF cho mutation | Quản lý mã, trạng thái và tồn lô; không có cờ verified thủ công                                                          |
| `POST /api/orders`                      | Customer + CSRF           | Giữ G2/G3 và thêm chọn/trừ/snapshot lô atomically                                                                        |
| `POST /api/me/orders/:id/cancel`        | Customer + CSRF           | Hoàn tồn Product và Lot đúng một lần khi hủy `PENDING`                                                                   |

Các endpoint tài khoản, catalog, cart, địa chỉ, order, AGE challenge/artifact và quản trị khác giữ hành vi G3 đã ghi trong lịch sử tài liệu.

## Kiểm proof và trạng thái lô

```mermaid
sequenceDiagram
  participant I as Issuer/Prover CLI
  participant A as API
  participant D as PostgreSQL
  participant B as Browser
  I->>A: admin import public LOT bundle
  A->>A: pin manifest/schema/WASM/zkey/vk
  A->>A: Ed25519 + product/lot + policy + expiry + Groth16
  A->>D: credential/proof + audit (transaction)
  B->>A: GET current proof status
  A->>D: đọc lot + credential + proof hiện hành
  alt ACTIVE
    A-->>B: bundle + issuer key + checkedAt, no-store
    B->>B: fingerprint/signature/binding/expiry/vk hash/Groth16
    B-->>B: Đã xác minh tại checkedAt
  else EXPIRED/REVOKED/STALE/UNVERIFIED
    A-->>B: status + reason, không bundle
    B-->>B: không hiển thị đã xác minh
  end
```

Proof Groth16 cũ có thể vẫn đúng về mật mã sau khi credential hết hạn hoặc bị thu hồi. Nhãn website phụ thuộc trạng thái API tại `checkedAt`, vì vậy API không trả bundle cho mọi trạng thái khác `ACTIVE`. Verifier CLI offline chỉ kiểm artifact/chữ ký/binding/hạn/proof và luôn in `REVOCATION NOT CHECKED`.

## Phân bổ lô trong checkout

```mermaid
sequenceDiagram
  participant A as API checkout
  participant D as PostgreSQL transaction
  A->>D: khóa User và Product theo UUID
  A->>D: khóa toàn bộ Lot của từng Product theo lotCode
  D-->>A: danh sách lot hiện tại
  A->>A: chọn 1 ACTIVE lot đủ quantity, lotCode tăng dần
  A->>D: decrement Product.stock có điều kiện
  A->>D: decrement Lot.stock có điều kiện
  A->>D: tạo Order/OrderItem snapshot lotId + lotCode
  A->>D: movement, consume AGE nếu có, xóa cart
  D-->>A: commit hoặc rollback toàn bộ
```

Sản phẩm có ít nhất một `Lot` bắt buộc được phân bổ đúng một lô; v1 không split một order item. Không có lô `ACTIVE` riêng lẻ đủ quantity trả `LOT_OUT_OF_STOCK`. Sản phẩm không có lô để `lotId/lotCode` trống. Trạng thái proof lô không quyết định bán được hay không; nó chỉ quyết định nhãn xác minh. Client không gửi lựa chọn lô.

## Đối chiếu vận hành G5

- `GET /api/health` trả `status=ok`, `gate=G5`, `ageZkp=integrated`, `lotZkp=integrated`. Bốn migration hiện có đã được áp dụng; `prisma migrate deploy` báo không có migration chờ trên schema public. G5 không thêm migration.
- Test schema `g2_test` đạt 58/58. Các invariant thêm ở G5 xác nhận giỏ thường không tạo `AgeChallenge`, một giỏ có nhiều mặt hàng 18+ dùng đúng một challenge/verification, nullifier có unique constraint tại DB, retry sau lỗi trước commit vẫn dùng được verification, và tranh tồn không bán âm.
- API artifact AGE chỉ trả CORS cho Wallet origin. Hash WASM/zkey được Wallet kiểm trước khi dùng từ network hoặc Cache Storage; cache sai hash bị xóa và fail closed. Website chỉ gửi `ageVerificationId` khi checkout.
- Audit tên cột trên schema public không tìm thấy `dob`, `dobDay`, `salt`, `holderSecret`, `witness`, `supplierIdHash`, `privateLotCodeHash`, private key hoặc credential kín. Tại mốc kiểm tra có 0 `AgeChallenge`, 0 `AgeVerification`, 1 `LotCredential` và 1 `LotProof`; LOT bundle active không chứa tên hay giá trị `supplierIdHash`, salt hoặc `privateLotCodeHash`.
- Trạng thái LOT thực tế: lô `BP-2026-03` của `hat-dieu-binh-phuoc` trả `ACTIVE` cùng `checkedAt` và hạn credential, còn lô `DL-2026-01` không có proof hiển thị `UNVERIFIED`. Các ca hết hạn, revoke sau khi tạo proof và stale được test tự động; API không trả bundle ở các trạng thái đó.

Các số đếm là ảnh chụp trạng thái DB demo tại thời điểm kiểm tra, không phải ràng buộc seed. Hồ sơ chi tiết nằm ở `docs/evidence/g5/test-results.json`; owner E2E AGE không thay đổi ERD và đang `PENDING OWNER MANUAL TEST`.

## AGE credential delivery (pilot nội bộ)

```mermaid
erDiagram
  USER ||--o{ AGE_CREDENTIAL_REQUEST : owns
  USER ||--o{ AGE_CREDENTIAL_DELIVERY : owns
  USER ||--o{ AGE_CREDENTIAL_CLAIM : redeems
  AGE_CREDENTIAL_REQUEST ||--o| AGE_CREDENTIAL_DELIVERY : seals
  AGE_CREDENTIAL_REQUEST ||--o{ AGE_CREDENTIAL_CLAIM : authorizes
  AGE_CREDENTIAL_DELIVERY ||--o{ AGE_CREDENTIAL_CLAIM : delivers
```

`AgeCredentialDelivery` giữ envelope AES-256-GCM phía Issuer, không phải bản rõ. `AgeCredentialClaim.tokenHash` là SHA-256 của token 256 bit; token thô chỉ xuất hiện trong claim URL và request body Wallet–Issuer. TTL được ràng buộc đúng 5 phút. Trạng thái chỉ chuyển `ACTIVE → CLAIMED` sau ACK của Wallet.

```mermaid
sequenceDiagram
  participant P as Issuer Portal
  participant I as Issuer Delivery
  participant W as Wallet origin
  participant D as PostgreSQL
  P->>I: tạo claim cho request ISSUED
  I->>D: lưu hash token + binding + TTL 5 phút
  I-->>P: Wallet URL chỉ chứa token
  P->>W: mở claim URL
  W->>W: yêu cầu PIN / mở khóa
  W->>I: redeem token với session cùng account
  I->>D: kiểm TTL, lifecycle và binding
  I-->>W: credential qua exact Wallet origin
  W->>W: strict schema + Ed25519 + AES-256-GCM + IndexedDB
  W->>I: ACK sau khi save
  I->>D: FOR UPDATE và đánh dấu CLAIMED
  Note over W,I: Mất ACK thì retry ACK idempotent
```

Delivery không đi qua website payload hoặc API thương mại. Log/audit không chứa token, credential, PIN hay private inputs.

## Tách origin Issuer Portal (06/10/2026)

```mermaid
flowchart LR
  RP[Bản Vị Việt\n5173\nRelying Party] -->|tạo / polling trạng thái tối thiểu| API[API thương mại/verifier\n3001]
  RP -->|ISSUED: tiếp tục nhận| IP[Issuer Portal\n5175]
  IP -->|ownership / operator + session| API
  IP -->|tạo claim khi ISSUED| D[Issuer Delivery\n3002]
  D -->|credential trực tiếp| W[Wallet\n5174]
  W -->|public proof| RP
  CLI[Issuer CLI\nprivate key ngoài repo] -->|ISSUING / ISSUED + sealed delivery| DB[(PostgreSQL pilot dùng chung)]
  API --> DB
  D --> DB
```

```mermaid
sequenceDiagram
  participant R as Bản Vị Việt
  participant I as Issuer Portal
  participant A as API
  participant C as Issuer CLI
  participant D as Delivery
  participant W as Wallet
  R->>A: tạo request của chính user
  R->>A: polling id/status/createdAt mỗi 7 giây
  I->>A: operator APPROVE + recordChecked
  C->>A: claim/ký/finalize request APPROVED
  R->>I: ISSUED → /receive-age/{requestId}
  I->>A: kiểm ownership và trạng thái ISSUED
  I->>D: tạo claim một lần khi ISSUED
  D->>W: credential trực tiếp
  W-->>R: public AGE proof khi checkout
```

Issuer Portal được tách origin để mô phỏng ranh giới tin cậy. Pilot vẫn dùng chung API xác thực và PostgreSQL nhằm giới hạn phạm vi. Khi triển khai thực tế, Issuer cần tổ chức, tài khoản, API, cơ sở dữ liệu và hạ tầng quản lý khóa độc lập.
# AGE evidence bổ sung 07/10/2026

Xem [endpoint, ERD và sequence mới](age-evidence-2026-10-07.md). Website chỉ nhận recordSubmitted boolean; Issuer giữ metadata/file. APPROVE yêu cầu recordChecked và evidenceRevision hiện tại, submission/consent và active evidence đúng ownership; review/operator ghi nguyên tử. Sơ đồ AGE trước đây được bổ sung bước nộp/review trước APPROVED.

