# Lookup — task → file

Đọc file này ĐẦU TIÊN mỗi phiên (≤ 80 dòng). Mỗi dòng: 1 entry dạng `path::Symbol` (script
`index-check` kiểm được). Không ghi số dòng. Không văn xuôi.

| Task / màn | Entry | Liên quan | Không đụng / invariant | Bug liên quan |
|---|---|---|---|---|
| Gen 1 asset (chạy cả job) | `src/main/queue/GenJob.ts::runGenJob` | `src/main/queue/GenJob.ts::buildPrompt` | version cấp qua reserveVersion | — |
| Xử lý ảnh sau Codex | `src/main/pipeline/process.ts::processAsset` | `src/main/pipeline/client.ts::PipelineClient` | output cùng size ảnh gốc | — |
| QA ảnh | `src/main/pipeline/qa.ts::qa` | `src/main/pipeline/types.ts::QaReport` | không throw | — |
| Recolor không tốn lượt | `src/main/pipeline/recolor.ts::recolor` | `src/shared/recolor.ts::recolorPixels` | preview renderer = main | — |
| Hàng đợi gen | `src/main/queue/JobQueue.ts::JobQueue` | `src/main/queue/index.ts::registerQueueIpc` | running → queued khi restart | — |
| Hết quota → pause/resume | `src/main/queue/JobQueue.ts::JobQueue` | `src/shared/queue.ts::QUEUE_IPC` | job về queued, tự resume | — |
| Auto-regen khi QA fail | `src/main/queue/autoRegen.ts::needsAutoRegen` | `src/main/queue/autoRegen.ts::buildRegenNote` | không loop | — |
| Codex login / gen / rate limit | `src/main/codex/service.ts::CodexService` | `src/main/codex/rpc.ts::AppServerConnection` | pinned version | — |
| Onboarding | `src/main/setup/service.ts::SetupService` | `src/renderer/src/screens/SetupScreen.tsx::SetupScreen` | — | — |
| Sửa môi trường (long path, PATH) | `src/main/setup/fix.ts::FixService` | `src/main/system/windows.ts::enableLongPaths` | cần UAC | — |
| Dung lượng / dọn / chuyển data dir | `src/main/storage/service.ts::StorageService` | `src/main/storage/service.ts::hasGenSpace` | đĩa thấp thì pause queue | — |
| Auto update | `src/main/updater/index.ts::Updater` | `src/main/updater/index.ts::registerUpdateIpc` | hỏi trước khi tải | — |
| Style template builtin/user | `src/main/style/templates.ts::TemplateStore` | `src/shared/style.ts::templatesByCategory` | — | — |
| Chốt style (lock) | `src/main/style/lock.ts::lockStyle` | `src/main/style/lock.ts::unlockStyle` | gen cần style đã lock | — |
| Suggest hướng style | `src/main/style/suggest.ts::SuggestService` | `src/main/style/suggest.ts::parseDirections` | tính vào busyCount | — |
| Màn Style (Reskin) | `src/renderer/src/screens/StyleStep.tsx::StyleStep` | `src/renderer/src/components/StyleLibrary.tsx::StyleLibraryPanel` | — | — |
| Workspace cây thư mục | `src/main/workspace/service.ts::WorkspaceService` | `src/renderer/src/store/workspace.ts::useWs` | isAllowed chặn ngoài workspace | — |
| project.json | `src/main/workspace/project.ts::readProject` | `src/main/workspace/project.ts::writeProject` | ghi atomic | — |
| View project gửi renderer | `src/main/workspace/project.ts::buildView` | `src/main/workspace/project.ts::checkInputs` | — | — |
| Review / duyệt version | `src/main/workspace/review.ts::applyReviewPatch` | `src/main/workspace/review.ts::readVersions` | version cũ giữ nguyên | — |
| Reprocess / recolor version | `src/main/workspace/review.ts::reprocessVersion` | `src/main/workspace/review.ts::recolorVersion` | tạo version mới | — |
| Việc cần làm | `src/main/workspace/todo.ts::TodoIndex` | `src/renderer/src/screens/TodoScreen.tsx::TodoScreen` | — | — |
| Export plan | `src/main/export/index.ts::planExport` | `src/shared/export.ts::normalizeExportOptions` | outDir ngoài nguồn | — |
| Export chạy | `src/main/export/index.ts::runExport` | `src/shared/export.ts::scaledRel` | backup file cũ vào _backup | — |
| Màn Export Reskin | `src/renderer/src/screens/ExportStep.tsx::ExportStep` | `src/main/export/index.ts::registerExportIpc` | — | — |
| Sprite service | `src/main/sprite/service.ts::SpriteService` | `src/main/sprite/service.ts::registerSpriteIpc` | — | — |
| Sprite dò lưới | `src/main/sprite/grid.ts::detectGrid` | `src/main/sprite/grid.ts::gridFrames` | — | — |
| Sprite đọc atlas | `src/main/sprite/atlas.ts::parseAtlas` | `src/main/sprite/atlas.ts::parsePlistXml` | file atlas gốc dùng lại | — |
| Sprite suy anim/hướng | `src/main/sprite/anims.ts::animsFromGrid` | `src/main/sprite/anims.ts::animsFromTags` | — | — |
| Sprite strip: dải cần gen | `src/main/sprite/strips.ts::buildStripDefs` | `src/main/sprite/strips.ts::composeSheet` | mirror dùng lại strip | — |
| Sprite strip: fit + QA | `src/main/sprite/strip.ts::fitStrip` | `src/main/sprite/strip.ts::staticCheck` | frame tĩnh đứng yên | — |
| Sprite strip job | `src/main/sprite/stripJob.ts::runStripJob` | `src/main/queue/JobQueue.ts::JobQueue` | — | — |
| Sprite tạo sheet mới | `src/main/sprite/create.ts::buildNewStripPrompt` | `src/renderer/src/screens/sprite/NewSheetDialog.tsx::NewSheetDialog` | — | — |
| Sprite nguồn đổi | `src/main/sprite/source.ts::createSourceChecker` | `src/renderer/src/store/sprite.ts::sourceChangedStrips` | — | — |
| Sprite GIF/WebP động | `src/main/sprite/anim-export.ts::encodeAnimation` | `src/main/sprite/service.ts::SpriteService` | — | — |
| Màn Sprite | `src/renderer/src/screens/sprite/SpriteProjectScreen.tsx::SpriteProjectScreen` | `src/renderer/src/components/sprite/SpritePlayer.tsx::SpritePlayer` | — | — |
| Spine service | `src/main/spine/service.ts::SpineService` | `src/main/spine/service.ts::registerSpineIpc` | — | — |
| Spine atlas | `src/main/spine/atlas.ts::parseSpineAtlas` | `src/main/spine/regions.ts::extractRegion` | atlas gốc giữ nguyên | — |
| Spine skeleton json / skel | `src/main/spine/skeleton.ts::parseSkeleton` | `src/main/spine/binary.ts::parseSkeletonBinary` | chỉ Spine 4.2 | — |
| Spine skin biến thể | `src/main/spine/skins.ts::addSkinsJson` | `src/main/spine/binary.ts::addSkinsBinary` | file gốc không đổi | — |
| Màn Spine | `src/renderer/src/screens/spine/SpineProjectScreen.tsx::SpineProjectScreen` | `src/renderer/src/components/spine/SpinePreview.tsx::SpinePreview` | — | — |
| Thêm IPC channel | `src/shared/ipc.ts::IPC` | `src/preload/index.ts` | renderer chỉ dùng window.gas | — |
| Kiểu window.gas | `src/shared/types.ts::GasApi` | `src/preload/update.ts::exposeUpdateApi` | — | — |
| Khởi động main / đóng app | `src/main/index.ts::registerServiceIpc` | `src/main/index.ts::registerWorkspaceIpc` | còn job → hỏi chạy nền | — |
| Route renderer | `src/renderer/src/App.tsx::App` | `src/renderer/src/screens/ProjectScreen.tsx::ProjectScreen` | — | — |
| Thanh duyệt chung | `src/renderer/src/components/ReviewBar.tsx::ReviewBar` | `src/renderer/src/components/VersionCompare.tsx::VersionCompare` | 3 loại project cùng vị trí/phím | — |
| Duyệt asset Reskin | `src/renderer/src/screens/ReviewDetail.tsx::ReviewDetail` | `src/renderer/src/lib/review.ts::setDecision` | — | — |
