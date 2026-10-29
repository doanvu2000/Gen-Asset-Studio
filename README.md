# Gen Asset Studio

App Windows giúp đổi style **cả bộ asset 2D** cho game chỉ trong vài bước, dùng AI vẽ ảnh của Codex (ChatGPT).

Bạn đưa vào một folder ảnh UI (nút, icon, popup, thanh máu…), chọn hoặc tự tạo style mới, app vẽ lại từng ảnh và xuất ra **đúng tên file, đúng cây thư mục, đúng kích thước** như cũ — chép đè vào game là dùng được.

![Phiên bản](https://img.shields.io/github/v/release/doanvu2000/Gen-Asset-Studio)

## Cần có

- Windows 10/11 64-bit
- Tài khoản **ChatGPT Plus trở lên** (gói Free không gen ảnh được)
- Kết nối Internet

Không cần cài Node, Python hay công cụ nào khác — app tự lo.

## Tải về

Vào [Releases](https://github.com/doanvu2000/Gen-Asset-Studio/releases/latest), chọn 1 trong 2:

| File | Dùng khi | Cập nhật |
|---|---|---|
| `GenAssetStudio-Setup-<phiên bản>.exe` | Cài vào máy (khuyên dùng) | App tự báo bản mới, hỏi trước khi tải |
| `GenAssetStudio-Portable-<phiên bản>.exe` | Chạy luôn không cần cài, để trong USB / máy không có quyền cài | Không tự cập nhật — tải bản mới ở Releases |

Nếu Windows hiện "Windows protected your PC" → bấm **More info → Run anyway** (app chưa ký số).

Lần đầu mở app, màn **Chuẩn bị môi trường** tự chạy:
- App tự tải Codex (~160 MB).
- Bấm **Đăng nhập bằng ChatGPT** → đăng nhập trên trình duyệt → quay lại app.
- Chọn một folder làm **workspace** (nơi chứa các project).
- Nếu Windows hỏi quyền Administrator thì bấm **Yes**.

## Sử dụng

Mỗi bước trong project đều có dòng hướng dẫn **Bước N/5** ở đầu màn hình.

| Bước | Làm gì |
|---|---|
| 1. Ảnh gốc | Tạo project → **Mở folder** / **Thêm ảnh** hoặc kéo thả. Ưu tiên **PNG** (giữ nền trong suốt); JPG, WebP, AVIF, TIFF vẫn dùng được |
| 2. Style | Chọn ảnh cho nhóm, rồi tạo style theo 1 trong 3 cách: **Tự tạo** (viết mô tả và/hoặc thêm ảnh tham chiếu → **Vẽ preview** hoặc **Chốt luôn theo mô tả**), **Mẫu có sẵn**, **AI gợi ý** vài hướng để so sánh. Chọn 1 thẻ → **Chốt style này**. Chốt xong mọi nhóm thì app tự sang bước Gen |
| 3. Gen | Bấm **Bắt đầu gen**. Mỗi ảnh khoảng 30 giây; hết quota app tự dừng và tự chạy tiếp khi quota hồi |
| 4. Duyệt | Xem gốc / mới cạnh nhau. Ảnh đẹp → **Duyệt** (phím A, tự sang ảnh tiếp). Chưa ưng → ghi chú rồi **Regen** (phím R). Duyệt xong ảnh cuối → **Tiếp: Xuất** |
| 5. Xuất | Chọn folder xuất (mặc định `output` trong project), tuỳ chọn thêm bản ×2 / ×4 → **Xuất**. Ảnh giữ đúng định dạng gốc |

Lần đầu dùng: bấm **Tạo project mẫu** ở workspace để thử cả luồng với 14 ảnh có sẵn. Xem lại hướng dẫn: **Cài đặt › Chung › Xem lại hướng dẫn**.

### Mẹo

- Ảnh chưa vào nhóm style hoặc chưa được duyệt sẽ **không** được xuất.
- Xuất đè lên file cũ thì bản cũ được cất vào `output/_backup/<thời gian>/`.
- Nút, khung popup, thanh kéo dài được nên bật **9-slice** để góc không bị méo.
- **Chốt luôn theo mô tả** nhanh hơn nhưng không có ảnh khoá style, các ảnh có thể lệch nhau hơn một chút — muốn đồng đều thì vẽ preview rồi chốt.
- Đóng app khi đang gen: app thu xuống taskbar và chạy tiếp; đóng lần nữa sẽ hỏi có thoát hẳn không (đổi ở **Cài đặt › Chung**).
- JPG không có nền trong suốt — khi xuất ra JPG, phần trong suốt thành nền trắng.
- Gặp lỗi → bấm **Gửi lỗi cho Codex sửa** hoặc **Xuất log** gửi cho người phụ trách.

## Câu hỏi thường gặp

**Tốn quota nhiều không?** Mỗi ảnh khoảng 0,2% quota 5 giờ của gói Plus. Quota hiện ở **Cài đặt › Tài khoản**.

**Dữ liệu lưu ở đâu?** Ảnh gốc không bị đụng tới. Project lưu trong workspace bạn chọn. Codex ở `%LOCALAPPDATA%\GenAssetStudio`, cài đặt app ở `%APPDATA%\Gen Asset Studio` (bản cài và bản portable dùng chung).

**Đổi tài khoản ChatGPT?** **Cài đặt › Tài khoản › Đổi tài khoản**.

**Spine / Sprite sheet?** Đang phát triển (hiện "Sắp có" trong app).

## Thay đổi qua các phiên bản

Xem [CHANGELOG.md](CHANGELOG.md).

## Dành cho dev

```bash
npm install
npm run dev            # chạy thử
npm run build          # kiểm kiểu + build
npm run dist:win       # file cài NSIS vào release/<phiên bản>/
npm run dist:portable  # bản portable vào release/<phiên bản>/
npm run test:format    # test nhận định dạng ảnh
npm run test:export    # test xuất ảnh
```

Phát hành bản mới: tăng `version` trong `package.json` → thêm mục mới vào `CHANGELOG.md` (Update · Add · Remove · Fixbug) → `npm run dist:win` + `npm run dist:portable` → tạo GitHub Release `v<phiên bản>` kèm `GenAssetStudio-Setup-*.exe`, `.blockmap`, `latest.yml`, `GenAssetStudio-Portable-*.exe`, dán mục changelog làm ghi chú (`node scripts/release-notes.mjs <phiên bản>`).

Tài liệu thiết kế: `.planning/`.

© Jin Vũ. All rights reserved.
