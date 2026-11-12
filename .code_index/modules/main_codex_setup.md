# main/codex + setup + settings + storage + updater + stats + system

## Codex
- `src/main/codex/installer.ts::CodexInstaller` — tải/giải nén codex release (`PINNED_VERSION`, `detectTarget`, `requiredFiles`, `compareVersions`).
- `src/main/codex/rpc.ts::AppServerConnection` — JSON-RPC tới `codex app-server` (stdio), `RpcNotification`, `RpcError`.
- `src/main/codex/service.ts::CodexService` — login ChatGPT, account, models, rate limits (`parseRateSnapshot`), thread/turn sinh ảnh (`TurnOptions`, `TurnResult`, `GeneratedImage`, `SandboxPolicy`).
- `src/main/paths.ts::appDataDir` / `codexHome` / `codexImagesDir` / `logsDir` / `cacheDir` — mọi đường dẫn app data.
- `src/main/logger.ts::logger` — `logger.scoped('name')` ghi file log.

## Setup / fix / settings
- `src/main/setup/service.ts::SetupService` — các bước `SETUP_STEPS` (môi trường, codex, đăng nhập, test gen, workspace), snapshot + `setup:changed`.
- `src/main/setup/fix.ts::FixService` — chẩn đoán + sửa (long path, PATH, UAC) qua `system/windows.ts::enableLongPaths` / `addUserPath` / `isAdmin`.
- `src/main/settings.ts::SettingsStore` — `AppSettings` (lang, theme, workspace, onboarding tours, model…).

## Storage
- `src/main/storage/service.ts::StorageService` — quét dung lượng, dọn session/ảnh gen cũ (`removeGeneratedImage`), chuyển data dir, banner đĩa đầy; `hasGenSpace` chặn queue khi đĩa thấp.
- `src/main/storage/config.ts::storageConfig` / `saveStorageConfig` — vị trí data dir tuỳ chỉnh.
- `src/shared/storage.ts` — `DISK_LOW_BYTES`, `DISK_CRITICAL_BYTES`, `GEN_MIN_FREE_BYTES`, `SESSION_KEEP_DAYS`, `STORAGE_IPC`.

## Updater / stats / sample
- `src/main/updater/index.ts::Updater` — electron-updater, hỏi trước khi tải; `createUpdater`, `registerUpdateIpc`, `normalizeNotes`. Bản portable không tự cập nhật.
- `src/main/stats/recorder.ts::attachStatsRecorder` — ghi JSONL mỗi job; `pruneStats`. `src/main/stats/aggregate.ts::summarize` (theo ngày/project). `src/main/stats/index.ts::initStats`.
- `src/main/sample/index.ts::createSampleProject` — nhân bản `resources/sample-project` (manifest `SAMPLE_MANIFEST`).

## Quan hệ
- `main/index.ts` dựng: `CodexInstaller` → `CodexService` → `SetupService` / `FixService`; `JobQueue` dùng `CodexService`.
- IPC: `setup:*`, `env:*`, `account:*`, `fix:*`, `app:*`, `win:*`, `settings:*`, `theme:*` (trong `registerServiceIpc`); `storage:*`, `update:*`, `stats:*` (module riêng).
- Renderer: `store/env.ts::useEnv`, `store/app.ts::useApp`, `screens/SetupScreen.tsx::SetupScreen`, `components/SettingsDialog.tsx::SettingsDialog`.

## Invariant
- Không gen khi chưa login ChatGPT Plus+ (gói Free không gen ảnh).
- Đóng cửa sổ khi còn job: hỏi "Chạy nền / Thoát hẳn" (`busyCount` trong `main/index.ts`); thoát hẳn thì lần sau job chạy tiếp từ queue.
- Codex pinned version; nâng cấp qua `env:upgrade-codex`.
- Test: `scripts/stats-test.ts`, `scripts/sample-test.ts`.
