# PLAN 2026-10-31 — Dọn việc sót S2–S4 + nhận Spine `.skel`

Chủ nhân chốt: phạm vi = dọn việc sót + `.skel`; commit từng phần (không push).
Ghi chú: project đã chuyển sang `L:\AI\Gen-Asset-Studio`, chạy lại `npm ci`.

Ngoài phạm vi (giữ lại sau): mẫu style riêng cho nhân vật (tốn lượt gen), bóng dưới chân AI hay bỏ.

## WP-1: Sprite QA mới + sheet tạm Đi thử (backend)
- Mục tiêu: QA `overflow` (frame trimmed: nội dung mới vượt rect trim → sẽ bị cắt khi xuất), QA `static`
  (anim > 1 frame mà các frame gần như giống nhau → warn). API tạo sheet tạm gộp dải mới để Đi thử.
- Phạm vi: `src/main/sprite/*`, `src/shared/sprite.ts`, `src/preload/*` (spriteGen), `scripts/sprite-s2-test.ts`, `scripts/sprite-s3-test.ts`.
- Cấm: renderer, i18n, spine.
- Song song với: WP-3.
- Test: `npm run test:sprite`, `test:sprite-gen`, `test:sprite-new`, `npm run typecheck`.

## WP-2: Sprite UI polish (sau WP-1)
- Nhãn QA mới (i18n), Lưới tổng: Đi thử bằng frame mới + slot theo số hướng thật của sheet, intro bước
  Xuất đúng cho sheet tạo mới, ô mô tả NewSheetDialog cao hơn.
- Phạm vi: `src/renderer/src/screens/sprite/*`, `components/sprite/*`, `lib/sprite.ts`, `store/sprite.ts`, `styles/sprite*.css`, `i18n/vi.json`, `i18n/en.json`.
- Song song với: WP-4 (WP-4 không sửa i18n).
- Test: `npm run typecheck`.

## WP-3: Spine `.skel` 4.2 (backend)
- Mục tiêu: nhập `.skel` (binary 4.2) như `.json`: info (bones/slots/skins/attachments/anims), tìm atlas,
  region, gen, duyệt, xuất (page + atlas; rig đổi → `.skel` mới + `.original.skel`, splice binary).
- Phạm vi: `src/main/spine/*`, `src/shared/spine.ts`, `src/preload/*` (spine nếu cần), `scripts/make-spine-sample.mjs`, `resources/spine-samples/`, `scripts/spine-test.ts`.
- Song song với: WP-1.
- Test: `npm run test:spine`, `npm run typecheck`.

## WP-4: Spine UI polish + `.skel` (sau WP-3)
- Chọn file nhận `.skel`, preview spine-player chạy binary, thẻ tạo project ghi lại `.skel`, ảnh thẻ
  Workspace đổi theo bản mới, nút "Mở thư mục" bước Xuất không full width.
- Phạm vi: `screens/spine/*`, `components/spine/*`, `store/spine.ts`, `lib/spine.ts`, `components/ProjectKinds.tsx`, css spine. Cần i18n → báo key cho main.
- Test: `npm run typecheck`.

## WP-5: E2E + index/CHANGELOG (main)
- E2E thật app (profile tạm, dọn queue, thoát bằng window.close), CHANGELOG/PLAN-sprite-spine cập nhật, HANDOFF.
