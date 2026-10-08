# G1 — Hai thao tác người thực hiện cần tự chạy

**Cập nhật 28/09/2026: đã nhận owner-summary và đối chiếu artifacts thành công; G1 hoàn tất trong phạm vi demo. Không chạy lại các bước tạo khóa/contribution trên workspace hiện tại.** Hướng dẫn dưới đây được giữ để truy vết quy trình người dùng thực hiện; kiểm lại chỉ đọc bằng `node circuits/scripts/verify-owner.mjs`. Agent không chạy thay bước owner và không đọc private key. Không ghi giảng viên đã duyệt, không tuyên bố Issuer độc lập hoặc ceremony nhiều bên.

Mở PowerShell tương tác trên máy của bạn tại `E:\ban-vi-viet`. Script chỉ hỏi nhập `TOI` để xác nhận chính bạn thao tác; không hỏi hoặc in private key/entropy. Không dùng shell transcript/screen recording để ghi nội dung bí mật.

## 1. Tự tạo và giữ khóa Issuer

```powershell
Set-Location E:\ban-vi-viet
powershell -NoProfile -File .\circuits\scripts\owner-keys.ps1
```

Mặc định tạo thư mục **mới** `%LOCALAPPDATA%\BanViViet\issuer` ngoài repo, bỏ quyền ACL kế thừa và chỉ cấp quyền cho tài khoản Windows hiện tại trước khi sinh khóa. Hai private key Ed25519 nằm trong `age.pkcs8.pem`, `lot.pkcs8.pem`; không vào biến môi trường hoặc web session. Script từ chối thư mục đã tồn tại để không sửa quyền/ghi đè khóa cũ. Nếu đã có thư mục này, chọn thư mục mới bằng `-PrivateDirectory 'C:\duong-dan-ngoai-repo\issuer-moi'`; không xóa khóa cũ tùy tiện.

Đầu ra được phép gửi: `artifacts/issuer-public.json` (chỉ public key raw/base64url, fingerprint SHA-256, key version và loại AGE/LOT). Không gửi các tệp PEM. Khóa thuộc quyền giữ của bạn; đây vẫn là Issuer mô phỏng, không có độc lập thể chế.

## 2. Trực tiếp contribution và thử lại proof bằng key mới

```powershell
powershell -NoProfile -File .\circuits\scripts\owner-complete.ps1
```

Nhập `TOI` ở prompt trong terminal. Script xác nhận toolchain/constraints/test evidence, thêm contribution phase 2 riêng cho A/B trên setup phát triển đã verify, dùng entropy từ CSPRNG tại máy; không cần nhập hay gửi entropy. Tiếp đó kiểm zkey từ R1CS/ptau, export vk, chạy lại các proof test trên key mới, cập nhật manifest và summary công khai. Không dùng key `_0000` cuối cùng. Phase 1 trước đó là contribution tự động trên cùng máy; thao tác của bạn bổ sung phase 2, không phải tạo thêm một bên độc lập.

Đầu ra cần gửi lại: nội dung `artifacts/evidence/owner-summary.json` hoặc thông báo đã chạy thành công để agent đọc tệp trong workspace. Summary có status, hash manifest/transcript, fingerprint và số proof checks, không có private key. Nếu lỗi, gửi thông báo lỗi đã kiểm không có bí mật; không gửi `.wtns`, entropy, credential hay tệp PEM.

Script dừng nếu phát hiện setup dở dang hoặc đã hoàn tất để tránh ghi đè kết quả. Nếu bước contribution xong nhưng proof/finalize lỗi, không chạy lại contribution: sau khi xử lý lỗi, chạy hai lệnh sau:

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe circuits/scripts/proof-tests.mjs --owner
.\.tools\node-v24.21.0-win-x64\node.exe circuits/scripts/finalize.mjs
```

Giới hạn: contribution một người trên máy phát triển, không chứng minh entropy đã hủy, không tương đương setup nhiều bên. Summary máy sinh cần được đối chiếu với evidence; không phải chứng nhận pháp lý hay chứng minh thao tác do người độc lập thực hiện. Q4/fingerprint và kết luận G1 đã cập nhật sau khi kiểm summary/artifacts ngày 28/09/2026. Không chuyển sang API/web trong lượt này.
