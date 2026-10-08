# Đặc tả triển khai Bản Vị Việt ZKP cho một sinh viên

**Phiên bản 2.0 — 24/09/2026.** Tài liệu này là đầu vào để Codex xây hệ thống, đồng thời làm căn cứ đối chiếu Chương 2–3. Đây là **kế hoạch**, chưa phải mô tả chức năng đã hoàn thành. Đọc toàn bộ trước khi code. Khi mã và tài liệu khác nhau, sửa tài liệu theo thiết kế đã kiểm thử; ghi quyết định trong `docs/decisions.md`.

## 1. Mục tiêu và giới hạn phát biểu

Bản Vị Việt là cửa hàng thương mại điện tử thử nghiệm quy mô SME bán cà phê, trà, bánh/mứt, quà tặng và một số đồ uống có cồn. Website có danh mục, tài khoản, giỏ theo tài khoản, địa chỉ, đặt hàng COD, xem đơn và quản trị tối giản. Không tích hợp cổng thanh toán, hãng vận chuyển, blockchain, hệ thống căn cước hoặc cơ quan chứng nhận thật.

**A — Khách hàng chứng minh đủ tuổi:** Với mặt hàng do admin cấu hình yêu cầu tuổi, khách dùng credential cấp trước để tạo proof trên trình duyệt. Backend kiểm tra proof và điều kiện nghiệp vụ trước khi cho đặt hàng; không nhận ngày sinh/witness. Ngưỡng 18 trong dữ liệu thử nghiệm là **cấu hình demo**, không phải kết luận chung về chính sách pháp lý cho mọi sản phẩm.

**B — Doanh nghiệp chứng minh một thuộc tính của lô hàng:** Issuer mô phỏng cấp credential cho lô chứa mã vùng xuất xứ và mã nhà cung cấp nội bộ. Cửa hàng tạo proof trước khi công bố lô. Người xem kiểm tra rằng mã vùng của đúng lô **bằng mã vùng công khai được công bố trong chính sách**, trong khi không thấy mã nhà cung cấp, salt hoặc chứng từ nội bộ. Circuit B v1 chọn **một vùng công khai**, không làm OR nhiều vùng. Mã vùng được tiết lộ; chỉ thông tin nội bộ còn lại được che. Nếu không có thông tin đã được Issuer xác nhận cần giữ bí mật, chữ ký số thông thường là lựa chọn đơn giản hơn ZKP.

Hai kịch bản là **đầu ra bắt buộc của đồ án này**. Bản thiết kế hoặc stub cho B không được tính là hoàn thành hai kịch bản. Nếu deadline/giảng viên chỉ cho phép một circuit, chốt lại mục tiêu đề tài và báo cáo trung thực là đã triển khai một kịch bản; Codex không tự báo đạt cả hai. Mức tin cậy của Issuer demo chỉ là giả định thử nghiệm.

| Bên | A | B |
|---|---|---|
| Prover | Khách hàng, trình duyệt | Cửa hàng, script tạo proof trước khi công bố |
| Verifier | Backend cửa hàng | Trình duyệt khách; script Node.js dùng để đối chiếu proof |
| Giữ bí mật | Ngày sinh, salt, holder secret | Mã nhà cung cấp, salt, hồ sơ lô |
| Công khai | Commitment, ngày cắt tuổi, requestHash, nullifier | Commitment, mã lô, mã vùng công khai, metadata hiệu lực |

### 1.1 Điều không được khẳng định

Groth16 chứng minh quan hệ toán học trong circuit, **không** chứng minh ngày sinh thật, Issuer đã kiểm tra hồ sơ thực, sản phẩm vật lý có đúng xuất xứ, hàng được giao đúng lô, doanh nghiệp tuân thủ mọi nghĩa vụ dữ liệu cá nhân, hay sản phẩm có bản quyền. Chữ ký Issuer, trạng thái thu hồi, liên kết tài khoản/lô, thời gian, quyền truy cập và tình trạng tồn kho được kiểm tra **ngoài circuit**. Một người có thể kiểm soát cả CLI Issuer và website trong demo; đó là **phân vai logic**, không phải độc lập thể chế. Không gọi chứng nhận demo là chứng nhận pháp lý.

## 2. Quy mô 3–5 tuần và thứ tự ưu tiên

| Mức | Phải làm | Có thể để sau khi chạy được hai proof |
|---|---|---|
| Web | 2–3 danh mục, **6–8 sản phẩm** (2 mặt hàng yêu cầu tuổi), giỏ theo tài khoản, địa chỉ, COD, trang đơn và admin CRUD cơ bản | Giỏ khách vãng lai, hợp nhất giỏ, lọc/báo cáo nâng cao, nhiều trạng thái giao nhận |
| Lô | **3 lô demo**: hợp lệ, hết hạn, bị thu hồi | Nhiều lô và nhập chứng nhận hàng loạt |
| ZKP | Hai circuit, setup riêng, Issuer demo ký commitment, A kiểm ở checkout, B kiểm ở trang lô | Nhiều vùng OR, Worker, công cụ kiểm toán hoàn chỉnh |
| Test | Test circuit đúng/sai/biên; integration checkout/tồn; một E2E mua hàng tuổi; thử trạng thái hết hạn/thu hồi lô | E2E mọi nhánh UI, tải lớn, chạy đa trình duyệt |
| Tài liệu | 3 file gọn bên dưới và README | Báo cáo vận hành dài, tài liệu riêng cho từng module |

**Lịch 4 tuần là mục tiêu có điều kiện**, không có cơ sở để bảo đảm tỷ lệ hoàn thành 100% khi chưa biết nền tảng của người thực hiện, máy thử nghiệm, thời gian và độ khó của circuit. Chốt mốc với giảng viên và dự phòng ít nhất một tuần nếu có thể. Tuần 1 chốt phát biểu, chạy hai circuit bằng dữ liệu giả và kiểm thử ràng buộc trước khi làm giao diện. Tuần 2 làm DB, API, catalog, giỏ, đơn COD tối giản. Tuần 3 tích hợp A vào checkout và B vào trang lô. Tuần 4 kiểm tra lỗi, đo thời gian, dàn giao diện và cập nhật báo cáo. Nếu có 10–14 tuần, dùng các tuần dư cho gia cố và kiểm thử; không thay B thật bằng stub chỉ để khớp lịch. Sau 2 ngày mà circuit B chưa thể tạo proof đúng/sai, giữ công việc web độc lập và trao đổi lại phạm vi với giảng viên trước khi đổi đề tài.

### 2.1 Cổng hoàn thành từng giai đoạn

1. **G0:** viết rõ private/public, tín hiệu, issuer giả lập, tiêu chí B cần giấu, phiên bản nguồn; test vector tối thiểu ở `docs/decisions.md`.
2. **G1:** hai circuit biên dịch và thử proof/verify offline; setup đã có contribution và manifest checksum. Chưa chuyển sang tích hợp nếu circuit cho phép witness sai.
3. **G2:** API+DB có checkout thường, không bán âm tồn; E2E đơn COD bình thường.
4. **G3:** A chứng minh đủ tuổi ở trình duyệt, API từ chối underage/replay/challenge sai.
5. **G4:** B tạo proof trước, web từ chối sai lô/chữ ký/credential bị thu hồi/hết hạn; script kiểm lại proof.
6. **G5:** có ảnh demo, bảng đo thật, mã nguồn build/test được, Chương 2–3 khớp hệ thống.

## 3. Công nghệ và môi trường

Node.js **24 LTS**, TypeScript, npm workspaces/lockfile; React + Vite cho web; Fastify cho API; PostgreSQL + Prisma cho DB; Circom 2, circomlib Poseidon và comparator, snarkjs/Groth16 trên đường cong **BN128 (còn gọi BN254 trong ngữ cảnh hệ sinh thái)**. Khóa phiên bản thực tế trong lockfile, Dockerfile DB và manifest; kiểm tra tài liệu phiên bản trước khi cài. BN128 là tên curve trong lệnh Powers of Tau của snarkjs; không mặc nhiên cho rằng tùy chọn của mọi công cụ đều mặc định như nhau [R1–R4].

**Chạy demo:** PostgreSQL bằng **một container Docker** hoặc bản PostgreSQL sẵn trên máy; `npm run dev` chạy web/API trực tiếp. `compose.yaml` có thể chỉ chứa DB. Không cần Compose nhiều service, Redis, Kubernetes hay dịch vụ ngoài. Dùng **một database** với bảng nghiệp vụ và bảng credential khác nhau. Issuer mô phỏng là **một CLI riêng với private key lưu ngoài git và ngoài cấu hình API/web**; người dùng có thể sử dụng cùng tài khoản ADMIN khi điều khiển demo, không tạo `ISSUER_OPERATOR` hoặc DB role riêng. `docs/decisions.md` phải ghi rõ private key là tệp cục bộ có quyền truy cập hạn chế do CLI đọc trực tiếp, **không nằm trong session/cookie/token ADMIN hoặc biến môi trường của tiến trình web/API**. Về kỹ thuật, một admin nắm private key có thể tự cấp credential. Báo cáo phải nói rõ sự phân vai chỉ là mô phỏng. Không mở route công khai để admin tùy ý ghi trạng thái proof hợp lệ.

Trang web và API chạy same-origin qua Vite proxy khi phát triển; session cookie HttpOnly/SameSite, Secure ngoài localhost; backend kiểm tra quyền từng đối tượng, CSRF token cho mutation. Mật khẩu băm Argon2id. Không dùng JWT thủ công để tiết kiệm một hệ refresh-token riêng. Chính sách pháp lý trong báo cáo đối chiếu Luật 91/2025/QH15 và Nghị định 356/2025/NĐ-CP đang có hiệu lực, không nói ZKP là chứng nhận tuân thủ [R7].

## 4. Chức năng và giao diện

**Khách:** trang chủ, danh mục/tìm kiếm đơn giản, chi tiết sản phẩm, đăng ký/đăng nhập, giỏ theo tài khoản, địa chỉ, đặt COD, danh sách và chi tiết đơn. Sản phẩm có cờ tuổi hiển thị điều kiện ở trang chi tiết và checkout. Trên chi tiết sản phẩm có lô tương ứng và nút **“Kiểm tra thông tin lô”**: hiển thị phát biểu hẹp, tên Issuer **mô phỏng**, ngày hiệu lực và kết quả. Nếu proof thất bại/hết hạn/thu hồi, không hiển thị nhãn “được xác minh”.

**Admin:** CRUD 6–8 sản phẩm/danh mục/lô, chọn lô có chứng nhận, cờ và ngưỡng tuổi, chỉnh tồn, xem đơn, chuyển trạng thái. Mô hình đơn tối giản: `PENDING → CONFIRMED → COMPLETED`, có `CANCELLED` theo quy tắc. COD mặc định chưa thu tiền; khi hoàn thành mới đánh dấu đã thu COD bằng thuộc tính `cod_collected_at` nếu demo cần đối soát; không cần máy trạng thái thanh toán riêng. Giao nhận được mô phỏng bằng trạng thái đơn, không giả lập hãng vận chuyển thật.

**Thiết kế:** tông kem/nâu/xanh phù hợp hàng đặc sản Việt, ảnh sản phẩm có quyền sử dụng, giao diện tiếng Việt responsive, chú trọng nút mua và thông tin giá. Không để tham số kỹ thuật che việc mua hàng: ZKP chỉ xuất hiện khi cần hoặc khi người xem chủ động kiểm tra. Thông báo spinner trước khi tạo proof; **`async/await` không bảo đảm UI vẫn phản hồi** nếu phần tính toán chặn main thread. MVP được phép gọi `snarkjs.groth16.fullProve` trên main thread *sau khi spinner đã render*, thử trên máy mục tiêu; nếu giao diện đứng lâu không chấp nhận được, chuyển sang Web Worker. Worker là tối ưu hóa có điều kiện, không mặc định bỏ qua vấn đề hiệu năng [R8]. Không đưa dữ liệu credential vào console/log.

## 5. Cấu trúc repository và tài liệu tối thiểu

```text
ban-vi-viet-zkp/
├── AGENTS.md                      # yêu cầu Codex đọc đặc tả, giữ secret khỏi git
├── README.md                      # lệnh chạy, dữ liệu demo, giới hạn hệ thống
├── package.json / package-lock.json / .nvmrc / .env.example
├── compose.yaml                   # chỉ PostgreSQL nếu dùng Docker
├── apps/
│   ├── web/src/                   # React: catalog, cart, checkout, orders, lot verify, admin
│   ├── api/src/                   # Fastify: auth, product, cart, order, zkp, admin
│   └── issuer-cli/src/            # issue-age, issue-lot, revoke; cùng DB, khóa riêng
├── packages/contracts/           # enum, DTO, thứ tự public signals
├── circuits/
│   ├── age/age_eligibility.circom
│   ├── lot/lot_origin.circom
│   ├── scripts/                   # setup, test, bench, verify-bundle.ts
│   └── vectors/                   # đúng/sai/biên
├── prisma/schema.prisma / prisma/migrations/ / prisma/seed.ts
├── artifacts/manifest.json       # hash .r1cs/.wasm/.zkey/vk, phiên bản
├── docs/
│   ├── implementation-spec.md    # bản này
│   ├── decisions.md              # threat model rút gọn; ngày/issuer/vùng/khóa/setup
│   ├── api-erd.md                # endpoints, bảng, ERD
│   └── test-evidence.md          # test, ảnh minh họa, số đo thật
└── tests/integration/ / tests/e2e/
```

`README.md` đủ để người khác chạy từ seed sạch. Tệp `.env`, private key, DOB, salt, holder secret, witness, kho credential, bản sao DB không được commit. Public verification key và manifest có thể công bố. `verify-bundle.ts` chỉ là **một script Node.js**, không cần package/ứng dụng CLI riêng. `groth16.verify` đơn lẻ chỉ kiểm phương trình mật mã; script còn phải kiểm hash verification key, chữ ký Issuer và binding lot/policy ở bundle trước khi in kết luận hẹp. `decisions.md` lưu rõ dấu vân tay public key, setup transcript/hash và giới hạn single-party.

## 6. Database vừa đủ dùng

Khóa ID UUID, thời gian UTC, VND lưu `bigint` đơn vị đồng; BigInt qua JSON là chuỗi thập phân. Các index và foreign key cần thiết phải có migration. Không cần nhóm bảng ưu đãi cũ.

| Bảng | Cột chính và ràng buộc |
|---|---|
| `users`, `sessions`, `addresses` | email unique, password_hash, role `CUSTOMER/ADMIN`, trạng thái; session token hash và TTL; địa chỉ có `user_id`, chỉ chủ sở hữu được đọc/sửa |
| `categories`, `products`, `product_images` | slug unique, giá nguyên, tồn, trạng thái, `requires_age_proof`, `minimum_age`; ảnh đã kiểm tra loại/kích thước |
| `lots` | product_id, lot_code unique theo product, stock_qty, status; không đổi product sau cấp credential |
| `carts`, `cart_items` | cart.user_id unique, product_id unique trong cart, quantity > 0; giá lấy lại từ product |
| `orders`, `order_items`, `order_status_history` | user_id, địa chỉ snapshot, giá/tổng snapshot, trạng thái, `idempotency_key` unique theo user; item có lot_id nếu chọn lô; lịch sử append-only |
| `inventory_movements` | lot_id hoặc product_id, order_id, delta, reason; đối chiếu tồn |
| `issuers` | type `AGE/LOT`, public key, fingerprint, status/version; **không có private key** |
| `credential_commitments` | type, subject_user_id hoặc lot_id, commitment, signed_metadata, issuer_signature, issue/expiry/status; không lưu DOB/supplier secret |
| `circuit_versions` | type, version, hashes của artifact, signal schema hash, active/retired |
| `age_challenges`, `age_verifications` | challenge gắn user, snapshot giỏ, cutoff, requestHash, expires/status; verification gắn challenge, nullifier unique, expires, proof_hash/result; không lưu proof/witness tuổi |
| `lot_proofs` | lot_id, credential_id, circuit_version, policy_version, proof và public signals, status, created_at; dữ liệu công khai có thể lưu |
| `public_policies`, `audit_logs` | policy version và đúng **một origin code** công khai; audit chỉ action/object/time/result, không ghi request body/secret |

**Checkout transaction:** tính lại giá/số lượng/cờ tuổi; chọn ngưỡng tuổi lớn nhất trong giỏ; khóa/cập nhật tồn có điều kiện; kiểm tra age verification đúng tài khoản + hash snapshot giỏ + TTL; chèn đơn và items; trừ tồn, đánh dấu verification tiêu thụ, lưu biến động. Nếu lỗi, rollback toàn bộ. Request lặp cùng `idempotency_key` trả cùng đơn. Hủy đơn trả tồn một lần. Không mở transaction trong lúc chạy `fullProve` hoặc đợi HTTP.

## 7. Issuer mô phỏng và chữ ký

Một **script Issuer CLI** có private key Ed25519 riêng trên máy thực hiện; người chạy có thể chính là ADMIN demo. CLI tiếp nhận dữ liệu **hư cấu**, ghi lý do cấp trong nhật ký demo không có bí mật, tính commitment và ký thông điệp canonical `domain || version || commitment || subject/lot binding || issuedAt || expiresAt || issuerKeyVersion`. Định nghĩa byte order, encoding, độ dài trường trong `decisions.md`; backend/web kiểm tra chữ ký bằng public key pin theo fingerprint. Không ký JSON với key order không ổn định. Chữ ký **ở ngoài circuit**; Groth16 chứng minh các trường kín khớp commitment đã được Issuer ký. Nếu chỉ tự nhập dữ liệu rồi tự cấp, demo không xác thực sự thật đời sống.

**A:** Issuer tiếp nhận DOB demo và tạo `dobDay`, salt, holder secret; private credential xuất một lần cho wallet khách dạng tệp demo được giữ ngoài repository. API thương mại điện tử chỉ nhận signed commitment + metadata tài khoản; không lưu ngày sinh. CLI không ghi DOB/secret vào log. Credential gắn `userIdHash` để backend so với session khi verify.

**B:** Issuer xem hồ sơ lô mô phỏng, cấp private credential gồm `originCode`, `supplierIdHash`, `salt`, `lotCodeHash`; ký commitment và metadata lot/product/expiry. Tệp credential riêng chỉ cho admin/prover đọc lúc tạo proof, không trả cho trình duyệt. `supplierIdHash` không được đưa vào proof bundle; salt đủ ngẫu nhiên để commitment không dễ bị dò từ miền mã nhà cung cấp nhỏ.

**Thu hồi:** CLI cập nhật `credential_commitments.status = REVOKED` và đánh dấu `lot_proofs` liên quan `STALE` cùng transaction. `GET /lots/:id/proof-bundle` thực hiện một truy vấn/join DB cho `lots`, `credential_commitments`, `issuers`, `lot_proofs` và policy hiện hành, so thời gian máy chủ với `expiresAt`, trả `status = ACTIVE/REVOKED/EXPIRED/STALE` cùng `checkedAt`; gửi `Cache-Control: no-store`. Nếu không ACTIVE, MVP **không cần trả proof** và frontend hiện nhãn lỗi, bỏ qua `groth16.verify` để tiết kiệm CPU. Nếu ACTIVE mới trả bundle; frontend vẫn tự kiểm chữ ký, lot, metadata và proof. Không tin nhãn ACTIVE nếu chỉ do dữ liệu proof precompute gắn kèm. Thử tạo proof B, thu hồi, rồi tải lại trang → phải báo không hợp lệ. Đây là trạng thái **tại thời điểm API kiểm tra**; người dùng vẫn có thể hành động sau đó nên nếu có nghiệp vụ phụ thuộc chứng nhận, kiểm tra trạng thái lại ngay trong transaction quyết định để giảm TOCTOU. Offline, `verify-bundle.ts` kiểm proof, chữ ký, hạn theo metadata đã ký và in `REVOCATION NOT CHECKED`, không kết luận credential hiện còn hiệu lực.

## 8. Circuit và ranh giới bảo đảm

Dùng Poseidon từ circomlib với domain separation cho commitment/nullifier. Trong Circom, `<--` không sinh constraint; mọi giá trị phải ràng buộc. Tín hiệu nào công khai phải xuất hiện và được ràng buộc đúng phát biểu; kiểm tra thứ tự public signals thực tế, lưu trong manifest. `snarkjs` sinh proof trên BN128/BN254 theo cấu hình **được xác nhận ở lệnh setup**. Mỗi circuit có R1CS/WASM/zkey/verification key và SHA-256 riêng. Thay constraint hoặc schema public inputs → version và setup mới [R3–R4].

### 8.1 Circuit A `AgeEligibilityV1`

Private `dobDay, salt, holderSecret`. Public `commitment, cutoffDay, requestHash, nullifier`.

- `commitment = Poseidon(domainAge, dobDay, salt, holderSecret)`; `nullifier = Poseidon(domainNullifier, holderSecret, requestHash)`; `dobDay ≤ cutoffDay` và các đầu vào so sánh có range-check. `requestHash` ràng buộc challenge, account hash, hash giỏ, ngưỡng và version từ backend. Issuer signature, expiry, user binding, nonce/challenge dùng một lần được backend kiểm tra ngoài circuit.
- Ngày là số ngày kể từ **1900-01-01**, giới hạn tới **2100-12-31**. Issuer xác nhận DOB là ngày lịch hợp lệ; circuit ràng buộc `0 ≤ dobDay ≤ cutoffDay ≤ dayIndex(2100-12-31)`, tránh wrap modulo trường. Với ngày sinh 29/02, hệ thống demo tính đạt tuổi mới từ **00:00 ngày 01/03 UTC trong năm không nhuận**, và từ **00:00 ngày 29/02 UTC trong năm nhuận**. Đây là quy ước demo do người dùng chốt ngày 25/09/2026 trong `docs/decisions.md` (D04/Q2), không phải kết luận pháp lý đã được xác nhận hay xác nhận của giảng viên.
- Backend tính `cutoffDay` bằng **trừ `minimumAge` năm lịch** từ ngày UTC hiện tại: lấy năm đích `Y = năm(todayUTC) - minimumAge`, giữ tháng, đặt ngày bằng `min(ngày(todayUTC), số ngày của tháng đó trong năm Y)`. Chỉ clamp 29/02 thành 28/02 khi năm đích không nhuận; **không nâng cutoff 28/02 thành 29/02 khi năm đích nhuận**. Không dùng công thức gần đúng `minimumAge × 365 + số năm nhuận`; từ chối phát challenge nếu cutoff ngoài miền ngày hỗ trợ. Ví dụ tuổi 18: ngày 28/02/2022 cho cutoff 28/02/2004, người sinh 29/02/2004 chưa đủ tuổi; từ 00:00 ngày 01/03/2022 UTC cho cutoff 01/03/2004, người đó đủ tuổi. Việc clamp cutoff khi năm đích không nhuận không đổi quy ước sinh nhật 29/02 sang 28/02.
- Khi checkout có hàng tuổi, API phát challenge ngắn hạn. Wallet dùng `snarkjs.groth16.fullProve` với WASM/zkey; sau khi UI có cơ hội render spinner, có thể tính trên main thread cho MVP. Nếu đo thấy lag đáng kể, chuyển sang Worker và cập nhật số liệu. Chỉ gửi proof, public signals, credentialId, challengeId; API tự đối chiếu cutoff/requestHash với DB, chữ ký Issuer, trạng thái credential, nullifier chưa dùng, rồi `groth16.verify`.

### 8.2 Circuit B `LotOriginV1`

Private `originCode, supplierIdHash, salt, privateLotCodeHash`. Public `commitment, publicAllowedCode, lotCodeHash`. Ràng buộc `commitment = Poseidon(domainLot, originCode, supplierIdHash, salt, privateLotCodeHash)`, `originCode = publicAllowedCode`, `privateLotCodeHash = lotCodeHash`. Issuer đã ký commitment và metadata chứa `productIdHash/lotCodeHash/issuedAt/expiresAt/version`; verifier kiểm tra chữ ký, thời hạn, Issuer, policy, trạng thái thu hồi và sản phẩm/lô UI ngoài circuit. Proof B chỉ chứng minh **mã vùng công khai** và liên kết commitment của đúng lot; mã nhà cung cấp không công bố. Không làm membership OR hoặc padding trong v1; nếu cần nhiều vùng, tạo `LotOriginV2`, vector biên/trùng/padding riêng và setup lại.

Tạo proof B khi admin công bố/cập nhật lô, lưu proof + signals; không tạo trên từng lượt xem. Nếu Issuer/policy/lot/circuit thay đổi hoặc hết hạn thì proof cũ không được hiển thị là hợp lệ. Browser dùng `snarkjs.groth16.verify`, kiểm chữ ký Issuer và mã lô. Doanh nghiệp kiểm soát code website nên kiểm lại proof bằng script Node.js trên máy người đánh giá là **khả năng xác minh mật mã tách khỏi UI**, không phải bằng chứng Issuer độc lập ngoài đời.

### 8.3 Setup và artifact

Compile và test constraint **trước** setup; chạy Powers of Tau phù hợp số constraint; Groth16 phase 2 riêng cho A/B, có ít nhất một contribution; `zkey verify`; export verification key và tạo manifest hashes. Không dùng `*_0000.zkey` chưa có contribution làm key cuối. Ghi trong báo cáo: “Phase 2 của bản thử nghiệm được thực hiện một người trên môi trường phát triển; mức tin cậy chưa tương đương nghi thức nhiều bên. Với hệ thống thực có yêu cầu tin cậy cao, thiết lập nhiều bên giúp giảm rủi ro nếu có ít nhất một người tham gia trung thực và hủy bí mật tạm thời.” Không tuyên bố MPC là yêu cầu pháp lý tuyệt đối cho mọi triển khai [R4].

### 8.4 Định dạng dữ liệu và manifest bắt buộc

`packages/contracts` định nghĩa cố định: `userIdHash` và `lotCodeHash` từ chuỗi ID chuẩn hóa bằng thuật toán hash-to-field được ghi phiên bản; domain age/lot/nullifier/request là các hằng số field khác nhau; input Poseidon cùng thứ tự trên issuer, wallet, prover và circuit. `requestHash = Poseidon(domainRequest, challengeNonceField, userIdHash, cartSnapshotHash, cutoffDay, circuitVersionField)`; giỏ được canonical theo cặp `(productId, quantity, giá/cờ tuổi/ngưỡng máy chủ)` rồi hash, không dựa vào tổng tiền client. Public `nullifier = Poseidon(domainNullifier, holderSecret, requestHash)`. Backend phải tính lại requestHash từ trạng thái server, kiểm tra chữ ký trên commitment gắn userIdHash và challenge chưa tiêu thụ; một proof của người khác hoặc giỏ khác phải sai. Nếu Poseidon/circomlib chỉ hỗ trợ arity giới hạn, dùng cấu trúc hash lồng có domain cho từng lớp và test giá trị Node/Circom giống nhau.

Manifest cho A/B gồm `type`, `version`, curve `bn128`, hash SHA-256 của R1CS/WASM/zkey/verification key, thứ tự public signals **lấy từ output thực tế**, schema commitment/Poseidon, input encoding, Issuer fingerprint, status. Cả frontend lẫn backend chỉ tải artifact theo manifest phiên bản đó. Mọi số field trong API/`public.json` là chuỗi thập phân; không để JavaScript Number làm mất chính xác. `proof-bundle` B có `productId`, `lotCode`, `publicAllowedCode`, proof, signals, signed metadata, chữ ký Issuer, manifest hash và ngày tạo; **không có** `supplierIdHash`, salt hay hồ sơ. Verifier kiểm tra `productId/lotCode` đang xem với metadata đã ký và các public signal trước khi tin `groth16.verify`.

## 9. API tối thiểu

| Route | Quyền | Kiểm tra bắt buộc |
|---|---|---|
| `POST /auth/register`, `/login`, `/logout`; `GET /me` | khách | email unique, password/session, rate limit |
| `GET /products`, `GET /products/:slug` | công khai | chỉ hàng published; lô và chính sách công khai |
| `GET/POST/PATCH/DELETE /cart/items` | customer | sở hữu giỏ, quantity, tồn |
| `GET/POST/PATCH/DELETE /me/addresses` | customer | sở hữu địa chỉ |
| `POST /age/challenges`, `POST /age/verifications` | customer | giỏ/account/cutoff/version/chữ ký/expiry/nullifier/proof |
| `POST /orders`, `GET /me/orders/:id` | customer | transaction/idempotency; kiểm tra sở hữu |
| `GET /lots/:id/proof-bundle` | công khai | join trạng thái hiện hành; `no-store`; chỉ trả proof khi ACTIVE; `checkedAt` để giải thích tính thời điểm |
| `POST/PATCH /admin/products`, `/admin/lots`, `POST /admin/lots/:id/prove`, `PATCH /admin/orders/:id/status` | admin | quyền server-side; proof B tính trước và ghi phiên bản |

Request ZKP dùng các số trường lớn ở dạng **chuỗi thập phân**. API age verify không nhận ngày sinh. `proof-bundle` chứa proof, signals, signed metadata, issuer key fingerprint, circuit version/hash; **không chứa supplierIdHash, originCode riêng hay salt**. Gói B có thể tiết lộ mã vùng đã công bố qua public input. Lỗi `PROOF_INVALID`, `ISSUER_SIGNATURE_INVALID`, `CHALLENGE_EXPIRED`, `CREDENTIAL_REVOKED`, `LOT_PROOF_STALE`; không trả stack trace hoặc witness.

## 10. Kiểm thử tối thiểu có giá trị

| Gate | Test bắt buộc |
|---|---|
| Circuit A | đủ tuổi, thiếu một ngày; kiểm phép tính cutoff và vector circuit theo A7–A12 trong `docs/decisions.md`: DOB 29/02/2004 chưa đủ 18 tại 28/02/2022 23:59:59 UTC, đủ từ 01/03/2022 00:00 UTC; năm đích không nhuận: ngày 28/02 và 29/02/2024, tuổi 18 cùng cutoff 28/02/2006, tới 01/03/2024 cutoff là 01/03/2006; cả hai năm nhuận: DOB 29/02/2004 chưa đủ 20 ngày 28/02/2024, đủ từ 00:00 UTC ngày 29/02/2024. Circuit chỉ so DOB với cutoff; đồng hồ/cách tính cutoff kiểm ngoài circuit. Thêm DOB ngoài miền/ngày không hợp lệ, commitment sai, nullifier/requestHash khác; **cố tình thay từng private input/witness** hoặc một public input trong test vector để khẳng định circuit không chấp nhận dữ liệu sai. Nếu witness không tính được thì test pass ở bước witness; nếu vẫn tính được, verify phải fail. |
| Circuit B | vùng đúng, vùng sai, lot sai, commitment/supplier hash sửa, proof sửa |
| API ZKP | chữ ký Issuer sai, challenge hết hạn, giỏ đổi, replay, revoked/expired, proof đúng nhưng sai tài khoản/lô |
| DB/checkout | hai request đồng thời cho lượng tồn cuối; request idempotent; lỗi giữa transaction rollback; hủy trả tồn một lần |
| E2E | **một** happy path đăng nhập → mua hàng tuổi → proof hợp lệ → COD → xem đơn; thêm ca API âm quan trọng, không cần Playwright cho mọi nhánh |
| B online/offline | khách web thấy lô hợp lệ; thu hồi sau precompute → web báo lỗi; script `verify-bundle.ts` cho proof đúng/sai và in `REVOCATION NOT CHECKED` |
| Riêng tư | không có DOB, salt, holderSecret, supplierIdHash, witness trong API thương mại/log/bundle công khai |

**Đo hiệu năng:** ít nhất **3 lần** trên cùng máy/browser sau lần khởi động đầu, báo từng số đo và median đơn giản cho witness+proof A, proof B, verify A/B, kích thước artifact. Không yêu cầu p95 từ ba lần chạy; một lần duy nhất không đủ để rút nhận xét ổn định. Nếu thời gian cho phép, tăng số lần chạy, ghi cold/warm và độ lệch. Ghi cấu hình máy, browser, phiên bản công cụ, constraint count. Không bịa số liệu hoặc coi thời gian setup là thời gian mỗi giao dịch.

## 11. Bảo mật, vận hành và dữ liệu demo

Giá và tồn backend tính lại; VND `bigint`, không floating point. Password Argon2id, session cookie an toàn, CSRF cho mutation, validation dữ liệu, giới hạn body/rate, HTTPS ngoài localhost, quyền sở hữu địa chỉ/đơn ở API. Không log private proof inputs, credential, request body endpoint verify; không đưa secret vào repository/browser bundle. DB vẫn lưu họ tên, số điện thoại, địa chỉ đơn để xử lý giao nhận giả lập, nên phân quyền và chính sách lưu giữ phải được ghi rõ. Không nhập dữ liệu cá nhân thật khi demo.

Seed **6–8 sản phẩm, 2–3 danh mục, 3 lô** (hợp lệ/hết hạn/thu hồi), 2 hàng tuổi, admin và customer demo. Trạng thái lô thu hồi có thể được tạo sau khi tạo proof để kiểm thử TOCTOU. `npm run db:migrate`, `npm run db:seed`, `npm run circuits:test`, `npm run dev`, `npm run test`, `npm run build` là tên script mục tiêu: Codex phải tạo thật và sửa README theo cách chạy thực tế. Hướng dẫn backup DB demo tối thiểu bằng lệnh `pg_dump`/restore có thử thủ công khi còn thời gian; không xây hệ sao lưu tự động.

## 12. Người thực hiện phải tự làm

1. Xác nhận với giảng viên **hai phát biểu và mức hoàn thành cần cho đồ án 1**, kịch bản B một vùng công khai, giới hạn Issuer một người, quy ước 29/2 và điều kiện demo COD.
2. Chọn nội dung/ảnh sản phẩm có quyền sử dụng; tự kiểm tra giao diện và dùng **dữ liệu hư cấu** khi vận hành Issuer.
3. Trực tiếp giữ private key Issuer và làm contribution setup thử nghiệm; lưu fingerprint public key và transcript/hash, không đưa private key cho repository.
4. Chạy demo trên máy mình, đo thời gian thật, chụp màn hình/test evidence; giải thích nếu B chưa đạt thì không được nhận đã triển khai đủ hai circuit.
5. Viết đánh giá trung thực: chứng nhận ký số có thể đủ nếu không có trường cần giữ kín; mô hình Issuer/CLI một người không tạo độc lập tin cậy; ZKP không chứng minh nguồn gốc vật lý hay tuân thủ luật.

Codex có thể viết mã, script và tài liệu, **không thể thay giảng viên duyệt phạm vi, thay Issuer ngoài đời, tự giữ khóa đáng tin hoặc bịa kết quả đo**.

## 13. Câu lệnh để giao Codex khi mở dự án

> Đọc toàn bộ `docs/implementation-spec.md` và `AGENTS.md`; kiểm tra repository thực tế. Làm G0–G1 trước: viết test vector hai circuit v1, compile/setup/verify thật, ghi hash và public signal order. Dựng DB/API/web tối giản theo mục 2, không phát triển tính năng mở rộng khi hai proof chưa chạy. Giữ cùng một DB và issuer-cli dùng khóa riêng, ghi giới hạn mô phỏng. Sau mỗi gate, chạy test tương ứng, cập nhật `README.md`, `docs/decisions.md`, `docs/api-erd.md`, `docs/test-evidence.md`. Chỉ báo hoàn thành hai kịch bản khi G4 và G5 được chứng minh bằng mã chạy và kết quả đo.

## 14. Nguồn chính thức để đối chiếu lúc code

- [R1 Node.js release schedule](https://nodejs.org/en/about/previous-releases/) và [Vite guide](https://vite.dev/guide/).
- [R2 Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions).
- [R3 Circom signals](https://docs.circom.io/circom-language/signals/), [constraint generation](https://docs.circom.io/circom-language/constraint-generation/), [proving circuits](https://docs.circom.io/getting-started/proving-circuits/), [circomlib](https://github.com/iden3/circomlib).
- [R4 snarkjs README](https://github.com/iden3/snarkjs) — BN128, setup/contribution, proof/verify, trình duyệt.
- [R5 OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [session](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- [R6 W3C Verifiable Credentials Data Model](https://www.w3.org/TR/vc-data-model/) — Issuer/Holder/Verifier, xác thực credential không tự chứng minh sự thật ngoài đời.
- [R7 Luật 91/2025/QH15](https://chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroupid=3), [Nghị định 356/2025/NĐ-CP](https://vanban.chinhphu.vn/?docid=216387&pageid=27160) — bối cảnh pháp lý, không biến proof thành giấy chứng nhận tuân thủ.
- [R8 MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) — công việc CPU trên main thread có thể chặn giao diện.

## 15. Ánh xạ cập nhật tài liệu đồ án

Chương 2 đổi tên khỏi “xác minh thuộc tính người dùng”; phần yêu cầu mô tả hai vai trò Prover khác nhau; use case A ở đặt hàng và B ở xem lô, sequence tách riêng. Database bỏ bảng ưu đãi ZKP của bản cũ, bổ sung `lots`, `lot_proofs`, credential và challenge như schema thực. Chương 3 chụp màn hình/demo hai proof thật, ghi giới hạn Issuer, setup một người và benchmark do sinh viên đo. Không đưa hình/chức năng chưa code vào phần kết quả triển khai.
