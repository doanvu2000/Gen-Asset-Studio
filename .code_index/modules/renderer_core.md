# renderer — shell, màn Reskin, store, lib

## Shell
- `src/renderer/src/main.tsx` — mount React, khởi tạo i18n. `src/renderer/src/App.tsx::App` — route `setup | workspace | todo | project` (`SCREENS`), TitleBar, Sidebar, tour/coach marks.
- `src/renderer/src/screens/SetupScreen.tsx::SetupScreen` — onboarding (codex, login, workspace).
- `src/renderer/src/screens/WorkspaceScreen.tsx::WorkspaceScreen` — cây folder/project, tạo project 3 loại (`components/ProjectKinds.tsx`).
- `src/renderer/src/screens/TodoScreen.tsx::TodoScreen` — việc cần làm; `store/todo.ts::useTodo`, `todoBadge`, `useTodoFocus` nhảy đúng project/bước/asset.
- `src/renderer/src/screens/ProjectScreen.tsx::ProjectScreen` — stepper 5 bước cho Reskin (`canStep` khoá bước chưa đủ điều kiện); Sprite/Spine có screen riêng.

## Các bước Reskin
- `screens/InputStep.tsx::InputStep` — thêm ảnh, gán type normal/nine, group.
- `screens/StyleStep.tsx::StyleStep` — chọn/chốt style (`PolishPanel`, suggest, template, ảnh ref).
- `screens/GenStep.tsx::GenStep` — chọn asset, enqueue, tiến độ; `components/GenEstimate.tsx`.
- `screens/ReviewStep.tsx::ReviewStep` + `screens/ReviewDetail.tsx::ReviewDetail` — duyệt từng asset, QA, so sánh.
- `screens/ExportStep.tsx::ExportStep` — plan + chạy export (xem `main_export.md`).

## Component dùng chung
- `components/ReviewBar.tsx::ReviewBar` — thanh duyệt chung 3 loại project (chip version, So sánh A/B, Đổi màu, Gen lại, Cần sửa, Duyệt).
- `components/VersionCompare.tsx::VersionCompare` — A/B cạnh nhau hoặc slider (phím `C`, `[` `]`).
- `components/RecolorPanel.tsx::RecolorPanel` — đổi màu nhanh (dùng `shared/recolor.ts`).
- `components/QueueDrawer.tsx::QueueDrawer`, `QuotaBanner`, `StatusBar`, `EnvChip`, `ModelChip`, `QuickPassBar` — queue + trạng thái.
- `components/StyleLibrary.tsx::StyleLibraryPanel` / `SaveToLibraryButton` / `StyleLibraryDialog` — thư viện style team (`.gasstyle`).
- `components/ShortcutsDialog.tsx`, `CoachMarks.tsx`, `Toasts.tsx`, `Modal.tsx`, `SettingsDialog.tsx::SettingsDialog`.

## Store (zustand)
- `store/app.ts::useApp` (route, settings, theme `selectResolvedTheme`, step), `store/workspace.ts::useWs` (snapshot, project đang mở, `findNode`), `store/env.ts::useEnv`.
- `store/queue.ts::useQueue` (`isActive`, `projectName`), `store/review.ts::useRv`, `store/style.ts::useStyle`, `store/toast.ts::toast`.

## Lib
- `lib/review.ts::reviewItems` / `setDecision` / `selectVersion` / `approvedCount` / `RV_FILTERS`; `lib/project.ts::styleReady` / `gennable` / `isLocked` / `groupOf` / `hasVersions`.
- `lib/useReviewKeys.ts::useReviewKeys` (phím tắt duyệt), `lib/useQuickPass.ts::useQuickPass` (xem lướt chưa duyệt, A/X tự sang mục kế).
- `lib/tours.ts::tourSteps` + `coachAttr` — coach marks theo `TOUR_IDS`. `lib/files.ts`, `format.ts`, `env.ts`, `versionUrl.ts` (url `gas-file`).
- i18n: `i18n/index.ts` + `vi.json` / `en.json` + `coach.*`, `export.*`, `update.*` (hook `lib/useUpdateT.ts`); kiểu `i18next.d.ts`.
- Style: `src/renderer/src/styles/*.css` (design system, theme sáng/tối).

## Invariant
- Gen chỉ khi group có style đã lock (`styleReady`); bước Review/Export bị khoá nếu chưa có version/duyệt (`canStep`).
- Quyết định duyệt ghi qua `review:set` (không giữ riêng ở renderer).
- Phím tắt `?` mở bảng phím ở mọi màn duyệt; giữ thống nhất 3 loại project (`ReviewBar`).
