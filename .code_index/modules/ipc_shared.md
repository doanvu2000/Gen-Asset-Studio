# IPC + preload + shared

## Symbol
- `src/shared/ipc.ts::IPC` — channel chung: `app:*`, `win:*`, `settings:*`, `theme:*`, `setup:*`, `env:*`, `account:*`, `fix:*`, `ws:*`, `proj:*`.
- `src/shared/types.ts::GasApi` — kiểu `window.gas` (gộp các `*Api`: queue, style, sprite, spine, export, storage, stats, update, review…); `AppSettings`, `SETUP_STEPS`, `EnvStatus`, `RateLimits`, `Unsubscribe`.
- `src/preload/index.ts` — `contextBridge.exposeInMainWorld('gas', …)`; helper `subscribe(channel, cb)` trả `Unsubscribe`; `webUtils` lấy path file kéo thả.
- `src/preload/update.ts::exposeUpdateApi` — phần updater của `window.gas`; `src/preload/gas.d.ts` khai báo global type cho renderer.
- `src/shared/queue.ts::QUEUE_IPC` · `src/shared/style.ts::STYLE_IPC` · `src/shared/sprite.ts::SPRITE_IPC` · `src/shared/sprite.ts::SPRITE_GEN_IPC` · `src/shared/spine.ts::SPINE_IPC` · `src/shared/review.ts::REVIEW_IPC` · `src/shared/export.ts::EXPORT_IPC` · `src/shared/storage.ts::STORAGE_IPC` · `src/shared/stats.ts::STATS_IPC` · `src/shared/update.ts::UPDATE_IPC`.
- `src/shared/update.ts::parseReleaseNotes` / `htmlNotesToMarkdown` — release notes cho banner cập nhật.
- `src/shared/imageFormats.ts` — danh sách định dạng ảnh hỗ trợ (png/jpg/webp), dùng cả main lẫn renderer.
- `src/main/index.ts::registerServiceIpc` / `registerWorkspaceIpc` — handler cho `IPC.*`, `REVIEW_IPC`.

## Quan hệ
- Đăng ký module: `registerQueueIpc`, `registerStyleIpc`, `registerSpriteIpc`, `registerSpineIpc`, `registerExportIpc`, `registerStorageIpc`, `registerUpdateIpc` (đều nhận `ipcMain` + `() => mainWindow`).
- Main push → renderer: `*:changed`, `queue:job`, `queue:quota`, `export:progress`, `storage:progress`, `style:suggest-progress`, `setup:log-line`, `win:maximized-changed`.
- Renderer lắng nghe tại `App.tsx::App` (`useBridgeEvents`, `useEnvBridge`, `useThemeSync`).

## Cách thêm 1 IPC
1. Thêm tên channel vào hằng IPC của vùng đó trong `src/shared/*`.
2. Thêm kiểu method vào interface `*Api` (hoặc `GasApi`).
3. Handler `ipcMain.handle` trong module service (hoặc `main/index.ts`).
4. Expose trong `preload/index.ts` (`ipcRenderer.invoke` / `subscribe`).
5. Gọi từ store/screen renderer qua `window.gas`.

## Invariant
- Renderer không import module main; chỉ dùng `@shared` + `window.gas`. Dữ liệu qua IPC phải serializable.
- Mọi đường dẫn file renderer đọc đi qua scheme `gas-file` (chỉ trong workspace đã `allowDir`).
- Test không phủ IPC trực tiếp (chỉ e2e playwright `scripts/e2e/run.ts`, helper `scripts/e2e/helpers.ts`).
