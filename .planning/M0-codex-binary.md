# M0 — Cài Codex CLI native (không cần Node/npm)

Nghiên cứu ngày 2026-10-29, bản stable mới nhất: **0.165.0** (tag `rust-v0.165.0`, 2026-10-27). Nguồn: `gh release view`, `install.ps1`/`install.sh` chính chủ của release, bản npm đang cài trên máy.

## 1. Nguồn tải chính thức

Mỗi release GitHub `openai/codex` có ~330 asset. Asset nên dùng là **package đầy đủ** (y hệt cách `install.ps1` chính chủ cài):

| Target | Asset | Size (0.165.0) |
|---|---|---|
| Windows x64 | `codex-package-x86_64-pc-windows-msvc.tar.gz` | 168 MB (giải nén ~465 MB) |
| Windows arm64 | `codex-package-aarch64-pc-windows-msvc.tar.gz` | 155 MB |
| macOS arm64 | `codex-package-aarch64-apple-darwin.tar.gz` | 137 MB |
| macOS x64 | `codex-package-x86_64-apple-darwin.tar.gz` | 148 MB |
| Checksum | `codex-package_SHA256SUMS` | 3 KB |

URL template (pin version `V`, vd `0.165.0`):

- Chính: `https://releases.openai.com/codex/releases/{V}/codex-package-{target}.tar.gz` (Cloudflare CDN, installer chính chủ ưu tiên nguồn này)
- Fallback: `https://github.com/openai/codex/releases/download/rust-v{V}/codex-package-{target}.tar.gz`
- Checksum: cùng 2 base trên, file `codex-package_SHA256SUMS` (dòng `<sha256>  <asset>`)
- Metadata: `https://releases.openai.com/codex/releases/{V}/release.json` hoặc `https://api.github.com/repos/openai/codex/releases/tags/rust-v{V}` — mỗi asset có field `digest: "sha256:..."`.

Không dùng:
- `codex-x86_64-pc-windows-msvc.exe(.zip|.tar.gz|.zst)` — chỉ có `codex.exe` lẻ, thiếu `codex-command-runner.exe`, `codex-windows-sandbox-setup.exe`, `rg.exe`, `codex-code-mode-host.exe`.
- Biến thể `-bazel` (bản build song song, không phải bản installer chọn).
- `codex-app-server-package-*` (133 MB, chỉ app-server) — chỉ cân nhắc nếu app **không** cần lệnh `codex` cho user và chỉ nói chuyện qua `app-server`. Mặc định dùng `codex-package-*`.
- `codex-npm-win32-x64-{V}.tgz` — layout cũ (legacy), installer chỉ dùng khi thiếu `codex-package-*`.

## 2. Layout package và file cần có

`codex-package.json` (giống hệt bản npm local đang cài):

```json
{"layoutVersion":1,"version":"0.165.0","target":"x86_64-pc-windows-msvc","variant":"codex",
 "entrypoint":"bin/codex.exe","resourcesDir":"codex-resources","pathDir":"codex-path"}
```

Giải nén **nguyên archive, giữ nguyên cấu trúc** (codex tự tìm file kèm theo đường dẫn tương đối với exe). File bắt buộc (`install.ps1` → `Test-PackageContentsAreComplete`):

```
codex-package.json
bin\codex.exe                                   (~341 MB)
bin\codex-code-mode-host.exe                    (~75 MB)
codex-path\rg.exe                               (ripgrep)
codex-resources\codex-command-runner.exe        (sandbox runner)
codex-resources\codex-windows-sandbox-setup.exe (setup sandbox elevated, gọi UAC)
codex-resources\voice\...                       (voice host + DLL GStreamer/opus + vcruntime140.dll riêng — chỉ phục vụ voice)
```

Kiểm tra local: chạy thẳng `vendor\x86_64-pc-windows-msvc\bin\codex.exe --version` → `codex-cli 0.165.0`; `codex.exe app-server --help` chạy OK, không cần Node. Shim npm (`bin/codex.js`) chỉ làm việc resolve `@openai/codex-win32-x64/vendor/<triple>/bin/codex.exe` rồi spawn kèm env `CODEX_MANAGED_BY_NPM=1` + `CODEX_MANAGED_PACKAGE_ROOT` (dùng để gợi ý lệnh update) — app **không** cần mô phỏng phần này.

## 3. Quy trình cài đề xuất (Windows)

Thư mục: `%LOCALAPPDATA%\GenAssetStudio\codex\releases\{V}-{target}\` (mỗi version 1 thư mục) + `current` (junction trỏ release đang dùng) + `%LOCALAPPDATA%\GenAssetStudio\bin` (junction → `current\bin`, hoặc copy shim). Đây là cách y hệt installer chính chủ (nó dùng `~/.codex/packages/standalone/releases/...` + junction `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`).

1. Xác định target: `process.arch` `x64` → `x86_64-pc-windows-msvc`, `arm64` → `aarch64-pc-windows-msvc` (chú ý Electron x64 chạy giả lập trên ARM → dùng `os.arch()` / `IsWow64Process2` hoặc env `PROCESSOR_ARCHITEW6432`).
2. Tải `codex-package_SHA256SUMS` → kiểm SHA-256 của nó với `digest` trong `release.json` (hoặc pin hash ngay trong app cho version đã pin).
3. Tải `.tar.gz` (stream, hiện progress, resume nếu cần) từ releases.openai.com, lỗi → fallback GitHub.
4. Kiểm SHA-256 archive khớp dòng trong SHA256SUMS. Sai → xoá, báo lỗi, không cài.
5. Giải nén vào `.staging.{V}.{pid}` (dùng `tar` npm package trong Electron, hoặc `tar.exe` có sẵn từ Win10 1803) → kiểm đủ 6 file bắt buộc → rename sang `releases\{V}-{target}`.
6. Verify: `bin\codex.exe --version` phải in đúng `codex-cli {V}`.
7. Trỏ junction `current` → release mới (atomic, rollback được). Giữ 1 bản cũ để rollback rồi dọn.
8. PATH: app **tự gọi bằng đường dẫn tuyệt đối**, không phụ thuộc PATH. Chỉ thêm `%LOCALAPPDATA%\GenAssetStudio\bin` vào User PATH khi user muốn dùng `codex` ở terminal: đọc/ghi `HKCU\Environment\Path` (giữ kiểu `REG_EXPAND_SZ`, không qua `setx` vì cắt 1024 ký tự) rồi broadcast `WM_SETTINGCHANGE`. Không đụng PATH hệ thống, không cần admin.
9. Có sẵn codex khác trên PATH (npm, `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, winget) → chỉ cảnh báo, không gỡ; app vẫn dùng bản riêng của mình.

macOS: cùng asset pattern, `bin/codex` + `bin/codex-code-mode-host`; sau giải nén `chmod +x`, gỡ quarantine (`xattr -dr com.apple.quarantine`) nếu tải bằng app chưa notarize. Bản Mac có `.dmg` riêng nhưng không cần.

## 4. Installer chính chủ & winget (tham khảo / fallback)

- Windows: `irm https://chatgpt.com/codex/install.ps1 | iex` (chuỗi có trong `codex.exe`; script có chữ ký Authenticode). Env: `CODEX_RELEASE=0.165.0` pin version, `CODEX_NON_INTERACTIVE=1`, `CODEX_INSTALL_DIR` đổi thư mục bin, `CODEX_HOME`. Script tự thêm User PATH, có thể hỏi gỡ bản npm.
- macOS/Linux: `install.sh` (cùng release).
- winget: `OpenAI.Codex` có, nhưng đang **0.161.0** (chậm hơn GitHub) → không dùng làm kênh chính.
- Lựa chọn thay thế rẻ: app chạy `install.ps1` với `CODEX_RELEASE` + `CODEX_NON_INTERACTIVE=1` + `CODEX_INSTALL_DIR`. Nhược: phụ thuộc PowerShell/ExecutionPolicy, khó hiện progress, ghi vào `~/.codex/packages`. Khuyến nghị tự cài như mục 3.

## 5. Phụ thuộc runtime trên Windows

- **Không cần VC++ Redistributable**: `codex.exe` link CRT tĩnh (không import `vcruntime140`/`api-ms-win-crt`); riêng `voice` mang `vcruntime140.dll` của nó.
- Cần Windows 10/11 **64-bit** (installer từ chối 32-bit).
- Shell: codex chạy lệnh qua PowerShell (máy này dùng `pwsh.exe` 7); Windows PowerShell 5.1 có sẵn là đủ. Cần console hỗ trợ ConPTY (Win10 1809+).
- Git: không bắt buộc để chạy; chỉ cần cho tính năng diff/apply/review. Với workflow gen asset có thể bỏ qua (`--skip-git-repo-check`).
- Đăng nhập: `codex login` (ChatGPT account) — auth lưu ở `~/.codex` (`CODEX_HOME`), dùng chung với codex khác trên máy.

## 6. Windows sandbox

Config `~/.codex/config.toml`:

```toml
[windows]
sandbox = "elevated"   # "elevated" | "unelevated" | "mxc"
```

hoặc per-call `-c 'windows.sandbox="unelevated"'`.

| Mode | Yêu cầu | Ghi chú |
|---|---|---|
| `elevated` | **1 lần UAC/admin** chạy `codex-windows-sandbox-setup.exe` → tạo user sandbox riêng + rule firewall | Cách ly mạng mạnh nhất. Máy công ty chặn admin → fail. Gỡ: `codex sandbox uninstall` |
| `unelevated` | Không cần admin | Chỉ ACL filesystem, cách ly mạng yếu hơn, không hỗ trợ denied-read paths. Đây là mode chủ nhân đang dùng cho Codex image gen |
| `mxc` | Windows 11 build ≥ 26100.9278, không cần admin | Docs mới khuyến nghị; kiểm: `codex -c windows.sandbox=mxc sandbox --include-managed-config` |

Đề xuất cho designer: mặc định truyền `windows.sandbox="unelevated"` từ app (không bật UAC, không cần admin), cho phép đổi sang `mxc` nếu Win11 đủ build. Không ép `elevated`. App không nên sửa `config.toml` global của user mà truyền `-c` theo từng lần gọi.

## 7. Kiểm tra cập nhật

- Codex tự check `https://api.github.com/repos/openai/codex/releases/latest`, cache vào `~/.codex/version.json` (`{"latest_version":"0.165.0","last_checked_at":...,"dismissed_version":null}`), tắt bằng config `check_for_update_on_startup = false`. Lệnh `codex update` tự update theo kênh cài (npm/bun/brew/installer) — **app không nên gọi** vì bản của app là kênh "manual/unknown".
- App tự check: `GET https://releases.openai.com/codex/channels/latest` (JSON có `tag_name` = `rust-v0.165.0` + `assets[].digest`), fallback `api.github.com/.../releases/latest` (rate limit 60 req/h/IP khi không token). Bỏ tag `-alpha`/`-beta` (GitHub `latest` đã loại prerelease). Có bản mới → hiện "Cập nhật lên X" → chạy lại quy trình mục 3 với V mới → đổi junction. Nên giữ allowlist version đã test với app (pin), bản mới hơn chỉ "gợi ý".

## 8. Rủi ro

- **Dung lượng lớn**: tải 168 MB, chiếm ~465 MB/version (codex.exe 341 MB) → cần progress, resume, dọn bản cũ, kiểm ổ đĩa trống ≥ 1 GB.
- **Release rất dày** (nhiều alpha/ngày, stable vài ngày/lần) và CLI/app-server protocol đổi nhanh (`app-server` vẫn `[experimental]`) → bắt buộc pin version + test trước khi bump.
- Layout package có `layoutVersion` — đọc `codex-package.json`, nếu `layoutVersion != 1` hoặc thiếu file bắt buộc thì từ chối và giữ bản cũ.
- Antivirus/SmartScreen có thể chặn/quarantine exe vừa giải nén (exe đã ký bởi OpenAI nhưng file tải bằng app vẫn có Mark-of-the-Web nếu không xử lý) → verify sau giải nén, báo lỗi rõ.
- Đang chạy `codex.exe` (app-server) thì không ghi đè được → luôn cài vào thư mục version mới rồi đổi junction, dừng tiến trình cũ trước khi dọn.
- Xung đột PATH với bản npm/winget/installer chính chủ → app luôn dùng đường dẫn tuyệt đối.
- releases.openai.com hoặc GitHub có thể bị chặn ở mạng công ty/VN → có 2 nguồn fallback; cân nhắc mirror riêng (vẫn kiểm SHA-256 từ nguồn chính chủ).
- Sandbox `elevated` cần admin; `mxc` cần Win11 mới — designer máy công ty nên dùng `unelevated`.
- Auth/config dùng chung `~/.codex` với codex khác của user; muốn tách thì set `CODEX_HOME` riêng cho tiến trình của app (đánh đổi: phải login lại).
