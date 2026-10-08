# G1 — Toolchain đã pin trước khi viết circuit

Ghi nhận khi bắt đầu G1 (25–26/09/2026). Máy ban đầu có Node 22.14.0/npm 11.1.0, không có Circom. G1 dùng portable Node **24.21.0/npm 11.19.0** trong `.tools/node-v24.21.0-win-x64`, không thay Node toàn máy.

| Công cụ | Phiên bản | Nguồn |
|---|---|---|
| Node | 24.21.0, Windows x64 | https://nodejs.org/dist/v24.21.0/SHASUMS256.txt |
| Circom | 2.2.3 | https://github.com/iden3/circom/releases/tag/v2.2.3 |
| circomlib | 2.0.5 | https://github.com/iden3/circomlib |
| circomlibjs | 0.1.7 | https://github.com/iden3/circomlibjs |
| snarkjs | 0.7.6 | https://github.com/iden3/snarkjs |

Exact commits, SHA-256 binary/archive, flags, lockfile hash và golden hash: `artifacts/toolchain.json`. Node archive và compiler đã kiểm hash khớp nguồn phát hành HTTPS (không tuyên bố đã xác minh chữ ký nhà phát hành). `package-lock.json` khóa cả dependency bắc cầu bằng integrity; cài với `--ignore-scripts`. Không chạy `npm audit fix` tự ý đổi pin. Kết quả npm install có 18 cảnh báo dependency (12 low, 2 moderate, 4 high); phải rà trước G2, không coi toolchain G1 là dependency web production đã được duyệt.

Flags phát hành: `--r1cs --wasm --sym --O1 --prime bn128 --sanity_check 2`. Build bổ sung `--sanity_check 0` cho R1CS cùng hash nhưng vẫn gặp assert equality; kiểm ràng buộc độc lập bằng sửa trực tiếp binary witness. Bản WASM mức 0 không dùng phát hành. Circom kiểm constraint; ngày/encoding/chữ ký kiểm bằng Node. Script công cụ G1 dùng ESM `.mjs`; các ứng dụng TypeScript chưa bắt đầu.

Golden được tạo trước circuit, so Poseidon WASM với Poseidon reference (cùng họ constants nên không phải hai nguồn mật mã độc lập hoàn toàn); sau đó circuit phải khớp cả hai. Golden không tự tái tạo khi chạy test. Khóa ký fixture chỉ ở bộ nhớ, lưu public key/signature; không phải khóa Issuer.
