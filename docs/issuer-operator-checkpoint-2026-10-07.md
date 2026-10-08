# ISSUER_OPERATOR checkpoint — local pilot

Owner cho phép tạo mới `operator@evidence.invalid` trong public local, không sao chép dữ liệu xác thực từ schema khác. Tài khoản trong g2_test_20261005 giữ nguyên; schema g2_test cũ không truy cập. Không dùng admin@banviviet.demo làm operator.

Migration `202610070002_issuer_operator_role` chỉ ADD VALUE vào Role; không SQL tạo User/backfill/chuyển role, không tham chiếu enum mới trong cùng transaction. SHA-256: `CA4940A7E3B585225EA242A17604A3624FDF8D06212D4206116AEA1F18E048E4`. Backup full trước migration: `.work/backups/banviviet-before-issuer-role-20261007.dump`, 1,333,643 byte, pg_restore catalog PASS. Preflight AGE evidence đều0; preflight lifecycle/delivery trước đó đều0.

ADMIN là quản trị thương mại, không được review AGE hoặc mở evidence operator. ISSUER_OPERATOR được AGE operator list/review/revoke và mở evidence, không được API /admin quản trị sản phẩm/tồn kho. Legacy tên route /api/admin/age-credential-requests tạm giữ tương thích, nhưng guard chỉ ISSUER_OPERATOR. Portal dashboard/login chuyển role này; ADMIN/CUSTOMER bị chặn operator. Auth dùng nguyên endpoint và cookie hiện hữu; đăng nhập tài khoản ISSUER_OPERATOR chỉ chấp nhận exact Issuer Portal origin. Origin không thay thế role authorization.

## Owner tạo tài khoản

Chỉ sau migration finished và drift sạch, mở PowerShell tương tác:

```powershell
Set-Location E:\ban-vi-viet
npm --prefix apps run issuer:operator
```

CLI sẽ hỏi hai lần mật khẩu ẩn (12–128 ký tự, không echo). Không truyền password qua CLI argument hoặc chat. Email mặc định operator@evidence.invalid, display name Nhân viên xác minh. Nếu cần email khác, dùng ISSUER_OPERATOR_EMAIL; tool cấm email admin thương mại. Có thể dùng ISSUER_OPERATOR_PASSWORD trong môi trường local riêng, không in biến hoặc ghi transcript.

Idempotent: email đã ISSUER_OPERATOR thì không cập nhật mật khẩu/role và không tạo audit lặp; email role khác thì dừng EXISTING_ROLE_CONFLICT. Advisory transaction lock bảo vệ create đồng thời. Password băm Argon2id cùng cấu hình hiện hữu. Create+audit ISSUER_OPERATOR_ACCOUNT_CREATED cùng transaction; không tạo cart/session, không nhận private key. Chỉ kiểm public local/current_schema/migration trước ghi.

Nếu quên mật khẩu, chạy `npm --prefix apps run issuer:operator -- --reset-password`. Vẫn prompt ẩn, không đổi role; audit ISSUER_OPERATOR_PASSWORD_RESET và hết hạn session cũ. Không đọc hash/token hay sao chép User từ test. CLI lỗi chỉ in mã đã allowlist, không raw exception.

## Giới hạn checkpoint

Agent không chạy provisioning public vì owner tự đặt mật khẩu. Chưa có public account/login Browser E2E ba vai trò. Chưa triển khai LotCredentialRequest/LOT evidence/request-based LOT CLI; đó là bước tiếp theo sau owner tạo operator. Không tuyên bố hoàn thành toàn bộ kế hoạch hay production-ready. AGE/LOT circuit, G1 và Delivery protocol không đổi.

## Kết quả checkpoint

Public: migration role đã áp dụng, 10 finished/0 failed/0 rolled back, migrate status PASS và drift sạch. User2/AuditLog4 trước và sau không đổi; email operator vẫn chưa tồn tại trong public. Không chuyển role admin hoặc account ở schema khác. g2_test_20261007 áp dụng đủ10 migration và chạy fixture/test cô lập. Toàn bộ97 test PASS; build Website/Wallet/Portal và TypeScript PASS (Vite vẫn cảnh báo chunk lớn). G1 static45/45, witness evidence71/71 được giữ nguyên, không chạy lại harness owner.

File sửa: prisma/schema.prisma và migration role mới; apps/api/src/app.ts; apps/issuer/evidence-service.ts; apps/issuer-portal/src/api.ts, flow.ts, App.tsx, flow.test.ts; apps/web/src/api.ts; apps/api/tests/checkout.test.ts, run.ts; apps/issuer/evidence-service.test.ts; apps/package.json. File mới provisioning service/CLI/test ở apps/issuer. Không sửa migration cũ, private-key handling, credential schema hoặc Delivery protocol.
