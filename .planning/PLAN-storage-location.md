# PLAN — Chọn ổ lưu dữ liệu + chống đầy ổ C (2026-10-31)

## Vấn đề
User thường không biết app ghi gì vào ổ C, ổ C nhanh đầy. Hiện tất cả nằm cứng ở `%LOCALAPPDATA%` / `%APPDATA%` / `%TEMP%` (`src/main/paths.ts` là hằng số tính lúc import).

## Kiểm kê chỗ đang ghi
| Mục | Đường dẫn hiện tại | Dung lượng | Ghi chú |
|---|---|---|---|
| Codex binary | `%LOCALAPPDATA%\GenAssetStudio\codex\releases` + `current` | ~160 MB/bản, giữ nhiều bản | `installer.ts` |
| Codex download | `…\codex\downloads` | ~160 MB/lần | archive đã xoá sau cài, staging lỗi có thể sót |
| CODEX_HOME | `…\GenAssetStudio\codex-home` | **tăng mãi** | `auth.json`, `config.toml`, `sessions/` (log hội thoại), `generated_images/` — ảnh gen gốc **đã copy vào project** (`GenJob.ts:256`) nhưng không xoá → trùng lặp |
| Ảnh input tạm | `%TEMP%\gas-codex-input` | vừa | `codex/service.ts:113` |
| test-gen | `…\GenAssetStudio\test-gen` | nhỏ | ảnh test setup |
| Logs | `…\GenAssetStudio\logs` | nhỏ, xoay vòng 2 file | |
| Settings | `%APPDATA%\Gen Asset Studio\settings.json` | rất nhỏ | giữ ở C làm "con trỏ" |
| Chromium cache | `%APPDATA%\Gen Asset Studio\` (Cache, GPUCache…) | vài chục MB | dời được bằng `app.setPath('sessionData')` trước `ready` |
| Updater cache | `%LOCALAPPDATA%\gen-asset-studio-updater` | ~100 MB/bản cập nhật | electron-updater cố định gốc → chỉ dọn sau cài |
| App cài | NSIS per-user, mặc định `%LOCALAPPDATA%\Programs` | ~300 MB | NSIS đã cho đổi thư mục (`allowToChangeInstallationDirectory`) |
| Workspace project | user chọn, mặc định gợi ý `Documents` (C) | **lớn nhất** (gốc + version + preview) | đổi gợi ý mặc định |
| Thư mục xuất | mặc định `output` trong project | theo project | đã theo workspace |

## Thiết kế
### Một "Thư mục dữ liệu" (bản đã làm: 1 gốc duy nhất, không ghi đè từng mục)
- `settings.json` (giữ ở `%APPDATA%`) thêm `storage: { dataRoot, overrides: { codexBin?, codexHome?, cache?, logs? } }`.
- Mặc định `dataRoot = %LOCALAPPDATA%\GenAssetStudio` (giữ tương thích bản cũ).
- `paths.ts` đổi từ hằng số sang `resolvePaths(settings)` gọi một lần lúc khởi động (đọc settings **đồng bộ** trước `app.whenReady`), export getter; mọi nơi import hằng cũ đổi sang getter.
- Cache gom về `<dataRoot>\cache\` (input tạm, test-gen, sessionData Chromium).
- Biến môi trường `GAS_CODEX_HOME` vẫn ưu tiên cao nhất như hiện tại.

### Cài đặt › Lưu trữ (tab mới)
- Bảng từng mục: đường dẫn · dung lượng đang dùng · ổ + dung lượng trống ổ đó · nút Mở folder / Đổi.
- Nút **Chuyển tất cả sang ổ khác**: chọn ổ/thư mục → app tự tạo `<ổ>:\GenAssetStudio`.
- Thanh dung lượng ổ hệ thống, cảnh báo vàng khi trống < 10 GB, đỏ < 3 GB.

### Quy trình chuyển (an toàn)
1. Kiểm tra đích: ghi được, đủ chỗ (dung lượng mục + 1 GB), không phải ổ mạng; USB cho phép nhưng cảnh báo "rút ra là app lỗi"; không trỏ vào trong thư mục cũ.
2. Dừng hàng đợi (pause), tắt Codex app-server.
3. Copy → so khớp số file + dung lượng → ghi settings mới → xoá bản cũ (hỏi xác nhận, mặc định có xoá).
4. Cập nhật PATH user nếu thư mục `codex\current\bin` đổi (`userPathEntry` hiện hard-code `%LOCALAPPDATA%`).
5. Khởi động lại app. Lỗi giữa chừng → giữ nguyên chỗ cũ, settings không đổi.
- Chuyển CODEX_HOME giữ `auth.json` → **không phải đăng nhập lại**.
- Codex riêng của user (`~\.codex`) không bị đụng.

### Dọn dẹp
- Nút **Dọn dẹp** trong tab Lưu trữ, hiện trước số MB sẽ giải phóng:
  - `codex-home\generated_images` đã copy vào project.
  - `codex-home\sessions` cũ hơn N ngày (mặc định 7).
  - Bản Codex cũ không dùng, `downloads`/`.staging.*` sót.
  - Cache, test-gen, updater cache sau khi đã cập nhật xong.
- Tuỳ chọn **Tự dọn** (bật mặc định): xoá ảnh gốc trong `generated_images` ngay sau khi copy thành công vào project; dọn sessions cũ lúc khởi động.

### Lần đầu cài / bản cũ cập nhật lên
- Màn Chuẩn bị môi trường thêm bước **Chọn nơi lưu dữ liệu** (trước bước tải Codex): nếu máy có ổ cố định khác ổ hệ thống → gợi ý sẵn `D:\GenAssetStudio` kèm giải thích ngắn "Codex và ảnh gen khá nặng, nên để ngoài ổ C".
- Hộp chọn workspace: gợi ý mặc định ở ổ dữ liệu thay vì `Documents`.
- User bản cũ: banner một lần "App đang dùng X GB trên ổ C · Chuyển sang ổ khác / Dọn dẹp / Để sau".
- Installer NSIS: trang chọn thư mục cài vẫn giữ; thêm dòng gợi ý chọn ổ khác (qua `installer.nsh`) — tuỳ.

### Chống đầy giữa chừng
- Kiểm tra dung lượng trống trước: tải Codex, bắt đầu gen batch (ước tính ~3 MB/ảnh), xuất (ước tính theo số ảnh × scale).
- Bắt `ENOSPC` ở pipeline/xuất/installer → dừng hàng đợi, báo rõ "Ổ X đầy" + nút **Mở Lưu trữ** / **Dọn dẹp**.

## Milestone
- **D1**: `paths.ts` → getter + đọc settings đồng bộ, `sessionData`, gom cache. Không đổi hành vi mặc định.
- **D2**: tab Lưu trữ (dung lượng, ổ trống, mở folder), dọn dẹp + tự dọn `generated_images`.
- **D3**: chuyển dữ liệu an toàn (copy/verify/PATH/restart).
- **D4**: bước chọn ổ trong setup, gợi ý workspace, banner user cũ, kiểm tra trống + `ENOSPC`.

## Đã chốt (2026-10-31)
- Làm trước Sprite/Spine.
- Tự dọn bật mặc định.

## Trạng thái (2026-10-31)
- D1–D4 xong (trừ gợi ý ở installer NSIS — bỏ). Thực tế: cấu hình ở storage.json (userData) đọc đồng bộ lúc import paths.ts; chuyển = chép nguyên thư mục gốc (trừ codex/downloads, .staging.*), dựng lại junction codex/current, đổi PATH nếu pathChoice=added, relaunch; app mới xoá thư mục cũ (chỉ khi tên là GenAssetStudio).
- Chromium sessionData giữ ở %APPDATA% (nhỏ, chứa Local Storage).
- codex-home/.tmp/plugins + cache do Codex tự quản (~150 MB) — không dọn.
- Test: chuyển đi/về trên bản cách ly (LOCALAPPDATA giả + --user-data-dir) OK; tự dọn chạy thật xoá 47 MB; test:queue OK.
