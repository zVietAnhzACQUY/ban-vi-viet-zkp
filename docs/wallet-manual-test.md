# Checklist kiểm thử thủ công Ví ZKP AGE

Ngày cập nhật: 30/09/2026. Trạng thái G5: **PENDING OWNER MANUAL TEST**. Chỉ dùng tài khoản, địa chỉ và ngày sinh hư cấu. Không gửi private key hoặc credential vào chat/Git/API.

## Chuẩn bị

```powershell
Set-Location E:\ban-vi-viet
$env:PATH = "$PWD\.tools\node-v24.21.0-win-x64;" + $env:PATH
if (-not (Test-Path apps\.env)) { Copy-Item .env.example apps\.env }
docker compose up -d --wait
npm run db:migrate
npm run dev
```

Kiểm tra website `http://127.0.0.1:5173`, Wallet `http://127.0.0.1:5174`, API health `http://127.0.0.1:3001/api/health`. Không chạy `docker compose down -v`.

## Lần đầu trên thiết bị

1. Đăng nhập website bằng tài khoản demo và ghi lại UUID tài khoản.
2. Trên máy giữ private key AGE, phát hành request pilot theo hướng dẫn operator; không chia sẻ private key/credential.
3. Tại Portal, khi request là `ISSUED`, chọn **Nhận vào Ví**; trong Wallet nhập PIN và nhận trực tiếp. Kiểm URL chỉ có `claim` token. Import tệp chỉ kiểm ở mục **Nâng cao / Khôi phục từ tệp** như đường dự phòng.
4. Xác nhận Wallet chỉ hiện loại, Issuer, thời hạn; không hiện DOB/dobDay/salt/holderSecret.
5. Chọn **Lưu vào Ví**, tải lại Wallet và xác nhận credential vẫn có từ IndexedDB.
6. Ở website, thêm ít nhất một sản phẩm 18+, chọn địa chỉ rồi bấm **Xác minh đủ 18 tuổi bằng Ví ZKP**.
7. Xác nhận popup nêu Bản Vị Việt, mệnh đề đủ 18 tuổi, mục đích mua sản phẩm hạn chế tuổi và hạn request; proof chưa tự chạy.
8. Bấm **Đồng ý và tạo bằng chứng**. Chờ Wallet báo thành công và website gọi API.
9. Chỉ khi API trả thành công, website phải hiện **Đã xác minh đủ 18 tuổi cho đơn hàng này** và các timing của đúng lần chạy: cache cold/warm, WASM, zkey, witness + proof, Wallet total, API verify và tổng sau consent.
10. Bấm **Đặt hàng COD**; kiểm tra đơn có `ageVerificationId`, challenge/verification chuyển `CONSUMED` và giỏ bị xóa.

## Lần mua sau và nhiều sản phẩm

1. Không nhập credential lại. Thêm hai sản phẩm 18+ vào cùng giỏ.
2. Bấm xác minh một lần, đồng ý một lần; chỉ một challenge/proof/verification được tạo cho snapshot giỏ.
3. Đặt COD và xác nhận cả hai dòng nằm trong cùng đơn.
4. Với giỏ chỉ có sản phẩm thường, xác nhận nút Wallet không xuất hiện và checkout không tạo AgeChallenge.

## Ca từ chối và chống giả mạo

- Bấm **Từ chối** trong Wallet: website thoát trạng thái chờ và hiện lỗi dễ hiểu.
- Đóng popup trước consent và trong lúc chờ: website thoát trạng thái chờ.
- Để quá hạn request: Wallet/API từ chối; website không hiện đã xác minh.
- Xóa credential trong Wallet: request vẫn hiện nhưng nút tạo proof bị khóa và hướng dẫn thêm credential nằm trong Wallet.
- Thử credential sai schema, sửa một ký tự signature hoặc credential hết hạn: Wallet từ chối trước khi lưu.
- Sau khi API xác minh, đổi quantity/sản phẩm hoặc địa chỉ: website xóa dấu xác minh; giỏ thay đổi cũng bị API từ chối nếu cố gửi verification cũ.
- Gửi lại cùng proof vào endpoint verify: nhận `CHALLENGE_REPLAY`. Gửi lại `ageVerificationId` sau đơn thành công: nhận `AGE_PROOF_REPLAY`.
- Trong unit test, giả `event.origin`, `event.source`, request ID hoặc challenge ID khác đều bị từ chối; không dùng DevTools để nhập credential thật vào message.

## Ghi benchmark owner

Chạy ít nhất ba lần trên cùng browser/device: lần đầu sau khi xóa riêng Cache Storage artifact của Wallet là `cold`, hai lần sau là `warm`. Không xóa volume PostgreSQL. Chỉ chép các số timing công khai mà UI hiển thị; không chép credential, proof request body, IndexedDB value hoặc private input.

| Lần | Cache | WASM ms | zkey ms | Witness + proof ms | Wallet total ms | API verify ms | Tổng sau consent ms | Kết quả |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | cold | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| 2 | warm | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| 3 | warm | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |

Ghi thêm model CPU, RAM, browser/version và thời điểm chạy để số đo có ngữ cảnh. Không suy rộng kết quả của máy này thành cam kết hiệu năng cho thiết bị khác.

## Kiểm tra storage và Network bằng DevTools

1. Tại origin Wallet `http://127.0.0.1:5174`, mở Application → IndexedDB. Chỉ xác nhận database/object store tồn tại, số record credential và việc reload vẫn nhận credential; không mở/copy giá trị bí mật vào báo cáo.
2. Mở Application → Cache Storage sau lần proof cold. Xác nhận chỉ Wallet origin có cache artifact AGE; đối chiếu URL artifact. SHA-256 bytes đã được ứng dụng kiểm tự động, không sửa cache bằng credential thật.
3. Tại website origin, xác nhận không có credential AGE trong IndexedDB/localStorage/sessionStorage. `sessionStorage` Wallet có thể chứa ID request đã xử lý, không chứa credential.
4. Trong Network của website, request checkout chỉ mang `ageVerificationId`; request verify chỉ mang public envelope/proof/signals. Không lưu HAR nếu nó chứa cookie/session. Trong popup Wallet, không có DOB, salt, holderSecret, witness hoặc credential trong URL/query.
5. Ghi console warning/error của website và Wallet. Kết quả đạt cần 0 lỗi ngoài thông báo do chính ca test âm tạo ra.

Sau khi hoàn tất, đổi ba dòng benchmark sang số thực và thêm mã đơn công khai, kết quả cold/warm, console/Network/storage PASS vào tài liệu. Không gửi tệp credential để nhờ cập nhật.

## Giới hạn cần ghi khi trình bày

Wallet, Issuer và setup là mô phỏng do một người vận hành; IndexedDB chưa mã hóa bằng PIN; popup web không phải browser extension hay mobile wallet; không có đồng bộ nhiều thiết bị. Luồng chứng minh sự phân tách vai trò và kiểm mật mã của demo, không phải kết luận pháp lý hoặc hạ tầng định danh production.

Cho đến khi toàn bộ bước owner ở trên đạt và bảng benchmark có số đo thật, kết luận dự án giữ ở **READY AFTER OWNER TEST**.
