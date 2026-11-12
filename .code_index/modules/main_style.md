# main/style — style template, lock, polish, suggest

## Symbol
- `src/main/style/index.ts::StyleService` — gom `TemplateStore`, `SuggestService`, polish, lock, models; `registerStyleIpc` (`STYLE_IPC`).
- `src/main/style/templates.ts::TemplateStore` — template builtin (`resources/style-templates/*`, `resolveBuiltinTemplatesDir`) + của user (`userTemplatesDir`); lưu/đổi tên/xoá, export-import `.gasstyle`.
- `src/main/style/lock.ts::lockStyle` / `unlockStyle` / `groupStyleDir` / `lockRelPath` — chốt style cho 1 group: ghi prompt + ảnh tham chiếu vào project.
- `src/main/style/promptPolish.ts::polishPrompt` — nhờ Codex viết lại prompt style (`buildPolishPrompt`, `parsePolish`).
- `src/main/style/suggest.ts::SuggestService` — Codex đề xuất N hướng style + ảnh preview từ asset mẫu (`pickDiverseSamples`, `buildDirectionsPrompt`, `parseDirections`, `buildPreviewPrompt`); chạy nền, `activeCount()`.
- `src/main/style/common.ts::extractJson` / `writeJsonAtomic` / `readJson` / `turnFailure` — helper chung.
- `src/shared/style.ts::templatesByCategory` — cùng `StyleTemplate`, `STYLE_IPC`, `GASSTYLE_EXT`, `STYLE_REF_MAX`, `DEFAULT_TASK_MODELS`.

## Quan hệ
- Dùng `CodexService` (qua `StyleCodex`). Sprite/Spine dùng chung template qua `sprite:set-style` / `spine:set-style`.
- Renderer: `screens/StyleStep.tsx::StyleStep`, `components/StyleLibrary.tsx::StyleLibraryPanel`, `store/style.ts::useStyle`.
- `queue/GenJob.ts::buildPrompt` đọc style đã lock khi gen.

## Invariant
- Gen chỉ cho group đã lock style (`lib/project.ts::styleReady`, `gennable`).
- `suggest` được tính vào `busyCount` (đóng app có hỏi).
- Ảnh tham chiếu: tối đa `STYLE_REF_MAX`, giới hạn `STYLE_IMAGE_MAX_BYTES`.
- Test: `scripts/style-test.ts` (`npm run test:style`).
