# PLAN — Gen Asset Studio

Spec chi tiết + mọi quyết định đã chốt: `.planning/SPEC-gen-asset-studio.md`.

## Giai đoạn hiện tại

- [x] Brainstorm + audit + chốt quyết định (2026-10-29)
- [x] Chủ nhân duyệt spec v0.2
- [x] Mockup HTML prototype → `mockup/index.html` → chủ nhân duyệt OK (2026-10-29)
- [x] M0 spike xong (2026-10-29) — kết quả dưới
- [x] M1–M6 code xong (2026-10-29), bản cài thử `release/0.1.0/GenAssetStudio-Setup-0.1.0.exe`
- [x] Phát hành v1.0.0 trên GitHub Releases (2026-10-29)
- [ ] Chủ nhân dùng thử + góp ý → bản 1.0.x/1.1.0

## Kết quả M0 (chi tiết: `M0-protocol.md`, `M0-imagegen.md`, `M0-codex-binary.md`)

- Gen ảnh qua `codex app-server` chạy ổn: 5/5 ảnh, đính kèm `localImage`; item `imageGeneration` có `savedPath` (`~/.codex/generated_images/<threadId>/exec-<itemId>.png`) + `result` base64 → map theo threadId, không quét thư mục. Song song 2 thread không lẫn.
- Thời gian: luna/medium ~25–31 s/ảnh. Quota Plus: 5 ảnh làm cửa sổ 5h tăng 0→1% (≤ ~0,2%/ảnh); cần batch 20+ để đo chính xác.
- Model mặc định của app: `gpt-6-luna` + `medium`.
- Ảnh ra lớn (vd 2048×768 cho nút ngang), RGB không alpha; nền chroma xấp xỉ (250,4,252) → tách nền cần dung sai. Chọn màu chroma phải xa cả màu **style tham chiếu** (style hồng/tím → nền xanh lá), không chỉ màu ảnh gốc.
- Quyết định kiến trúc:
  - App dùng **CODEX_HOME riêng** (`%LOCALAPPDATA%\GenAssetStudio\codex-home`): tránh MCP server/hook/AGENTS.md của user chạy theo mỗi thread (tốn 3–5 s, rò chỉ dẫn); login riêng trong app. Thêm `baseInstructions` riêng.
  - Spawn thẳng `codex.exe app-server` (đường dẫn tuyệt đối), không qua shim; tắt bằng `stdin.end()` + kill.
  - Cài Codex: `codex-package-{target}.tar.gz` từ releases.openai.com (fallback GitHub `rust-v{V}`), kiểm SHA256, `releases\{V}-{target}` + junction `current`; sandbox `unelevated`; pin 0.165.0; check bản mới qua `releases.openai.com/codex/channels/latest`.
  - Login: `account/login/start {type:"chatgpt"}` → `authUrl` → `shell.openExternal`; chờ `account/login/completed`. Quota qua `account/rateLimits/read` + notif `account/rateLimits/updated`.

## Mockup (prototype HTML 1 file, bấm được)

Màn: Setup môi trường (có dialog cấp quyền) · Đăng nhập · Workspace (folder tree + lưới project + queue + quota) · Project 5 bước (Input, Style + preview, Gen tiến độ, Duyệt lưới + chi tiết + regen, Xuất) · Settings · Coach mark.
Toggle Light/Dark + Việt/Anh, motion thật, cửa sổ macOS-style. Áp frontend-design + ui-ux-pro-max + macOS HIG. Ảnh demo vẽ bằng SVG/CSS.

## Milestone code

- **M0** Spike Codex app-server trên Windows: gen ảnh có ảnh đính kèm, map đúng file, đọc quota, login/logout, đo quota/ảnh trên Plus.
- **M1** Khung Electron + design system + i18n + theme + cửa sổ macOS-style + Setup gate + màn trạng thái môi trường + luồng "Gửi lỗi cho Codex sửa".
- **M2** Workspace (folder tree, card project, project.json) + Input (open/add/drop, cây, preview, đoán loại, relink).
- **M3** Nhóm style + gợi ý style + preview + khoá style + 4 template style sẵn (Candy Pop, Jelly Cartoon, Wood & Gold Adventure, Neon Arcade; gen preview sheet 1 lần) + chuẩn hoá prompt (EN) + chọn model/effort (mặc định luna · medium).
- **M4** Queue chung + CodexService + ImagePipeline + QA + auto-resume quota.
- **M5** Duyệt/Regen + lịch sử phiên bản + phím tắt.
- **M6** Xuất + onboarding coach mark + project mẫu + đóng gói NSIS + electron-updater.
- **Phase sau**: Sprite sheet (atlas reader, dò lưới, editor, animation preview) — UI hiện badge "Đang phát triển"; macOS.

## Quy ước làm việc

- Mỗi task: append `.planning/PROGRESS-*.md`, cập nhật handoff; xong trọn task → commit (không push, không trailer attribution).
- **Được tự build / chạy app để test verify khi cần** (chủ nhân cho phép 2026-10-29, riêng project này — đè rule "không tự build" chung).
- Không comment trong code.
- `README.md` luôn cập nhật theo tính năng; `CHANGELOG.md` ghi mỗi phiên bản dạng liệt kê ngắn 4 mục **Update · Add · Remove · Fixbug** (mục `Chưa phát hành` gom việc đang làm; ra bản thì đổi thành số phiên bản + ngày và dùng làm release note GitHub). Mỗi milestone xong → thêm dòng vào changelog. Phiên bản: 0.1.0 = M0+M1, mỗi milestone +0.1, 1.0.0 = bản phát hành đầu sau M6.
