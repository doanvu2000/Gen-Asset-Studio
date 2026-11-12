# Gen Asset Studio — index hub

last_updated: 2026-11-13

## Mục đích
App Electron (Windows) reskin cả bộ asset 2D bằng Codex CLI image generation (tài khoản ChatGPT Plus+).
3 loại project (`ProjectKind`): **reskin** (folder ảnh UI), **sprite** (sprite sheet + atlas, hoặc tạo sheet mới
từ 1 ảnh nhân vật), **spine** (skeleton 4.2 + atlas, region + skin biến thể). Luồng chung:
Input → Style → Gen → Review → Export. Gen chạy qua `JobQueue` (nền, persist, pause khi hết quota).

## Stack
Electron 45 · electron-vite 6 · TypeScript · React 19 · zustand · i18next (vi/en) · motion · sharp (pipeline ảnh,
chạy trong worker_threads) · `@esotericsoftware/spine-player` · electron-updater · chokidar · tar.
Alias: `@shared` (src/shared), `@renderer` (src/renderer/src).

## Layout
- `src/main/` — process main. `index.ts` dựng service + đăng ký IPC.
  - `codex/` (installer, rpc app-server, service) · `setup/` (onboarding, fix) · `settings.ts` · `paths.ts` · `logger.ts`
  - `pipeline/` (xử lý ảnh) · `queue/` (JobQueue, GenJob) · `style/` · `workspace/` · `export/`
  - `sprite/` · `spine/` · `storage/` · `stats/` · `updater/` · `sample/` · `system/` (notify, queueBatch, windows)
- `src/preload/index.ts` — `contextBridge` expose `window.gas` (kiểu `GasApi` trong `src/shared/types.ts`), `update.ts`.
- `src/renderer/src/` — `App.tsx` (route: setup / workspace / todo / project), `screens/`, `components/`, `store/` (zustand),
  `lib/`, `i18n/`, `styles/`.
- `src/shared/` — kiểu + hằng IPC dùng chung 2 phía (`ipc.ts`, `queue.ts`, `style.ts`, `sprite.ts`, `spine.ts`, `export.ts`…).
- `resources/` — style-templates, sample-project, sprite/spine samples. `scripts/` — test + tool. `.planning/` — plan/handoff cũ.
- Bỏ qua: `out/`, `release/`, `spike/`, `mockup/`, `node_modules/`.

## Process + IPC
renderer → `window.gas.*` (preload) → `ipcRenderer.invoke(channel)` → `ipcMain.handle` trong main.
Hằng channel nằm ở `src/shared/*` (`IPC`, `QUEUE_IPC`, `STYLE_IPC`, `SPRITE_IPC`, `SPRITE_GEN_IPC`, `SPINE_IPC`, `REVIEW_IPC`,
`EXPORT_IPC`, `STORAGE_IPC`, `STATS_IPC`, `UPDATE_IPC`). Main → renderer push bằng event `*:changed` / `queue:job` /
`export:progress`. File ảnh phục vụ qua scheme `gas-file` (`workspace/protocol.ts`).
Handler IPC chung đăng ký trong `main/index.ts` (`registerServiceIpc`, `registerWorkspaceIpc`); module lớn tự có
`register*Ipc` (queue, style, sprite, spine, export, storage, updater).

## Dữ liệu trên đĩa
- Workspace folder (user chọn) chứa folder/project; mỗi project có `project.json` (`PROJECT_FILE`), `versions/<asset>/vN.png`
  (`versionsDir`, `reserveVersion`), style lock, cache thumb.
- Export ghi ra `outDir`, backup file cũ vào `_backup` (`BACKUP_DIR`), báo cáo `export-report.json`.
- App data `GenAssetStudio/` (`paths.ts`): codex binary, logs, queue state, stats, user style templates. Có thể đổi vị trí (storage).

## Chạy + kiểm tra
- `npm run dev` (electron-vite dev) · `npm run build` (typecheck + build) · `npm run dist:win` / `dist:portable`.
- Kiểm tra: `node scripts/check.mjs` (typecheck → test, tóm tắt OK/FAIL; xem `scripts/jin-scripts.json`).
  Chạy 1 test: `node scripts/check.mjs --test test:queue`. Cờ: `--only typecheck`, `--skip test`, `--verbose`.
- Test = script `scripts/*-test.ts` (tsx, không framework), gom bởi `scripts/test-all.mjs` (14 suite: format, export, sample,
  pipeline, queue, style, sprite, sprite-gen, sprite-new, spine, workspace-card, todo, recolor, stats). `test:e2e` = playwright.
- Test queue/pipeline có phần cần codex thật đã login; suite khác chạy offline với fake.

## Routing: task → đọc slice nào
| Task | Đọc |
|---|---|
| Sửa gen 1 asset (prompt, chroma, bg, fit, QA) | `modules/main_pipeline.md` |
| Queue, retry, quota pause, auto-regen, batch notify | `modules/main_queue.md` |
| Codex binary/login/rate limit, onboarding, fix, storage, updater | `modules/main_codex_setup.md` |
| Style template, lock, polish, suggest direction | `modules/main_style.md` |
| Project.json, workspace scan, todo, review/version, recolor | `modules/main_workspace.md` |
| Sprite sheet, grid, strip, anim export, snippets | `modules/main_sprite.md` |
| Spine atlas/skeleton/skin/region | `modules/main_spine.md` |
| Export ra thư mục game | `modules/main_export.md` |
| Thêm IPC channel / sửa preload / kiểu shared | `modules/ipc_shared.md` |
| UI màn Reskin, store, review bar, i18n | `modules/renderer_core.md` |
| UI màn Sprite / Spine | `modules/renderer_sprite_spine.md` |
Entry nhanh theo tên symbol: `lookup.md`.

## Quy ước
- Thêm IPC: hằng ở `src/shared/*` → handler main → `preload/index.ts` → kiểu `GasApi`/`*Api` → store/UI.
- Text UI vào `i18n/vi.json` + `en.json` (kiểu `i18next.d.ts`). Không có comment trong code.
- Ghi file dùng atomic (`writeJsonAtomic`). Đường dẫn Windows dài: `longPath` (export), `enableLongPaths` (system).
