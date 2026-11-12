# main/sprite — project Sprite sheet

Mỗi sheet gồm nhiều anim (hàng/dải); mỗi anim là 1 "strip" gen riêng, ghép lại thành sheet cùng rect với sheet gốc.

## Symbol
- `src/main/sprite/service.ts::SpriteService` — API cho project sprite: `open`, `addPaths`, `addFromDialog`, `remove`, `updateSheet`, `detectGrid`, `setSettings`, `setStyle`, `addRefs`, `setLock`, `enqueue`, `enqueueAll`, `review`, `versions`, `recolor`, `exportRun`, `pickExportDir`, `pickCharacter`, `createSheet`, `snippets`, `previewSheet`, `exportAnimations`, `saveAnimation`.
- `src/main/sprite/service.ts::registerSpriteIpc` — `SPRITE_IPC` + `SPRITE_GEN_IPC`.
- `src/main/sprite/service.ts::readSpriteData` / `SpriteData` / `SheetRecord` — dữ liệu sprite trong `project.json`; `sanitizeSettings`, `sanitizeAnims` làm sạch input; `refreshSpriteCovers` / `flushSpriteCovers` cập nhật ảnh cover.
- `src/main/sprite/grid.ts::detectGrid` / `makeGrid` / `gridFrames` / `emptyCells` — tự dò lưới khi không có file atlas.
- `src/main/sprite/atlas.ts::parseAtlas` / `parsePlistXml` / `isAtlasFile` / `atlasImageName` — đọc TexturePacker/Aseprite JSON, Cocos `.plist`, Unity `.png.meta`.
- `src/main/sprite/anims.ts::animsFromTags` / `animsFromNames` / `animsFromGrid` / `animId` / `splitName` / `dirOrder` — suy ra anim + hướng từ tên frame / tag / lưới.
- `src/main/sprite/strips.ts::buildStripDefs` — dải cần gen (`StripDef`, có `mirrorOf` khi mirror hướng); `stripKey`, `stripAsset`, `listStripVersions`, `stripVersions`, `composeSheet`, `sheetPieces`, `recolorStripVersion`, `origStrip`.
- `src/main/sprite/strip.ts::fitStrip` — ghép lại strip AI vào bố cục gốc (`stripLayout`, `cellBox`, `keyStrip`, `splitFrames`, `joinFrames`, `flipFrame`); `buildStripPrompt`, `staticCheck`, `overflowCheck`, `motionDiff` cho QA strip.
- `src/main/sprite/stripJob.ts::runStripJob` — job gen 1 strip (gọi từ `JobQueue`); `stripQaSummary`.
- `src/main/sprite/create.ts::buildNewStripPrompt` — tạo sheet mới từ 1 ảnh nhân vật (`composeGuide`, `fitNewStrip`, `ANIM_TEXT`).
- `src/main/sprite/source.ts::createSourceChecker` — phát hiện sheet nguồn đổi (`frameHash`, `atlasTextHash`) → báo "nguồn đã đổi".
- `src/main/sprite/formats.ts::godotTres` / `unityMeta` / `cocosPlist` — xuất atlas phụ; `src/main/sprite/snippets.ts::buildSnippets` — code mẫu + `atlasJson`.
- `src/main/sprite/anim-export.ts::encodeAnimation` — GIF/WebP động để gửi duyệt (`AnimFormat`, `AnimScale`, `frameDelay`).
- `src/shared/sprite.ts::stripFrames` — cùng `ProjectKind`, `DIRECTIONS`, `ROW_PRESETS`, `DEFAULT_SPRITE_SETTINGS`, `NEW_ANIM_PRESETS`, `NEW_MAX_FRAMES`, `SPRITE_IPC`, `SPRITE_GEN_IPC`.

## Quan hệ
- Dùng `WorkspaceService.spriteDeps()`, `JobQueue.enqueue` (job strip), style qua `main_style.md`, pipeline `scale`/`recolor`.
- Renderer: `screens/sprite/SpriteProjectScreen.tsx::SpriteProjectScreen`, `SpriteWorkStep`, `SpriteStyleStep`, `SpriteExportStep`, `NewSheetDialog`; store `store/sprite.ts::useSprite`; xem `renderer_sprite_spine.md`.

## Invariant
- Sheet xuất cùng rect/kích thước với sheet gốc; file atlas gốc dùng lại nguyên (sheet tạo mới mới kèm atlas mới).
- Strip mirror (`mirrorOf`): hướng đối xứng dùng lại strip đã gen (flip) thay vì gen lần nữa; cần check overflow (`mirrorNeedsCheck`).
- Frame tĩnh phải đứng yên (`staticCheck`); strip tràn khung (`overflowCheck`) bị QA báo.
- Nguồn đổi sau khi gen → strip bị đánh dấu cũ (`store/sprite.ts::sourceChangedStrips`).
- Test: `scripts/sprite-test.ts`, `scripts/sprite-s2-test.ts` (`test:sprite-gen`), `scripts/sprite-s3-test.ts` (`test:sprite-new`).
