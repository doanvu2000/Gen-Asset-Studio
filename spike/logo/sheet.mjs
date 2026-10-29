import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require(path.join(here, "..", "..", "node_modules", "sharp"));
const files = fs.readdirSync(path.join(here, "out")).filter(f => /^\d-.*\.png$/.test(f)).sort();
const C = 360, G = 24, W = files.length * (C + G) + G, H = C + 150;
const comps = [];
let x = G;
for (const f of files) {
  const p = path.join(here, "out", f);
  comps.push({ input: await sharp(p).resize(C, C, { fit: "contain", background: "#ffffff" }).png().toBuffer(), left: x, top: G });
  comps.push({ input: await sharp(p).resize(64, 64).png().toBuffer(), left: x, top: C + G + 16 });
  comps.push({ input: await sharp(p).resize(32, 32).png().toBuffer(), left: x + 80, top: C + G + 32 });
  const label = Buffer.from(`<svg width="${C}" height="40" xmlns="http://www.w3.org/2000/svg"><text x="0" y="28" font-family="Segoe UI" font-size="26" font-weight="700" fill="#111">${f.replace(".png", "")}</text></svg>`);
  comps.push({ input: label, left: x + 130, top: C + G + 28 });
  x += C + G;
}
await sharp({ create: { width: W, height: H, channels: 3, background: "#eef0f4" } }).composite(comps).png().toFile(path.join(here, "out", "sheet.png"));
console.log(path.join(here, "out", "sheet.png"));
