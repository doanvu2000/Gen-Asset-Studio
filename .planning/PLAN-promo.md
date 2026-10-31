# PLAN — Giới thiệu sản phẩm cùng tác giả (2026-10-31)

## Sản phẩm
| App | Repo | Một dòng |
|---|---|---|
| Orrery (tên cũ Claude Code Monitor) | https://github.com/JLSoft-Together/Claude-Code-Monitor | Theo dõi realtime mọi phiên Claude Code / Codex, token, chi phí; có workspace terminal, editor, Git |
| AI Asset Studio | https://github.com/doanvu2000/AI-Asset-Studio | Tạo asset game từ mô tả: sprite, texture, tileset, 3D, Spine có xương; nối AI local, Claude Code, Codex, Unity, Godot, Blender |
| HyperFrames Studio | https://github.com/doanvu2000/hyper-frames | Làm video motion ngắn bằng AI, preview có tiếng, render MP4/WebM/MOV/GIF |

## Đã chốt vị trí (cả 4)
1. **Cài đặt › tab "Từ cùng tác giả"**: 3 thẻ (ảnh chụp, tên, 1 dòng, nút Xem trên GitHub).
2. **Gợi ý theo ngữ cảnh, mỗi gợi ý 1 lần, có ✕**:
   - Xuất xong: HyperFrames ("làm video giới thiệu game từ asset vừa xuất") + AI Asset Studio ("cần asset mới từ mô tả").
   - Tab Môi trường/Codex: Orrery ("theo dõi các phiên Codex/Claude đang chạy").
3. **Footer màn Workspace**: 1 dòng nhỏ "Từ cùng tác giả" → mở tab trên.
4. **Splash**: hàng logo nhỏ 3 app, mờ, không chặn.

## Quy tắc chống khó chịu
- Không popup/modal, không tự bật khi khởi động ngoài splash, không hiện khi đang gen.
- Mỗi gợi ý ngữ cảnh hiện tối đa 1 lần (lưu `promo.dismissed` trong settings).
- Công tắc "Hiện gợi ý app khác" (Cài đặt › Chung) tắt mục 2 + 3 + 4; tab giữ nguyên.
- Dữ liệu đóng gói sẵn, offline, không tracking; link mở trình duyệt ngoài.
- Text vi/en trong i18n.

## Sprite/Spine
- AI Asset Studio là app riêng, lớn → Gen Asset Studio **vẫn làm S3 (Sprite tạo mới)** theo `PLAN-sprite-spine.md`.

## Thứ tự
Lưu trữ → Promo → Sprite/Spine.
