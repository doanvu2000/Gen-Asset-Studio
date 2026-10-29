# Release notes — Gen Asset Studio

Mỗi phiên bản liệt kê ngắn theo 4 mục: **Update** · **Add** · **Remove** · **Fixbug** (mục trống thì bỏ).
Mục `Chưa phát hành` gom thay đổi đang làm; khi ra bản thì đổi thành số phiên bản + ngày, dùng nguyên văn làm release note trên GitHub Releases.

## Chưa phát hành

### Add
- Workspace: cây thư mục, thẻ project, tạo/đổi tên/xoá/kéo thả (M2, đang làm)
- Bước nhập ảnh: mở folder, thêm file, kéo thả, xem trước, đoán loại asset (M2, đang làm)
- Hàng đợi gen chung, tự dừng khi hết quota và tự chạy tiếp (M4, đang làm)

## 0.1.0 — 2026-10-29 (nội bộ, chưa phát hành)

### Add
- Khung app Electron: cửa sổ kiểu macOS, Sáng/Tối/Theo hệ thống, Việt/Anh, lưu cài đặt
- Màn khởi động: logo động + chữ "Gen Asset Studio" hiện từng ký tự, © Jin Vũ
- Setup gate 7 bước: kiểm quyền, tải + kiểm SHA-256 + cài Codex CLI 0.165.0, PATH (tuỳ chọn), bật đường dẫn dài (UAC), đăng nhập ChatGPT, quota + gen thử, chọn workspace
- Trạng thái môi trường (Đã cài / Đang cài / Chưa cài / Cài lỗi) ở thanh trạng thái và Cài đặt
- Cài đặt: tab Tài khoản (quota 5 giờ + tuần, đăng xuất/đổi tài khoản), tab Môi trường (cài lại, kiểm tra lại, báo bản Codex mới)
- "Gửi lỗi cho Codex sửa": Codex phân tích lỗi, đề xuất cách sửa, áp dụng khi người dùng đồng ý
- Xử lý ảnh sau gen: chọn nền chroma, tách nền, khử ám màu viền, cắt khối, fit đúng W×H gốc + 9-slice, phóng ×2/×4, QA
- 4 template style sẵn: Candy Pop, Jelly Cartoon, Wood & Gold Adventure, Neon Arcade
