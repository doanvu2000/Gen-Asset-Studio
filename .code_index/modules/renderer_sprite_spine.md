# renderer — màn Sprite + Spine

## Sprite
- `src/renderer/src/screens/sprite/SpriteProjectScreen.tsx::SpriteProjectScreen` — host các bước (Input/Grid → Style → Work → Export); `firstOpenStep` chọn bước mở.
- `screens/sprite/SpriteWorkStep.tsx::SpriteWorkStep` — bảng anim/hướng, gen strip, review.
- `screens/sprite/StripReview.tsx::StripDetail` / `StripOverview` — duyệt từng strip, so sánh Gốc/Mới (frame lớn tự thu để vừa khung).
- `screens/sprite/SpriteStyleStep.tsx::SpriteStyleStep`, `SpriteExportStep.tsx::SpriteExportStep`, `NewSheetDialog.tsx::NewSheetDialog` (tạo sheet mới từ 1 ảnh nhân vật).
- `components/sprite/SpritePlayer.tsx::SpritePlayer` — player; `SpritePlayground`, `SpriteDemo`, `AnimTable`, `DirCompass`, `StripPreview`, `OrigPreview`, `QueueControls`, `SourceChangeBanner`.
- `components/sprite/GridEditor.tsx::GridEditor` + `SheetCanvas.tsx::SheetCanvas` — chỉnh lưới / chọn frame trên sheet; `draw.ts`, `useSize.ts`, `useSpriteT.ts`.
- `store/sprite.ts::useSprite` (`sourceChangedStrips`), `lib/sprite.ts::stripState` / `genTargets` / `stripMatches` / `needsGridEdit` / `firstOpenStep` / `jobOf` / `isApproved`.

## Spine
- `screens/spine/SpineProjectScreen.tsx::SpineProjectScreen` — host các bước (`SPINE_STEPS`, khoá qua `spineStepLock`).
- `screens/spine/SpineStyleStep.tsx::SpineStyleStep`, `SpineGenReviewStep.tsx::SpineGenReviewStep`, `SpineExportStep.tsx::SpineExportStep`.
- `components/spine/SpinePreview.tsx::SpinePreview` — Spine player 4.2 (`useSpineClock`, `ViewerControls`); `SpineCompare.tsx::SpineCompare` (A/B).
- `components/spine/RigEditor.tsx::RigEditor` — chỉnh vị trí bone/attachment (`applyRig`, `rigCount`); `components/spine/SkinPicker.tsx::SkinPicker`.
- `store/spine.ts::useSpine` (`regionSig`, `importErrorText`), `lib/spine.ts::regionState` / `regionReviewState` / `regionQaFail` / `rigEditCount` / `firstOpenSpineStep`.

## Quan hệ
- Gọi `window.gas.sprite.*` / `window.gas.spine.*` (channel `SPRITE_IPC` / `SPINE_IPC`, xem `ipc_shared.md`); job gen lấy từ `store/queue.ts::useQueue` rồi khớp qua `jobOf` / `regionJob`.
- Dùng chung `ReviewBar`, `VersionCompare`, `RecolorPanel`, `StyleLibrary` (xem `renderer_core.md`).
- Phía main: `main_sprite.md`, `main_spine.md`.

## Invariant
- Phím: ←/→ đổi dải/region, `1`–`9` chọn phiên bản, `C` so sánh A/B (Sprite chạy 2 player đồng bộ).
- Sprite: sheet cần chỉnh lưới (`needsGridEdit`) thì chặn bước gen cho tới khi xong.
- Spine: mỗi skin có style/gen/duyệt riêng; xem trước skin trong player trước khi xuất.
