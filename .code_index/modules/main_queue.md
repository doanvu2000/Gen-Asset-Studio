# main/queue — hàng đợi gen

## Symbol
- `src/main/queue/JobQueue.ts::JobQueue` — EventEmitter: `enqueue`, `pause`/`resume`, `pauseJob`, `pauseProject`, `cancel`, `cancelAll`, `retry`, `retryFailed`, `remove`, `move`, `clearFinished`, `setConcurrency`, `snapshot`, `load`, `flush`, `whenIdle`, `dispose`.
- `src/main/queue/JobQueue.ts::pump` (private) — lấy job `queued` theo concurrency + `staggerMs`, gọi `runJob` (mặc định `runGenJob`).
- `src/main/queue/GenJob.ts::runGenJob` — 1 job: chroma → prompt → codex turn → lấy ảnh → background → fit → qa → save version.
- `src/main/queue/GenJob.ts::buildPrompt` — dựng prompt (`PromptInput`: style, note, chroma, refs).
- `src/main/queue/GenJob.ts::reserveVersion` / `releaseVersion` / `versionsDir` — cấp số version `vN` trong `versions/<asset>/`.
- `src/main/queue/GenJob.ts::JobFailure` — lỗi có mã (quota, noImage, timeout…) để queue quyết retry/pause.
- `src/main/queue/autoRegen.ts::needsAutoRegen` / `buildRegenNote` / `regenSpecFor` — QA fail → enqueue đúng 1 job regen kèm note sửa lỗi.
- `src/main/queue/index.ts::createJobQueue` / `registerQueueIpc` / `queueStatePath` — dựng + IPC `QUEUE_IPC`.
- `src/main/system/queueBatch.ts::BatchTracker` — gom job thành "đợt" để báo xong/lỗi.
- `src/main/system/notify.ts::attachQueueNotifier` — Notification Windows khi hết đợt.
- `src/main/stats/recorder.ts::attachStatsRecorder` — ghi record mỗi job (xem `main_codex_setup.md`).
- `src/shared/queue.ts` — `JobSpec`, `QueueJob`, `JobStatus`, `JobStep`, `QueuePauseReason`, `QuotaPause`, `QUEUE_IPC`, giới hạn concurrency.

## Quan hệ
- `JobQueue` dùng `CodexLike` (`codex/service.ts::CodexService`), `PipelineLike`, và `sprite/stripJob.ts::runStripJob` cho job loại strip.
- Event renderer nhận: `queue:changed` (snapshot), `queue:job`, `queue:quota` (countdown). Renderer: `store/queue.ts::useQueue`, `components/QueueDrawer.tsx::QueueDrawer`.
- `handleRateLimits` nhận `RateLimits` từ codex → `enterQuotaPause` / `scheduleQuotaResume`.

## Invariant
- State persist (`queueStatePath`): job `running` khi tắt app được khôi phục thành `queued`; pause của user giữ qua restart.
- Hết quota: queue `paused` với `pauseReason: 'quota'`, job lỗi về lại `queued`, tự resume sau thời điểm reset rồi retry.
- `retry` tăng `attempt`; có `maxAutoRetries`; lỗi `noImage` liên tiếp / đĩa đầy (`hasDiskSpace`) → pause `noImage` / `diskFull`.
- Auto-regen chỉ khi setting bật + QA có check `fail`; chỉ `warn`/`pass` không enqueue; job regen fail lần nữa KHÔNG loop (`autoRegenOf`).
- `BatchTracker`: đợt chỉ kết thúc khi hết job active; cancel-all không báo; retry mở đợt mới.
- Số version chỉ cấp qua `reserveVersion` (tránh 2 job đè nhau).
- Test: `scripts/queue-test.ts` (`npm run test:queue`; phần cuối cần codex thật đã login).
