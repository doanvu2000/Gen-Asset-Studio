# PLAN — Gen Asset Studio

Spec chi tiết + mọi quyết định đã chốt: `.planning/SPEC-gen-asset-studio.md`.

## Giai đoạn hiện tại

- [x] Brainstorm + audit + chốt quyết định (2026-10-29)
- [ ] Chủ nhân duyệt spec v0.2
- [ ] Mockup HTML prototype bấm được → `mockup/index.html` → chủ nhân duyệt
- [ ] Bắt đầu M0

## Mockup (prototype HTML 1 file, bấm được)

Màn: Setup môi trường (có dialog cấp quyền) · Đăng nhập · Workspace (folder tree + lưới project + queue + quota) · Project 5 bước (Input, Style + preview, Gen tiến độ, Duyệt lưới + chi tiết + regen, Xuất) · Settings · Coach mark.
Toggle Light/Dark + Việt/Anh, motion thật, cửa sổ macOS-style. Áp frontend-design + ui-ux-pro-max + macOS HIG. Ảnh demo vẽ bằng SVG/CSS.

## Milestone code

- **M0** Spike Codex app-server trên Windows: gen ảnh có ảnh đính kèm, map đúng file, đọc quota, login/logout, đo quota/ảnh trên Plus.
- **M1** Khung Electron + design system + i18n + theme + cửa sổ macOS-style + Setup gate + màn trạng thái môi trường + luồng "Gửi lỗi cho Codex sửa".
- **M2** Workspace (folder tree, card project, project.json) + Input (open/add/drop, cây, preview, đoán loại, relink).
- **M3** Nhóm style + gợi ý style + preview + khoá style + chuẩn hoá prompt (EN) + chọn model/effort (mặc định luna · medium).
- **M4** Queue chung + CodexService + ImagePipeline + QA + auto-resume quota.
- **M5** Duyệt/Regen + lịch sử phiên bản + phím tắt.
- **M6** Xuất + onboarding coach mark + project mẫu + đóng gói NSIS + electron-updater.
- **Phase sau**: Sprite sheet (atlas reader, dò lưới, editor, animation preview) — UI hiện badge "Đang phát triển"; macOS.

## Quy ước làm việc

- Mỗi task: append `.planning/PROGRESS-*.md`, cập nhật handoff; xong trọn task → commit (không push, không trailer attribution).
- **Được tự build / chạy app để test verify khi cần** (chủ nhân cho phép 2026-10-29, riêng project này — đè rule "không tự build" chung).
- Không comment trong code.
