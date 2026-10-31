# PLAN — Sprite nhiều hướng + Spine (2026-10-31)

## Đã chốt
- Sprite: làm **cả hai** chế độ — Reskin sheet có sẵn + Tạo mới từ 1 ảnh nhân vật.
- Engine đích: Flutter (Flame) + Android/iOS native.
- Spine: **4.2** — runtime chính chủ spine-flutter / spine-android / spine-ios đều ở 4.2; preview dùng `@esotericsoftware/spine-player` 4.2 cùng bản.
- Preview là bắt buộc ở mọi bước (chọn hướng, gen, duyệt, xuất).
- Đầu ra reskin: đúng tên, đúng W×H, đúng rect → file atlas/skeleton/meta dùng lại không sửa.

## Định dạng
| Loại | Vào | Ra |
|---|---|---|
| Sprite reskin | PNG sheet + (tuỳ chọn) TexturePacker `.json` hash/array, `.plist`, Unity `.meta`; không có → dò lưới | PNG cùng tên/W×H/rect + giữ nguyên file atlas đi kèm |
| Sprite tạo mới | 1 ảnh nhân vật (+ mô tả) | PNG lưới (hàng = hướng, cột = frame) + TexturePacker `.json` (array, có `animations` theo `<anim>_<dir>`) — Flame `flame_texturepacker` / native đọc được; kèm snippet Flame + Android/iOS |
| Spine | `.json`/`.skel` 4.2 + `.atlas` + page `.png` | page `.png` cùng tên/W×H, region đúng toạ độ; `.atlas` + skeleton giữ nguyên |

Không hỗ trợ Spine 3.8/4.0/4.1 ở bản đầu: đọc header version, khác 4.2 → báo rõ.

## Hướng
- Bộ hướng: 4 (S W E N) · 6 (hex: S SW NW N NE SE) · 8 (S SW W NW N NE E SE).
- Preset thứ tự hàng (Flame mặc định, RPG Maker, tuỳ chỉnh kéo thả).
- Mirror: E←W, NE←NW, SE←SW (8 hướng gen 5); 6 hướng gen 4; 4 hướng gen 3. Tắt được cho nhân vật bất đối xứng (cầm kiếm tay phải…).

## Pipeline gen
- 1 lượt = 1 hướng × 1 animation, cả dải frame (≤ 8 frame/lượt; dài hơn chia cụm, cụm sau đính frame cuối cụm trước).
- Hướng S gen trước → thành **ảnh khoá nhân vật**, đính vào mọi lượt sau (giữ mặt, màu, trang phục, tỉ lệ).
- Prompt hướng dùng góc nhìn cố định của project (xem câu hỏi mở).
- Hậu xử lý: tách nền chroma theo rule hiện có, cắt khối theo ô, căn **anchor đáy-giữa**, chuẩn hoá chiều cao giữa hướng/frame, khoá bảng màu theo ảnh khoá.
- QA: lệch anchor > N px, chênh chiều cao > X%, frame trùng nhau/nhảy size, mép ô bị cắt.
- Spine: mỗi region = 1 job như ảnh lẻ, đính "ảnh ghép nhân vật" (render setup pose gốc) để cùng style; giữ rotate/offset/whitespace của region; QA mép region (mesh kéo giãn lộ viền).

## Preview (component dùng chung)
- **SpritePlayer** (Canvas 2D): play/pause, FPS, từng frame, loop/ping-pong, onion skin, đường anchor/đất, nền caro/tối/sáng, zoom pixel-perfect.
- **La bàn hướng** 4/6/8 nút + phím mũi tên/WASD điều khiển nhân vật đi trên nền lưới (top-down/iso) để test cảm giác.
- **Lưới tổng**: mọi hướng × animation chạy cùng lúc — bắt lệch giữa hướng.
- **Gốc | Mới đồng bộ** cùng frame (reskin).
- **SpinePreview** (spine-player WebGL): chọn animation/skin, tốc độ, scrub, bật bones/slots, bấm region ↔ highlight trên nhân vật, Gốc | Mới đồng bộ.
- Duyệt/Regen theo **từng hướng × animation** (sprite) / **từng region** (Spine).

## Milestone
- **S1 Hạ tầng sheet**: type `sprite`/`spine` trong `InputType`, đọc TexturePacker/plist/meta, dò lưới + editor lưới overlay, model frame/hướng/animation, SpritePlayer + la bàn.
- **S2 Sprite reskin**: gán hướng/preset, mirror, gen theo dải, ảnh khoá, anchor + QA, duyệt theo hướng, xuất đè đúng rect.
- **S3 Sprite tạo mới**: dialog chọn ảnh nhân vật + bộ hướng + bộ animation + số frame + cỡ ô; sinh lưới + JSON + snippet Flame/native.
- **S4 Spine reskin**: parser `.atlas` + đọc skeleton 4.2, danh sách region theo skin/slot, gen region, ghép page, SpinePreview, duyệt theo region.
- Bật `AssetKinds` (`spine`, `sprite` → ready) theo từng milestone.

## Ngoài phạm vi bản đầu
- Tạo mới Spine từ 1 ảnh (cần rig xương) — chỉ reskin.
- Spine < 4.2, `.skel` binary nếu parse phức tạp → sau (ưu tiên `.json`).
- Xuất Godot/Unity metadata.

## Tách bạch 3 phần (yêu cầu 2026-10-31)
- **Reskin ảnh** (chức năng hiện có) — người dùng chính: BA. **Spine** và **Sprite sheet** — người dùng chính: artist.
- 3 loại project riêng, chọn khi tạo project (`AssetKinds`: png / spine / sprite), không trộn trong 1 project.
- Mỗi loại có luồng bước + màn hình riêng; chỉ dùng chung hạ tầng (queue, Codex, style, xuất, lưu trữ).
  - Reskin: Ảnh gốc → Style → Gen → Duyệt → Xuất (giữ nguyên).
  - Sprite sheet: Nhập sheet/Tạo mới → Lưới & hướng → Style → Gen theo hướng → Duyệt (player) → Xuất.
  - Spine: Nhập skeleton → Region & skin → Style → Gen region → Rigging → Duyệt (spine-player) → Xuất.
- Workspace: badge + bộ lọc theo loại; icon/màu phân biệt; màn tạo project mô tả rõ "dành cho ai".
- Gỡ lựa chọn `sprite` khỏi `InputType` của project Reskin (thay bằng loại project Sprite sheet).

## Spine — chỉnh khung xương / rigging (yêu cầu thêm 2026-10-31)
- Lý do: region gen lại có thể lệch dáng/kích thước so với gốc → cần chỉnh xương cho khớp.
- Bản đầu (đề xuất):
  - Editor setup pose trên canvas WebGL cạnh preview: chọn bone (cây bone + bấm trên nhân vật), kéo dời / xoay / scale, nhập số.
  - Chỉnh attachment của region: offset, rotation, scale, pivot so với bone; draw order slot.
  - Gizmo, undo/redo, so sánh Gốc | Mới, chạy thử animation ngay sau khi chỉnh.
  - Xuất `.json` 4.2 mới (giữ tên bone/slot/animation) + bản gốc để backup; animation giữ nguyên keyframe.
- Phase sau: sửa mesh + weights, IK/constraint, tạo bone mới, keyframe animation.
- Đánh đổi: có chỉnh rigging thì skeleton `.json` thay đổi (không còn "dùng lại nguyên file cũ") → mặc định chỉ xuất json mới khi user có chỉnh.

## Đã chốt thêm (2026-10-31)
- Góc nhìn: user chọn mỗi project (top-down 3/4 · isometric · side-view), không mặc định cứng.
- Animation tạo mới: mặc định idle + walk; run, attack, hurt + die là checkbox tuỳ chọn.
- Cỡ ô mặc định 128 px (cho chọn 64 / 256).
- Thứ tự: làm `PLAN-storage-location.md` trước, Sprite/Spine sau.

## Trạng thái (2026-10-31)
- **S1 xong** (chưa có Style/Gen/Duyệt/Xuất cho sprite — S2):
  - Loại project: `src/shared/sprite.ts` (ProjectKind, READY_KINDS = reskin + sprite), project.json `kind`, `sprite: { settings, sheets }`.
  - Main `src/main/sprite/`: `atlas.ts` (TP hash/array, Aseprite tags, plist 0–3, Unity meta; Spine .atlas → báo lỗi), `grid.ts` (detectGrid, gridFrames r*cols+c, emptyCells, cache alpha), `anims.ts` (từ tag / tên / lưới), `service.ts` (SpriteService + registerSpriteIpc, deps từ `WorkspaceService.spriteDeps()`).
  - Renderer: `components/ProjectKinds.tsx`, `screens/sprite/SpriteProjectScreen.tsx` (Nhập sheet + Thiết lập nhân vật · Lưới & hướng), `components/sprite/*` (SpritePlayer, DirCompass, SpritePlayground, SheetCanvas, GridEditor, AnimTable, SpriteDemo), `store/sprite.ts` (debounce anims 400 ms).
  - Quy ước FrameRect: x,y,w,h = rect trên sheet (rotated = xoay 90° CW khi pack, vẽ xoay -90°); srcX/srcY/srcW/srcH = khung gốc chưa trim; pivot 0..1 trên-trái.
  - Mẫu test: `resources/sprite-samples/` (`node scripts/make-sprite-samples.mjs`), `npm run test:sprite` 68/68.
- Tiếp S2: gán hướng/preset + mirror, gen theo dải, ảnh khoá, anchor + QA, duyệt theo hướng, xuất đè đúng rect.
- **S2 xong** (2026-10-31): Style (mẫu/tự tạo) → Gen theo dải (ảnh khoá S, mirror) → Duyệt (player đồng bộ, QA, version, Lưới tổng) → Xuất đè rect + chép atlas. Code: `src/main/sprite/{strip,stripJob,strips}.ts`, SpriteService (style/review/enqueue/export), `screens/sprite/Sprite{Style,Gen,Review,Export}Step.tsx`, `lib/sprite.ts`, `components/sprite/StripPreview.tsx`. Test: `npm run test:sprite-gen` 27/27; E2E thật trong app: TP 4 hướng, 3 lượt gen, QA sạch, xuất đúng.
- Việc còn sau S2:
  - Frame trimmed: nội dung AI to hơn rect trim bị cắt khi xuất → cần QA "tràn rect trim" (hoặc gợi ý dùng sheet không trim).
  - Bóng dưới chân hay bị AI bỏ dù prompt đã dặn giữ.
  - Lưới tổng chưa có Đi thử bằng frame mới (cần sheet tạm gộp dải mới).
  - Lưới tổng hiện slot theo bộ hướng của project (8) kể cả khi sheet chỉ 4 hướng.
- Tiếp: S3 Sprite tạo mới.
- **S3 xong** (2026-10-31): Tạo sheet mới từ ảnh nhân vật (`NewSheetDialog`), sheet trống `generated/<name>.png` hàng = anim × hướng, gen theo dải với ảnh dẫn lưới (ảnh nhân vật trong từng ô) + `fitNewStrip` (chân xuống đường đất, căn theo trọng tâm vùng chân), xuất `.json` TexturePacker array + `-snippets.md` (Flame SpriteSheet / Kotlin Bitmap / SpriteKit). Code: `src/main/sprite/{create,snippets}.ts`, SpriteService createSheet/pickCharacter/snippets. Test `npm run test:sprite-new` 28/28; E2E thật: idle 4 frame × 4 hướng, 3 lượt gen, QA sạch, xuất đúng.
- Việc còn sau S3: walk/idle đôi khi ít khác biệt giữa frame (AI) — cân nhắc QA "chuyển động quá ít" bằng so sánh frame; intro bước Xuất ghi "atlas chép theo" chưa đúng cho sheet tạo mới; ô mô tả trong dialog hơi thấp.
- Tiếp: S4 Spine reskin.
