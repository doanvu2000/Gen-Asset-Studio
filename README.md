# Gen Asset Studio

App desktop (Windows, macOS sau) giúp team design đổi style cả bộ asset 2D PNG bằng Codex CLI image gen: giữ đúng tên file, cây thư mục và kích thước W×H, chỉ đổi style.

Phiên bản hiện tại: **0.1.0** (nội bộ). Thay đổi từng bản: [CHANGELOG.md](CHANGELOG.md).

## Tính năng

| Nhóm | Nội dung |
|---|---|
| Môi trường | Tự cài Codex CLI (không cần Node/Python), đăng nhập ChatGPT, xem quota, trạng thái từng thành phần, gửi lỗi cho Codex sửa |
| Workspace | Nhiều project, cây thư mục thật trên đĩa, hàng đợi gen chung |
| Project | 5 bước: Nhập ảnh → Style → Gen → Duyệt / Regen → Xuất |
| Style | Template sẵn, Codex gợi ý nhiều hướng + preview, khoá style, chuẩn hoá prompt tiếng Anh, chọn model + effort (mặc định `gpt-6-luna` · `medium`) |
| Xuất | PNG nền trong suốt, đúng tên + cây thư mục + W×H, tuỳ chọn ×2 / ×4 |
| Giao diện | Kiểu macOS, Sáng/Tối, Việt/Anh, hướng dẫn lần đầu |

Sprite sheet: đang phát triển (phase sau).

## Cài đặt (người dùng)

1. Tải `GenAssetStudio-Setup-<version>.exe` ở GitHub Releases.
2. Windows SmartScreen cảnh báo (app chưa ký code) → **More info → Run anyway**.
3. Mở app, làm theo màn **Chuẩn bị môi trường**. Bước nào cần quyền Administrator thì app hỏi; chạy app bằng *Run as administrator* để bỏ qua các lần hỏi.
4. Cần tài khoản ChatGPT (Plus trở lên) để gen ảnh.

Dữ liệu app: `%LOCALAPPDATA%\GenAssetStudio` (Codex, codex-home, log, hàng đợi) · cài đặt: `%APPDATA%\Gen Asset Studio\settings.json`.

## Phát triển

Yêu cầu: Node 24+, npm, Windows 10/11 x64.

| Lệnh | Việc |
|---|---|
| `npm install` | Cài dependency (thiếu `node_modules/electron/dist` thì chạy `node node_modules/electron/install.js`) |
| `npm run dev` | Chạy app chế độ dev |
| `npm run typecheck` | Kiểm kiểu main + renderer |
| `npm run build` | Typecheck + build vào `out/` |
| `npm run dist:win` | Đóng gói NSIS vào `release/<version>/` |
| `npm run test:pipeline` | Chạy thử pipeline xử lý ảnh trên ảnh mẫu |

Biến môi trường dev: `GAS_CODEX_HOME=<thư mục>` dùng CODEX_HOME khác thay cho `%LOCALAPPDATA%\GenAssetStudio\codex-home`.

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/main/codex` | Cài Codex, client JSON-RPC `codex app-server` |
| `src/main/setup` | Setup gate, luồng gửi lỗi cho Codex sửa |
| `src/main/pipeline` | Xử lý ảnh (sharp, chạy trong worker) |
| `src/main/queue` | Hàng đợi gen |
| `src/preload`, `src/shared` | API `window.gas` + kiểu dùng chung |
| `src/renderer/src` | Giao diện React |
| `resources/style-templates` | Template style + ảnh preview |
| `.planning` | Spec, plan, tiến độ, kết quả spike |
| `mockup/index.html` | Mockup đã duyệt |

## Phát hành

1. Chuyển mục `Chưa phát hành` trong `CHANGELOG.md` thành `## <version> — <ngày>` (mục Update · Add · Remove · Fixbug).
2. Tăng `version` trong `package.json`.
3. `npm run dist:win`, tạo GitHub Release tag `v<version>`, dán đúng mục changelog làm release note, đính kèm file cài + `latest.yml`.

© Jin Vũ. All rights reserved.
