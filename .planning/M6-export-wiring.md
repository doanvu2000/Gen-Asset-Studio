# M6 — Nối dây module Xuất ảnh (bước ⑤)

File mới (đã có, chỉ cần nối):
- `src/shared/export.ts` — `ExportOptions` (`outDir` rỗng = `<project>/output`, `scales` 1/2/4, `scaleLayout` `folder` = `@2x/<cây>` | `suffix` = `tên@2x.png`, `onlyApproved`, `conflict` `backup|skip`, `openFolderWhenDone`), `ExportPlan`, `ExportProgress`, `ExportResult`, `EXPORT_IPC`, `ExportApi`, `normalizeExportOptions`, `scaledRel`, `backupStamp`.
- `src/main/export/index.ts` — `planExport(src, options)`, `runExport(src, options, onProgress, { scale, signal })`, `registerExportIpc(ipcMain, getWindow, { loadProject, scale, log })` → `dispose()`; `reviewOf(data, input)` đọc `data.review[id]` (`decision === 'approved'`, `selected`), fallback `input.approved` / `input.selectedVersion`, không chọn → version mới nhất.
- `src/renderer/src/screens/ExportStep.tsx` (để cạnh các step khác, thư mục `screens/` phẳng) + `src/renderer/src/styles/export.css`.
- `src/renderer/src/i18n/export.vi.json`, `export.en.json` (khoá `export.*`; ExportStep tự `addResourceBundle` nếu chưa có).
- `scripts/export-test.ts` — `./node_modules/.bin/tsx --tsconfig tsconfig.node.json scripts/export-test.ts` (project giả ở `%TEMP%\gas-export-test`).

Hành vi: cây output = `outRel` (giống `InputView.outRel`, tính từ root chung; nhiều root không chung cha → `<tên root>/<rel>`). ×1 = chép nguyên byte `versions/<asset>/vN.png` sau khi kiểm W×H đúng gốc; ×2/×4 = Lanczos qua `scale`, kiểm lại W×H. File đã có → chuyển vào `<out>/_backup/<yyyyMMdd-HHmmss>/<cây>` (hoặc giữ nguyên nếu `skip`). Ghi tmp rồi rename, đường dẫn > 240 ký tự tự thêm `\\?\`. Chặn output nằm trong folder gốc. Ghi `<out>/export-report.json`. Huỷ được giữa chừng.

## 1. `src/main/workspace/service.ts`

`load` đang private → thêm hàm public cho export (cạnh `open`):

```ts
loadForExport(rel: string): Promise<{ dir: string; data: ProjectFile }> {
  return this.run(() => this.load(rel))
}
```

(Nếu `run` khoá cả workspace lâu thì gọi thẳng `this.load(rel)` — export chỉ đọc.)

## 2. `src/main/index.ts`

```ts
import { registerExportIpc } from './export'
```

Khai báo cạnh `let updater`:

```ts
let disposeExportIpc: (() => void) | null = null
```

Trong `app.whenReady()` ngay sau `registerStyleIpc(...)`:

```ts
disposeExportIpc = registerExportIpc(ipcMain, () => mainWindow, {
  loadProject: (rel) => workspace.loadForExport(rel),
  scale: (png, factor) => getPipeline({ size: 2 }).scale({ png, factor }),
  log: logger.scoped('export')
})
```

Khi thoát (cùng chỗ dispose queue / `closePipeline()`), gọi **trước** `closePipeline()`:

```ts
disposeExportIpc?.()
```

Folder output cần xem được trong app thì thêm `workspace.allowDir(outDir)` — hiện ExportStep không load ảnh output nên chưa cần.

## 3. `src/shared/types.ts`

```ts
import type { ExportApi } from './export'
```

Trong `GasApi` (cạnh `review: ReviewApi`):

```ts
export: ExportApi
```

## 4. `src/preload/index.ts`

```ts
import { EXPORT_IPC, type ExportOptions, type ExportProgress } from '@shared/export'
```

Trong object `api` (cạnh `review`):

```ts
export: {
  plan: (rel: string, options?: Partial<ExportOptions>) => ipcRenderer.invoke(EXPORT_IPC.plan, rel, options),
  run: (rel: string, options?: Partial<ExportOptions>) => ipcRenderer.invoke(EXPORT_IPC.run, rel, options),
  cancel: (rel: string) => ipcRenderer.invoke(EXPORT_IPC.cancel, rel),
  pickDir: (current?: string) => ipcRenderer.invoke(EXPORT_IPC.pickDir, current),
  openPath: (path: string) => ipcRenderer.invoke(EXPORT_IPC.openPath, path),
  onProgress: (cb) => subscribe<ExportProgress>(EXPORT_IPC.progress, cb)
},
```

## 5. `src/renderer/src/screens/ProjectScreen.tsx`

```ts
import { ExportStep } from './ExportStep'
import { useApp } from '@renderer/store/app'
```

Trong component render step:

```ts
const setStep = useWs((s) => s.setStep)
const closeProject = useWs((s) => s.closeProject)
const reloadProject = useWs((s) => s.reloadProject)
const defaultScale = useApp((s) => s.settings.gen.scale)
```

Thay nhánh cuối của chuỗi điều kiện:

```tsx
: key === 'export' ? (
  <ExportStep
    project={project}
    api={window.gas.export}
    defaultScale={defaultScale}
    onBack={() => setStep(4)}
    onHome={closeProject}
    onExported={() => void reloadProject()}
  />
) : <Soon step={key} />
```

`canStep` bước 5: mở khi có ≥ 1 ảnh đã duyệt (`project.review` / `approved` của agent M5), vd:

```ts
if (n === 5) return approvedCount(p) > 0 ? true : LOCK.export
```

Sub-title bước 5 `project.sub.notExported` → có thể đọc `<out>/export-report.json` sau này; hiện giữ nguyên.

## 6. i18n (tuỳ chọn)

ExportStep tự đăng ký bundle khi render nên không bắt buộc. Muốn gộp hẳn cho kiểu `t` typed thì trong `src/renderer/src/i18n/index.ts`:

```ts
import exportVi from './export.vi.json'
import exportEn from './export.en.json'

export const resources = {
  vi: { translation: { ...vi, ...exportVi } },
  en: { translation: { ...en, ...exportEn } }
} as const
```

## 7. `package.json`

```json
"test:export": "tsx --tsconfig tsconfig.node.json scripts/export-test.ts"
```

## Kiểm sau khi nối

- `npx tsc --noEmit -p tsconfig.node.json` + `-p tsconfig.web.json`, `npm run test:export`.
- Chạy app: duyệt 2–3 ảnh → bước Xuất: số liệu 4 ô, mở "Xem N ảnh bị bỏ qua", đổi folder, ×1+×2, xuất 2 lần (lần 2 hiện chip cam + đường dẫn `_backup`), Huỷ giữa chừng, "Mở folder output".
