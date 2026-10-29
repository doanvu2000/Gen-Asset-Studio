# M6 — Wiring onboarding (coach marks + project mẫu)

Module đã có sẵn (file mới, chưa nối vào app):

| File | Vai trò |
|------|---------|
| `resources/sample-project/assets/**` | 14 PNG UI mẫu (buttons / panels / bars / toggles / icons), nền trong suốt |
| `resources/sample-project/sample.json` | Tên project vi/en, nhóm style gợi ý `candy-pop`, danh sách asset + type ép (`nine`) |
| `scripts/make-sample-assets.mjs` | Vẽ lại bộ PNG bằng sharp từ SVG (`node scripts/make-sample-assets.mjs [--sheet out.png]`) |
| `src/main/sample/index.ts` | `createSampleProject(workspaceRoot, lang, deps)` → copy asset vào `<ws>/<Project mẫu>/source/`, ghi `project.json` bằng helper của `workspace/project.ts`, 1 nhóm style điền từ template (chưa khoá), tạo sẵn thumb |
| `scripts/sample-test.ts` | Test standalone: `node_modules/.bin/tsx --tsconfig tsconfig.node.json scripts/sample-test.ts` |
| `src/renderer/src/components/CoachMarks.tsx` | Engine tour: `CoachMarks` (controlled) + `CoachTour` (tự mở lần đầu, replay) + `findCoachTarget`, `ensureCoachBundles` |
| `src/renderer/src/styles/coach.css` | Spotlight + bubble (import sẵn trong CoachMarks.tsx) |
| `src/renderer/src/lib/tours.ts` | `tourSteps('workspace' \| 'project' \| 'style')`, hằng `COACH`, helper `coachAttr(id)` |
| `src/renderer/src/i18n/coach.vi.json` / `coach.en.json` | Chuỗi `coach.*` (CoachMarks tự `addResourceBundle`, không cần merge) |
| `electron-builder.yml` | Đã thêm `extraResources: resources/sample-project → sample-project` |

## 1. Main: IPC tạo project mẫu

`src/shared/ipc.ts` — thêm:

```ts
wsCreateSample: 'ws:create-sample',
```

`src/shared/workspace.ts` (hoặc `types.ts`) — kiểu trả về cho renderer:

```ts
export interface SampleCreateResult {
  ok: boolean
  rel: string | null
  name: string | null
  added: number
  error: string | null
}
```

`src/main/index.ts` — import + handler (sau `ipcMain.handle(IPC.wsCreateProject, …)`):

```ts
import { createSampleProject } from './sample'

ipcMain.handle(IPC.wsCreateSample, async () => {
  const root = workspace.current
  if (!root) return { ok: false, rel: null, name: null, added: 0, error: 'noWorkspace' }
  try {
    const r = await createSampleProject(root, settings.get().lang, {
      getTemplate: (id) => style.templates.get(id),
      log: logger.scoped('sample')
    })
    await workspace.rescan()
    return { ok: true, rel: r.rel, name: r.name, added: r.added, error: null }
  } catch (e) {
    return { ok: false, rel: null, name: null, added: 0, error: (e as Error).message }
  }
})
```

Ghi chú:
- Project nằm ngay root workspace, tên `Project mẫu` / `Sample project`, trùng thì `Project mẫu 2`, `3`…
- Root input = `<project>/source` (nằm trong project). `WorkspaceService.isAllowed` đã cho phép vì nằm trong workspace. Đừng gọi `addPaths` lên folder này (service lọc path nằm trong project).
- `project.json` có thêm khoá `sample: { version, lang }` (giữ nhờ index signature của `ProjectFile`). Dùng để đánh dấu card mẫu (mục 4).
- Nhóm style: `templateId: 'candy-pop'`, `promptEn` + `palette` lấy từ template, `notes` hướng dẫn, **không** có `lockImage` → user tự bấm Khoá.
- Packaged: resource nằm `process.resourcesPath/sample-project`; dev: `resources/sample-project` (resolve tự động, có thể override `deps.sampleDir`).

## 2. Preload

`src/preload/index.ts`, trong nhóm `workspace`:

```ts
createSample: (): Promise<SampleCreateResult> => ipcRenderer.invoke(IPC.wsCreateSample),
```

Cập nhật type `window.gas` tương ứng (file khai báo type đang dùng cho `workspace.createProject`).

## 3. Settings: cờ "đã xem" + nút Xem lại hướng dẫn

`src/shared/types.ts`:

```ts
export interface OnboardingPersist {
  tours: Record<string, boolean>
  sampleOffered: boolean
}
export const DEFAULT_ONBOARDING: OnboardingPersist = { tours: {}, sampleOffered: false }
```

- Thêm `onboarding: OnboardingPersist` vào `AppSettings` + `DEFAULT_SETTINGS`; thêm `onboarding?: Partial<OnboardingPersist>` vào `SettingsPatch`.
- `src/main/settings.ts`: `sanitizeOnboarding(input, base)` — `tours` chỉ nhận key `workspace|project|style` giá trị boolean; merge trong `sanitize()` và trong các chỗ clone `{ ...this.current, setup, gen }` (thêm `onboarding: { ...this.current.onboarding, tours: { ...this.current.onboarding.tours } }`).
- Store renderer (`store/app.ts`): selector `seenTours = s.settings.onboarding.tours`, action `markTourSeen(id)` → `window.gas.settings.set({ onboarding: { tours: { ...cur, [id]: true } } })`, action `replayTours()` → set `tours: {}` + tăng `coachReplay` (number trong store, không persist).

`SettingsDialog.tsx` — tab Chung (cạnh Ngôn ngữ / Giao diện), thêm 1 dòng:

```tsx
<div className="row">
  <div>
    <b>{t('coach.ui.replay')}</b>
    <small>{t('coach.ui.replayHint')}</small>
  </div>
  <button type="button" className="btn" onClick={() => { closeSettings(); replayTours() }}>
    {t('coach.ui.replay')}
  </button>
</div>
```

`SettingsDialog` cần gọi `ensureCoachBundles(i18n)` (import từ `@renderer/components/CoachMarks`) trước khi dùng key `coach.*`, hoặc đơn giản là App đã mount `CoachTour` (đã add bundle) trước khi mở Settings.

## 4. `data-coach` cần gắn vào element có sẵn

Dùng `{...coachAttr(COACH.xxx)}` từ `@renderer/lib/tours` hoặc ghi thẳng chuỗi `data-coach="..."`. Mỗi bước tour có danh sách target dự phòng: element đầu tiên đang hiển thị sẽ được chọn; không có target nào thì bước đó tự bỏ qua.

| data-coach | File | Element |
|------------|------|---------|
| `ws-tree` | `components/Sidebar.tsx` | `<aside className="side">` (dòng ~275) |
| `ws-settings` | `components/Sidebar.tsx` | nút gear ở `side-foot` (`aria-label={t('sidebar.settings')}`, dòng ~333) |
| `ws-settings` | `components/TitleBar.tsx` | nút gear `titlebar.settings` (dòng ~120) — dự phòng khi sidebar đóng |
| `ws-new-project` | `screens/WorkspaceScreen.tsx` | nút `btn primary` "Project mới" trong `mh-actions` (dòng ~175) |
| `ws-sample` | `screens/WorkspaceScreen.tsx` | `Card` của project mẫu: thêm `sample?: boolean` vào `ProjectSummary` (service `summary()` đọc `data.sample`), rồi trên `<div className="card">` gắn `data-coach={p.sample ? 'ws-sample' : undefined}` — chỉ card mẫu đầu tiên được chọn |
| `ws-sample` | `screens/WorkspaceScreen.tsx` | nút mới "Tạo project mẫu" trong Empty state root (cạnh "Project mới"/"Folder mới", dòng ~193) |
| `ws-queue` | `components/StatusBar.tsx` | nút queue `className={drawer ? 'st-btn on' : 'st-btn'}` (title `queue.title`) |
| `proj-steps` | `screens/ProjectScreen.tsx` | `<div className="steps" role="tablist">` (dòng ~39) |
| `proj-step-${key}` | `screens/ProjectScreen.tsx` | từng `<button className={cls} role="tab">` trong `STEPS.map` → `data-coach={\`proj-step-${key}\`}` (`input/style/gen/review/export`) |
| `proj-input-add` | `screens/InputStep.tsx` | `<div className="empty-drop big">` (empty state, dòng ~535) **và** `<div className="toolbar">` (dòng ~558) |
| `style-groups` | `screens/StyleStep.tsx` | `<div className="glist">` (dòng ~954) |
| `style-templates` | `screens/StyleStep.tsx` | `<section className="card-s">` chứa `tpl-grid` (dòng ~710, section tiêu đề `style.tpl.title`) |
| `style-lock` | `screens/StyleStep.tsx` | nút `btn primary` Khoá style (`t('style.lock')`, dòng ~849) |
| `gen-start` | `screens/GenStep.tsx` | nút `btn primary lg` Bắt đầu (`gen.start`, dòng ~227) |
| `review-grid` | `screens/ReviewStep.tsx` | `<div className="rv-grid">` (dòng ~228) |
| `export-run` | `screens/ExportStep.tsx` | nút `btn primary lg` xuất (dòng ~491) |

Tour `project` ở bước Input chỉ thấy `proj-input-add`; các bước style/gen/review/export rơi về tab tương ứng trên thanh bước (`proj-step-*`). Tour `style` chạy khi lần đầu vào bước Style.

## 5. Mount CoachTour

`App.tsx` — trong `<div className="app">`, sau `<WorkspaceDialogs />`:

```tsx
import { useMemo } from 'react'
import { CoachTour } from '@renderer/components/CoachMarks'
import { tourSteps } from '@renderer/lib/tours'

const wsSteps = useMemo(() => tourSteps('workspace'), [])
const projSteps = useMemo(() => tourSteps('project'), [])
const seen = useApp((s) => s.settings.onboarding.tours)
const replay = useApp((s) => s.coachReplay)
const markTourSeen = useApp((s) => s.markTourSeen)
const settingsOpen = useApp((s) => s.settingsOpen)

{route === 'workspace' && (
  <CoachTour tourId="workspace" steps={wsSteps} seen={!!seen.workspace} onSeen={markTourSeen} replay={replay} enabled={!settingsOpen} />
)}
{route === 'project' && (
  <CoachTour tourId="project" steps={projSteps} seen={!!seen.project} onSeen={markTourSeen} replay={replay} enabled={!settingsOpen} />
)}
```

`StyleStep.tsx` — cuối JSX:

```tsx
const styleSteps = useMemo(() => tourSteps('style'), [])
<CoachTour tourId="style" steps={styleSteps} seen={!!seen.style} onSeen={markTourSeen} delay={500} />
```

Hành vi engine:
- Mở sau `delay` (mặc định 450 ms, chờ view transition), poll tối đa ~10 s nếu target chưa render.
- `onSeen(tourId)` chỉ gọi khi đã hiện ≥ 1 bước (Xong hoặc Bỏ qua đều tính là đã xem).
- `replay` đổi số → mở lại dù đã xem.
- Phím: Esc = bỏ qua (chặn Esc lan sang dialog khác), ←/→ = lùi/tiếp, Tab bị giữ trong bubble, focus trả về element cũ khi đóng.
- Spotlight bám target mỗi frame (resize, scroll, layout shift, sidebar đóng/mở); target biến mất thì tự sang bước sau.
- `prefers-reduced-motion`: tắt transition/animation.
- z-index 950 (dưới splash 1000, trên update banner 900).

## 6. Gợi ý project mẫu lần đầu

Sau khi setup xong và vào workspace lần đầu (`onboarding.sampleOffered === false`):
1. Nếu workspace chưa có project nào → tự gọi `window.gas.workspace.createSample()` rồi set `sampleOffered: true`; toast `coach.ui.sampleCreated` (`{ name, count: added }`), lỗi → toast `coach.ui.sampleFailed`.
2. Tour `workspace` mở sau đó sẽ chỉ vào card mẫu (`ws-sample`).
3. Empty state root luôn có nút "Tạo project mẫu" (`coach.ui.sampleCreate`, hint `coach.ui.sampleHint`) để tạo lại bất cứ lúc nào.

## 7. i18n

Không cần merge vào `vi.json`/`en.json`: `CoachMarks` gọi `ensureCoachBundles(i18n)` (giống `export.*.json`). Chỗ nào khác dùng key `coach.*` mà không render `CoachMarks`/`CoachTour` thì gọi `ensureCoachBundles(i18n)` trước.

## 8. Kiểm tra sau khi nối

- `npm run typecheck`
- `node_modules/.bin/tsx --tsconfig tsconfig.node.json scripts/sample-test.ts`
- Chạy app: xoá cờ `onboarding` trong settings → vào workspace trống → project mẫu được tạo, tour workspace chạy 5 bước; mở project mẫu → tour project; sang bước Style → tour style chỉ tới nút Khoá.
- Đóng/mở sidebar, resize cửa sổ khi tour đang mở → spotlight bám đúng.
- Bật Reduce motion của Windows → không còn animation.
