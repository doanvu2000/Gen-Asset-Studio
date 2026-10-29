# Gen Asset Studio

App Windows giúp đổi style **cả bộ asset 2D (PNG)** cho game chỉ trong vài bước, dùng AI vẽ ảnh của Codex (ChatGPT).

Bạn đưa vào một folder ảnh UI (nút, icon, popup, thanh máu…), chọn style mới, app vẽ lại từng ảnh và xuất ra **đúng tên file, đúng cây thư mục, đúng kích thước** như cũ — chép đè vào game là dùng được.

![Phiên bản](https://img.shields.io/github/v/release/doanvu2000/Gen-Asset-Studio)

## Cần có

- Windows 10/11 64-bit
- Tài khoản **ChatGPT Plus** (hoặc cao hơn) — dùng để vẽ ảnh
- Kết nối Internet

Không cần cài Node, Python hay công cụ nào khác — app tự lo.

## Cài đặt

1. Vào [Releases](https://github.com/doanvu2000/Gen-Asset-Studio/releases/latest), tải file `GenAssetStudio-Setup-<phiên bản>.exe`.
2. Mở file. Nếu Windows hiện "Windows protected your PC" → bấm **More info → Run anyway** (app chưa ký số, an toàn).
3. Làm theo trình cài đặt.
4. Mở app → màn **Chuẩn bị môi trường** tự chạy:
   - App tự tải Codex (~160 MB).
   - Bấm **Đăng nhập bằng ChatGPT** → đăng nhập trên trình duyệt → quay lại app.
   - Chọn một folder làm **workspace** (nơi chứa các project).
   - Nếu Windows hỏi quyền Administrator thì bấm **Yes**.

Có bản mới, app tự báo và hỏi bạn trước khi tải.

## Sử dụng

| Bước | Làm gì |
|---|---|
| 1. Ảnh gốc | Tạo project → **Mở folder** hoặc kéo thả folder ảnh PNG vào |
| 2. Style | Tạo nhóm style → chọn style có sẵn, hoặc viết mô tả rồi bấm **Gợi ý style** để Codex vẽ thử vài hướng → chọn 1 hướng để **khoá** |
| 3. Gen | Bấm **Bắt đầu gen**. Mỗi ảnh mất khoảng 30 giây; hết quota app tự dừng và tự chạy lại khi quota hồi |
| 4. Duyệt | Xem gốc / mới cạnh nhau. Ảnh đẹp → **Duyệt** (phím A). Chưa ưng → viết ghi chú rồi **Gen lại** (phím R) |
| 5. Xuất | Chọn folder xuất (mặc định `output` trong project), tuỳ chọn thêm bản ×2 / ×4 → **Xuất** |

Lần đầu dùng: bấm **Tạo project mẫu** ở workspace để thử cả luồng với 14 ảnh có sẵn. Xem lại hướng dẫn: **Cài đặt › Chung › Xem lại hướng dẫn**.

### Mẹo

- Ảnh chưa vào nhóm style hoặc chưa được duyệt sẽ **không** được xuất.
- Xuất đè lên file cũ thì bản cũ được cất vào `output/_backup/<thời gian>/`.
- Nút, khung popup, thanh kéo dài được nên bật **9-slice** để góc không bị méo.
- Gặp lỗi → bấm **Gửi lỗi cho Codex sửa** hoặc **Xuất log** gửi cho người phụ trách.

## Câu hỏi thường gặp

**Tốn quota nhiều không?** Mỗi ảnh khoảng 0,2% quota 5 giờ của gói Plus. Quota hiện ở **Cài đặt › Tài khoản**.

**Dữ liệu lưu ở đâu?** Ảnh gốc không bị đụng tới. Project lưu trong workspace bạn chọn. Dữ liệu app ở `%LOCALAPPDATA%\GenAssetStudio`.

**Đổi tài khoản ChatGPT?** **Cài đặt › Tài khoản › Đổi tài khoản**.

## Thay đổi qua các phiên bản

Xem [CHANGELOG.md](CHANGELOG.md).

## Dành cho dev

```bash
npm install
npm run dev          # chạy thử
npm run build        # kiểm kiểu + build
npm run dist:win     # đóng gói file cài vào release/<phiên bản>/
```

Phát hành bản mới: tăng `version` trong `package.json` → thêm mục mới vào `CHANGELOG.md` (Update · Add · Remove · Fixbug) → `npm run dist:win` → tạo GitHub Release `v<phiên bản>` kèm file `.exe`, `.blockmap`, `latest.yml`, dán mục changelog làm ghi chú (`node scripts/release-notes.mjs <phiên bản>`).

Tài liệu thiết kế: `.planning/`.

© Jin Vũ. All rights reserved.
