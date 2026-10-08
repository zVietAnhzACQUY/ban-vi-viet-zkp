# Hướng dẫn SME operator

## AGE

- Mở Quản trị → **Yêu cầu AGE**.
- Chỉ duyệt sau khi đối chiếu hồ sơ hư cấu. Ngày sinh trong hộp xác nhận không gửi API; nhập lại khi chạy CLI.
- Không tự ký trong Portal và không đưa private key vào browser/API.
- Từ chối/thu hồi phải có lý do; hành động được ghi audit.

## LOT

- Tạo lô DRAFT, kiểm product/lotCode/tồn rồi chuyển PENDING.
- Sau khi Issuer/prover tạo bundle, nạp bundle; API chỉ chuyển ACTIVE sau khi kiểm đầy đủ.
- Đổi lotCode làm proof cũ STALE. Thu hồi luôn cần lý do.
- Proof không phải chứng nhận nguồn gốc vật lý hay kết luận pháp lý.
