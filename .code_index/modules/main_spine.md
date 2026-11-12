# main/spine — project Spine 4.2

Gen theo region (ảnh trong page atlas), giữ nguyên rig; skin biến thể thêm page + atlas + skeleton mới.

## Symbol
- `src/main/spine/service.ts::SpineService` — `open`, `importDialog`, `importPaths`, `clear`, `assets`, `setStyle`, `addRefs`, `enqueue`, `review`, `recolor`, `setRig`, `pickExportDir`, `addVariant`, `setVariant`, `removeVariant`, `exportRun`.
- `src/main/spine/service.ts::registerSpineIpc` — `SPINE_IPC`.
- `src/main/spine/service.ts::regionAsset` / `variantAsset` / `assignAssets` / `refersTo` — đặt tên asset cho region / skin variant, gán asset vào job queue.
- `src/main/spine/atlas.ts::parseSpineAtlas` / `regionPageSize` / `AtlasError` — đọc `.atlas`.
- `src/main/spine/skeleton.ts::parseSkeleton` / `applyRig` / `sanitizeRig` / `rigIsEmpty` — skeleton `.json` + chỉnh vị trí (rig edit).
- `src/main/spine/binary.ts::parseSkeletonBinary` / `applyRigBinary` / `addSkinsBinary` — skeleton `.skel` nhị phân (`SkelLayout`, `skinSource`, `skinPath`).
- `src/main/spine/skins.ts::addSkinsJson` / `mergeSkinAtlas` / `skinAtlasPages` — thêm skin vào `.json`, gộp atlas.
- `src/main/spine/regions.ts::extractRegion` / `writeRegion` / `partsBoard` / `premultiply` / `unpremultiply` — cắt/ghi region trong page PNG (xử lý PMA, rotate).
- `src/shared/spine.ts::skinNameError` / `skinPageName` / `skinAtlasName` / `skinSkeletonName` / `skeletonFormatOf` / `attachmentKey` / `SKIN_NAME_RE` / `SPINE_IPC`.

## Quan hệ
- Dùng `WorkspaceService`, `JobQueue` (job gen theo region), pipeline `recolor`, `main_export.md` KHÔNG dùng (export riêng `spine:export-run`).
- Renderer: `screens/spine/SpineProjectScreen.tsx::SpineProjectScreen`, `components/spine/SpinePreview.tsx::SpinePreview` (spine-player), `RigEditor`, `SkinPicker`; store `store/spine.ts::useSpine`; xem `renderer_sprite_spine.md`.

## Invariant
- Output: page PNG đúng toạ độ region; `.atlas` gốc giữ nguyên; skeleton mới chỉ khi chỉnh vị trí hoặc thêm skin.
- Skin biến thể xuất thêm `<page>-<skin>.png`, atlas gộp, skeleton có skin mới (cả `.json` và `.skel`); file gốc không đổi.
- Tên skin hợp lệ theo `SKIN_NAME_RE` (`skinNameError`); mỗi skin có style, gen, duyệt riêng.
- Hỗ trợ đúng Spine 4.2 (player pin 4.2.120).
- Test: `scripts/spine-test.ts` (`npm run test:spine`), tool `scripts/spine-skel-writer.mjs` sinh `.skel` mẫu.
