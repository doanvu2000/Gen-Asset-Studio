# Release notes — Gen Asset Studio

Mỗi phiên bản liệt kê ngắn theo 4 mục: **Update** · **Add** · **Remove** · **Fixbug** (mục trống thì bỏ).

## 1.1.0 — 2026-10-29

### Update
- Bước Style làm lại: nhóm style thành tab ngang, chỉ dẫn 3 bước (chọn ảnh → chọn style → chốt), thanh **Chốt style** luôn hiện ở đáy
- 3 cách tạo style rõ ràng: **Tự tạo** (mô tả và/hoặc ảnh tham chiếu → Vẽ preview), **Mẫu có sẵn**, **AI gợi ý**
- Tự tạo style: thêm **Chốt luôn theo mô tả** — không cần đợi gen preview
- Chốt xong style cho mọi nhóm có ảnh thì tự sang bước Gen
- Duyệt trong màn chi tiết: bấm Duyệt (A) tự sang ảnh tiếp; ảnh cuối đã duyệt có nút **Tiếp: Xuất** (Enter)
- Logo mới: Jin Vũ bắt tay GPT
- App mở phóng to toàn màn hình ngay từ đầu
- Ghi rõ cần tài khoản ChatGPT Plus trở lên

### Add
- Bản **portable** `GenAssetStudio-Portable-<phiên bản>.exe`: chạy không cần cài (không tự cập nhật)
- Nhận thêm ảnh JPG, WebP, AVIF, TIFF (vẫn ưu tiên PNG); xuất giữ đúng định dạng gốc
- Đóng app khi đang gen: thu xuống taskbar và chạy tiếp, đóng lần nữa sẽ hỏi thoát hẳn (tuỳ chọn ở Cài đặt › Chung)
- Dòng hướng dẫn **Bước N/5** đầu mỗi bước: bước này làm gì + bước tiếp theo
- Chọn loại asset khi tạo project: Ảnh 2D · Spine (sắp có) · Sprite sheet (sắp có)

## 1.0.0 — 2026-10-29

Bản phát hành đầu tiên.

### Add
- Đổi style cả bộ asset 2D PNG bằng Codex: giữ đúng tên file, cây thư mục, kích thước W×H
- Tự cài môi trường: Codex CLI, đăng nhập ChatGPT, xem quota, trạng thái từng thành phần
- Workspace nhiều project, cây thư mục thật trên đĩa
- Project 5 bước: Ảnh gốc → Style → Gen → Duyệt → Xuất
- Nhập ảnh: mở folder, thêm file, kéo thả từ Explorer
- 4 style sẵn: Candy Pop, Jelly Cartoon, Wood & Gold Adventure, Neon Arcade
- Codex gợi ý nhiều hướng style kèm ảnh preview, khoá style cho từng nhóm
- Nút chuẩn hoá prompt sang tiếng Anh, chọn model + effort (mặc định luna · medium)
- Hàng đợi gen chung, chạy song song 1–6 ảnh, hết quota tự dừng và tự chạy tiếp
- Tự tách nền, khử viền màu, đặt vừa khung gốc (có 9-slice), kiểm tra chất lượng
- Duyệt ảnh: so sánh gốc/mới, duyệt hàng loạt, gen lại kèm ghi chú, lịch sử phiên bản
- Xuất PNG nền trong suốt, tuỳ chọn ×2/×4, tự backup bản cũ
- "Gửi lỗi cho Codex sửa" khi cài đặt hoặc gen bị lỗi
- Cập nhật trong app: báo bản mới kèm ghi chú + ngày phát hành, hỏi trước khi tải
- Project mẫu 14 ảnh và hướng dẫn nhanh lần đầu
- Giao diện kiểu macOS, Sáng/Tối, Tiếng Việt/English, màn khởi động động
