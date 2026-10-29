# SPEC — Gen Asset Studio

Phiên bản spec: v0.3 (2026-10-29). Plan triển khai: `.planning/PLAN-gen-asset-studio.md`.

## 1. Mục tiêu

App desktop (Windows trước, macOS sau) giúp designer reskin bộ asset 2D PNG bằng Codex CLI image gen theo luồng GUI: nhập ảnh → chốt style → gen batch → duyệt/regen → xuất đúng tên, đúng cây thư mục, đúng W×H.

Ngoài phạm vi: gen ảnh bằng AI khác Codex; recolor/hue-shift thay cho gen; chỉnh sửa ảnh thủ công kiểu Photoshop; chuyển WebP (làm ở pipeline app đích).

## 2. Quyết định đã chốt

| Mục | Chốt |
|---|---|
| Stack | Electron + React + TypeScript (electron-vite) |
| Gen ảnh | 100% Codex CLI image gen. Lỗi → báo, cấm fallback recolor |
| Asset | UI (nút, popup, 9-slice) + nhân vật/minh hoạ. Sprite sheet: **để phase sau**, UI hiện "Đang phát triển" |
| Input | Chỉ PNG, project chỉ lưu đường dẫn (không copy) |
| Output | PNG, đúng tên + cây thư mục, mặc định đúng W×H gốc, scale ×1/×2/×4 bằng resize thường (Lanczos) |
| Output folder | Mặc định `<project>/output`, cho đổi |
| Batch | Tối đa 100 ảnh / lần chạy |
| Song song | User chỉnh 1–6, mặc định 3 |
| Style | Nhiều nhóm style / project; ảnh không thuộc nhóm nào thì không xuất |
| Gợi ý style | Mặc định 3 hướng, chỉnh 1–6 |
| Template style sẵn | 4 template cho game vui vẻ: Candy Pop · Jelly Cartoon · Wood & Gold Adventure · Neon Arcade (chủ nhân chốt 2026-10-29) |
| Duyệt | Bắt buộc từng ảnh, có duyệt hàng loạt |
| 9-slice | Tự đoán (tên + hình dạng) + user bật/tắt từng ảnh |
| Hết quota | Tự dừng, đếm ngược, tự chạy tiếp khi reset |
| Tài khoản | ChatGPT Plus (quota thấp) |
| Workspace | Folder trên đĩa, mỗi người 1 workspace riêng, folder tree = thư mục thật |
| Hàng đợi | 1 queue chung toàn app cho mọi project |
| Phát hành | GitHub Releases + electron-updater, chưa ký code (chấp nhận SmartScreen) |
| Cập nhật app (in-app) | Mở app tự kiểm tra; có bản mới → thông báo + changelog, **hỏi trước khi tải**; tải xong hỏi khởi động lại (không restart khi đang có job gen). Nút "Kiểm tra cập nhật" trong Cài đặt |
| Cập nhật Codex CLI | App cài sẵn bản Codex đã test; kiểm tra bản mới nhất trên GitHub → **báo khi có bản mới**, user tự bấm nâng (cảnh báo có thể chưa tương thích, giữ bản cũ để quay lại) |
| Cửa sổ | Giống hệt macOS kể cả trên Windows (nút đèn giao thông bên trái) |
| Thiết kế | macOS HIG, accent system blue, Light/Dark (mặc định Light), Việt/Anh (mặc định Việt) |
| Onboarding | Coach mark + project mẫu |
| Cài môi trường | Bắt buộc hoàn tất trước mọi flow; cần quyền thì hỏi user cấp (UAC) |

## 2b. Bổ sung v0.3 (2026-10-29)

- **Chuẩn hoá prompt:** nút "Codex chuẩn hoá prompt (EN)" ở ô prompt nhóm style và ô ghi chú regen. Codex kiểm tra + viết lại thành prompt tiếng Anh chuyên nghiệp (câu mệnh lệnh rõ, thêm ràng buộc giữ hình/bố cục/chữ/ký hiệu, màu theo vai trò, nền chroma). Hiện bản đề xuất + ghi chú đã sửa gì; user chọn Dùng / Gen lại / Giữ bản gốc; có Hoàn tác.
- **Model + effort:** chọn riêng cho 3 việc — chuẩn hoá prompt, gợi ý style + preview, gen asset. Mặc định `gpt-6-luna` + `medium` cho cả 3 (M0 xác minh: id thật `gpt-6-luna`, UI hiện "luna"). Danh sách model + effort lấy từ `model/list` khi chạy (luna: low/medium/high/xhigh/max). Chip "model · effort" hiện cạnh nút liên quan, bấm mở Cài đặt.
- **Trạng thái môi trường:** Cài đặt → Môi trường liệt kê Codex CLI, PATH, đường dẫn dài, đăng nhập, image gen, xử lý ảnh với trạng thái Đã cài / Đang cài / Chưa cài / Cài lỗi (+ nút Cài, Thử lại, Cài lại, Kiểm tra lại tất cả). Thanh trạng thái dưới cùng hiện "Môi trường x/6", có lỗi thì chấm đỏ.
- **Gửi lỗi cho Codex sửa:** ở lỗi setup, lỗi môi trường, lỗi gen từng ảnh (trạng thái mới `Lỗi gen`). Codex đọc lỗi + log → nêu nguyên nhân → đề xuất bước sửa + lệnh/config → user bấm "Cho Codex sửa" → áp dụng rồi tự thử lại. Codex chỉ sửa trong thư mục app và config Codex của app; thay đổi hệ thống hỏi quyền riêng. Lỗi khi chính Codex CLI chưa cài được → chỉ Thử lại + Xuất log.

## 3. Cài đặt môi trường (Setup gate)

Chạy ở lần mở đầu tiên và mỗi lần mở app (check nhanh). Chưa đạt hết → không vào workspace.

Các bước, mỗi bước có trạng thái `chờ · đang chạy · xong · lỗi`, progress bar + text mô tả + log mở rộng:

1. **Kiểm tra quyền**: phát hiện app có chạy Administrator không. Có → làm hết không hỏi. Không → bước nào cần quyền thì hiện dialog giải thích + nút "Cấp quyền" (gọi UAC cho riêng bước đó).
2. **Codex CLI**: tìm bản đã cài; chưa có hoặc khác version ghim → tải binary native từ GitHub Releases vào `%LOCALAPPDATA%\GenAssetStudio\bin`, verify checksum. Không cần Node/Python/ffmpeg.
3. **PATH**: thêm vào PATH user (không cần admin). Admin → cho chọn thêm PATH hệ thống.
4. **Long path Windows**: kiểm `LongPathsEnabled`; tắt → đề nghị bật (cần admin) vì cây thư mục asset có thể sâu > 260 ký tự.
5. **Đăng nhập Codex**: nút "Đăng nhập bằng ChatGPT" → mở trình duyệt; app chờ callback, hiện trạng thái. Lỗi/timeout → thử lại.
6. **Kiểm tra quota + gen thử**: đọc account + quota; gen 1 ảnh test nhỏ để xác nhận image gen chạy được trên tài khoản.
7. **Chọn workspace**: tạo mới hoặc mở folder có sẵn.

Lỗi mạng/proxy → hiện lỗi cụ thể + nút thử lại, không treo.

## 4. Workspace

- Sidebar: folder tree thật của workspace (tạo/đổi tên/xoá vào Thùng rác/kéo thả di chuyển). Folder là project khi có `project.json`.
- Vùng chính: lưới card project (thumbnail, tên, số ảnh, % đã duyệt, trạng thái queue, sửa lần cuối), tìm kiếm, sắp xếp.
- Nhớ danh sách workspace gần đây; đổi workspace từ menu.
- Panel Queue (toàn app): job đang chạy/chờ theo project, đổi thứ tự, pause/resume từng project, đếm ngược reset quota.
- Thanh trạng thái: tài khoản Codex, quota 5h + tuần (thanh %), số job đang chạy.

## 5. Project — 5 bước

Thanh bước trên cùng: ① Input ② Style ③ Gen ④ Duyệt ⑤ Xuất. Bước nào chưa đủ điều kiện thì khoá, hover hiện lý do.

### ① Input
- Thêm: Open folder (giữ cây), Add files, kéo thả file/folder. Chỉ nhận PNG; file khác liệt kê "bị bỏ qua".
- Cây thư mục input + lưới preview (thumbnail, tên, W×H, loại: thường / 9-slice / sprite sheet).
- Chọn nhiều (click, Shift, Ctrl, kéo vùng), xoá khỏi project.
- Tự tìm root chung để dựng cây output. Cảnh báo > 100 ảnh / lần chạy.
- Đường dẫn gốc: lưu tuyệt đối + kích thước + mtime + hash. Mở project: file mất → "Thiếu file" + nút "Trỏ lại folder"; file đổi nội dung → "Gốc đã đổi" + gợi ý regen.
- Loại ảnh: `Thường` / `9-slice`; tự đoán 9-slice (tên `btn_`, `bg_`, `popup_`, `panel_`, `frame_`… + viền đồng màu), user đổi được từng ảnh. Lựa chọn `Sprite sheet` hiện nhưng khoá, badge "Đang phát triển".

### Sprite sheet — PHASE SAU (đang phát triển, chưa làm phase này)
Thiết kế giữ lại để làm sau:
- Nguồn rect: TexturePacker `.json`/`.plist`, Unity `.png.meta` (sprite mode multiple). Không có → dò khối alpha liền / lưới đều; editor lưới (hàng × cột, kích thước ô, padding, offset) có overlay trên ảnh.
- Kiểu sheet (user chọn): **Atlas** — mỗi ô gen riêng như ảnh lẻ rồi ghép đúng rect cũ. **Animation** — gen cả dải frame trong 1 lượt (tối đa 8 frame/lượt; dài hơn chia cụm, cụm sau đính frame cụm trước làm tham chiếu), căn frame theo anchor đáy-giữa, preview chạy anim + onion skin.
- Output: 1 PNG cùng tên, cùng W×H, rect giữ nguyên → file atlas kèm dùng lại được không đổi.

### ② Style
- Nhóm style: tên, prompt (tuỳ chọn), ảnh tham chiếu (tuỳ chọn, nhiều ảnh), danh sách ảnh áp dụng (chọn từ lưới, hoặc "tất cả ảnh chưa có nhóm"). 1 ảnh thuộc tối đa 1 nhóm.
- Template style sẵn (chọn nhanh thay vì/kèm gợi ý): mỗi template có tên, prompt EN chuẩn, bảng màu, ảnh preview sheet đóng sẵn trong app (gen 1 lần bằng Codex, sheet chung: nút xanh/xanh dương/xám, close, tab, toggle, sao, popup, progress, ribbon). Màu luôn rực, bão hoà. Chọn template → điền prompt nhóm, vẫn sửa được; user lưu được template riêng.
  - **Candy Pop**: kẹo ngọt bóng bẩy, hồng/tím/xanh bạc hà rực, viền đậm, vệt gloss.
  - **Jelly Cartoon**: thạch trong mọng nước, màu bão hoà, bo tròn mập, highlight trắng lớn, bóng đáy.
  - **Wood & Gold Adventure**: gỗ hoạt hình + viền vàng kim, đinh tán; game phiêu lưu/nông trại casual.
  - **Neon Arcade**: thân tối, viền neon phát sáng xanh/hồng/vàng; arcade/đối kháng nhẹ.
- Gợi ý style: Codex phân tích bộ ảnh + prompt + ref → đề xuất N hướng (mặc định 3), mỗi hướng: tên, mô tả ngắn, bảng màu, 1 sheet preview vẽ 4–6 asset đại diện (app tự chọn đa dạng: nút, icon, popup, thanh, nhân vật nếu có).
- Chọn 1 hướng, hoặc ghi nhận xét → regen preview (hướng đó hoặc cả bộ). Chốt → sheet thành **ảnh khoá style** + mô tả style, đính vào mọi lượt gen của nhóm.
- Bỏ qua gợi ý: dùng thẳng prompt + ref (vẫn gen 1 preview để chốt).
- Hiện ước tính lượt gen + quota trước mỗi lần bấm gen.

### ③ Gen
- Chọn phạm vi: cả nhóm / ảnh đang chọn / ảnh chưa gen. Đẩy vào queue chung.
- Màn tiến độ: tổng (x/y, ETA), từng file (bước hiện tại: gửi Codex → chờ ảnh → tách nền → fit → QA), log mở rộng.
- Pause/resume/cancel; đóng app giữa chừng → mở lại tiếp tục.
- Rate limit → backoff tự động. Hết quota → dừng, đếm ngược, tự chạy tiếp.
- Ảnh xong đi thẳng vào trạng thái "Chờ duyệt" hoặc "Lỗi QA".

### ④ Duyệt / Regen
- Lưới: thumbnail gốc | mới, chip trạng thái `Chờ duyệt · Đã duyệt · Cần sửa · Lỗi QA · Đang gen · Lỗi gen`, lọc theo trạng thái/nhóm/folder.
- Chi tiết: so sánh gốc | mới (cạnh nhau / slider / bật tắt), nền caro + viền đỏ biên canvas, zoom 1:1 và fit; bảng QA; lịch sử v1..vn (so sánh 2 bản, chọn bản dùng).
- Regen: ghi chú (từng ảnh hoặc chung cho nhiều ảnh), chọn "gen từ gốc" hay "sửa từ bản hiện tại", thêm ref riêng. Lưu ghi chú + số lần gen của ảnh.
- Duyệt: từng ảnh, nhiều ảnh, "duyệt tất cả QA đạt" (vẫn cần bấm). Phím tắt `A` duyệt · `R` regen · `X` cần sửa · `←/→` chuyển · `Space` bật tắt gốc/mới.

### ⑤ Xuất
- Chỉ ảnh đã duyệt. Tóm tắt trước khi xuất: số ảnh, scale, folder đích, file sẽ ghi đè.
- Cây thư mục output = cây input tính từ root chung; tên giữ nguyên.
- Không bao giờ ghi vào folder input. File đích đã tồn tại → backup vào `output/_backup/<thời gian>/`.
- Xong → nút "Mở folder" + báo cáo (số ảnh, ảnh bỏ qua và lý do).

## 6. Gen + hậu xử lý

Prompt ghép: ràng buộc cố định (giữ bố cục/dáng/ký hiệu/chữ, giữ màu theo vai trò: xanh lá = bật/xong, xám = disabled, mask trắng giữ trắng; không thêm phần tử mới; không trang trí giữa ảnh 9-slice; nền chroma đồng màu) + mô tả style khoá + prompt nhóm + ghi chú ảnh. Đính: ảnh gốc (hoặc bản hiện tại), ảnh khoá style, ref.

Hậu xử lý:
1. Chọn màu chroma xa màu nội dung nhất (magenta / xanh lá / xanh dương) theo ảnh gốc.
2. Tách nền + khử ám màu viền; alpha lấy từ ảnh AI (cấm dùng alpha gốc làm khuôn).
3. Cắt theo khối liền gồm glow/hiệu ứng.
4. Fit về W×H gốc giữ tỉ lệ, lề ≥ 2 px (trừ ảnh vốn dán mép); 9-slice: scale đều rồi co giãn giữ 4 góc, lấp ≥ 85% bbox gốc.
5. Scale ×n (Lanczos).

QA tự động: đúng W×H; có alpha; không pixel alpha > 20 ở mép (trừ ảnh dán mép); độ lấp so bbox gốc; tỉ lệ pixel sót màu chroma. Ngưỡng chỉnh trong Settings.

## 7. Settings

Giao diện (Light/Dark/Theo hệ thống, mặc định Light) · Ngôn ngữ (Việt/Anh) · Song song (1–6) · Số hướng style (1–6) · Scale mặc định · Ngưỡng QA · Tài khoản Codex (email, gói, quota, Đăng xuất / Đổi tài khoản) · Môi trường (version Codex, chạy lại setup) · Cập nhật app · Log (mở folder, xuất zip).

## 8. Onboarding

- Lần đầu sau setup: coach mark từng vùng (sidebar, card project, 5 bước, queue, quota).
- Project mẫu kèm 6–8 asset demo để bấm thử cả luồng.
- Mở lại guide từ menu Help.

## 9. UI / Motion

- Cửa sổ macOS-style: titlebar ẩn, nút đèn giao thông bên trái, sidebar vibrancy (Mica/Acrylic trên Win 11), font Inter (fallback SF Pro/Segoe UI), radius 10–12, accent system blue `#007AFF` / dark `#0A84FF`.
- Motion: chuyển bước slide + fade 200–250 ms, card hover nâng nhẹ, progress mượt, ảnh gen xong fade-in + chip đổi màu, queue item reorder có layout animation; tôn trọng "reduce motion".
- Trạng thái rỗng / lỗi / đang tải có minh hoạ + hành động rõ.

## 10. Dữ liệu

```
<workspace>/
  <folder>/<project>/
    project.json      input (path, hash, loại, rect sheet), nhóm style, trạng thái, ghi chú, lịch sử
    styles/<group>/   preview sheet, ảnh khoá style, ref
    versions/<id>/    v1.png, v2.png … + raw AI
    output/
```

App data: `%LOCALAPPDATA%\GenAssetStudio\` (bin Codex, settings, log, workspace gần đây).

## 11. Kiến trúc

- Main: `CodexService` (spawn `codex app-server`, JSON-RPC stdio: thread/turn, map ảnh theo thread id, account, quota, login/logout), `JobQueue` (p-queue, persist trạng thái), `ImagePipeline` (sharp trong worker thread), `SetupService`, `WorkspaceFs` (chokidar theo dõi thay đổi), `Updater`.
- Renderer: React + Zustand + i18next + Motion; IPC typed qua preload, contextIsolation bật.
- Ghim version Codex; spike M0 xác minh API app-server.

## 12. Rủi ro

- API `codex app-server` đổi theo version → ghim + test hợp đồng khi nâng.
- Quota Plus: 100 ảnh + preview + regen có thể vượt quota 5h → auto-resume, ước tính trước.
- Chữ trên asset AI vẽ sai → ràng buộc prompt + user duyệt.
- Không ký code → SmartScreen cảnh báo; guide hướng dẫn.
