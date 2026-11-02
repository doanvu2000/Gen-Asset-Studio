# PLAN 2026-11-02 — 8 gợi ý UX + chức năng (manager-work-agent)

Chủ nhân chốt: làm cả 8; **commit từng phần + push master**; #2 tự gen lại **tắt sẵn** (công tắc trong Cài đặt).
Test chung: `npm test` (11 bộ) + `npm run typecheck`. Không build để verify.

## WP-A: Phím tắt duyệt (#1)
- Mục tiêu: A duyệt, R cần sửa, ←/→ đổi dải/region/asset, Space chạy/dừng player; bỏ qua khi focus input/textarea/select; gợi ý phím hiện trên nút (tooltip / kbd nhỏ).
- Phạm vi: renderer review screens (Reskin ReviewDetail, Sprite StripReview/SpriteWorkStep, Spine SpineGenReviewStep) + hook chung `lib/useReviewKeys.ts` + i18n.
- Model: sonnet.

## WP-B: Tự gen lại khi QA fail (#2)
- Mục tiêu: setting `autoRegenOnQaFail` (mặc định false). Bật → job xong mà qa có check `fail` thì enqueue lại đúng 1 lần (attempt đánh dấu autoRegen) kèm note sinh từ check fail. Không lặp vô hạn.
- Phạm vi: src/main/queue, settings, Settings screen, i18n. Model: sonnet.

## WP-C: Ước tính lượt Codex (#3)
- Mục tiêu: trước Gen hàng loạt (Sprite gen tất cả, Spine gen tất cả, Reskin gen nhóm) hiện dòng "N lượt · còn X% quota 5h / Y% tuần"; cảnh báo màu khi N lớn so với quota còn lại.
- Phạm vi: renderer component `GenEstimate` + chỗ nút gen hàng loạt. Model: sonnet.

## WP-D: Thông báo hàng đợi xong (#4)
- Mục tiêu: queue idle sau khi có job chạy → Windows Notification (số xong/lỗi), cửa sổ không focus thì flashFrame + taskbar progress (setProgressBar) khi đang chạy, overlay badge số lỗi. Setting bật/tắt (mặc định bật).
- Phạm vi: src/main (index.ts + module notify mới), settings, i18n. Model: sonnet.

## WP-E: Đổi màu nhanh (#5)
- Mục tiêu: trên bản đã duyệt/đang xem (Reskin asset, Sprite strip, Spine region) chỉnh hue/saturation/brightness → lưu thành version mới (meta kind 'recolor', không gọi Codex), QA giữ nguyên alpha.
- Phạm vi: main helper recolor (sharp modulate) + IPC + panel nhỏ UI. Model: sonnet.

## WP-F: Xuất GIF/WebP preview (#6)
- Mục tiêu: Sprite: mỗi animation×hướng xuất GIF/WebP động từ frame mới (hoặc gốc nếu chưa gen), FPS theo anim, nền trong suốt; nút ở màn Xuất + trong review "Lưu GIF".
- Phạm vi: main sprite export gif (sharp animated) + UI. Model: sonnet.

## WP-G: Thêm định dạng xuất (#7)
- Mục tiêu: sheet tạo mới (và sheet nhập không có atlas) xuất thêm Godot 4 `SpriteFrames .tres`, Unity `.anim` + sprite meta slicing (.png.meta), Cocos `.plist` v3; tab chọn định dạng ở màn Xuất.
- Phạm vi: src/main/sprite (module formats mới + service export), UI Xuất. Model: sonnet.

## WP-H: Spine skin mới giữ rig (#8)
- Mục tiêu: tạo "skin biến thể" từ style mới cho các region, xuất thành page/atlas mới (`<name>-<skin>.atlas/png`) + skin trong skeleton json (attachment trỏ region mới) giữ nguyên bone/rig.
- Phạm vi: src/main/spine + renderer spine. Model: opus (kiến trúc dữ liệu skeleton). Chạy sau khi có khảo sát chi tiết.

## Thứ tự
Đợt 1 song song (không chung file): A (renderer review), D (main notify), G (main sprite formats).
Đợt 2: B (queue+settings), C (renderer gen buttons), F (sprite export gif).
Đợt 3: E (chạm review screens — sau A), H (spine).
i18n vi/en: nhiều WP chung file → mỗi WP chỉ thêm key trong namespace riêng; chạy song song thì WP ghi key vào báo cáo, main gộp nếu xung đột.

# Đợt 2 (chủ nhân: "làm hết" 12 gợi ý)
- WP-I (#9) CI GitHub Actions `npm test` + typecheck trên windows-latest; test không hardcode đường dẫn máy; release flow chạy `npm test` trước dist.
- WP-J (#1) thanh công cụ duyệt chung (Duyệt/Cần sửa/Gen lại/Đổi màu/phiên bản) cho 3 màn — sau E + H.
- WP-K (#4) bảng phím tắt `?` — gộp với WP-J.
- WP-L (#2) màn "Việc cần làm" Workspace (chờ duyệt, QA lỗi, chưa xuất) toàn project.
- WP-M (#5) duyệt hàng loạt theo QA cho Sprite + Spine (+ xem lướt).
- WP-N (#3) gập tuỳ chọn nâng cao (Lưới & hướng, Xuất, Cài đặt).
- WP-O (#6) thư viện style dùng chung giữa project.
- WP-P (#7) so sánh A/B 2 phiên bản (cạnh nhau / thanh trượt) — cùng WP-J.
- WP-Q (#8) nguồn đổi → liệt kê phần bị ảnh hưởng + gen lại đúng phần (Sprite; Spine đã có sourceChanged).
- WP-R (#10) tăng tốc project lớn (thumb/cover lazy + cache hash, xử lý sheet trong worker).
- WP-S (#11) thống kê lượt Codex theo project/ngày + tỉ lệ QA pass theo style.
- WP-T (#12) E2E Playwright Electron cho luồng chính (profile + LOCALAPPDATA tạm, không gen Codex).
