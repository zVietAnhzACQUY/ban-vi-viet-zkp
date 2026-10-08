# Bản Vị Việt — website SME với Ví ZKP tách origin

G1 giữ hai circuit Groth16 và owner artifacts bất biến. G2 cung cấp website SME, API Fastify và PostgreSQL. G3 tích hợp proof tuổi vào checkout 18+. G4 bổ sung credential/proof LOT, kiểm trạng thái online và gán lô atomically khi đặt COD. G5 ngày 30/09/2026 đã chốt hồi quy, build và kiểm tra vận hành; trạng thái demo là **READY AFTER OWNER TEST** vì E2E/benchmark AGE bằng credential do chủ sở hữu giữ còn chờ kiểm thử thủ công.

Đặc tả: [docx/implementation-spec.md](docx/implementation-spec.md). Quyết định: [docs/decisions.md](docs/decisions.md). API/ERD: [docs/api-erd.md](docs/api-erd.md). Bằng chứng: [docs/test-evidence.md](docs/test-evidence.md).

## Khởi động trên Windows

Yêu cầu Docker Desktop đang chạy. Dùng đúng Node 24.21.0 đã pin:

```powershell
Set-Location E:\ban-vi-viet
$env:PATH = "$PWD\.tools\node-v24.21.0-win-x64;" + $env:PATH
node --version
npm --version

npm ci --ignore-scripts
npm --prefix apps ci --ignore-scripts
if (-not (Test-Path apps\.env)) { Copy-Item .env.example apps\.env }

docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` khởi động năm tiến trình: website `http://127.0.0.1:5173`, Ví `http://127.0.0.1:5174`, Issuer Portal `http://127.0.0.1:5175`, API thương mại/verifier `http://127.0.0.1:3001` và Issuer Delivery `http://127.0.0.1:3002`. Website tạo/theo dõi yêu cầu bằng dữ liệu trạng thái tối thiểu. Issuer Portal chỉ chứa khu vực operator và bước tiếp tục nhận credential `ISSUED`. PostgreSQL 17.6 chỉ lắng nghe localhost cổng 5434 và dùng volume `bvv_g2_pg`. Giữ `apps/.env` hiện có khi volume đã được khởi tạo bằng mật khẩu riêng. **Không chạy `docker compose down -v`**, vì lệnh đó xóa dữ liệu PostgreSQL hiện có.

## Tài khoản demo

| Vai trò    | Email                  | Mật khẩu         |
| ---------- | ---------------------- | ---------------- |
| Khách hàng | `khach@banviviet.demo` | `BanViViet@2026` |
| Quản trị   | `admin@banviviet.demo` | `BanViViet@2026` |

Chỉ dùng danh tính, địa chỉ, ngày sinh, nhà cung cấp và lô hư cấu. Issuer và trusted setup đều do một người vận hành; nhãn proof của demo không phải chứng nhận nguồn gốc vật lý, kết luận pháp lý hoặc phê duyệt của giảng viên.

## Cấp credential và tạo proof LOT

Tìm UUID lô trong trang quản trị. Trên máy đang giữ đúng private key LOT G1, chạy các lệnh sau. Credential phải nằm ngoài repository; public proof bundle có thể tải lên trang quản trị.

```powershell
Set-Location E:\ban-vi-viet
$credential = "$env:LOCALAPPDATA\BanViViet\credentials\lot-demo.json"
$bundle = "$env:LOCALAPPDATA\BanViViet\proofs\lot-demo.public.json"

npm --prefix apps run issuer:lot -- --lot-id "UUID_LOT" --supplier-code SUP-DEMO-01 --origin-code 1 --out $credential
npm --prefix apps run prover:lot -- --credential $credential --out $bundle
npm --prefix apps run verify:lot -- --bundle $bundle
```

`issuer:lot` mặc định đọc `%LOCALAPPDATA%\BanViViet\issuer\lot.pkcs8.pem`, đối chiếu public key/fingerprint LOT G1, rồi in đường dẫn, credential ID và hạn UTC. `prover:lot` kiểm chữ ký/binding/artifact trước khi tạo Groth16 proof B; bundle công khai không có mã nhà cung cấp, salt hoặc witness. `verify:lot` phải in JSON với `"valid": true` và dòng `REVOCATION NOT CHECKED`; đây chỉ là kiểm offline, trạng thái thu hồi hiện tại phải xem qua website/API.

Không gửi private key hoặc credential LOT vào chat, Git, phiên đăng nhập hay API. Nếu private key chưa có ở đường dẫn trên, người giữ khóa cần đặt tệp PKCS#8 vào đó hoặc truyền `--key <đường-dẫn>` cho `issuer:lot`.

## Yêu cầu và cấp credential AGE

Khách gửi và theo dõi yêu cầu tại `/account/age-verification/{requestId}` trên Website. Trang này chỉ nhận mã, thời gian và trạng thái; không nhận CCCD/DOB/ảnh khuôn mặt, credential hoặc claim token. ADMIN đăng nhập Issuer Portal tại `5175/login`, thao tác ở `/operator` và phải xác nhận đã đối chiếu hồ sơ giả lập ngoài hệ thống rồi mới phê duyệt.

Trên máy đang giữ private key AGE G1, ký request đã được operator duyệt. CLI nhận UUID request và chỉ hỏi ngày sinh hư cấu trong terminal; không gửi private key hoặc tệp credential vào chat.

```powershell
$out = "$env:LOCALAPPDATA\BanViViet\credentials\age-khach.json"
npm --prefix apps run issuer:age -- --request "UUID_YEU_CAU" --out $out
```

Sau khi CLI hoàn tất request thành `ISSUED`, Website chỉ hiện **Tiếp tục nhận tại Issuer** tới `/receive-age/{requestId}` ở origin 5175. Portal kiểm ownership, tạo claim và chuyển thẳng sang Wallet; Website không nhận credential hoặc claim token. Import tệp trong Wallet chỉ là đường khôi phục nâng cao.

Ở lần mua 18+ đầu tiên và những lần sau: chọn địa chỉ, bấm **Xác minh điều kiện tuổi**, xem bên yêu cầu/mục đích trong popup rồi bấm đồng ý. Wallet lấy credential đã lưu, tạo một proof mới cho toàn bộ giỏ và trả dữ liệu công khai. Website chỉ hiện dấu xác minh sau khi API chấp nhận proof; sau đó bấm **Đặt hàng COD**. Một giỏ có nhiều sản phẩm 18+ vẫn chỉ cần một proof. Giỏ thường không tạo challenge và không mở Wallet.

## Chức năng đã hoạt động

- Catalog responsive, tìm kiếm tiếng Việt có/không dấu, chi tiết sản phẩm, tài khoản và đổi mật khẩu, địa chỉ, giỏ và COD.
- Checkout 18+ dùng challenge 300 giây, `requestHash` từ server và Wallet origin riêng. Web Worker trong Wallet tạo proof sau consent; API xác minh trước, còn checkout tiêu thụ `ageVerificationId`/challenge/nullifier trong transaction.
- `apps/web` không có file input credential AGE, không tạo witness và không nhận ngày sinh, dobDay, salt, holderSecret hoặc toàn bộ credential kín. Wallet lưu credential một lần theo thiết bị; mỗi checkout tạo proof mới chống replay.
- Trang sản phẩm có “Kiểm tra thông tin lô hàng”. API chỉ trả bundle khi credential/proof và trạng thái hiện tại đều `ACTIVE`; browser kiểm fingerprint/key, chữ ký, product/lot hash, policy, hạn, verification-key hash và Groth16 trước khi hiện “Đã xác minh thông tin vùng của lô hàng”.
- Admin tạo/sửa lô và tồn lô, tải public proof bundle, thu hồi credential. Thu hồi hoặc hết hạn làm nhãn xác minh biến mất dù proof cũ vẫn đúng về mật mã.
- Với sản phẩm có lô, checkout khóa các lô, chọn lô `ACTIVE` đủ tồn theo `lotCode` tăng dần, trừ tồn tổng và tồn lô, rồi snapshot `lotId/lotCode` vào dòng đơn trong cùng transaction. Hủy đơn hoàn cả hai loại tồn đúng một lần.
- Sản phẩm chưa có lô tiếp tục dùng tồn tổng. V1 không tách một dòng đơn qua nhiều lô và client không được tự chọn lô.

## Kiểm tra G5 và Ví

Giữ PostgreSQL chạy. Chạy test/build ứng dụng từ đúng workspace `apps`, sau đó kiểm nguyên trạng G1:

```powershell
Set-Location E:\ban-vi-viet\apps
npm test
npm run build
Set-Location E:\ban-vi-viet
.tools/node-v24.21.0-win-x64/node.exe circuits/scripts/verify-owner.mjs
```

Test dùng schema riêng `g2_test` và từ chối chạy vào schema khác. Kết quả G5 ngày 30/09/2026 đạt **59/59** và baseline thời điểm đó khớp **46/46**. Nhánh pilot 04/10/2026 có migration chưa áp dụng và full integration đang chờ DB test; không dùng số G5 như bằng chứng cho lifecycle pilot. Kiểm hiện tại tách 45/45 tệp baseline bất biến khỏi `witness-tests.json` là evidence động có timestamp; xem [báo cáo rà soát pilot](docs/pilot-consistency-review.md).

Popup end-to-end với credential ký bằng khóa owner cần người giữ khóa tự làm theo [checklist Ví ZKP](docs/wallet-manual-test.md). Ghi ít nhất một lượt cold cache và hai lượt warm cache, gồm thời gian WASM, zkey, witness + proof, API và tổng. Khi kiểm lỗi, thử đóng popup, bấm từ chối, xóa/đổi credential, sửa giỏ sau xác minh, chờ challenge hết hạn và gửi lại kết quả cũ. Chỉ gửi ảnh/trạng thái/timing công khai; không gửi credential hoặc private key.

Circuit, public verification key, `artifacts/`, root lockfile và baseline 46 tệp G1 không bị sửa. Dependency ứng dụng tiếp tục dùng lockfile riêng `apps/package-lock.json`.

## Trạng thái G5

- Website `5173`, Wallet `5174`, API health `3001` và PostgreSQL đã chạy trên volume hiện hữu; không reset dữ liệu và không tạo migration mới.
- Catalog thực tế có 8 sản phẩm; tìm kiếm tiếng Việt không dấu trả đúng “Cà phê Đắk Lắk”. Trang LOT active hiển thị nhãn xác minh tại `checkedAt`; lô chưa có proof không hiện nhãn. Console website/Wallet không có warning/error trong các trang đã kiểm.
- DB public tại thời điểm kiểm có 0 AgeChallenge, 0 AgeVerification, 1 LotCredential và 1 LotProof; audit tên cột không tìm thấy DOB/dobDay/salt/holderSecret/witness/supplierIdHash/privateLotCodeHash/private key/credential kín.
- In-app Browser không cho đọc trực tiếp IndexedDB/Cache Storage qua scope tự động và API `3001` bị browser client chặn khi mở như một tab độc lập; health được xác nhận bằng HTTP cục bộ. Việc xem storage/cache và popup AGE thật nằm trong checklist owner.
- Ảnh UI thực tế: [website desktop](docs/evidence/g5/web-home-desktop.png), [Wallet chưa có credential](docs/evidence/g5/wallet-empty-desktop.png), [LOT active](docs/evidence/g5/lot-active-ui.png), [LOT chưa xác minh](docs/evidence/g5/lot-unverified-ui.png).

Không tuyên bố 100% hoàn tất cho đến khi chủ sở hữu ghi kết quả `PENDING OWNER MANUAL TEST` trong checklist thành PASS.
# AGE evidence (07/10/2026)

Hồ sơ chỉ được nộp tại Issuer Portal bằng dữ liệu hoàn toàn hư cấu; Website không nhận file. Cấu hình riêng `AGE_EVIDENCE_STORAGE_DIR` ngoài repository/web root và `AGE_EVIDENCE_ENCRYPTION_KEY` base64 32 byte, không dùng lại khóa Delivery. Thiếu/sai cấu hình fail closed. Xem [thiết kế, migration, API/ERD, retention và E2E](docs/age-evidence-2026-10-07.md); không dùng giấy tờ thật hoặc tuyên bố KYC/VNeID.

## LOT request/evidence (07/10/2026)

ADMIN thương mại tạo yêu cầu tại quản lý lô, nộp hồ sơ hư cấu tại Issuer; ISSUER_OPERATOR độc lập đối chiếu. CLI chỉ ký request APPROVED; nhãn xác minh vẫn phụ thuộc proof, không phụ thuộc evidence hoặc operational status. Xem [migration, API/ERD, threat model và checklist owner Browser E2E](docs/lot-request-evidence-2026-10-07.md).

