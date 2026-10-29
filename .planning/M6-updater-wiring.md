# M6 — Nối dây module cập nhật app (electron-updater)

File mới (đã có, chỉ cần nối):
- `src/shared/update.ts` — `UpdateState`, `UpdateSnapshot`, `UPDATE_IPC`, `UpdateApi`, `parseReleaseNotes`, `htmlNotesToMarkdown`
- `src/main/updater/index.ts` — `createUpdater({ log, canRestart })`, `registerUpdateIpc(ipcMain, getWindow, updater)`
- `src/preload/update.ts` — `exposeUpdateApi()`
- `src/renderer/src/components/UpdateBanner.tsx`, `UpdateSettingsSection.tsx`, `src/renderer/src/lib/updateText.ts`, `src/renderer/src/styles/update.css`
- `src/renderer/src/i18n/update.vi.json`, `update.en.json`
- `scripts/release-notes.mjs`
- `electron-builder.yml` đã thêm `publish` (github, doanvu2000/Gen-Asset-Studio, releaseType: release); `package.json` đã thêm dependency `electron-updater` ^6.8.11

## 1. `src/main/index.ts`

```ts
import { createUpdater, registerUpdateIpc } from './updater'
```

Trong `app.whenReady()` sau khi tạo `mainWindow` + queue:

```ts
const updater = createUpdater({
  log: logger.scoped('update'),
  canRestart: () => !queue.hasActiveJobs()
})
const disposeUpdateIpc = registerUpdateIpc(ipcMain, () => mainWindow, updater)
updater.start()
app.on('will-quit', () => {
  disposeUpdateIpc()
  updater.dispose()
})
```

- `canRestart`: trả `false` khi còn job đang chạy/đợi (tên hàm queue thực tế tuỳ M4, vd `queue.snapshot().running > 0`).
- Bản dev (`app.isPackaged === false`) tự ở trạng thái `dev`, không gọi GitHub.
- `autoInstallOnAppQuit = true`: user bấm "Để sau" thì lần tắt app sẽ tự cài.
- Nếu `before-quit`/`close` có hộp xác nhận "đang có job", `quitAndInstall` chỉ chạy khi `canRestart()` true nên không bị chặn giữa chừng.

## 2. Preload `src/preload/index.ts`

```ts
import { exposeUpdateApi } from './update'
```

Thêm vào object `api`:

```ts
update: exposeUpdateApi(),
```

`src/shared/types.ts` — trong `GasApi`:

```ts
import type { UpdateApi } from './update'
update: UpdateApi
```

## 3. `App.tsx`

```tsx
import { UpdateBanner } from './components/UpdateBanner'
const { t, i18n } = useTranslation()
const updT = useCallback((k: UpdateKey, v?: UpdateVars) => t(`update.${k}`, v ?? {}), [t])
<UpdateBanner api={window.gas.update} t={updT} lang={i18n.language} />
```

Đặt ở cuối cây (ngoài Splash/Setup gate, chỉ hiện khi đã vào app chính). Import type: `import type { UpdateKey, UpdateVars } from './lib/updateText'`. Không truyền `t` thì component tự dùng `update.<lang>.json` (fallback).

## 4. `SettingsDialog.tsx`

```tsx
import { UpdateSettingsSection } from './UpdateSettingsSection'
<UpdateSettingsSection api={window.gas.update} t={updT} lang={i18n.language} />
```

Đặt trong tab Chung (hoặc tab "Giới thiệu"). Có nút "Kiểm tra cập nhật", phiên bản hiện tại, lần kiểm tra cuối, dòng trạng thái, notes + nút "Tải về"/"Khởi động lại để cập nhật" khi có.

## 5. Gộp i18n

Copy nguyên object `update` từ `update.vi.json` vào `vi.json`, `update.en.json` vào `en.json` (key gốc `update`). Sau khi gộp có thể bỏ `update.*.json`, nhưng `lib/updateText.ts` đang import chúng cho fallback + type `UpdateKey` → nếu xoá thì đổi import sang `vi.json` (`typeof vi.update`).

## 6. Phát hành

```bash
node scripts/release-notes.mjs 0.2.0 > release-notes.md
node scripts/release-notes.mjs "Chưa phát hành"
```

- Đổi heading `## Chưa phát hành` → `## 0.2.0 — <ngày>` trong CHANGELOG, bump `package.json` version.
- `GH_TOKEN=... npx electron-builder --win nsis --publish always` (tạo draft/release kèm `latest.yml` + `.exe` + `.blockmap`), dán `release-notes.md` vào body. Release phải **published** (không draft, không prerelease) thì updater mới thấy.
- App unsigned: Windows SmartScreen có thể cảnh báo lần cài update; electron-updater không kiểm chữ ký khi exe không ký (`publisherName` trống).
- Notes trên GitHub về app dạng HTML → main tự đổi sang markdown (`htmlNotesToMarkdown`) để banner hiện nhãn Update/Add/Remove/Fixbug.
