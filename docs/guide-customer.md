# Hướng dẫn khách hàng

1. Đăng nhập, mở Tài khoản và gửi yêu cầu xác minh. Không nhập ngày sinh trên Website hoặc checkout.
2. Chọn **Xem chi tiết** để theo dõi tiến trình tại `/account/age-verification/{requestId}`. Website chỉ hiển thị mã rút gọn, thời gian và trạng thái; đây là đối chiếu hồ sơ mô phỏng ngoài hệ thống, không phải KYC/VNeID hay xác nhận của cơ quan nhà nước.
3. Khi request là `ISSUED`, chọn **Tiếp tục nhận tại Issuer**. Portal 5175 kiểm tra ownership, tạo claim rồi chuyển trực tiếp sang Wallet; credential và claim token không quay lại Bản Vị Việt.
4. Tạo PIN/passphrase 8–64 ký tự. PIN số ngắn dễ bị thử offline hơn; ưu tiên passphrase dài, khó đoán. Quên PIN cần xóa Ví và nhận credential mới.
5. Import tệp chỉ nằm trong **Nâng cao / Khôi phục từ tệp**, dùng khi luồng Delivery không khả dụng.
6. Với giỏ 18+, chọn **Tiếp tục xác minh**, đọc bên yêu cầu/mục đích/dữ liệu công khai rồi đồng ý. Giỏ thường không mở Wallet.
7. Khóa Ví khi dùng xong; Ví tự khóa sau 5 phút.

Không gửi credential, PIN, DOB hoặc ảnh giấy tờ cho hỗ trợ/chat.
# Nhận credential AGE trực tiếp vào Ví

Khi yêu cầu AGE hiện `ISSUED`, chọn **Nhận vào Ví**. Portal mở một liên kết dùng một lần chỉ chứa token, có hiệu lực 5 phút. Trong Wallet, nhập PIN/passphrase để mở khóa; Wallet tự kiểm schema, Issuer và chữ ký, sau đó mã hóa credential trên thiết bị. Nếu mạng mất sau khi lưu, giữ nguyên tab và chọn **Xác nhận đã lưu** để retry ACK.

Không chia sẻ claim URL. URL không chứa DOB, salt, holderSecret, credential hay private key. Tài khoản đang đăng nhập ở Wallet phải là tài khoản đã tạo yêu cầu. Nhập tệp vẫn có trong **Nâng cao / Khôi phục từ tệp**, chỉ dùng khi luồng trực tiếp không khả dụng.

Trang chi tiết yêu cầu trên Website polling 7 giây và dừng ở trạng thái kết thúc. Chỉ khi `ISSUED`, Website mới đưa người dùng sang `http://127.0.0.1:5175/receive-age/{requestId}` để nhận credential.

# Nộp hồ sơ AGE (07/10/2026)

Sau tạo request, Website chuyển sang Issuer `/submit-age/{id}`. Nếu chưa nộp, chọn “Tiếp tục cung cấp hồ sơ” trên tài khoản/chi tiết. Chọn hồ sơ điện tử (PDF/JPG/PNG ≤5MB hoàn toàn hư cấu), đối chiếu trực tiếp hoặc mã FICTIONAL của phương thức ngoài hệ thống; consent rồi gửi. Quay lại Website theo dõi, không tự xác nhận tuổi hoặc phê duyệt. Khi ISSUED tiếp tục nhận tại Issuer/Wallet. Không dùng giấy tờ thật; không KYC/VNeID. Hồ sơ đã nộp không thay thế ở v1. [Hướng dẫn đầy đủ](age-evidence-2026-10-07.md).

