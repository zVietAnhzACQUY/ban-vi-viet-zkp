# Bảng trạng thái demo → nguyên mẫu pilot SME

| Hạng mục | Trước | Mục tiêu | Sau lượt này |
|---|---|---|---|
| Issuer AGE | CLI xuất file | Portal operator + audit | Có request/status/ADMIN guard/audit; ký vẫn ở CLI |
| DOB | Nhập tại CLI | Operator đối chiếu, checkout không nhập | Portal xác nhận mô phỏng; DOB chỉ nhập cục bộ ở CLI |
| Delivery | Import JSON | Nhận vào Ví một lần | Chưa có delivery service; import chuyển vào nâng cao |
| Wallet at-rest | Plaintext IndexedDB | PIN + AES-GCM + auto-lock | Đã triển khai |
| Checkout 18+ | Challenge/popup/proof | Một proof/cart, retry an toàn | Giữ nguyên kiểm soát G3/G5 |
| LOT | ACTIVE/ARCHIVED | Lifecycle đầy đủ hơn | DRAFT/PENDING/ACTIVE/EXPIRED/REVOKED/STALE/ARCHIVED |
| Version | Một phần trong metadata | Lifecycle tối thiểu | Có issuerKeyId/circuitVersion ở request, lot, credential, proof |

## Kiến trúc trước và sau

Trước: khách nhận file từ CLI → Wallet lưu plaintext → checkout gọi Wallet; admin nhập LOT proof trực tiếp. Không có trạng thái yêu cầu cấp AGE.

Sau: khách tạo request → ADMIN/operator xác nhận hồ sơ mô phỏng → Issuer CLI chỉ ký request đã duyệt → Wallet mã hóa credential bằng PIN → checkout dùng proof gắn user/cart. LOT đi qua draft/pending, chỉ active sau import proof hợp lệ; thay binding hoặc thu hồi làm trạng thái không còn hợp lệ.

## Threat model rút gọn

- Tách origin ngăn website đọc IndexedDB Wallet; vẫn cần CSP/headers tại reverse proxy.
- PIN bảo vệ at-rest nhưng không chống malware/extension/XSS khi Wallet đang mở.
- ADMIN và Issuer mới chỉ phân vai logic; demo không có HSM hay tổ chức Issuer độc lập.
- APPROVED chỉ là đối chiếu hồ sơ mô phỏng, không phải KYC/VNeID.
- ZKP không chứng minh DOB hoặc xuất xứ vật lý là thật.
- Trạng thái LOT chỉ đúng tại `checkedAt`; nghiệp vụ phụ thuộc phải query lại DB.

Khoảng trống chính: delivery tự động một lần cần Issuer service độc lập, token TTL/binding user và mã hóa đầu-cuối cho Wallet. Không nên đặt private key hay plaintext credential trong API thương mại.
