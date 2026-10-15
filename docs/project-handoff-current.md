# Bàn giao hiện trạng dự án Bản Vị Việt

> Sinh ngày 14/10/2026 (Asia/Saigon) từ source, cấu hình, migration, test và tài liệu đang có tại commit `0cd6d9f43dea55e5451ae4dccae9fcc8c69c24b8`. Đây là nguyên mẫu thí điểm nội bộ/đồ án, **không phải hệ thống production-ready**. Working tree đang có thay đổi của owner và các lượt phát triển trước; không được ghi đè hoặc hoàn tác hàng loạt.

## 1. Tổng quan đề tài

**Tên đề tài:** Bản Vị Việt — website thương mại điện tử SME ứng dụng Zero-Knowledge Proof (ZKP) để giảm lộ dữ liệu trong xác minh điều kiện tuổi và thông tin lô hàng.

Website phục vụ danh mục đặc sản/quà tặng Việt Nam, giỏ hàng, địa chỉ, đặt hàng COD, tài khoản khách hàng và quản trị thương mại. Hai kịch bản riêng:

- **AGE:** khách chứng minh đủ 18 tuổi mà Website không nhận ngày sinh hoặc credential riêng.
- **LOT:** doanh nghiệp chứng minh một thuộc tính nguồn gốc đã được Issuer chấp nhận mà public bundle không chứa định danh nhà cung cấp, salt hoặc witness.

Đây là pilot học thuật một API instance, Issuer mô phỏng và trusted setup một người. Hệ thống cố ý không triển khai thanh toán trực tuyến, KYC/VNeID thật, OCR/CCCD/khuôn mặt, hãng vận chuyển thật, ceremony nhiều bên hoặc hạ tầng chống brute force/multi-instance cấp production.

## 2. Kiến trúc hiện tại

| Thành phần | Trách nhiệm | Mã chính | Port local | Được phép xử lý | Không được nhận | Bên gọi |
|---|---|---|---:|---|---|---|
| Website (Relying Party) | Cửa hàng, tài khoản, giỏ, COD, theo dõi AGE, quản trị thương mại | `apps/web/src/App.tsx`, `api.ts`, `wallet.ts`, `checkout-policy.ts` | 5173 | Dữ liệu thương mại, trạng thái tối thiểu, challenge/proof public result | DOB, credential đầy đủ, salt, holderSecret, witness, private key, delivery token | Trình duyệt CUSTOMER/ADMIN; gọi API, mở Wallet/Portal bằng URL pin origin |
| Wallet | Nhận/kiểm credential AGE, mã hóa cục bộ, mở khóa, consent, tạo proof trong worker | `apps/wallet/src/App.tsx`, `storage.ts`, `credential.ts`, `proof.ts`, `proof.worker.ts`, `protocol.ts` | 5174 | Credential AGE riêng trong bộ nhớ/IndexedDB mã hóa; artifact công khai; challenge | Private key Issuer, evidence, dữ liệu quản trị/thương mại | Website popup; Delivery/API |
| Issuer Portal | Đăng nhập/operator review AGE/LOT; các route khách nộp hồ sơ và tiếp tục nhận AGE | `apps/issuer-portal/src/App.tsx`, `api.ts`, `evidence.tsx`, `lot.tsx` | 5175 | Projection request, evidence giải mã tạm cho operator có quyền, claim handoff | Issuer private key; không đưa claim/credential về Website | CUSTOMER ở route submit/receive; ISSUER_OPERATOR ở route operator |
| Backend/API | Auth, RBAC, catalog/cart/order, AGE challenge/verify, LOT import/verify, request projections | `apps/api/src/app.ts`, `age.ts`, `lot.ts` | 3001 | Dữ liệu nghiệp vụ, signals/proof public, hashes/audit cần thiết | DOB, salt, holderSecret, witness, private key, proof/credential kín ngoài endpoint chuyên biệt | Ba frontend, CLI/service nội bộ |
| Credential Delivery Service | AGE claim một lần; evidence upload/download; exact-origin/role/CSRF enforcement | `apps/issuer/delivery-server.ts`, `delivery-service.ts`, `delivery-crypto.ts`, `evidence-service.ts` | 3002 | Envelope mã hóa, claim hash/binding, evidence bytes mã hóa | Private key Issuer; không public storage path/key/plaintext | Issuer Portal và Wallet |
| PostgreSQL/Prisma | Source of truth nghiệp vụ, lifecycle, claims, challenges/verifications, audit metadata | `prisma/schema.prisma`, `prisma/migrations` | 5434 host | Metadata công khai/tối thiểu, hashes, encrypted envelope, storage key nội bộ | Private key; AGE DOB/salt/holderSecret/witness; plaintext evidence | API, Delivery, Issuer/Prover services qua Prisma |
| Issuer CLI AGE | Claim APPROVED, ký Ed25519, ghi credential ngoài repo, finalize ISSUED; recovery idempotent | `apps/issuer/issue-age.ts` | — | Request đã duyệt, DOB hư cấu nhập terminal, private key từ file ngoài repo | Browser không bao giờ nhận key/DOB | Owner/operator cục bộ |
| Issuer CLI LOT | Claim APPROVED, ký credential LOT, ghi ngoài repo, finalize ISSUED | `apps/issuer/issue-lot.ts`, `lot-issuance.ts` | — | Request/review, supplier code hư cấu, key ngoài repo | Browser/API không nhận private key/private inputs | Owner/operator cục bộ |
| LOT Prover | Đọc credential kín cục bộ, tạo public proof bundle, verify offline | `apps/prover/prove-lot.ts`, `verify-lot-bundle.ts` | — | Credential kín cục bộ và artifact pin | Không gửi credential kín vào Website/API | Owner; ADMIN chỉ import bundle public |
| Circuits/artifacts | Hai circuit Groth16 và artifact G1 bất biến | `circuits/age`, `circuits/lot`, `artifacts/manifest.json`, `artifacts/owner` | — | Signals, R1CS/WASM/zkey/vk/public issuer metadata | Không chứa private key | Wallet/API/CLI/Prover |

### Ranh giới web

- API pin ba origin từ `WEB_ORIGIN`, `WALLET_ORIGIN`, `ISSUER_PORTAL_ORIGIN`; production thiếu origin thì fail closed. Không dùng wildcard.
- Delivery pin Portal/Wallet/Website origin theo đúng endpoint; production thiếu `ISSUER_PORTAL_ORIGIN` thì fail closed.
- Fetch xuyên origin dùng `credentials: "include"`; Website same-origin dùng cookie cùng origin qua proxy Vite.
- Cookie phiên/CSRF là `HttpOnly`, `SameSite=Strict`, `Secure` ở production. Phiên thương mại và Issuer tách cookie/context; Portal không dùng session Website làm quyền operator.
- Request ghi yêu cầu origin chính xác và header `x-csrf-token`; Wallet `postMessage` kiểm exact `origin`, `source`, `requestId`, `challengeId`. Không dùng `targetOrigin="*"`.
- Vite variables (`VITE_*`) là **build-time**; API/Delivery origins, DB và encryption keys là **runtime**.

## 3. Cấu trúc thư mục rút gọn

```text
apps/
  api/                 Fastify API, seed và test integration
  web/                 React/Vite Website RP
  wallet/              React/Vite Wallet tách origin
  issuer-portal/       React/Vite cổng Issuer
  issuer/              Delivery/evidence services và AGE/LOT CLI
  prover/              LOT prover/verifier CLI
  shared/              Zod schemas, protocol, catalog, UI dùng chung
circuits/
  age/                  AgeEligibilityV1
  lot/                  LotOriginV1
  scripts/, tests/, vectors/
artifacts/              Manifest, public issuer data, owner/development artifacts, evidence kỹ thuật
prisma/
  schema.prisma
  migrations/           Migration cộng dồn
docs/                   Quyết định, ERD, threat/security, hướng dẫn, preflight và bằng chứng
docx/                   Nguồn báo cáo/đặc tả dạng Markdown hiện có
```

Không coi `node_modules`, `dist`, cache, `.work`, backup, private credentials/evidence là source hoặc tài liệu cần commit.

## 4. Công nghệ và phiên bản

| Công nghệ | Phiên bản/cấu hình đã đọc trực tiếp |
|---|---|
| Node.js / npm | Node `24.21.0` (`package.json`, `.nvmrc`); npm `11.19.0` trong `artifacts/toolchain.json` |
| TypeScript | `5.9.3` |
| React / React DOM | `19.2.0` |
| Vite | `7.3.6` |
| Fastify | `5.12.5`; `@fastify/rate-limit` `10.3.0`; `@fastify/cookie` `11.0.2` |
| PostgreSQL | Docker image `postgres:17.6-alpine`; role local trong Compose là `bvv`; host port `5434` |
| Prisma | CLI/client `6.12.0` |
| Circom | `2.2.3`, flags pin gồm `--O1 --prime bn128 --sanity_check 2` |
| circomlib / circomlibjs / snarkjs | `2.0.5` / `0.1.7` / `0.7.6` |
| ZKP | Groth16 trên `bn128` (BN254), Poseidon |
| Chữ ký | Ed25519, public key/fingerprint/version pin; private key chỉ ở CLI |
| Wallet crypto | AES-256-GCM; PBKDF2-SHA-256 với salt ngẫu nhiên; IndexedDB; Web Worker tạo proof |
| Evidence/Delivery crypto | AES-256-GCM với key runtime riêng và lưu file ngoài web root/repository |

Không tự nâng các phiên bản pin ở pipeline G1: thay toolchain có thể làm lệch artifact/hash.

## 5. Kịch bản ZKP AGE

### Mục tiêu và state machine

CUSTOMER xin credential chứng minh đủ 18 tuổi. `AgeCredentialRequest` đi qua `PENDING → APPROVED → ISSUING → ISSUED`; nhánh kết thúc khác là `REJECTED`, `REVOKED`, `EXPIRED`. Portal chỉ review/approve sau đối chiếu hồ sơ giả lập ngoài hệ thống; không phải KYC/VNeID và Website không thu hồ sơ định danh.

1. CUSTOMER tạo request ở Website, được điều hướng tới trang chi tiết riêng và nộp evidence hư cấu qua route Portal.
2. ISSUER_OPERATOR độc lập tải/review evidence và APPROVE/REJECT; API bắt buộc `recordChecked`.
3. Owner chạy `issuer:age`. CLI claim nguyên tử APPROVED→ISSUING, đọc key ngoài repo, hỏi DOB hư cấu trong terminal, ký canonical Ed25519, ghi credential ngoài repo, rồi finalize ISSUED. Nếu file đã ghi nhưng finalize lỗi, chế độ finalize-existing kiểm lại file/request để phục hồi idempotent.
4. Khi ISSUED, Portal tạo claim qua Delivery. Token ngẫu nhiên 256 bit chỉ xuất hiện trong claim URL tới Wallet; PostgreSQL chỉ lưu SHA-256 hash. TTL đúng 5 phút, dùng một lần và bind `userId + requestId + credentialId + credentialType=AGE`. Claim concurrency được tuần tự hóa trong transaction.
5. Wallet redeem, strict-parse credential, kiểm Ed25519/issuer fingerprint/key version/circuit/policy/binding/expiry; sau đó mã hóa AES-256-GCM và commit IndexedDB. Chỉ ACK sau save thành công; ACK lặp idempotent. Website projection `walletReceived` chỉ đúng khi claim liên kết đã `CLAIMED`.
6. Checkout có sản phẩm 18+ tạo `AgeChallenge` TTL 300 giây bind user/cart snapshot/cutoff/version, mở đúng Wallet popup. Wallet mở khóa, consent riêng, tạo witness/proof trong worker và gửi response về opener với exact-origin/source/id checks.
7. API kiểm lifecycle credential hiện tại, chữ ký/binding/artifact hashes, Groth16, public signals, request/cart binding, TTL và nullifier. Transaction khóa challenge, ngăn replay/duplicate và tạo `AgeVerification`.
8. Website giữ `ageVerificationId`; endpoint current khôi phục verification chưa consumed/chưa hết hạn cho đúng cart sau refresh/mất response. Tạo COD truyền ID này; API consume verification trong transaction tạo order. Một cart có nhiều sản phẩm 18+ chỉ cần một verification; cart thường không mở Wallet.

### Circuit AGE chính xác

Source: `circuits/age/age_eligibility.circom`.

- **Private inputs:** `dobDay`, `salt`, `holderSecret`.
- **Public signals đúng thứ tự:** `commitment`, `cutoffDay`, `requestHash`, `nullifier`.
- `dobDay` và `cutoffDay` bị giới hạn 17 bit.
- `dobDay <= cutoffDay`; `cutoffDay <= 73413`.
- `commitment = Poseidon([1, dobDay, salt, holderSecret])`.
- `nullifier = Poseidon([3, holderSecret, requestHash])`.
- Ngoài circuit, shared protocol dựng `requestHash = Poseidon([4, nonceField, accountHash, cartSnapshotHash, cutoffDay, circuitVersion])` theo encoding/domain pin.

Public: commitment, cutoff, request/cart binding hash, nullifier, proof và metadata Issuer tối thiểu. Bí mật: DOB/dobDay, salt, holderSecret, credential đầy đủ, PIN/passphrase, decrypted key, witness, private Issuer key. ZKP chỉ chứng minh quan hệ đã mã hóa; Issuer mô phỏng vẫn là bên tin cậy đối với dữ liệu cấp ban đầu.

## 6. Kịch bản ZKP LOT

1. ADMIN thương mại tạo lô/request và nộp evidence hư cấu; CUSTOMER không làm việc này.
2. ISSUER_OPERATOR độc lập review AGE/LOT; ADMIN không tự duyệt request của mình.
3. `LotCredentialRequest` đi `PENDING_EVIDENCE → PENDING_REVIEW → APPROVED → ISSUING → ISSUED`; nhánh kết thúc `REJECTED`, `REVOKED`, `EXPIRED`.
4. `issuer:lot` chỉ xử lý request APPROVED đã review, ký Ed25519 và ghi credential kín ngoài repo; finalize idempotent.
5. `prover:lot` kiểm credential/binding/artifact rồi tạo public proof bundle. `verify:lot` chỉ kiểm offline và phải coi revocation là chưa được kiểm online.
6. ADMIN import **public proof bundle**, không import credential kín. API kiểm issuer/key/fingerprint, chữ ký, product/lot hash, policy/version, hạn, signal order, artifact hash và Groth16 trước khi ghi `LotCredential`/`LotProof`.
7. Trang khách lấy bundle public và verification key pin để kiểm public; nhãn chỉ hiện khi trạng thái online hiện tại hợp lệ.

### Circuit LOT chính xác

Source: `circuits/lot/lot_origin.circom`.

- **Private inputs:** `originCode`, `supplierIdHash`, `salt`, `privateLotCodeHash`.
- **Public signals đúng thứ tự:** `commitment`, `publicAllowedCode`, `lotCodeHash`.
- `originCode === publicAllowedCode`.
- `privateLotCodeHash === lotCodeHash`.
- `commitment = Poseidon([2, originCode, supplierIdHash, salt, privateLotCodeHash])`.
- Policy v1 ngoài circuit pin `publicAllowedCode=1`, product/lot binding, issuer/circuit versions và artifact hashes.

### Hai lifecycle tách biệt

- **Vận hành/tồn kho:** API quản trị hiện chỉ cho `DRAFT`, `ACTIVE`, `ARCHIVED`; schema `LotStatus` vẫn còn các giá trị legacy `PENDING`, `EXPIRED`, `REVOKED`, `STALE` — đây là dư âm schema, không được dùng để trộn verification vào tồn kho.
- **Xác minh tính toán:** `UNVERIFIED`, `ACTIVE`, `EXPIRED`, `REVOKED`, `STALE` từ request/credential/proof/current time/version.
- Lô ACTIVE vận hành nhưng chưa có proof vẫn được bán theo policy hiện tại và hiển thị UNVERIFIED. Proof thiếu/hết hạn/thu hồi/stale không tự đổi stock hay cấm COD.
- Sửa lotCode làm proof stale; revoke làm REVOKED/stale theo workflow. Import/revoke/edit dùng transaction/locks và UI/API phải hỏi trạng thái hiện tại để giảm TOCTOU.
- Proof LOT không phải chứng nhận pháp lý hay bằng chứng tuyệt đối về nguồn gốc vật lý.

## 7. Vai trò và phân quyền

| Tác nhân | Được phép | Bị chặn/không sở hữu dữ liệu |
|---|---|---|
| CUSTOMER | Catalog/cart/address/COD; request/track AGE của chính mình; submit AGE evidence; nhận AGE vào Wallet; tạo AGE challenge/proof | Admin Website; dashboard/evidence operator; request LOT; request/trạng thái của user khác |
| ADMIN | Quản trị catalog/lô/tồn kho/order; tạo/nộp LOT request; import public LOT bundle | Issuer operator dashboard; tự APPROVE request LOT; private issuer key; credential AGE kín |
| ISSUER_OPERATOR | Đăng nhập riêng Portal; review/APPROVE/REJECT/REVOKE AGE và LOT; tải evidence request được phép | Admin thương mại; tạo request LOT như ADMIN; private key; signing trong browser |
| Issuer CLI | Claim request APPROVED, đọc private key ngoài repo, ký/finalize credential | Không phải browser role; không dùng làm auth Website/Portal |
| Wallet | Lưu credential AGE mã hóa; verify; consent/prove; ACK Delivery | Không quản trị, không evidence, không private Issuer key |

Role `ISSUER_OPERATOR` tồn tại và được dùng trong source/schema. Tài liệu cũ nào nói ADMIN là operator là **STALE DOCUMENTATION** sau migration `202610070002_issuer_operator_role`. Hai cookie/session audience được tách trong source hiện tại.

## 8. Database và migration

### Model chính

- Identity/commerce: `User`, `Session`, `Address`, `Category`, `Product`, `Cart`, `CartItem`, `Order`, `OrderItem`, `OrderHistory`, `InventoryMovement`.
- LOT: `Lot`, `LotCredentialRequest`, `LotVerificationEvidence`, `LotCredential`, `LotProof`.
- AGE: `AgeCredentialRequest`, `AgeVerificationEvidence`, `AgeCredentialDelivery`, `AgeCredentialClaim`, `AgeChallenge`, `AgeVerification`.
- Audit: `AuditLog` với `actorId` hiện vẫn bắt buộc; kế hoạch làm nullable đã bị hủy và không có migration brute-force/audit mới.

### Migration theo thứ tự source

1. `202609280001_g2`
2. `202609280002_g3_age`
3. `202609280003_g3_issuer_binding`
4. `202609280004_g4_lot`
5. `202610040001_pilot_issuer_lifecycle`
6. `202610040002_pilot_age_status_values`
7. `202610040003_pilot_lifecycle_consistency`
8. `202610050001_age_credential_delivery`
9. `202610070001_age_verification_evidence`
10. `202610070002_issuer_operator_role`
11. `202610070003_lot_request_evidence`

Tài liệu `docs/lot-request-evidence-2026-10-07.md` báo cáo lịch sử public và `g2_test_20261007` đã có 11 migration finished, 0 failed/rolled back, drift NONE. **Không dùng thông tin lịch sử đó như xác minh hiện tại:** ngày bàn giao port 5434 không listen; `prisma migrate status` thất bại ở schema engine nên migration/drift hiện tại là `CHƯA XÁC MINH`.

Nguyên tắc bất biến: migration cộng dồn; backup + `pg_restore -l` + preflight chỉ đọc trước migration; không reset/drop/resolve mù; không sửa migration đã áp dụng. Schema test được phép dùng là `g2_test_20261007` theo cấu hình owner gần nhất. Các schema test cũ (đặc biệt `g2_test` và `g2_test_20261005`) không được resolve, rollback, drop hoặc sử dụng. Luôn kiểm `current_schema()` trước test.

## 9. Trạng thái kiểm thử tại lần bàn giao

| Kiểm tra hiện tại | Kết quả 14/10/2026 | Ghi chú/lệnh owner |
|---|---|---|
| Prisma validate | **PASS** | `cd apps; npx prisma validate --schema ..\prisma\schema.prisma` |
| Migration status/drift | **BLOCKED / CHƯA XÁC MINH** | PostgreSQL `127.0.0.1:5434` không listen; chạy status và drift sau khi DB lên |
| Unit không DB trong app runner | **PASS 4/4** | Nhóm login IP limiter/generic failure chạy trước bước DB |
| Toàn bộ `npm test` trong `apps` | **FAIL (môi trường)** | Runner dừng khi Prisma không kết nối schema `g2_test_20261007`; không có kết quả toàn bộ suite hiện tại |
| Website build | **PASS** | Vite cảnh báo chunk >500 kB, không phải lỗi |
| Wallet build | **PASS** | Vite cảnh báo chunk lớn, không phải lỗi |
| Issuer Portal build mặc định | **FAIL đúng fail-closed** | Thiếu build-time `WEBSITE_ORIGIN` |
| Issuer Portal build với origin local rõ ràng | **PASS** | `$env:WEBSITE_ORIGIN='http://127.0.0.1:5173'` rồi build |
| TypeScript | **PASS** | `cd apps; npx tsc --noEmit` |
| G1 static preservation | **PASS 45/45** | So SHA-256 chỉ đọc với `.work/g2/g1-baseline.json`, loại `artifacts/evidence/witness-tests.json` là evidence động |
| Witness/owner verification | **CHƯA CHẠY** | Không chạy owner harness/private input; báo cáo lịch sử 71/71 không được nâng thành kết quả lần này |
| Browser smoke | **CHƯA CHẠY** | Không có service nào listen ở 3001/3002/5173/5174/5175 |
| Owner Browser AGE E2E | **PENDING OWNER** | Cần credential/key owner; agent không chạy |
| Owner Browser LOT E2E | **PENDING OWNER** | Cần owner ký và public bundle mới |
| Cache lạnh/ấm AGE | **PENDING OWNER** | Thực hiện theo `docs/wallet-manual-test.md` |
| Deploy E2E | **PENDING** | Chưa deploy |

Không chạy root `npm test` vì đó là circuit harness có thể cập nhật evidence động và cần phạm vi owner; không chạy Issuer CLI/prover/private credentials.

## 10. Trạng thái hoàn thành

| Hạng mục | Trạng thái | Bằng chứng/source | Việc tiếp theo |
|---|---|---|---|
| Website nghiệp vụ | DONE | `apps/web`, API routes/tests | Hồi quy với DB và Browser |
| AGE circuit | OWNER VERIFIED (lịch sử) | circuit, manifest, `docs/test-evidence.md` | Giữ bất biến; static 45/45 hiện PASS |
| LOT circuit | OWNER VERIFIED (lịch sử) | circuit, manifest, `docs/test-evidence.md` | Giữ bất biến |
| Issuer Portal | DONE về source/build có config | `apps/issuer-portal`; build hiện PASS khi truyền origin | Browser ba vai trò |
| Wallet | DONE về source/build | `apps/wallet`; build hiện PASS | AGE owner E2E/cold-warm |
| Credential Delivery | DONE về source | `apps/issuer/delivery-*`, tests | Integration/Browser khi DB lên |
| Evidence AGE | DONE về source | migration 001 evidence, service/tests/docs | Xác minh migration hiện tại và fixture hư cấu |
| Evidence LOT | DONE về source | migration LOT003, service/tests/docs | Xác minh migration hiện tại và fixture hư cấu |
| CLI cấp credential | DONE về source | `issue-age.ts`, `issue-lot.ts` | Owner chạy ngoài repo khi E2E |
| Proof verification | DONE về source | `age.ts`, `lot.ts`, prover/verifier | Full integration khi DB lên |
| Migration | BLOCKED hiện tại | 11 thư mục migration; DB không listen | Start DB, status, drift/preflight |
| E2E local | PENDING | manual guides | AGE + LOT Browser bằng dữ liệu hư cấu |
| Deploy | PENDING | chưa có môi trường production | Checklist §14 |
| Báo cáo Word | PENDING | không có `.docx` tracked; nguồn Markdown trong `docx/` | Hoàn thiện sau E2E/deploy |
| Phụ lục | PENDING | docs/evidence hiện có | Lọc bằng chứng sạch |
| Slide | PENDING | không có `.pptx` tracked | 7–10 trang sau báo cáo |
| Video demo | PENDING | không có video tracked | Viết script và quay sau deploy/E2E |
| Kiểm tra secret/Git | BLOCKED vệ sinh Git | xem cuối mục này | Owner review dirty tree và Prisma binaries tạm |

### Git/secret check chỉ đọc

- HEAD: `0cd6d9f`; lịch sử hiện có hai commit.
- Working tree: **không sạch**, 45 modified + 19 untracked trước khi thêm hai file bàn giao. Đây là thay đổi có sẵn; không reset/checkout.
- Không có private-key extension/marker, dump/backup data, `node_modules`, `dist` hoặc `.work` được track.
- `.env.example` được track và chỉ được phép chứa placeholder. Không có `.env` runtime được track.
- Các đường dẫn tên `credential` được track là source/migration; các đường dẫn `evidence` là public technical evidence và ảnh tài liệu, không phải plaintext upload owner theo kiểm tra tên/path. Không mở evidence riêng trong lượt này.
- Rủi ro repo: bốn file `apps/api/generated/client/query_engine-windows.dll.node*` khoảng 20,13 MB mỗi file đang tracked, gồm ba file `.tmp...`; owner nên review bằng commit riêng, không tự xóa giữa working tree dirty.
- Scan assignment chỉ đánh dấu `.env.example`; không in giá trị. Không phát hiện marker PEM private key trong tracked files.

## 11. Quyết định đã chốt

- Website là Relying Party và không nhận DOB/private credential/salt/holderSecret/witness/private key.
- Private key chỉ do Issuer CLI đọc từ secret path ngoài repository; Portal/API/browser không ký.
- Wallet giữ credential AGE mã hóa AES-256-GCM trong IndexedDB; mã khóa 8–64 ký tự, không log/lưu plaintext.
- Một cart nhiều sản phẩm 18+ dùng một verification bind toàn cart; cart thường không mở Wallet.
- AGE challenge TTL 300 giây; Delivery claim TTL 5 phút; nullifier/requestHash/cart binding và current credential state chống replay/stale.
- ACK Delivery chỉ sau strict verification + encryption + IndexedDB commit; retry idempotent.
- LOT operational lifecycle tách verification lifecycle; proof không tự thay stock/khả năng bán.
- LOT proof không phải chứng nhận pháp lý/xác nhận tuyệt đối nguồn gốc vật lý.
- UI khách không lạm dụng chữ “demo/mô phỏng/thử nghiệm”; giới hạn học thuật phải trình bày rõ ở báo cáo và đúng ngữ cảnh Issuer.
- Không thêm tính năng ngoài phạm vi chỉ để giống production.
- Không tạo migration AuditLog/brute-force/account lock/HMAC limiter khi owner chưa yêu cầu lại. Hiện chỉ giữ IP rate limit và generic login error/dummy Argon2.

**STALE DOCUMENTATION:** các đoạn cũ nói ADMIN là Issuer operator; baseline “46/46 bất biến” mà không tách witness evidence động; trạng thái migration 9/10; hoặc nói repo không có `.git`. Source hiện có `ISSUER_OPERATOR`, 11 migration và Git metadata; static gate hiện là 45/45 + witness evidence riêng.

## 12. Lỗi/bài học đã biết

- Chạy CLI từ `apps`; script đúng là `npm run issuer:age -- --request ...` và `npm run issuer:lot -- --request ...`. Dấu `--` bắt buộc để npm chuyển tiếp `--key/--out`; không đặt private key/credential trong repo.
- Không đoán đường dẫn CLI từ tài liệu cũ; đối chiếu `apps/package.json` và file CLI.
- Nếu 5173/5174/5175 bị chiếm, xác định đúng PID trước khi dừng; không kill tiến trình không thuộc dự án.
- PostgreSQL container dùng role `bvv`, không phải `postgres`; host port `5434`.
- Issuer Portal production build yêu cầu `WEBSITE_ORIGIN`; backend production yêu cầu exact origins. Thiếu phải fail closed.
- Test Prisma phải trỏ đúng `g2_test_20261007` và kiểm `current_schema()`; không để test ghi public/schema test cũ.
- LOT import nhận public proof bundle, không nhận credential private.
- Không in secret/request body/private material khi chẩn đoán; không sửa dữ liệu trực tiếp để giả PASS.
- `ISSUING` có thể tồn tại rất ngắn khi CLI hoàn tất nhanh; kiểm audit/state cuối thay vì buộc nhìn UI trung gian.
- Vite chunk warning không đồng nghĩa build fail; vẫn là nợ tối ưu hiệu năng.

## 13. Hướng dẫn chạy bằng PowerShell

### Chuẩn bị và DB

```powershell
Set-Location E:\ban-vi-viet
docker compose up -d postgres
docker compose ps
Test-NetConnection 127.0.0.1 -Port 5434
```

Kiểm presence mà không in secret:

```powershell
Test-Path .\apps\.env
$required = 'DATABASE_URL','TEST_DATABASE_URL','WEB_ORIGIN','WALLET_ORIGIN','ISSUER_PORTAL_ORIGIN','ISSUER_DELIVERY_ORIGIN','AGE_EVIDENCE_STORAGE_DIR','AGE_EVIDENCE_ENCRYPTION_KEY'
$names = Get-Content .\apps\.env | Where-Object { $_ -match '^[A-Z][A-Z0-9_]*=' } | ForEach-Object { ($_ -split '=',2)[0] }
$required | ForEach-Object { [pscustomobject]@{ Name=$_; Present=($names -contains $_) } }
```

Không in URL/key. Trước test, dùng client DB cục bộ phù hợp để chạy `SELECT current_schema()` và bắt buộc nhận `g2_test_20261007`. Sau backup/preflight nếu có migration pending:

```powershell
Set-Location E:\ban-vi-viet\apps
npx prisma validate --schema ..\prisma\schema.prisma
npx prisma migrate status --schema ..\prisma\schema.prisma
npm run db:migrate
npx prisma migrate status --schema ..\prisma\schema.prisma
```

Không dùng `migrate reset`, `migrate resolve`, `docker compose down -v`, DROP/TRUNCATE/DELETE. Drift read-only nên dùng shadow/test DB riêng theo quy trình owner; không để Prisma tạo/xóa schema chứa dữ liệu.

### Dev, URL và kiểm tra

```powershell
Set-Location E:\ban-vi-viet\apps
npm run dev
```

- Website: `http://127.0.0.1:5173`
- Wallet: `http://127.0.0.1:5174`
- Issuer Portal: `http://127.0.0.1:5175`
- API health: `http://127.0.0.1:3001/api/health`
- Delivery: `http://127.0.0.1:3002` (không có public credential URL)

```powershell
Set-Location E:\ban-vi-viet\apps
npm test
npm run build
npx tsc --noEmit
Set-Location E:\ban-vi-viet
$baseline = Get-Content -Raw .work\g2\g1-baseline.json | ConvertFrom-Json
$static = $baseline | Where-Object path -ne 'artifacts/evidence/witness-tests.json'
$bad = $static | Where-Object { (Get-FileHash -Algorithm SHA256 $_.path).Hash.ToLowerInvariant() -ne $_.sha256.ToLowerInvariant() }
"G1 static: $($static.Count-$bad.Count)/$($static.Count); mismatch=$($bad.Count)"
```

Khi port bị chiếm:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001,3002,5173,5174,5175 | Select-Object LocalPort,OwningProcess
Get-Process -Id <PID> | Select-Object Id,ProcessName,Path
Stop-Process -Id <PID>   # chỉ sau khi xác nhận là tiến trình dev của dự án
```

## 14. Checklist deploy (không thực hiện trong bàn giao)

1. Cấp PostgreSQL production riêng, TLS/backup/least privilege; không dùng mật khẩu Compose/local.
2. Tạo backup owner, kiểm catalog restore, chạy preflight chỉ đọc và `prisma migrate deploy` một lần có giám sát; ghi status/checksum/row counts; chuẩn bị restore/rollback ứng dụng tương thích migration cộng dồn.
3. Deploy API 3001 và Delivery 3002 sau reverse proxy HTTPS; health/readiness không trả secret/credential.
4. Deploy Website, Wallet, Issuer Portal trên **ba HTTPS origins riêng**.
5. Build frontend với `VITE_API_ORIGIN`, `VITE_WEB_ORIGIN(S)`, `VITE_WALLET_ORIGIN`, `VITE_ISSUER_PORTAL_ORIGIN`, `VITE_ISSUER_DELIVERY_ORIGIN` chính xác. Đây là build-time; thay đổi cần rebuild.
6. Runtime backend cấu hình `DATABASE_URL`, exact `WEB_ORIGIN`, `WALLET_ORIGIN`, `ISSUER_PORTAL_ORIGIN`, `ISSUER_DELIVERY_ORIGIN`, cookie security và proxy tin cậy theo topology cụ thể. Không bật `trustProxy=true` vô điều kiện.
7. Secret runtime riêng: session/auth, Delivery encryption, Evidence encryption, external evidence storage; private signing keys chỉ trên máy CLI, không ở image/DB/frontend.
8. CORS exact allowlist, CSRF exact origin, credentials/cookie `Secure + HttpOnly + SameSite`, CSP/XFO/nosniff giữ chặt; không wildcard hoặc open redirect.
9. Smoke: health, login CUSTOMER/ADMIN/ISSUER_OPERATOR, RBAC cross-role, catalog/cart/order, evidence ciphertext, no secret fields/logs.
10. Chạy AGE và LOT E2E sau deploy bằng fixture hư cấu; owner tự vận hành CLI/key. Kiểm claim TTL/replay, checkout consume, LOT revocation/stale/current status.
11. Rollback: ưu tiên rollback app về bản tương thích schema; không xóa migration đã chạy. Restore DB chỉ theo kế hoạch owner đã thử và khi xác nhận phạm vi dữ liệu.

Giới hạn: memory rate limiter chỉ phù hợp pilot một API instance. Multi-instance cần shared store/chính sách nâng cao nhưng nằm ngoài phạm vi hiện tại.

## 15. Hoàn thiện báo cáo đồ án

Thứ tự còn lại bắt buộc:

1. Đóng băng phiên bản code sau khi owner review dirty tree.
2. Khởi động DB và chạy hồi quy cuối đầy đủ.
3. Deploy theo checklist.
4. Chạy AGE/LOT E2E sau deploy.
5. Chụp bằng chứng sạch.
6. Hoàn thiện Chương 3 theo hệ thống thực tế.
7. Sửa Chương 2 khớp kiến trúc/công nghệ đã pin.
8. Rà Chương 1 và giới hạn phát biểu.
9. Hoàn thiện tài liệu tham khảo/giấy phép ảnh.
10. Hoàn thiện phụ lục migration, circuit, test matrix, threat model.
11. Làm slide 7–10 trang.
12. Viết và quay video/demo script.
13. Kiểm tra định dạng, link, hash/version và đóng gói nộp.

Ảnh nên chụp: storefront/cart thường; checkout AGE trước/sau verify; Wallet locked/consent/success; request AGE Website; operator AGE/LOT review bằng fixture hư cấu; LOT ACTIVE và UNVERIFIED; role guards; migration/test/build summary; deploy origins/health. Tuyệt đối che/không chụp mật khẩu, cookie/token, connection string, private key, DOB, private credential, evidence plaintext owner, PIN, IndexedDB value, salt, holderSecret, witness hoặc request body bí mật.

## 16. Tệp Codex mới phải đọc trước

1. `docs/project-handoff-current.md`
2. `README.md`
3. `docs/decisions.md`
4. `docx/implementation-spec.md`
5. `apps/package.json` và root `package.json`
6. `prisma/schema.prisma` và `prisma/migrations/*/migration.sql`
7. `circuits/age/age_eligibility.circom`, `circuits/lot/lot_origin.circom`, `artifacts/manifest.json`
8. `apps/shared/age-wallet.ts`, `apps/shared/g3.ts`, `apps/shared/g4.ts`
9. `apps/api/src/age.ts`, `apps/api/src/lot.ts`, `apps/api/src/app.ts`
10. `apps/web/src/App.tsx`, `apps/wallet/src/App.tsx`, `apps/issuer-portal/src/App.tsx`
11. `apps/issuer/delivery-service.ts`, `issue-age.ts`, `issue-lot.ts`, `apps/prover/prove-lot.ts`
12. `docs/wallet-manual-test.md`, `docs/api-erd.md`, `docs/security-assessment.md`, `docs/lot-request-evidence-2026-10-07.md`, các preflight SQL liên quan.

Luôn ưu tiên source/schema/DB đang chạy hơn số liệu lịch sử trong docs.

## 17. Prompt tiếp quản

> Hãy tiếp quản dự án Bản Vị Việt tại `E:\ban-vi-viet`. Trước khi sửa, đọc `docs/project-handoff-current.md` và source trực tiếp, rồi chạy `git status --short`. Working tree có thay đổi owner: không reset/checkout/ghi đè hoặc hoàn tác ngoài phạm vi. Không chạy/đọc private key, credential owner, evidence riêng, PIN, IndexedDB hay witness; không reset/drop/resolve database. Chỉ thực hiện đúng nhiệm vụ owner giao tiếp theo, giữ circuit/public signals/trusted setup/artifact G1 bất biến. Xác minh bằng test/build phù hợp; nếu DB không chạy hoặc cần migration/quyền mới thì dừng và báo blocker. Cuối lượt báo file đã sửa, kiểm tra đã chạy và phần owner còn phải làm; không tuyên bố production-ready.
