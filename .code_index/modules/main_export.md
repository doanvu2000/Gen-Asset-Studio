# main/export — xuất asset ra thư mục game

## Symbol
- `src/main/export/index.ts::planExport` — dựng plan: mỗi asset → version chọn, targets theo scale, `exists`, hoặc skipped (`notGrouped`, `notApproved`, `noVersion`, `missingFile`, `sizeMismatch`).
- `src/main/export/index.ts::runExport` — ghi file (scale qua pipeline), backup file cũ, ghi `export-report.json`, emit `ExportProgress`.
- `src/main/export/index.ts::registerExportIpc` — `EXPORT_IPC` (`export:plan|run|cancel|pick-dir|open-path|save-dir|progress`), trả hàm dispose.
- `src/main/export/index.ts::exportRels` / `resolveOutDir` / `longPath` / `versionPath` / `reviewOf` — helper đường dẫn + đọc review.
- `src/shared/export.ts::normalizeExportOptions` / `scaledRel` / `backupStamp` / `DEFAULT_EXPORT_OPTIONS` / `BACKUP_DIR` / `REPORT_FILE`.
- Renderer: `screens/ExportStep.tsx::ExportStep` (Reskin); Sprite/Spine có export riêng (`sprite:export-run`, `spine:export-run`).

## Invariant
- Ảnh xuất: cùng tên, cùng kích thước, cùng cây thư mục với nguồn — chép đè vào game là chạy.
- `outDir` không nằm trong thư mục nguồn (`outInsideSource`), không phải file (`outIsFile`), phải có ít nhất 1 scale (`noScale`).
- Scale `1|2|4`; layout `folder` hoặc `suffix` (`scaledRel`).
- Xung đột: `backup` (chuyển file cũ vào `_backup`) hoặc `skip`. Mặc định chỉ xuất bản đã duyệt (`onlyApproved`).
- Một export chạy tại 1 thời điểm (`busy`); cancel được giữa chừng.
- Test: `scripts/export-test.ts` (`npm run test:export`), `scripts/format-test.ts`.
