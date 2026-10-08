-- READ-ONLY. Chạy trước mọi migration pilot để xác nhận migration nào đã được áp dụng.
-- Chỉ đọc metadata migration, không đọc dữ liệu nghiệp vụ hoặc secret.
SELECT migration_name, finished_at IS NOT NULL AS applied
FROM "_prisma_migrations"
WHERE migration_name LIKE '20261004000%pilot%'
ORDER BY migration_name;
