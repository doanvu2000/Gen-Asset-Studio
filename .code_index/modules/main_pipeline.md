# main/pipeline — xử lý ảnh sau khi Codex trả về

Chạy trong `worker_threads` (sharp), gọi từ main qua `PipelineClient` (pool slot, post message, tự respawn khi worker chết).

## Symbol
- `src/main/pipeline/index.ts::getPipeline` / `closePipeline` — singleton `PipelineClient`.
- `src/main/pipeline/client.ts::PipelineClient` — API async: `pickChroma`, `removeBackground`, `extractMainBlock`, `processAsset`…
- `src/main/pipeline/worker.ts` — worker entry, nhận `WorkerRequest`, trả `WorkerResponse`.
- `src/main/pipeline/ops.ts::ops` — bảng op (`PipelineOps`, `OpArgs`, `OpResult`) dùng chung client/worker.
- `src/main/pipeline/process.ts::processAsset` — chuỗi decode → removeBackground → extract → fit → qa → encode (có `timings`).
- `src/main/pipeline/process.ts::scale` — resize lanczos3 x1/x2/x4 (export dùng).
- `src/main/pipeline/chroma.ts::pickChroma` / `resolveChroma` / `CHROMA_COLORS` — chọn màu nền chroma key không đụng palette ảnh nguồn + style refs.
- `src/main/pipeline/background.ts::removeBackground` — tách nền chroma, trả alpha.
- `src/main/pipeline/blocks.ts::extractMainBlock` — lấy khối chính (bỏ rác/viền thừa) sau tách nền.
- `src/main/pipeline/fit.ts::fitToOriginal` — đưa ảnh AI về đúng size gốc; `detectStretchRegion`, `guessNineSlice`, `detectEdgeAnchored` cho nine-slice / asset bám cạnh.
- `src/main/pipeline/qa.ts::qa` — `QaReport` gồm `QaCheck` (status pass/warn/fail, value, threshold).
- `src/main/pipeline/recolor.ts::recolor` / `recolorPng` — đổi sắc độ/bão hoà/sáng, hoặc 1 dải màu (không tốn lượt Codex).
- `src/main/pipeline/image.ts` — helper raw RGBA: `decode`, `encodePng`, `crop`, `blit`, `alphaBBox`, `hue`, `rgbToHex`.
- `src/main/pipeline/types.ts` — `ProcessInput`, `ProcessResult`, `FitOptions`, `QaOptions`, `ScaleFactor`.

## Quan hệ
- Gọi bởi: `queue/GenJob.ts::runGenJob` (`PipelineLike` = pickChroma + processAsset), `workspace/review.ts::reprocessVersion` / `recolorVersion`,
  `export/index.ts` (scale), `sprite/strip.ts`, `spine/regions.ts`.
- `src/shared/recolor.ts::recolorPixels` / `normalizeRecolor` để renderer xem trước giống main.

## Invariant
- Output cuối luôn cùng kích thước ảnh gốc (`fitToOriginal`); export kiểm `sizeMismatch`.
- Nền sinh bằng chroma `CHROMA_COLORS` (mặc định magenta); chroma chọn theo ảnh nguồn để không trùng màu asset.
- QA fail → auto-regen / `qaWarn` (xem `main_queue.md`); `qa` không throw.
- Test: `scripts/pipeline-test.ts` (`npm run test:pipeline`), `scripts/recolor-test.ts`; `scripts/perf-bench.ts` là bench.
