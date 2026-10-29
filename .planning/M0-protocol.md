# M0 — Codex app-server protocol (Codex CLI 0.165.0)

Spike phần A: dump protocol + kiểm account / quota / model / login. Ngày 2026-10-29.
File liên quan: `spike/m0/probe-account.mjs`, `spike/m0/out-real.json` (email đã che), `spike/m0/out-isolated.json`, schema ở `spike/m0/schema/`.

## 1. Dump schema

| Lệnh | Output |
|---|---|
| `codex app-server generate-json-schema --out spike/m0/schema/json` | JSON Schema (stable) |
| `codex app-server generate-json-schema --experimental --out spike/m0/schema/json-experimental` | + method experimental |
| `codex app-server generate-ts --out spike/m0/schema/ts` | TS types (ts-rs), có doc comment — dễ đọc nhất |
| `codex app-server generate-ts --experimental --out spike/m0/schema/ts-experimental` | |

- Danh sách method: `schema/json/ClientRequest.json` (client→server), `ServerNotification.json`, `ServerRequest.json` (server→client cần trả lời: approval…), `ClientNotification.json` (chỉ `initialized`).
- Type v2: `schema/ts/v2/*.ts`; vài type chung ở `schema/ts/*.ts` (vd `ImageGenerationItem.ts`, `PlanType.ts`, `ReasoningEffort.ts`).
- Bản `--experimental` thêm ~70 method (thread/queue/*, thread/settings/update, turn/settings/update, project/*, process/*, remoteControl/*…). Không cần cho MVP.

## 2. Transport + handshake

- stdio, JSON-RPC 2.0 **không có field `"jsonrpc"`**, mỗi message 1 dòng JSON (`\n`). Request `{id, method, params}`; response `{id, result}` / `{id, error:{code,message}}`; notification `{method, params}`; server request `{id, method, params}` → client phải trả `{id, result}`.
- Handshake:
  1. → `initialize` `{clientInfo:{name,title,version}, capabilities:{experimentalApi:bool, requestAttestation:bool, optOutNotificationMethods?:string[]}}`
  2. ← `{userAgent, codexHome, platformFamily:"windows", platformOs:"windows"}` (~400 ms)
  3. → notification `initialized` (không params)
- Ngay sau đó server tự bắn: `configWarning` (nếu config lỗi), `remoteControl/status/changed`, `account/updated {authMode, planType}`.
- `clientInfo.name` đi vào `originator` của authUrl và userAgent → đặt tên app thật (vd `gen_asset_studio`).

## 3. Method dùng cho app

| Method | Params (key) | Result (key) |
|---|---|---|
| `account/read` | `{refreshToken?:bool}` | `{account: null \| {type:"chatgpt", email, planType} \| {type:"apiKey"} …, requiresOpenaiAuth, workspaceRouting?}` |
| `account/rateLimits/read` | `{excludeResetCreditDetails?, supportsLunaReserve?}` | xem §5. Chưa login → error `-32600 "codex account authentication required to read rate limits"` |
| `account/usage/read` | — | `{summary:{lifetimeTokens, peakDailyTokens, …}, dailyUsageBuckets:[{startDate, tokens}]}` |
| `account/login/start` | `{type:"chatgpt"}` \| `{type:"chatgptDeviceCode"}` \| `{type:"apiKey", apiKey}` | chatgpt: `{type, loginId, authUrl}`; deviceCode: `{type, loginId, verificationUrl, userCode}` |
| `account/login/cancel` | `{loginId}` | `{status:"canceled"\|"notFound"}`; loginId lạ → error `-32600 "invalid login id: …"` |
| `account/logout` | — | `{}` + notif `account/updated {authMode:null, planType:null}` |
| `model/list` | `{cursor?, limit?, includeHidden?}` | `{data: Model[], nextCursor}` — chạy được cả khi chưa login |
| `config/read` | `{includeLayers?, cwd?}` | `{config, origins, layers}` (config = toàn bộ key config.toml, snake_case) |
| `config/value/write` | `{keyPath, value, mergeStrategy:"replace"\|"upsert", filePath?, expectedVersion?}` | `{status, version, filePath, overriddenMetadata}` |
| `config/batchWrite` | `{edits[], filePath?, expectedVersion?, reloadUserConfig?}` | như trên |
| `thread/start` | `{model?, cwd?, approvalPolicy?, sandbox?:"read-only"\|"workspace-write"\|"danger-full-access", config?, baseInstructions?, developerInstructions?, ephemeral?}` | `{thread:{id,…}, model, reasoningEffort, cwd, sandbox, approvalPolicy}` + notif `thread/started` |
| `thread/resume` | `{threadId, model?, cwd?, …, excludeTurns?}` | như thread/start |
| `thread/read`, `thread/list`, `thread/turns/list`, `thread/items/list` | | đọc lịch sử |
| `turn/start` | `{threadId, input: UserInput[], model?, effort?, cwd?, sandboxPolicy?, approvalPolicy?, outputSchema?, serviceTier?}` | `{turn:{id, status:"inProgress", …}}` |
| `turn/interrupt` | `{threadId, turnId}` | `{}`; turn kết thúc bằng `turn/completed` status `interrupted` |
| `turn/steer` | chèn input vào turn đang chạy | |

`UserInput`:
- `{type:"text", text, text_elements:[]}` (chú ý `text_elements` snake_case, bắt buộc — để `[]`)
- `{type:"localImage", path, detail?:"auto"|"low"|"high"|"original"}`
- `{type:"image", url}` hoặc `{type:"image", fileId}`

## 4. Notification quan trọng

| Method | Params (key) | Ghi chú |
|---|---|---|
| `turn/started` / `turn/completed` | `{threadId, turn}` | `turn.status`: `completed`/`interrupted`/`failed`/`inProgress`; `turn.error`, `durationMs` |
| `item/started` / `item/completed` | `{item: ThreadItem, threadId, turnId, startedAtMs/completedAtMs}` | |
| `item/agentMessage/delta` | `{threadId, turnId, itemId, delta}` | stream text |
| `item/reasoning/summaryTextDelta` | | stream tóm tắt reasoning |
| `error` | `{error: TurnError, willRetry, threadId, turnId}` | `willRetry=true` → đừng báo fail ngay |
| `warning`, `configWarning` | `{message}` / `{summary, details}` | |
| `account/rateLimits/updated` | `{rateLimits: RateLimitSnapshot}` | bắn trong/sau turn → cập nhật thanh quota không cần poll |
| `account/updated` | `{authMode, planType}` | sau login/logout/khởi động |
| `account/login/completed` | `{loginId, success, error, onboardingEntrypoint}` | cancel cũng bắn với `success:false` |
| `thread/tokenUsage/updated` | `{threadId, turnId, tokenUsage}` | |
| `model/rerouted` | `{fromModel, toModel, reason}` | |

ThreadItem cần xử lý: `userMessage`, `agentMessage {text}`, `reasoning`, `commandExecution`, `fileChange`, `imageView {path}`, **`imageGeneration`**:
`{id, status, revisedPrompt, transparentBackground?, failure: null | {type:"usageLimitExceeded", limitId, resetsAt}, savedPath?, inputImages?:[{path, sha256}]} & ({fileId} | {result})` — lấy file từ `savedPath`.

`TurnError.codexErrorInfo`: `usageLimitExceeded`, `rateLimitExceeded`, `unauthorized`, `serverOverloaded`, `modelNotFound`, `contextWindowExceeded`, `{httpConnectionFailed:{httpStatusCode}}`, … → map sang thông báo UI.

Server request (phải trả lời, nếu không turn treo): `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `account/chatgptAuthTokens/refresh`. Với app mình nên chạy `approvalPolicy:"never"` để tránh.

## 5. Quota (`account/rateLimits/read`) — kết quả thật (Plus)

```
ordinaryUsageAllowed: true
rateLimits: { limitId:"codex", planType:"plus",
  primary:   { usedPercent:0, windowDurationMins:300,   resetsAt:1793280388 },
  secondary: { usedPercent:1, windowDurationMins:10080, resetsAt:1793787033 },
  credits: { hasCredits:false, unlimited:false, balance:"0" },
  spendControlReached:false, rateLimitReachedType:null }
rateLimitsByLimitId: { codex: {...giống trên} }
rateLimitResetCredits: { availableCount:2, credits:null }
```

| Field | Nghĩa |
|---|---|
| `primary` | cửa sổ ngắn: 300 phút = 5 giờ |
| `secondary` | cửa sổ tuần: 10080 phút = 7 ngày |
| `usedPercent` | % đã dùng (0–100) trong cửa sổ đó; còn lại = 100 − used |
| `windowDurationMins` | độ dài cửa sổ (phút), có thể null |
| `resetsAt` | **Unix epoch giây** (đã kiểm: 1793280388 = 2026-10-29T13:26Z, ~5h sau lúc gọi) → `new Date(resetsAt*1000)` |
| `ordinaryUsageAllowed` | backend cho phép dùng quota thường; `null` = không rõ, doc dặn không tự suy từ % |
| `rateLimitReachedType` | null hoặc `rate_limit_reached` / `workspace_*_credits_depleted` / `workspace_*_usage_limit_reached` |
| `credits` | credit trả thêm (balance là string) |
| `rateLimitsByLimitId` | nhiều bucket theo `limitId` (hiện chỉ `codex`); nên đọc map này, fallback `rateLimits` |
| `rateLimitResetCredits.availableCount` | số lượt reset quota còn (dùng qua `account/rateLimitResetCredit/consume` — không gọi) |

- Poll nền dùng `{excludeResetCreditDetails:true}` (rẻ hơn). Gọi mất ~400 ms.
- `supportsLunaReserve` (param): cho backend tự fallback sang "Luna Reserve" (model hidden `gpt-reserve`) khi hết quota thường — **không bật**.

## 6. Login flow

Đã test trên CODEX_HOME tạm `C:\Users\dauph\AppData\Local\Temp\codex-home-probe` (không đụng account thật).

- Chưa login: `account/read` → `{account:null, requiresOpenaiAuth:true}`; `model/list` vẫn trả list.
- **ChatGPT (browser)**: `account/login/start {type:"chatgpt"}` trả ngay (~1 ms) `{loginId, authUrl}`.
  - `authUrl` = `https://auth.openai.com/oauth/authorize?…&redirect_uri=http://127.0.0.1:1455/auth/callback&code_challenge…(PKCE S256)&originator=<clientInfo.name>`.
  - Server **mở callback server local cổng 1455** (netstat thấy `127.0.0.1:1455 LISTENING` của codex.exe). Server chỉ trả URL; app tự mở browser bằng `shell.openExternal(authUrl)` (thiết kế API; lúc test không thấy cần thao tác gì khác).
  - Xong → notif `account/login/completed {loginId, success:true}` + `account/updated {authMode:"chatgpt", planType}`.
  - `account/login/cancel {loginId}` → `{status:"canceled"}`, cổng 1455 đóng ngay, notif `account/login/completed {success:false, error:"Login server error: Login was not completed"}`.
  - Cổng 1455 cố định → nếu Codex CLI/VS Code khác đang login cùng lúc sẽ đụng cổng.
- **Device code** (dự phòng): `{type:"chatgptDeviceCode"}` (~600 ms) → `{loginId, verificationUrl:"https://auth.openai.com/codex/device", userCode:"XXXX-XXXXX"}`; cancel được tương tự.
- **Logout**: `account/logout` → `{}` + `account/updated {authMode:null, planType:null}`; gọi khi đã logged-out vẫn OK.
- Login lưu credential vào `$CODEX_HOME/auth.json` → dùng chung với Codex CLI/VS Code trên máy (logout trong app = logout cả CLI).

## 7. Model list (account thật, `includeHidden:true`)

| id (= model) | efforts | default effort | hidden | ghi chú |
|---|---|---|---|---|
| `gpt-6.1-sol` | low, medium, high, xhigh, max, ultra | low | | `isDefault:true` |
| `gpt-6-astra` | low…ultra | low | | |
| `gpt-6.1-terra` | low…ultra | low | | |
| `gpt-6-sol` | low…ultra | medium | | |
| **`gpt-6-luna`** | low, medium, high, xhigh, max (không ultra) | medium | | **config hiện tại của chủ nhân: `model="gpt-6-luna"`, effort `medium`** |
| `gpt-5.6-sol` | low…ultra | low | | |
| `gpt-5.6-terra` | low…ultra | medium | | |
| `gpt-5.6-luna` | low…max | medium | | |
| `gpt-reserve` | low…max | medium | yes | Luna Reserve fallback |
| `codex-auto-review` | low…max | medium | yes | dùng nội bộ review |

- CODEX_HOME trống (chưa login, không hidden) còn thấy thêm `gpt-5.5` (low…xhigh) → list phụ thuộc account; luôn lấy động, không hard-code.
- Mọi model: `inputModalities:["text","image"]`, `serviceTiers:[{id:"priority", name:"Fast", "2x speed, increased usage"}]`.
- Effort là string (`ReasoningEffort = string`); `ultra` = "Maximum reasoning with automatic task delegation" (sub-agent) — app nên ẩn hoặc cảnh báo.
- Đổi model/effort: truyền `model`/`effort` vào `turn/start` (theo turn) hoặc `thread/start`; hoặc ghi `config/value/write keyPath:"model"`.

## 8. Spawn trên Windows

- Native exe: `%APPDATA%\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe` (kèm `codex-path\rg.exe`, `codex-resources\codex-command-runner.exe`, `codex-windows-sandbox-setup.exe`).
- 3 cách đều chạy OK (đã test):
  1. `spawn(codex.exe, ["app-server"], {stdio:"pipe", windowsHide:true})` — **khuyến nghị** (không qua cmd, kill sạch, không cửa sổ console).
  2. `spawn(process.execPath, [<pkg>\bin\codex.js, "app-server"])` — codex.js lại spawn codex.exe (thêm 1 process; trong Electron `process.execPath` là electron.exe → cần `ELECTRON_RUN_AS_NODE=1` hoặc node riêng).
  3. `spawn("codex", ["app-server"], {shell:true})` — chạy, nhưng kill chỉ giết cmd.exe, dễ mồ côi codex.exe.
- Tìm exe: đọc `npm root -g` hoặc `%APPDATA%\npm\node_modules\...`; fallback `where codex`. Version: `codex --version`.
- codex.js set env `CODEX_MANAGED_BY_NPM=1`, `CODEX_MANAGED_PACKAGE_ROOT` khi spawn — spawn exe trực tiếp thì không có (chỉ ảnh hưởng thông báo update).
- `CODEX_HOME` env đổi thư mục home (đã kiểm: initialize trả `codexHome` mới).

## 9. Gotchas

- Không có field `"jsonrpc":"2.0"` trong message (gửi kèm chưa test; cứ bỏ).
- stderr có log tracing màu ANSI (vd `ERROR … Ignoring malformed agent role definition: agent role 'subagent' must define a description` — lỗi trong config thật của chủ nhân, cũng tới qua notif `configWarning`). Chỉ log, đừng coi là fail.
- CODEX_HOME trong `%TEMP%` → stderr `WARNING: … could not create PATH aliases … temporary dir` — vô hại.
- `account/read` thật mất ~900 ms (có thể gọi backend); `refreshToken:false` vẫn chậm lần đầu.
- `account/rateLimits/read` khi chưa login trả error (không phải null) → UI bắt lỗi -32600.
- `text_elements` trong UserInput text là snake_case, khác phần còn lại camelCase.
- Cancel login luôn bắn `account/login/completed success:false` → UI đừng hiện "login lỗi" khi do user tự huỷ.
- Server request (approval) phải trả lời, nếu không turn treo → dùng `approvalPolicy:"never"` + sandbox phù hợp.
- `remoteControl/status/changed` bắn lúc khởi động — bỏ qua.
- Có thể tắt notif không cần bằng `capabilities.optOutNotificationMethods`.
