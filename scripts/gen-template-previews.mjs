import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const sharp = require(path.join(root, "node_modules", "sharp"));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "1"]; }));
const ids = (args.ids ?? "candy-pop,jelly-cartoon,wood-gold-adventure,neon-arcade").split(",");
const extra = args.extra ?? "";
const model = args.model ?? "gpt-6-luna";
const effort = args.effort ?? "medium";
const tplDir = path.join(root, "resources", "style-templates");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gas-tpl-preview-"));
const logFile = path.join(workDir, "events.jsonl");
const ev = fs.createWriteStream(logFile);
const t0 = Date.now();
const log = (dir, obj) => ev.write(JSON.stringify({ t: Date.now() - t0, dir, ...obj }) + "\n");

const codexJs = path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
const proc = spawn(process.execPath, [codexJs, "app-server", "-c", 'windows.sandbox="unelevated"'], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
proc.stderr.on("data", d => log("stderr", { text: String(d) }));

let nextId = 0;
const pending = new Map();
const listeners = new Set();
let buf = "";
proc.stdout.on("data", d => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { log("badline", { line }); continue; }
    if (msg.method !== "item/completed" || msg.params?.item?.type !== "imageGeneration") log("in", { msg });
    if (msg.id != null && msg.method) {
      send({ jsonrpc: "2.0", id: msg.id, result: { decision: "decline" } });
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      continue;
    }
    if (msg.method) for (const l of listeners) l(msg);
  }
});

function send(obj) { log("out", { msg: obj }); proc.stdin.write(JSON.stringify(obj) + "\n"); }
function request(method, params) {
  const id = ++nextId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); send({ jsonrpc: "2.0", id, method, params }); });
}

function buildPrompt(tpl) {
  return [
    "Use your image generation tool to create ONE image: a game UI style preview sheet for a casual mobile game.",
    `Style: ${tpl.promptEn}`,
    `Key palette: ${tpl.palette.join(", ")}.`,
    "Landscape canvas, about 16:10. Plain flat light grey background #F2F2F7 filling the whole canvas, no scene, no frame, no gradient.",
    "Arrange these UI elements in a neat, evenly spaced grid with generous gaps, every element fully visible and not overlapping:",
    "row 1: a wide green confirm button, a wide blue button, a wide grey disabled button (dull grey, clearly inactive), a round close button with an X symbol;",
    "row 2: a tab pair side by side (one active highlighted tab and one inactive tab), a toggle switch in ON state (green) and the same toggle in OFF state (grey), three stars in a row (two filled gold, one empty);",
    "row 3: a small popup panel with a title ribbon banner across its top edge, a horizontal progress bar about 60 percent filled, a round gold coin icon.",
    "No text anywhere except the word OK on the green and blue buttons. Tabs, ribbon and panel stay empty without letters.",
    "All elements share one consistent style. Colors vivid and saturated, not pale or pastel.",
    extra,
    "Do not write any code or files yourself; just generate the image and reply with one short sentence."
  ].filter(Boolean).join(" ");
}

async function genOne(tpl) {
  const started = Date.now();
  const th = await request("thread/start", { cwd: workDir, sandbox: "workspace-write", approvalPolicy: "never", config: { windows: { sandbox: "unelevated" } }, model, ephemeral: false });
  const threadId = th.thread.id;
  const info = { id: tpl.id, threadId, image: null, failure: null, error: null, turnStatus: null };
  const done = new Promise(resolve => {
    const l = msg => {
      const p = msg.params ?? {};
      if (p.threadId !== threadId) return;
      if (msg.method === "item/completed" && p.item?.type === "imageGeneration") {
        if (p.item.status === "completed" && (p.item.savedPath || p.item.result)) info.image = { savedPath: p.item.savedPath ?? null, result: p.item.result ?? null };
        if (p.item.failure) info.failure = p.item.failure;
      }
      if (msg.method === "error") info.error = p;
      if (msg.method === "turn/completed") { listeners.delete(l); info.turnStatus = p.turn.status; if (p.turn.error) info.error = p.turn.error; resolve(); }
    };
    listeners.add(l);
  });
  await request("turn/start", { threadId, input: [{ type: "text", text: buildPrompt(tpl), text_elements: [] }], effort });
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error("turn timeout 300s")), 300000))]).catch(e => { info.error = String(e); });
  info.elapsedMs = Date.now() - started;
  return info;
}

async function saveImage(tpl, img) {
  const dir = path.join(tplDir, tpl.id);
  const bytes = img.savedPath && fs.existsSync(img.savedPath) ? fs.readFileSync(img.savedPath) : Buffer.from(img.result, "base64");
  const out = path.join(dir, "preview.png");
  await sharp(bytes).png().toFile(out);
  await sharp(bytes).resize({ width: 480, kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile(path.join(dir, "preview-sm.png"));
  const meta = await sharp(bytes).metadata();
  return { out, width: meta.width, height: meta.height };
}

const report = [];
try {
  await request("initialize", { clientInfo: { name: "gas_tpl_preview", title: "Gen Asset Studio template previews", version: "0.0.1" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  send({ jsonrpc: "2.0", method: "initialized" });
  for (const id of ids) {
    const tpl = JSON.parse(fs.readFileSync(path.join(tplDir, id, "template.json"), "utf8"));
    let res = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const info = await genOne(tpl);
      console.log(JSON.stringify({ id, attempt, threadId: info.threadId, ok: !!info.image, turnStatus: info.turnStatus, failure: info.failure, error: info.error, elapsedMs: info.elapsedMs }));
      if (info.image) { res = { id, attempt, threadId: info.threadId, ...(await saveImage(tpl, info.image)) }; break; }
      if (info.failure?.type === "usageLimitExceeded") break;
    }
    report.push(res ?? { id, failed: true });
  }
  console.log(JSON.stringify({ workDir, logFile, report }, null, 2));
} catch (e) {
  console.error("FAILED", e);
  process.exitCode = 1;
} finally {
  proc.stdin.end();
  proc.kill();
  ev.end(() => process.exit());
}
