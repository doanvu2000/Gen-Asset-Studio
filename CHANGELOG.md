# Release notes — Gen Asset Studio

Mỗi phiên bản liệt kê ngắn theo 4 mục: **Update** · **Add** · **Remove** · **Fixbug** (mục trống thì bỏ).
Mục `Chưa phát hành` gom thay đổi đang làm; khi ra bản thì đổi thành số phiên bản + ngày, dùng nguyên văn làm release note trên GitHub Releases.

## Chưa phát hành

### Add
- Workspace: cây thư mục thật, thẻ project (tìm, sắp xếp), tạo/đổi tên/chuyển/xoá vào Thùng rác, tự cập nhật khi folder đổi ngoài app
- Project 5 bước: Ảnh gốc → Style → Gen → Duyệt → Xuất
- Bước Ảnh gốc: mở folder (đệ quy, chỉ PNG), thêm ảnh, kéo thả, cây thư mục, chọn nhiều, xem trước W×H/alpha/dung lượng, đoán loại + 9-slice, báo thiếu file + trỏ lại folder
- Backend hàng đợi gen chung (song song 1–6, giữ khi khởi động lại, tự dừng khi hết quota và tự chạy tiếp)
- Backend style: chuẩn hoá prompt EN, gợi ý N hướng + preview, khoá style, lưu template riêng
- Bước Duyệt: lưới gốc|mới, so sánh slider/cạnh nhau, duyệt hàng loạt, chọn phiên bản, Xử lý lại (không tốn quota), gen lại kèm ghi chú
- Bước Xuất: đúng tên + cây thư mục + W×H, tuỳ chọn ×2/×4, backup bản cũ, nhớ folder xuất theo project
- Cập nhật trong app: hỏi trước khi tải, hiện ghi chú + ngày phát hành, cài khi khởi động lại
- Project mẫu 14 ảnh UI (nút Tạo project mẫu ở workspace trống, đầu trang và menu chuột phải)
- Hướng dẫn nhanh lần đầu cho workspace, project, bước Style; Xem lại hướng dẫn ở Cài đặt › Chung
- Icon app

### Update
- Màn chuẩn bị môi trường tự dò nhanh khi mở, bước đã đạt hiện xong ngay

### Fixbug
- Bản đóng gói thiếu template style sẵn (đóng gói qua extraResources)
- Bản đóng gói thiếu project mẫu (extraResources) và icon
- Cập nhật báo lỗi đỏ khi GitHub chưa có bản phát hành → nay báo đang dùng bản mới nhất
- Toast "Đã gen xong N ảnh" cộng nhầm job cũ

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
