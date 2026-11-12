# main/workspace — workspace, project.json, review, todo

## Symbol
- `src/main/workspace/service.ts::WorkspaceService` — cây folder/project (chokidar), `rescan`, `createFolder`/`createProject`/`rename`/`move`/`trash`, `open`, `addPaths`, `remove`, `setType`, `setGroups`, `setReview`, `versions`, `reprocess`, `recolor`, `addRefs`, `relink`, `todo`, `recordExport`.
- `src/main/workspace/project.ts::readProject` / `writeProject` / `emptyProject` — `project.json` (`PROJECT_FILE`, kiểu `ProjectFile`).
- `src/main/workspace/project.ts::buildView` — `ProjectView` gửi renderer (inputs, groups, review, thumb).
- `src/main/workspace/project.ts::checkInputs` / `collect` / `addCollected` / `compactRoots` — thêm ảnh từ folder/file, nhiều root, phát hiện file mất.
- `src/main/workspace/project.ts::outRelResolver` / `assetSegments` / `isInside` / `pathKey` — quy đổi đường dẫn tương đối/Windows.
- `src/main/workspace/analyze.ts::analyzeImage` / `makeThumb` / `hashFile` / `guessKind` — phân tích ảnh (gợi ý nine-slice, thumb), `mapLimit`.
- `src/main/workspace/review.ts::applyReviewPatch` / `sanitizeReview` / `readVersions` / `reprocessVersion` / `recolorVersion` — quyết định duyệt, danh sách version + QA, reprocess/recolor tạo version mới.
- `src/main/workspace/todo.ts::TodoIndex` — gom "việc cần làm" mọi project (chờ duyệt, QA lỗi, đã duyệt chưa xuất, job lỗi).
- `src/main/workspace/protocol.ts::registerFileScheme` / `handleFileScheme` / `fileUrl` — scheme `gas-file` cho renderer đọc ảnh.
- `src/shared/workspace.ts::MAX_PER_RUN` — cùng `InputType` (normal | nine), `WorkspaceSnapshot`; `src/shared/review.ts::REVIEW_IPC` — `ReviewPatch`, `ReprocessOptions`.
- `src/main/index.ts::registerWorkspaceIpc` — đăng ký `ws:*`, `proj:*`, `review:*`.

## Quan hệ
- Sprite/Spine mở rộng qua `WorkspaceService.spriteDeps()` (`projectDir`, `run`).
- Export đọc `loadForExport` / `setExportDir` / `recordExport`.
- Renderer: `store/workspace.ts::useWs`, `store/review.ts::useRv`, `store/todo.ts::useTodo`, `screens/WorkspaceScreen.tsx::WorkspaceScreen`, `screens/TodoScreen.tsx::TodoScreen`.

## Invariant
- `isAllowed(abs)` — chỉ phục vụ file trong workspace/root project; thêm root qua `allowDir`.
- Ghi `project.json` atomic; project kind quyết định service: `projectKindOf` (reskin | sprite | spine).
- Review: mỗi asset có version đang chọn + decision; version cũ giữ nguyên, reprocess/recolor luôn tạo version mới.
- Test: `scripts/workspace-card-test.ts`, `scripts/todo-test.ts`.
