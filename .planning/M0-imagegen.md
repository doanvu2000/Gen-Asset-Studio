# M0 spike (B): gen ảnh qua `codex app-server`

Ngày 2026-10-29 · Codex CLI 0.165.0 · ChatGPT Plus · Windows 11

## Kết luận

**Chạy được.** Một turn app-server gồm text + 2 `localImage` (asset gốc + style ref), model tự gọi tool image gen và trả về item `imageGeneration` có sẵn **`savedPath`** + **`result` (PNG base64)**. 5/5 ảnh OK, kể cả 2 thread chạy song song, không bị lẫn ảnh giữa các thread.

- Script: `spike/m0/gen.mjs` (`node gen.mjs --tag=x [--parallel=N] [--model=..] [--effort=..]`)
- Input: `spike/m0/in/btn_green.png` (256x96 RGBA), `spike/m0/in/style_ref.png`
- Output: `spike/m0/out/*.png` (5 ảnh), `events-*.jsonl` (log đủ mọi message), `summary-*.json`
- Schema/TS nháp: `%TEMP%\m0b-schema\{json,ts}` (`generate-ts --experimental`, `generate-json-schema --experimental`)

## Chuỗi JSON-RPC đã dùng (JSONL qua stdio, mỗi dòng 1 message)

Spawn: `node %APPDATA%\npm\node_modules\@openai\codex\bin\codex.js app-server -c windows.sandbox="unelevated"` (gọi thẳng codex.js, không qua shim `.cmd`/shell).

1. `initialize` `{clientInfo:{name,title,version}, capabilities:{experimentalApi:true, requestAttestation:false}}` → `{userAgent, codexHome, platformFamily, platformOs}`
2. notification `initialized` (không có params)
3. `account/rateLimits/read` `{}` → trước
4. `thread/start` `{cwd, sandbox:"workspace-write", approvalPolicy:"never", config:{windows:{sandbox:"unelevated"}}, model?, ephemeral:false}` → `{thread:{id, sessionId,...}, model, reasoningEffort, ...}`
5. `turn/start` `{threadId, input:[{type:"text",text,text_elements:[]}, {type:"localImage",path}, {type:"localImage",path}], effort?, model?}` → `{turn:{id,status:"inProgress"}}`
6. Notification theo thứ tự: `thread/started` → `mcpServer/startupStatus/updated`… → `turn/started` → `hook/started/completed` → `item/started|completed userMessage` → `agentMessage`(commentary) → **`item/started imageGeneration`** (status `in_progress`, result "") → **`item/completed imageGeneration`** → `thread/tokenUsage/updated` → `account/rateLimits/updated` → `agentMessage`(final_answer) → `thread/status/changed idle` → **`turn/completed`** `{threadId, turn:{id,status,error,durationMs}}`
7. `account/rateLimits/read` → sau

Server request (có cả `id` và `method`, vd approval) → script trả `{decision:"decline"}`; với `approvalPolicy:"never"` không phát sinh lần nào.

Khác: `model/list {includeHidden:true}` → `data[]{id, model, isDefault, supportedReasoningEfforts, defaultReasoningEffort, hidden}`.

## Shape item ảnh (`item/completed`)

```json
{"item":{"type":"imageGeneration","id":"exec-<uuid>","status":"completed",
  "revisedPrompt":"...","result":"<PNG base64 ~1.5MB>","transparentBackground":false,
  "failure":null,
  "savedPath":"C:\\Users\\dauph\\.codex\\generated_images\\<threadId>\\exec-<uuid>.png"},
 "threadId":"<threadId>","turnId":"<turnId>","completedAtMs":...}
```

- `result` base64 == bytes file `savedPath` (đã so SHA-256).
- `failure` khi hết quota: `{type:"usageLimitExceeded", limitId, resetsAt}` (theo schema, chưa gặp).
- `inputImages` (schema có) **không xuất hiện** ở 0.165.0.
- Ảnh ra luôn **2048x768 RGB** (đúng 8:3, không alpha); nền ~ (250,4,252), **không phải #FF00FF tuyệt đối** → chroma key cần dung sai.

## Map ảnh ↔ thread

- `thread.id == thread.sessionId` (UUIDv7). Thư mục = `~/.codex/generated_images/<threadId>/exec-<itemId>.png` (tên file = `item.id`).
- Cách chắc nhất: lấy `params.threadId` + `item.savedPath` (hoặc `item.result`) ngay trong `item/completed`. Không cần quét thư mục / lấy file mới nhất.
- Máy này `~/.codex/generated_images` là symlink → `D:\work\AI\codex\cache\generated_images` (đường dẫn trong `savedPath` vẫn là dạng `C:\Users\...`).

## Thời gian & quota

| Run | Model / effort | Turn | Ảnh bắt đầu → xong | Quota 5h / tuần |
|---|---|---|---|---|
| seq1 (config mặc định) | gpt-6-luna / medium | 28.0 s | 9.1 → 26.6 s | 0 → 0 / 1 → 1 |
| seq2 | gpt-6-luna / medium | 25.0 s | 6.7 → 23.6 s | 0 → 0 / 1 → 1 |
| par2 t0 ‖ t1 (1 process, 2 thread) | gpt-6-luna / medium | 31.0 / 26.5 s | 7.7→29.4 / 8.5→25.2 s | 0 → 0 / 1 → 1 |
| sol | gpt-6.1-sol / low | 40.1 s | 19.9 → 36.2 s | 0 → **1** / 1 → 1 |

- Mỗi ảnh ~17 s cho riêng image gen + ~7–9 s overhead (khởi MCP/hook/turn). Song song 2 thread: tổng ~31 s cho 2 ảnh, không chậm hơn chạy lẻ.
- Quota: 5 ảnh làm cửa sổ 5h đi từ 0% → 1%, tuần giữ 1% → **ước ≤ 0.2%/ảnh (5h)**, tuần không đo được. `usedPercent` là số nguyên nên cần chạy batch lớn (≥ 20 ảnh) để đo chính xác.
- Token mỗi turn ~42k input (cache ~33k), output ~300.
- Default model trong `model/list` là `gpt-6.1-sol`, nhưng `~/.codex/config.toml` đặt `model="gpt-6-luna"`, `model_reasoning_effort="medium"` → thread không truyền model sẽ dùng luna. Sol/low chậm hơn (~40 s), bắt đầu gen muộn hơn.

## Chất lượng (đã tự xem ảnh)

Cả 5 ảnh: nút pill hồng kẹo, viền tím đậm, dải highlight hồng nhạt, đáy tối hơn, nền magenta phẳng, đúng tỉ lệ, không chữ / không phần tử thừa. Điểm trừ: ảnh luna (seq1, seq2) và sol có **viền răng cưa kiểu pixel-art** (bị ảnh hưởng do input 256x96 upscale); par2 mượt hơn. Màu chưa tím nhiều như style ref (gần như toàn hồng). Đạt mức dùng được sau khi tách nền + downscale.

## Vấn đề / lưu ý

- `proc.kill()` không đủ để Node thoát (con của codex.js giữ pipe) → phải `stdin.end()` + `process.exit()`. Lần chạy đầu bị treo cho tới timeout của shell vì lỗi này.
- Mỗi thread khởi MCP server + plugin hook của user (postman lỗi login, hyperframes-studio ECONNREFUSED, cua_repl, node_repl, codex_apps) → tốn ~3–5 s và rác stderr. Nên tắt qua `config` của thread (mcp_servers / plugins / hooks) hoặc `CODEX_HOME` riêng.
- AGENTS.md toàn cục của user lọt vào: agent trả lời tiếng Việt, xưng "Con". Dùng `baseInstructions`/`developerInstructions` hoặc CODEX_HOME riêng để cách ly.
- stderr có `ERROR ... agent role subagent must define a description` (config user) — vô hại.
- `config.toml` có `[windows] sandbox="elevated"`; đã override bằng `-c windows.sandbox="unelevated"` lúc spawn + `config.windows.sandbox` khi tạo thread; không gặp lỗi sandbox (turn không chạy shell).
- Nền không đúng #FF00FF tuyệt đối, ảnh không có alpha, kích thước cố định 2048x768 cho input 8:3.

## Đề xuất thiết kế CodexService

1. **Một process app-server lâu dài**, nhiều thread song song (đã chứng minh 2; nên giới hạn concurrency 2–3, chỉnh sau khi đo quota).
2. **1 asset = 1 thread mới** (`thread/start` + `turn/start`), cwd = thư mục job; `approvalPolicy:"never"`, `sandbox:"workspace-write"`, `config.windows.sandbox="unelevated"`.
3. Router notification theo `params.threadId`; lấy ảnh từ `item/completed` `type=imageGeneration`: ưu tiên `savedPath`, fallback decode `result`. Kết thúc khi `turn/completed` (kiểm `turn.status`, `turn.error`, `item.failure`).
4. Prompt cấm viết code/file, yêu cầu đúng 1 ảnh; nếu turn xong mà không có item ảnh → đánh lỗi "no image" để retry.
5. Quota: đọc `account/rateLimits/read` khi khởi động + nghe `account/rateLimits/updated` để cập nhật UI; dừng hàng đợi khi `rateLimitReachedType` khác null hoặc `failure.type=usageLimitExceeded`.
6. Model/effort chọn qua `model/list`; mặc định luna/medium (nhanh nhất đo được).
7. Hậu xử lý: chroma key dung sai (~ R>230, G<40, B>230) + khử ám viền, rồi scale về W×H gốc.
8. Timeout turn ~180 s, gọi `turn/interrupt` khi hủy; tắt process bằng `stdin.end()` + kill tree.
