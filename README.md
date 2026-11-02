# Gen Asset Studio

[![CI](https://github.com/doanvu2000/Gen-Asset-Studio/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/doanvu2000/Gen-Asset-Studio/actions/workflows/ci.yml)

App Windows giúp đổi style **cả bộ asset 2D** cho game chỉ trong vài bước, dùng AI vẽ ảnh của Codex (ChatGPT).

Có 3 loại project, chọn khi tạo:

| Loại | Dành cho | Vào | Ra |
|---|---|---|---|
| **Reskin ảnh** | BA, không cần vẽ | Folder ảnh UI (nút, icon, popup, thanh máu…) PNG/JPG/WebP | Ảnh cùng tên, cùng kích thước, cùng cây thư mục — chép đè vào game là dùng được |
| **Sprite sheet** | Artist, animation | Sheet PNG + TexturePacker/Aseprite JSON, Cocos `.plist`, Unity `.png.meta` (không có thì tự dò lưới) — hoặc **1 ảnh nhân vật** để tạo sheet mới | Sheet cùng rect, file atlas dùng lại; sheet tạo mới kèm TexturePacker JSON (tuỳ chọn thêm Godot `.tres`, Unity `.png.meta`, Cocos `.plist`) + code mẫu; GIF/WebP động để gửi duyệt |
| **Spine** | Artist, Spine 4.2 | Skeleton `.json` hoặc `.skel` 4.2 + `.atlas` + ảnh page | Page PNG đúng toạ độ region, `.atlas` giữ nguyên, skeleton mới nếu có chỉnh vị trí; thêm skin biến thể giữ nguyên rig |

![Phiên bản](https://img.shields.io/github/v/release/doanvu2000/Gen-Asset-Studio)

## Cần có

- Windows 10/11 64-bit
- Tài khoản **ChatGPT Plus trở lên** (gói Free không gen ảnh được)
- Kết nối Internet

Không cần cài Node, Python hay công cụ nào khác — app tự lo.

## Tải về

Vào [Releases](https://github.com/doanvu2000/Gen-Asset-Studio/releases/latest), chọn 1 trong 2:

| File | Dùng khi | Cập nhật |
|---|---|---|
| `GenAssetStudio-Setup-<phiên bản>.exe` | Cài vào máy (khuyên dùng) | App tự báo bản mới, hỏi trước khi tải |
| `GenAssetStudio-Portable-<phiên bản>.exe` | Chạy luôn không cần cài, để trong USB / máy không có quyền cài | Không tự cập nhật — tải bản mới ở Releases |

Nếu Windows hiện "Windows protected your PC" → bấm **More info → Run anyway** (app chưa ký số).

Lần đầu mở app, màn **Chuẩn bị môi trường** tự chạy:
- App tự tải Codex (~160 MB).
- Bấm **Đăng nhập bằng ChatGPT** → đăng nhập trên trình duyệt → quay lại app.
- Chọn một folder làm **workspace** (nơi chứa các project).
- Nếu Windows hỏi quyền Administrator thì bấm **Yes**.

## Sử dụng

Mỗi bước trong project đều có dòng hướng dẫn ở đầu màn hình. Mở lại project thì app tự nhảy tới bước chưa xong.

### Reskin ảnh (5 bước)

| Bước | Làm gì |
|---|---|
| 1. Ảnh gốc | Tạo project → **Mở folder** / **Thêm ảnh** hoặc kéo thả. Ưu tiên **PNG** (giữ nền trong suốt); JPG, WebP, AVIF, TIFF vẫn dùng được |
| 2. Style | Chọn ảnh cho nhóm, rồi tạo style theo 1 trong 3 cách: **Tự tạo** (viết mô tả và/hoặc thêm ảnh tham chiếu → **Vẽ preview** hoặc **Chốt luôn theo mô tả**), **Mẫu có sẵn**, **AI gợi ý** vài hướng để so sánh. Chọn 1 thẻ → **Chốt style này**. Chốt xong mọi nhóm thì app tự sang bước Gen |
| 3. Gen | Bấm **Bắt đầu gen**. Mỗi ảnh khoảng 30 giây; hết quota app tự dừng và tự chạy tiếp khi quota hồi |
| 4. Duyệt | Xem gốc / mới cạnh nhau. Ảnh đẹp → **Duyệt** (phím A, tự sang ảnh tiếp). Chưa ưng → ghi chú rồi **Regen** (phím R). Duyệt xong ảnh cuối → **Tiếp: Xuất** |
| 5. Xuất | Chọn folder xuất (mặc định `output` trong project), tuỳ chọn thêm bản ×2 / ×4 → **Xuất**. Ảnh giữ đúng định dạng gốc |

Lần đầu dùng: bấm **Tạo project mẫu** ở workspace để thử cả luồng với 14 ảnh có sẵn. Xem lại hướng dẫn: **Cài đặt › Chung › Xem lại hướng dẫn**.

### Sprite sheet (4 bước)

| Bước | Làm gì |
|---|---|
| 1. Nhập | Kéo thả sheet + file atlas, hoặc **Tạo sheet mới** từ 1 ảnh nhân vật (chọn 4/6/8 hướng, góc nhìn, cỡ ô, animation idle/walk/run/attack…). Kiểm lưới, đặt tên animation, hướng, FPS; xem anim chạy thử, **Đi thử** bằng phím mũi tên/WASD |
| 2. Style | 1 style cho cả nhân vật: mẫu nhân vật có sẵn (Chibi, Pixel Art, Vẽ tay Fantasy, Anime cel) hoặc tự mô tả + ảnh tham chiếu |
| 3. Gen & duyệt | Gen dải hướng đầu tiên làm **ảnh khoá nhân vật** → duyệt → app tự gen các dải còn lại theo ảnh khoá. Hướng phải lật gương từ hướng trái, không tốn lượt. Xem Gốc / Mới chạy đồng bộ, QA tự báo lệch chân, chênh chiều cao, bị cắt, thiếu/trùng frame; **Lưới tổng** xem mọi hướng cùng lúc |
| 4. Xuất | Sheet cùng tên, cùng W×H, đè đúng rect (cả frame xoay/trim); frame chưa duyệt giữ gốc. Sheet tạo mới: tick thêm Godot / Unity / Cocos. Mục **Ảnh động xem trước** xuất GIF/WebP mỗi dải |

### Spine (4 bước)

| Bước | Làm gì |
|---|---|
| 1. Nhập | Kéo thả skeleton `.json`/`.skel` (Spine 4.2) — app tự tìm `.atlas` và ảnh page cạnh nó. Xem nhân vật chạy animation ngay trong app |
| 2. Style | Như Sprite sheet |
| 3. Gen & duyệt | Gen từng region (đầu, tay, áo…) theo style chung, giữ đúng kích thước region. Duyệt với nhân vật mới chạy animation; panel **Chỉnh vị trí** sửa setup pose (vị trí, xoay, scale) nếu phần mới lệch |
| 4. Xuất | Page PNG cùng tên, cùng W×H, region đúng toạ độ (kể cả xoay, premultiplied alpha); có chỉnh vị trí thì ghi skeleton mới kèm bản gốc `.original.json`/`.original.skel` |

**Skin biến thể**: ở bước Style/Gen chọn **Skin › Thêm skin** (vd `red_armor`) → chọn style riêng → gen, duyệt như bình thường. Rig dùng chung. Ở bước Xuất tick skin muốn xuất: app ghi thêm page `<page>-<skin>.png`, atlas gộp và skeleton có skin mới (`.json` hoặc `.skel`), file gốc không đổi.

Sửa file Spine bên ngoài app (trong Spine Editor) thì app báo **File nguồn đã đổi** — nhập lại rồi làm tiếp. Sprite cũng vậy: sửa sheet nguồn thì app đánh dấu dải bị ảnh hưởng và có nút **Gen lại các dải bị ảnh hưởng**.

### Duyệt nhanh

- **Việc cần làm** (thanh bên): mọi mục chờ duyệt, QA lỗi, chưa xuất, job lỗi của tất cả project — bấm **Mở** là tới đúng chỗ.
- Thanh duyệt giống nhau ở cả 3 loại project. Phím: **A** duyệt · **X** cần sửa · **R** gen lại/ghi chú · **←/→** mục trước/sau · **1–9** chọn phiên bản (Sprite/Spine) · **C** so sánh A/B · **?** xem mọi phím.
- **Xem lướt chưa duyệt**: đi lần lượt qua các mục chưa quyết định. **Duyệt tất cả bản QA đạt** khi đã tin QA.
- **Đổi màu**: chỉnh sắc độ / bão hoà / độ sáng hoặc chỉ một dải màu, lưu thành phiên bản mới — không tốn lượt Codex.
- **Thư viện style của team**: **Lưu vào thư viện** ở bước Style, dùng lại ở project khác; xuất/nhập file `.gasstyle` để gửi cho người khác.

### Mẹo

- Ảnh chưa vào nhóm style hoặc chưa được duyệt sẽ **không** được xuất.
- Xuất đè lên file cũ thì bản cũ được cất vào `output/_backup/<thời gian>/`.
- Nút, khung popup, thanh kéo dài được nên bật **9-slice** để góc không bị méo.
- **Chốt luôn theo mô tả** nhanh hơn nhưng không có ảnh khoá style, các ảnh có thể lệch nhau hơn một chút — muốn đồng đều thì vẽ preview rồi chốt.
- Trước khi gen hàng loạt app ước tính số lượt Codex và quota còn lại. Gen xong lúc đang làm việc khác thì có thông báo Windows (tắt ở **Cài đặt › Chung**). **Cài đặt › Thống kê** xem lượt dùng và tỉ lệ QA đạt.
- Đóng app khi đang gen: app thu xuống taskbar và chạy tiếp; đóng lần nữa sẽ hỏi có thoát hẳn không (đổi ở **Cài đặt › Chung**).
- JPG không có nền trong suốt — khi xuất ra JPG, phần trong suốt thành nền trắng.
- Gặp lỗi → bấm **Gửi lỗi cho Codex sửa** hoặc **Xuất log** gửi cho người phụ trách.

## Câu hỏi thường gặp

**Tốn quota nhiều không?** Mỗi ảnh khoảng 0,2% quota 5 giờ của gói Plus. Quota hiện ở **Cài đặt › Tài khoản**.

**Dữ liệu lưu ở đâu?** Ảnh gốc không bị đụng tới. Project lưu trong workspace bạn chọn. Codex ở `%LOCALAPPDATA%\GenAssetStudio`, cài đặt app ở `%APPDATA%\Gen Asset Studio` (bản cài và bản portable dùng chung). Chỗ lưu Codex + ảnh gen đổi được ở **Cài đặt › Lưu trữ**.

**Ổ C sắp đầy?** Vào **Cài đặt › Lưu trữ**: xem dung lượng từng phần, bấm **Dọn dẹp**, hoặc **Chuyển sang ổ khác** để dời Codex và ảnh gen sang ổ D/E… App tự chép rồi khởi động lại, không phải đăng nhập lại. Tự dọn dẹp đã bật sẵn.

**Đổi tài khoản ChatGPT?** **Cài đặt › Tài khoản › Đổi tài khoản**.

**Ảnh nào cũng lỗi "turn completed without an image"?** Thường do tài khoản ChatGPT **Free** — gói Free không gen ảnh được. App tự dừng hàng đợi sau 3 ảnh lỗi liên tiếp. Đổi sang tài khoản Plus trở lên rồi bấm **Thử lại N ảnh lỗi** ở bước Gen.

**Cài bản mới báo "Gen Asset Studio cannot be closed"?** App vẫn đang chạy ngầm (đang gen thì đóng app chỉ thu xuống taskbar). Thoát hẳn app hoặc End task `Gen Asset Studio.exe` trong Task Manager rồi bấm **Retry**. Cập nhật bằng nút trong app thì không gặp lỗi này.

**Spine bản cũ (3.x, 4.0, 4.1)?** Chưa hỗ trợ — mở bằng Spine 4.2 rồi xuất lại. Atlas xoay region 180°/270° cũng chưa nhận, xuất lại với rotation 90° hoặc tắt rotation.

**Giấy phép Spine?** Khung xem trước Spine dùng [spine-player](https://esotericsoftware.com/spine-player) theo Spine Runtimes License: người dùng project Spine cần có license Spine Editor.

## Thay đổi qua các phiên bản

Xem [CHANGELOG.md](CHANGELOG.md).

## Dành cho dev

```bash
npm install
npm run dev            # chạy thử
npm run build          # kiểm kiểu + build
npm run dist:win       # file cài NSIS vào release/<phiên bản>/
npm run dist:portable  # bản portable vào release/<phiên bản>/
npm test               # chạy mọi bộ test (CI chạy lệnh này + typecheck mỗi lần push)
npm run test:spine     # chạy riêng 1 bộ: test:<format|export|sprite|sprite-gen|spine|recolor|stats|todo…>
npm run test:e2e       # E2E Playwright trên app đã build (không gọi Codex)
npm run perf:bench     # đo tốc độ quét/mở project lớn
```

Phát hành bản mới: `npm test` + `npm run typecheck` sạch → tăng `version` trong `package.json` → thêm mục mới vào `CHANGELOG.md` (Update · Add · Remove · Fixbug) → `npm run dist:win` + `npm run dist:portable` → tạo GitHub Release `v<phiên bản>` kèm `GenAssetStudio-Setup-*.exe`, `.blockmap`, `latest.yml`, `GenAssetStudio-Portable-*.exe`, dán mục changelog làm ghi chú (`node scripts/release-notes.mjs <phiên bản>`).

Tài liệu thiết kế: `.planning/`.

© Jin Vũ. All rights reserved.
