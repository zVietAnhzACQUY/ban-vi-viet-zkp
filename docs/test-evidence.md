# Bằng chứng G1–G5 — cập nhật 30/09/2026

Q1–Q3 do người dùng tự thực hiện đồ án chốt, không ghi giảng viên đã duyệt. G3 đã tích hợp ZKP tuổi online; G4 đã tích hợp proof lô, trạng thái online và phân bổ tồn theo lô. G5 đã chạy test/build/audit/UI; benchmark AGE thật vẫn `PENDING OWNER MANUAL TEST` vì credential do chủ sở hữu giữ.

| Kiểm tra                | Kết quả / bằng chứng                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pin trước circuit       | Node 24.21.0, npm 11.19.0, Circom 2.2.3, circomlib 2.0.5, circomlibjs 0.1.7, snarkjs 0.7.6; `artifacts/toolchain.json`, lockfile                                                             |
| Golden trước circuit    | `circuits/vectors/golden.json`: H2F bytes/digest/field; Poseidon arity 3/4/5/6; metadata bytes/signatures công khai. Poseidon reference/WASM khớp                                            |
| A compile               | 634 nonlinear + 787 linear = **1421 constraints**, 4 public/3 private, 0 outputs; `artifacts/evidence/age-compile.txt`                                                                       |
| B compile               | 324 nonlinear + 511 linear = **835 constraints**, 3 public/4 private khai báo, 0 outputs; O1 giữ 2 private wires, 2 input còn lại là alias bằng public; `artifacts/evidence/lot-compile.txt` |
| Public order thực       | A: commitment, cutoffDay, requestHash, nullifier. B: commitment, publicAllowedCode, lotCodeHash. Kiểm `.sym`, witness và public signals proof                                                |
| Witness / golden / date | **71 checks PASS**, `artifacts/evidence/witness-tests.json`; gồm sửa mỗi private/public input, range 17 bit + max 73413, leap policy A7–A12, chữ ký fixture và sửa trực tiếp binary witness  |
| Arity 6 Circom          | Harness `circuits/tests/request_hash_vector.circom` so requestHash golden; chỉ test, không setup thành circuit sản phẩm thứ ba                                                               |
| Setup phát triển        | bn128, power **11** (A cần domain 2048, B cần 1024); phase 1 verify, phase 2 contribution riêng A/B, `verifyFromR1cs` PASS; `artifacts/evidence/setup-development.json` và `.log`            |
| Groth16                 | **15 checks PASS**, `artifacts/evidence/proof-tests-development.json`: proof hợp lệ A/B, sửa từng signal, sửa proof, sai vk/schema, prove từ witness đã sửa rồi verify fail                  |
| Hash artifacts          | `artifacts/manifest.json`: SHA-256 của R1CS/WASM/contributed zkey/vk, public schema, ptau và transcript thực                                                                                 |
| Owner                   | **Đã nhận và kiểm ngày 28/09/2026**: `owner-summary.json`, `setup-owner.json`, `proof-tests-owner.json` có 15/15 checks PASS; fingerprint public key khớp manifest. Không đọc private key    |

Ràng buộc thật được kiểm bằng cách sửa trực tiếp bytes witness và chạy `snarkjs.wtns.check`, không chỉ dựa vào assert của witness generator. Build thử `--sanity_check 0` vẫn gặp assert equality trong toolchain này; không dùng việc tắt flag làm bằng chứng ràng buộc. Hai chế độ cho R1CS hash giống nhau; WASM phát hành dùng mức 2.

Các test âm phân biệt statement mới hợp lệ: đổi requestHash và tính lại nullifier, hoặc cutoff vẫn >= DOB, có thể pass circuit; G3 phải kiểm challenge/server policy. B vùng 2 với commitment khớp có thể pass circuit nhưng policy v1 chỉ cho vùng 1 phải bị verifier nghiệp vụ từ chối. Các kiểm tra nghiệp vụ này chưa được triển khai.

Giới hạn kiểm chữ ký: đã verify fixture và thay từng byte thông điệp/signature; chưa triển khai parser JSON/credential hoặc kiểm thu hồi. Khóa fixture ephemeral không phải khóa Issuer và private key không được ghi tệp. B chứng minh thuộc tính commitment, không chứng minh hồ sơ/sản phẩm vật lý.

Lưu ý thư viện: snarkjs 0.7.6 cần truyền logger ở nhánh witness sai để tránh lỗi `logger.warn`; harness đã làm điều đó. Verify sai vk có số signals khác được chặn bằng schema/count guard trước hàm mật mã; không ghi nhận TypeError như kết quả kiểm mật mã. Một số thao tác setup upstream phát cảnh báo đóng file descriptor bởi GC; lệnh vẫn exit 0 và kiểm toán học trả true, transcript được lưu.

Kết luận G1: hai circuit/proof offline đã chạy thật và test âm đạt. **G1 hoàn tất trong phạm vi offline demo một người**. Các con số trên là số ca/constraints thực, không phải benchmark thời gian hoặc tuyên bố an toàn production.

## G2 — website/API/PostgreSQL (28/09/2026)

Môi trường: Node 24.21.0/npm 11.19.0; PostgreSQL `17.6-alpine` trong container riêng, cổng localhost 5434; Prisma/Fastify/React/Vite được pin trong `apps/package-lock.json`. Root lockfile và toàn bộ baseline G1 được đối chiếu SHA-256 sau khi hoàn tất.

| Kiểm tra                      | Kết quả                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build production + TypeScript | PASS; Vite 1593 modules, JS 270.91 kB (gzip 86.21 kB), CSS 18.96 kB (gzip 4.88 kB); `tsc --noEmit` exit 0                                                                    |
| Migration/seed                | PASS; 1 migration, 8 sản phẩm, 3 danh mục, 3 lô; CHECK constraint nghiệp vụ hoạt động                                                                                        |
| Integration PostgreSQL        | **14 tests PASS, 0 fail**, 13 subtests nghiệp vụ trong 3.24 s, tổng runner 8.71 s                                                                                            |
| Tranh sản phẩm cuối           | 8 khách đồng thời, đúng 1 đơn thành công, 7 phản hồi conflict, tồn cuối 0 và không âm                                                                                        |
| Retry idempotent              | 6 request đồng thời cùng key trả cùng một order ID, chỉ trừ tồn một lần; tái dùng key khác nội dung trả 409                                                                  |
| Atomicity                     | Lỗi chèn sau bước trừ tồn được tiêm ở test làm rollback tồn, order và cart                                                                                                   |
| Checkout server-side          | Snapshot giá/địa chỉ; đổi giá làm quote cũ bị từ chối; client không chèn total/ageVerified/proof; giỏ 18+ bị chặn                                                            |
| Hủy và trạng thái             | Hai request hủy đồng thời chỉ hoàn tồn một lần; transition admin và mốc thu COD được kiểm                                                                                    |
| CRUD quản trị                 | Tạo danh mục/sản phẩm/lô, chỉnh tồn, movement, archive lô/ẩn sản phẩm và khóa xóa danh mục đang dùng đều PASS                                                                |
| Bảo vệ API                    | Ownership, role admin, CSRF Origin/token, quantity, unpublished/empty cart, session HttpOnly và logout được kiểm                                                             |
| DB invariant                  | Ghi stock âm và quantity 0 trực tiếp qua Prisma đều bị PostgreSQL từ chối                                                                                                    |
| Dependency audit              | `npm audit` tại workspace ứng dụng: 0 vulnerabilities; JSON tại `docs/evidence/g2/npm-audit.json`                                                                            |
| Bảo toàn G1                   | 46/46 file baseline cùng SHA-256; owner verifier AGE/LOT PASS; `docs/evidence/g2/g1-preservation.json`                                                                       |
| UI desktop/mobile             | PASS bằng trình duyệt thật: catalog 8 sản phẩm, chi tiết/lô, login, cart, địa chỉ, tạo đơn COD, order detail, admin products/lots/orders; breakpoint 390×844 có menu thu gọn |
| Ranh giới ZKP                 | UI lô ghi “Chưa xác minh”; nút checkout giỏ 18+ disabled; API trả `AGE_PROOF_NOT_AVAILABLE`; không có endpoint nhận proof ở G2                                               |

Ảnh kiểm tra đại diện: `docs/evidence/g2/home-desktop.png`, `product-desktop.png`, `checkout-desktop.png`. Lần UI E2E tạo đơn `BVV-C8168A57`, tổng 145.000 VND, snapshot địa chỉ demo và làm tồn cà phê từ 24 xuống 23; đây là dữ liệu demo trong database phát triển, không nằm trong seed/migration.

Test chạy trong schema riêng `g2_test` và script từ chối database URL không có schema này. Mỗi lần chạy dùng UUID mới nên không phụ thuộc dữ liệu lần trước. `npm run db:seed` idempotent với catalog nhưng không xóa đơn hoặc tự đặt lại tồn kho; muốn demo sạch phải tạo lại volume theo README.

**Kết luận tại mốc G2:** checkout COD thông thường chạy end-to-end và không bán âm tồn trong kiểm thử cạnh tranh. Kịch bản tuổi A và lô B chưa được tích hợp ở mốc này; các mục sau ghi phần triển khai G3–G5.

## G3 — credential/challenge/proof tuổi và checkout (28/09/2026)

G3 dùng nguyên circuit và owner artifacts G1. AGE public signals giữ đúng thứ tự `commitment, cutoffDay, requestHash, nullifier`; signal schema SHA-256 `616c508dd1cf9c2c8b704130ceda1f14133126c96f464fb22d7f6ead6e65d5e2`. Manifest `c942cffd8a412652f8df829fa842c3cfee972b0129d08b690fdada8cd7c511dc`; AGE WASM `6cfa2c24602376b839a726aff67e3782ed8c220e6b096d393a5746c5c43613c8`; owner zkey `f23ed79af1b4fb14f055a586ea8f6e8a396e86ea95df1a1e1799c0477775f95c`; verification key `eb674307b5de962cfedc9a5e63fce7d2e8820bef109bafd571a15295f05a7015`. API kiểm các hash này khi khởi động và fail closed nếu lệch.

| Kiểm tra                      | Kết quả                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build production + TypeScript | PASS; Vite 1602 modules; main JS 560.63 kB, Poseidon lazy chunk 1,905.57 kB; `tsc --noEmit` exit 0. Vite chỉ cảnh báo kích thước chunk mật mã                                                                                                                                  |
| Runner tổng                   | **23 tests PASS, 0 fail** bằng Node 24.21.0 trên PostgreSQL schema `g2_test`; lượt chốt chạy riêng G3 6,05 giây và hồi quy G2 3,32 giây                                                                                                                                        |
| Regression G2                 | **14 tests PASS, 0 fail**, gồm 13 subtest nghiệp vụ COD/tồn kho cũ                                                                                                                                                                                                             |
| G3 integration                | **8 subtests nghiệp vụ PASS, 0 fail**; kết quả tại `docs/evidence/g3/test-results.json`                                                                                                                                                                                        |
| Proof hợp lệ                  | Credential Ed25519 hợp lệ + challenge + Groth16 proof tạo đơn COD; verification/challenge cùng chuyển `CONSUMED`; DB chỉ có metadata/hash/nullifier công khai                                                                                                                  |
| Người chưa đủ tuổi            | Witness generator báo constraint `dobDay <= cutoffDay` không thỏa; không tạo được proof                                                                                                                                                                                        |
| Proof/chữ ký bị sửa           | Sửa `pi_a` trả `PROOF_INVALID`; sửa signature trả `ISSUER_SIGNATURE_INVALID`                                                                                                                                                                                                   |
| Challenge hết hạn             | Sửa fixture quá TTL trả `CHALLENGE_EXPIRED` trước verify mật mã                                                                                                                                                                                                                |
| Giỏ thay đổi                  | Tăng quantity sau challenge trả `CART_CHANGED`; requestHash được tính lại từ snapshot server                                                                                                                                                                                   |
| Replay                        | Nạp lại cùng giỏ nhưng dùng proof đã tiêu thụ cho idempotency key mới trả `AGE_PROOF_REPLAY`                                                                                                                                                                                   |
| Retry đồng thời               | 6 request checkout giống nhau cùng proof/key đều trả cùng một order; chỉ một Order và tồn giảm đúng 1                                                                                                                                                                          |
| TTL/schema                    | TTL đúng **300.000 ms**; public order đúng 4 signals G1                                                                                                                                                                                                                        |
| Trình duyệt thật tại mốc G3  | Hồ sơ lịch sử trước kiến trúc Wallet: đơn `BVV-3BB8D187` đã mở và không có console error. Kết quả này đã bị thay thế cho vận hành hiện tại bởi Wallet origin D25–D29; không dùng nó làm bằng chứng ranh giới credential G5                                                                                                                       |
| Migration dữ liệu hiện có     | PASS bằng `prisma migrate deploy`; thêm bảng/cột G3, không chạy `docker compose down -v`, không xóa đơn/tồn đang có                                                                                                                                                            |
| Bảo toàn G1                   | **46/46** baseline hash không đổi; owner verifier AGE/LOT PASS; `docs/evidence/g3/g1-preservation.json`                                                                                                                                                                        |
| Dependency audit              | 19 advisory transitive: 13 low, 2 moderate, 4 high, 0 critical; nguồn chính từ dependency tree của circomlibjs/snarkjs đã pin G1. `npm audit fix` đề xuất đổi/downgrade phiên bản, nên không tự áp dụng vì sẽ phá pin/artifact; JSON lưu tại `docs/evidence/g3/npm-audit.json` |

API không log body và không có cột DOB, salt, holderSecret, witness hay proof đầy đủ; server chỉ lưu SHA-256 của proof. Kiến trúc vận hành hiện tại được ghi ở D25–D29: Wallet origin giữ credential và tạo proof, website chỉ nhận dữ liệu công khai. Issuer CLI đối chiếu private key với public key AGE G1 trước khi cấp credential, nhưng việc Issuer và setup do một người vận hành vẫn là giới hạn tin cậy đã công bố.

Kiểm thử trình duyệt dùng Issuer/key/credential hư cấu tạm trên schema test; không đọc AGE private key thật. Tệp fixture được xóa sau kiểm thử. Lần chạy này tạo một đơn test trong `g2_test`, không sửa dữ liệu ở schema `public` ngoài migration G3.

**Kết luận tại mốc G3:** kịch bản A chạy end-to-end trên browser/API/PostgreSQL và các test âm bắt buộc đều đạt. COD thường tiếp tục hoạt động không cần proof. Khi mốc này được chốt, trạng thái lô `DEMO_*` vẫn chỉ là dữ liệu minh họa; phần đó đã được G4 thay thế ở mục kế tiếp.

## G4 — credential/proof lô, trạng thái online và checkout theo lô (28/09/2026)

G4 dùng nguyên circuit và owner artifacts LOT G1. Public signals giữ đúng thứ tự `commitment, publicAllowedCode, lotCodeHash`; signal schema SHA-256 `5b2ec726f1848bd688e55218aed951dee471acdb1385662082a966577483c215`. Manifest `c942cffd8a412652f8df829fa842c3cfee972b0129d08b690fdada8cd7c511dc`; R1CS `855a5b9dd0124e7d4cbfff5257aa8d9967be4058a45760b143e7c333c68cf626`; WASM `dabf75c9519a0e0513265f615b79b9e828d6a752c8f3d56a2d51001fa4925198`; owner zkey `07ef18d06f8fb76d77522411e8d18ced6f43cd7fb18982fe0dc14e30bd5d1d98`; verification key `3d34ad71eaf23d8b5d65e3dfa2254d970875e10df7b38134fe470a5f064df44d`.

| Kiểm tra                      | Kết quả                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production build + TypeScript | PASS; Vite 1605 modules, CSS 20,33 kB, main JS 567,11 kB, Poseidon lazy chunk 1.905,57 kB; `tsc --noEmit` exit 0. Chỉ có cảnh báo kích thước chunk mật mã đã biết         |
| Runner tổng                   | **36 tests PASS, 0 fail**: tìm kiếm 4/4, G2 14/14, G3 9/9, G4 9/9 trên PostgreSQL schema `g2_test`; JSON tại `docs/evidence/g4/test-results.json`                         |
| Proof LOT hợp lệ              | Credential ký bởi Issuer fixture tin cậy + proof B thật được API nhận thành `ACTIVE`; DB không chứa `supplierIdHash`, salt hay `privateLotCodeHash`                       |
| Proof bị sửa                  | Sửa `pi_a` trả `PROOF_INVALID`                                                                                                                                            |
| Chữ ký bị sửa                 | Sửa signature Ed25519 trả `ISSUER_SIGNATURE_INVALID`                                                                                                                      |
| Sai lô                        | Bundle hợp lệ của lô A nhập cho lô B trả `LOT_BINDING_MISMATCH`                                                                                                           |
| Hết hạn                       | Proof Groth16 sinh khi credential còn hạn nhưng nhập sau hạn trả `CREDENTIAL_EXPIRED`; proof đã nhập chuyển `EXPIRED` khi đồng hồ server vượt hạn và API không trả bundle |
| Thu hồi sau proof             | Revoke đổi credential thành `REVOKED`, proof thành `STALE`, API không trả bundle; cùng bundle vẫn verify offline nên chứng minh rõ cần trạng thái online                  |
| Tranh tồn kho lô              | Hai khách cùng mua lô cuối: đúng 1 order thành công, 1 `LOT_OUT_OF_STOCK`; `OrderItem` giữ đúng `lotId/lotCode`, Product và Lot không âm; hủy hoàn cả hai                 |
| Regression G2–G3              | G2 COD/idempotency/rollback/CSRF/quyền vẫn 14/14; G3 challenge/requestHash/nullifier/replay vẫn 9/9; tìm kiếm dấu tiếng Việt vẫn 4/4                                      |
| Migration dữ liệu hiện có     | PASS với 4 migration trên schema public và `g2_test`; G4 là migration cộng dồn, không chạy `docker compose down -v` và không xóa volume                                   |
| Bảo toàn G1                   | **46/46** baseline hash không đổi; root lock và artifacts không đổi; owner verifier AGE/LOT exit 0; `docs/evidence/g4/g1-preservation.json`                               |

API kiểm hash manifest/WASM/zkey/vk khi khởi động, kiểm chữ ký Issuer, product/lot binding, policy, hạn, public signal order và Groth16 trước khi lưu. Browser tải trạng thái `no-store`, kiểm lại fingerprint/key, chữ ký, binding, hạn, SHA-256 bytes verification key và proof trước khi hiện nhãn. Chỉ phản hồi `ACTIVE` mới mang bundle; `UNVERIFIED`, `EXPIRED`, `REVOKED` và `STALE` không thể hiện “đã xác minh”.

Kiểm thử browser thật dùng một Issuer fixture tạm trên schema `g2_test`. Proof toán học hợp lệ đã bị UI từ chối đúng thiết kế vì fingerprint fixture không khớp LOT key G1; ảnh `docs/evidence/g4/browser-issuer-fail-closed.png`. Không đọc private key LOT của người dùng. Ca giao diện “Đã xác minh” với khóa owner cần người giữ khóa tự chạy `issuer:lot → prover:lot → verify:lot` rồi tải public bundle theo README; credential/private key không được gửi vào chat.

Migration gán tồn tổng hiện có cho lô đầu theo `lotCode` của từng sản phẩm và 0 cho các lô còn lại. Từ G4, sản phẩm có bất kỳ lô nào phải chọn đúng một lô `ACTIVE` đủ quantity; client không chọn lô, v1 không tách một dòng qua nhiều lô. Trạng thái proof không quyết định sale eligibility, chỉ quyết định nhãn xác minh; đây là quyết định D21–D24, không phải chứng nhận xuất xứ vật lý.

**Kết luận G4:** kịch bản B đã có CLI cấp credential/tạo proof, xác minh hai lớp API/browser, expiry/revocation online và snapshot lô atomically trong checkout. Các test âm và hồi quy bắt buộc đều đạt; mục G5 bên dưới ghi lần đối chiếu cuối.

## Ví ZKP AGE tách origin — lần tích hợp ban đầu (29/09/2026)

Thay đổi này không sửa circuit hay trusted setup. Website chạy ở `127.0.0.1:5173`, Wallet ở `127.0.0.1:5174`, API ở `127.0.0.1:3001`. Credential AGE được Wallet kiểm và lưu trong IndexedDB; website chỉ nhận public response đã qua kiểm origin/source/request/challenge. API xác minh bundle ở `/api/age/verifications`, sau đó checkout chỉ nhận `ageVerificationId` và tiêu thụ trong transaction thành công.

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| Runner tổng `npm test` | **50 tests PASS, 0 fail**: tìm kiếm 4, Wallet/protocol 10, G2 14, G3/AGE 13, G4/LOT 9. Prisma xác nhận 4 migration và không có migration chờ trên schema riêng `g2_test` |
| Credential Wallet | PASS: schema/type, credential hợp lệ được kiểm trước save; sai schema, chữ ký bị sửa và credential hết hạn đều bị từ chối |
| Message security | PASS: Wallet từ chối origin/source sai, request hết hạn và request ID đã xử lý; website từ chối origin/source/request ID/challenge ID sai; ca người dùng từ chối, popup đóng và timeout đều kết thúc state chờ |
| Không rò dữ liệu kín | PASS: public response schema và endpoint API dùng `.strict()` từ chối `privateInputs`; source website không còn parser/prover/file input AGE; API/DB chỉ lưu public audit fields, nullifier và proof hash |
| AGE API/checkout | **12 subtests nghiệp vụ, 13 tests PASS**: proof hợp lệ, underage witness fail, proof/signature sửa, TTL, cart đổi, thiếu verification, challenge mismatch/replay, nhiều sản phẩm 18+ dùng một verification, checkout đồng thời idempotent |
| Retry trước commit | PASS: sau `OUT_OF_STOCK`, `AgeVerification.consumedAt` vẫn null và challenge vẫn `VERIFIED`; khôi phục tồn rồi gửi lại cùng `ageVerificationId` tạo đơn thành công |
| COD thường/G2 | **14/14 PASS**; không cần challenge, Wallet hoặc ageVerificationId |
| LOT/G4 | **9/9 PASS**; circuit B, proof/trạng thái lô, phân bổ lô và tranh tồn không bị ảnh hưởng |
| Production build + typecheck | PASS sau khi cấu hình worker ES module: web 1677 modules, CSS 20,33 kB, JS 873,94 kB; Wallet 111 modules, worker 283,64 kB, main JS 468,96 kB; `tsc --noEmit` exit 0. Vite chỉ cảnh báo các chunk mật mã lớn |
| UI Wallet thật | PASS read-only tại `http://127.0.0.1:5174`: thấy trạng thái chưa có credential, nút “Thêm credential”, thông báo IndexedDB/rành giới website; console có 0 warn/error |
| Bảo toàn G1 | **46/46** baseline SHA-256 khớp; `verify-owner.mjs` PASS AGE và LOT, owner summary/fingerprint/source/build/golden; không artifact hoặc private key nào được đọc/sửa |

Lần chạy build đầu phát hiện Vite mặc định đóng gói Web Worker dạng IIFE không hỗ trợ code-splitting. Đã đặt `worker.format = "es"`; lần build chốt vượt qua cả web, Wallet và TypeScript. Không bỏ hoặc làm yếu test để đạt build.

UI ghi timing không chứa bí mật cho `wasmLoadMs`, `zkeyLoadMs`, `proofMs`, `walletTotalMs`, `serverVerificationMs` và tổng từ lúc consent đến khi API trả kết quả; cache artifact phân biệt `cold/warm`. Chưa ghi một con số benchmark owner-credential trong lần này vì agent không đọc private key hay credential AGE của người dùng. Số đo sẽ hiện ngay trong checkout sau lần người giữ khóa tự chạy; không dùng thời gian test Node hoặc một máy để tuyên bố hiệu năng cho mọi thiết bị.

Popup end-to-end với credential ký bởi owner cần người giữ khóa thực hiện theo README. Checklist thủ công gồm lần đầu thêm/lưu credential, lần mua sau không nhập lại, đồng ý/từ chối, đóng popup, xóa credential, credential hết hạn, sửa giỏ/địa chỉ sau xác minh, challenge hết hạn và gửi lại proof cũ. Private key và credential không được gửi vào chat.

## Đối chiếu owner ngày 28/09/2026

Lệnh `node circuits/scripts/verify-owner.mjs` exit 0. Đã đối chiếu hash manifest với summary, SHA-256 public key AGE/LOT, các hash artifact và liên kết source/build/golden với báo cáo 71 checks. Đã chạy lại powersOfTau.verify, zKey.verifyFromR1cs cho cả A/B, so verification key xuất từ zkey với tệp public, verify proof đã lưu và thử sửa từng public signal/proof (đều bị từ chối). 15 ca owner là kết quả đã ghi của lần owner chạy; lần đối chiếu này không sinh lại proof từ witness sai và không sửa artifacts.

Manifest SHA-256: `c942cffd8a412652f8df829fa842c3cfee972b0129d08b690fdada8cd7c511dc`.
Transcript owner SHA-256: `243d623bf86cc5481be038014eb24fc77d55fd62f5202a32e02228749a72acd1`.

Không kiểm tra nội dung private key hoặc xác nhận vật lý ACL/nơi giữ khóa; không chứng minh entropy đã được hủy. Owner summary do người dùng cung cấp cùng artifacts là căn cứ ghi nhận bước owner của demo, không phải chứng nhận bởi bên độc lập.

## G5 — hồi quy, vận hành và mức sẵn sàng demo (30/09/2026)

Môi trường chốt: Windows, Node 24.21.0/npm 11.19.0, PostgreSQL 17.6 trong container hiện hữu, schema test `g2_test`. Không chạy `docker compose down -v`, không xóa dữ liệu, không tạo migration mới và không sửa circuit/khóa/artifact G1. Repository không có `.git`, nên không thể dùng `git status`/`git diff`; danh sách tệp được đối chiếu bằng filesystem và baseline SHA-256 G1.

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| `apps: npm test` | **59/59 PASS, 0 fail**: tìm kiếm 4, checkout policy 1, Wallet/protocol 16, G2 15, G3 AGE 14, G4 LOT 9. Ca mới xác nhận đổi mật khẩu phải kiểm mật khẩu hiện tại, thay Argon2 hash và không trả bí mật trong response |
| `apps: npm run build` | PASS web, Wallet và `tsc --noEmit`; web 1.678 modules, CSS 24.095 bytes, main JS 893.305 bytes; Wallet 1.661 modules, CSS 3.821 bytes, worker 284.135 bytes, main JS 476.716 bytes. Chỉ có cảnh báo chunk mật mã lớn |
| Migration/seed | `prisma migrate deploy`: 4 migration, không có migration chờ. Seed: 8 sản phẩm, 3 danh mục, 3 lô; giữ nguyên volume |
| Bảo toàn G1 | baseline **46/46** khớp, 0 mismatch; `verify-owner.mjs` exit 0 và PASS AGE/LOT, summary/fingerprint/source/build/golden, 71 witness checks và 15 proof checks |
| Giỏ thường | PASS: policy không mở Wallet; integration test xác nhận `/age/challenges` trả `AGE_NOT_REQUIRED`, không tạo `AgeChallenge`, rồi COD thành công |
| Nhiều sản phẩm 18+ | PASS: toàn bộ snapshot dùng đúng 1 challenge và 1 verification; checkout chỉ gửi `ageVerificationId` |
| Popup/protocol | PASS tự động: sai website/Wallet origin, sai API artifact origin, `event.source`, request/challenge ID và request replay đều bị từ chối; listener, interval và timeout được dọn ở success/reject/close/timeout |
| Artifact AGE | PASS: hash WASM/zkey được kiểm cho cache/network; cache sai bị xóa và SHA sai bị từ chối trước proving. API startup tiếp tục fail closed nếu artifact G1 lệch |
| AGE proof/API | PASS: proof hợp lệ, underage, proof/public signals/signature sửa, challenge hết hạn, cart đổi, replay, DB unique nullifier, checkout song song/idempotency, retry sau lỗi trước commit |
| Dữ liệu kín | PASS source/schema/DB audit: website không có parser/prover/file input AGE; API strict từ chối `privateInputs`; schema public không có tên cột DOB/dobDay/salt/holderSecret/witness/supplierIdHash/privateLotCodeHash/private key/credential kín |
| LOT | PASS bundle public không chứa tên hoặc giá trị supplier/salt/private lot hash; proof sửa, sai lô, hết hạn, revoke sau proof, stale, tranh tồn và hồi quy G2–G3 đều đạt |

Lần test đầu thất bại vì `TEST_DATABASE_URL` trong `apps/.env` dùng mật khẩu khác volume hiện hữu. Đã sửa cấu hình cục bộ để dùng đúng mật khẩu hiện hữu và schema `g2_test`, không ghi mật khẩu vào tài liệu. Lần sau phát hiện rate limit test AGE chia sẻ IP mặc định giữa các fixture; đã cấp `remoteAddress` riêng cho từng test client. Fixture duplicate-nullifier từng va vào nonce tĩnh còn lại trong schema test; đã chuyển fixture sang nonce/requestHash ngẫu nhiên. Đây là sửa lỗi test isolation, không nới lỏng kiểm tra production.

### Kiểm tra dịch vụ và UI thật

- API health qua HTTP cục bộ: `{"status":"ok","gate":"G5","ageZkp":"integrated","lotZkp":"integrated"}`. Website `5173` và Wallet `5174` trả 200; dev server ba tiến trình vẫn chạy sau kiểm tra.
- Catalog hiển thị 8 sản phẩm. Tìm `ca phe` trả đúng “Cà phê Đắk Lắk”. Chuỗi này là Unicode NFC, dùng Times New Roman và `letter-spacing: normal`; chữ Việt có dấu hiển thị liền, console không có warning/error.
- Wallet hiển thị trạng thái chưa có thông tin xác minh, nút “Thêm thông tin xác minh” và ranh giới IndexedDB/website rõ ràng; console không có warning/error. Agent không nhập credential owner.
- LOT `BP-2026-03` của `hat-dieu-binh-phuoc` trả `ACTIVE`, có `checkedAt`, hết hạn `2026-10-29T04:36:44Z`, bundle không có trường kín và UI hiện “Đã xác minh thông tin vùng của lô hàng”. Lô `DL-2026-01` không hiện nhãn đã xác minh. Ảnh nằm trong `docs/evidence/g5/`.
- CORS artifact AGE có `Access-Control-Allow-Origin: http://127.0.0.1:5174` với Wallet origin và không có header cho origin lạ. AGE WASM trả đúng 2.423.303 bytes; endpoint LOT dùng `Cache-Control: no-store`.
- Browser tự động chặn tab API `3001` với `ERR_BLOCKED_BY_CLIENT`, nhưng HTTP cục bộ xác nhận health 200. Scope điều khiển browser không cung cấp quyền đọc IndexedDB/Cache Storage. Responsive đã kiểm ở viewport thật 390 × 844 cho website và Wallet: media query mobile hoạt động và không có tràn ngang; storage/cache và popup AGE thật vẫn nằm trong checklist owner.

### Tinh chỉnh giao diện cửa hàng và Ví — 30/09/2026

- Trang chủ, catalog, chi tiết sản phẩm/lô, giỏ/checkout, đăng nhập/đăng ký, tài khoản, địa chỉ, đơn hàng, quản trị và Wallet dùng cùng hệ màu xanh lá trầm, nền ngà, chữ hiển thị Times New Roman và chữ nội dung Segoe UI. Bố cục 390 × 844 đã kiểm trực tiếp, không có overflow ngang.
- Nội dung dành cho khách đã bỏ các nhãn kỹ thuật hoặc câu chữ kiểu bản thử nghiệm. Chi tiết ZKP, Issuer, credential, origin, thời hạn và giới hạn không phải chứng nhận pháp lý vẫn có trong phần mở rộng hoặc khu vực quản trị để giữ minh bạch.
- Trang tài khoản có đổi mật khẩu; API kiểm mật khẩu hiện tại, hash Argon2id mật khẩu mới và thu hồi các session khác. Quản trị có danh sách người dùng chỉ đọc, không trả `passwordHash`.
- Ảnh trước/sau và desktop/mobile: `ui-before-home.jpg`, `ui-after-home-viewport.png`, `ui-after-product-viewport.png`, `ui-after-account-viewport.png`, `ui-after-admin-viewport.png`, `ui-after-admin-users-viewport.png`, `ui-after-home-mobile-390x844.png`, `ui-before-wallet.jpg`, `ui-after-wallet-viewport.png`, `ui-after-wallet-mobile-390x844.png`.
- JSON máy đọc cập nhật tại `docs/evidence/g5/test-results.json`; đối chiếu G1 riêng tại `docs/evidence/g5/g1-preservation-ui.json` cho kết quả **46/46**, 0 mismatch. Không sửa circuit, verification key, trusted setup hay artifact G1.

DB public tại thời điểm kiểm có 0 AgeChallenge, 0 AgeVerification, 1 LotCredential và 1 LotProof. Đây là ảnh chụp trạng thái demo, không phải invariant. JSON máy đọc tại `docs/evidence/g5/test-results.json`; ảnh desktop gồm `web-home-desktop.png`, `wallet-empty-desktop.png`, `lot-active-ui.png`, `lot-unverified-ui.png`.

### Benchmark và kết luận

UI hiện riêng cold/warm cache, WASM load, zkey load, witness + proof, Wallet total, API verify và tổng từ consent. Không có credential AGE owner trong phiên nên không chạy popup/proof thật và không ghi số benchmark giả. Phần này là **PENDING OWNER MANUAL TEST** theo `docs/wallet-manual-test.md`.

**Trạng thái G5: READY AFTER OWNER TEST.** Toàn bộ kiểm tra tự động và kiểm tra vận hành không cần bí mật đã đạt. Chưa tuyên bố 100% hoàn tất, production-ready hay được giảng viên phê duyệt; trạng thái chỉ chuyển khi chủ sở hữu hoàn thành E2E AGE và ghi số đo cold/warm mà không chia sẻ private key/credential.

## Tinh chỉnh UX thương mại và header sticky — 02/10/2026

Phạm vi chỉ sửa giao diện website và tài liệu bằng chứng. Không tạo migration, không reset volume PostgreSQL, không đổi giao thức Website–Wallet, circuit AGE/LOT, public signals, trusted setup, proving/verification key hoặc artifact G1. Repository vẫn không có metadata `.git`, nên không thể dùng `git status`/`git diff`; thay đổi được kiểm bằng filesystem, build và baseline SHA-256.

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| `npm --prefix apps test` | **59/59 PASS, 0 fail**: tìm kiếm 4, checkout policy 1, Wallet/protocol 16, G2 15, G3 AGE 14 và G4 LOT 9. Dòng lỗi Circom của witness chưa đủ tuổi là đầu ra phủ định mong đợi; subtest vẫn PASS |
| `npm --prefix apps run build` | PASS web, Wallet và `tsc --noEmit`; web 1.678 modules, CSS 26,34 kB, main JS 898,07 kB; Wallet 1.661 modules, CSS 3,82 kB, worker 284,14 kB, main JS 476,72 kB. Chỉ còn cảnh báo chunk mật mã lớn đã biết |
| Bảo toàn G1 | **46/46** SHA-256 khớp, 0 mismatch; bằng chứng mới tại `docs/evidence/g5/g1-preservation-sticky-ui.json` |
| Sticky desktop | Trước sửa tại `scrollY ≈ 700`, header ở ngoài viewport (`top ≈ -665 px`) và giỏ không còn thấy. Sau sửa tại 1280 × 720, header `position: sticky`, `top = 0`, cao khoảng 140,6 px và giỏ vẫn hiện |
| Sticky tablet/mobile | 768 × 1024: header `top = 0`, cao khoảng 133,4 px, không overflow ngang. 390 × 844: header `top = 0`, cao khoảng 123,8 px; nút giỏ và số lượng luôn hiện, menu mở ngay dưới header; document không overflow ngang |
| Nội dung không bị che | Trang chi tiết giữ ảnh sản phẩm bên dưới header khi cuộn; khoảng bám của ảnh và tóm tắt checkout dùng chiều cao sticky header. Announcement chỉ hiện ở đầu trang và không sticky |
| Catalog/tìm kiếm | 8 thẻ có cùng tỉ lệ ảnh, phần nội dung co giãn và tên giới hạn hai dòng. Tìm `ca phe` trên UI trả đúng một thẻ “Cà phê Đắk Lắk”; empty state có hướng dẫn và nút trở về toàn bộ sản phẩm |
| Giỏ/checkout | Nút số lượng/xóa bị khóa trong lúc gửi; tăng số lượng bị khóa khi chạm tồn; vùng hành động nêu rõ thiếu địa chỉ, cần xác minh tuổi hoặc đã sẵn sàng đặt COD. Giỏ rỗng có CTA rõ ràng |
| Quản trị | Tìm kiếm không dấu hoạt động (`ruou` → 2 mục), bộ đếm kết quả, trạng thái tải/disabled, empty row và phân trang 6 dòng/trang hoạt động (`Trang 1 / 2` → `Trang 2 / 2`). Bảng mobile cuộn bên trong, document không tràn ngang |
| Các route và Console | Đã mở trang chủ, danh mục/tìm kiếm, chi tiết sản phẩm, giỏ, tài khoản, đơn hàng, quản trị và Wallet thật. `tab.dev.logs` trả `[]` cho cả website và Wallet ở các mức warn/error |

Ảnh trước/sau và responsive nằm trong `docs/evidence/g5/`: `ui-sticky-before-home.png`, `ui-sticky-before-scrolled.png`, `ui-sticky-after-home.png`, `ui-sticky-after-scrolled.png`, `ui-sticky-after-product-scrolled.png`, `ui-sticky-after-tablet-768x1024.png`, `ui-sticky-after-mobile-390x844.png`, `ui-sticky-after-mobile-menu.png`, `ui-sticky-after-mobile-scrolled.png`, `ui-sticky-after-admin-filter.png`, `ui-sticky-after-admin-mobile-390x844.png` và `ui-sticky-wallet-mobile-390x844.png`.

Không nhập hoặc đọc credential AGE của owner, không chạy popup/proof AGE owner và không ghi benchmark giả. Trạng thái tổng thể vẫn là **READY AFTER OWNER TEST**.
