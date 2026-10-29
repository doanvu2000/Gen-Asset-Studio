import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);
const sharp = require(path.join(root, "node_modules", "sharp"));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "1"]; }));
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });
const person = path.join(root, "src", "jinvu.jpg");
const knot = path.join(root, "src", "GPT.png");

const BASE = [
  "Use your image generation tool to create ONE square app icon image, 1024x1024.",
  "Reference image 1 is a photo of a young Vietnamese man (Jin Vu): short wavy dark-brown hair with a side part, friendly confident smile, white t-shirt, silver smartwatch with a green strap.",
  "Reference image 2 is a hexagonal interlocking knot symbol made of six rounded ribbon loops (the AI assistant symbol).",
  "Concept: Jin Vu shaking hands with the AI knot symbol, a friendly human + AI partnership for a desktop app that restyles 2D game assets.",
  "Keep the man recognisable from the photo (hair, face shape, smile) but stylised. The knot keeps its six interlocking loops silhouette.",
  "Composition centered with comfortable margin, readable at 32x32, no text, no letters, no watermark."
].join(" ");

const CONCEPTS = [
  { id: "1-chibi-flat", text: "Style: cute chibi flat vector illustration, bold clean outlines, Jin Vu as a chibi character on the left reaching out to shake a small hand that grows out of a black-and-white knot character on the right (the knot has a tiny smiling face). Rounded-square app icon with a vivid blue (#0A84FF to #5E5CE6) gradient background." },
  { id: "2-hands-minimal", text: "Style: minimal geometric flat icon. Only two hands in a handshake fill the icon: the left is a human hand and wrist wearing the silver smartwatch with green strap, the right hand is built from the knot's white ribbon loops with black outline. A small knot emblem sits above the handshake. Rounded-square icon, vivid blue gradient background, crisp vector shapes." },
  { id: "3-3d-clay", text: "Style: glossy 3D claymation / Pixar-like render, soft studio lighting. Chibi Jin Vu (white tee, green-strap watch) happily shaking hands with a friendly 3D glossy knot mascot that has short arms. Rounded-square app icon with a saturated blue-violet gradient background and a subtle sparkle." },
  { id: "4-badge-line", text: "Style: modern monoline badge emblem, thick even strokes, two colors only: white lines on a deep blue (#0A84FF) circle. Inside: Jin Vu's head and shoulders in simple line art on the left, the knot symbol on the right, and their hands meeting in a handshake at the bottom center, the knot ribbon flowing into the handshake." },
  { id: "5-anime-sticker", text: "Style: vibrant anime sticker art with thick white sticker border, saturated colors. Half-body Jin Vu smiling and winking, firmly shaking hands with the knot symbol drawn as a sleek glowing black-and-white object with a single arm, small sparkles around. Transparent-looking plain light background behind the sticker, rounded composition." }
];

const ids = args.ids ? args.ids.split(",") : CONCEPTS.map(c => c.id);
const model = args.model ?? "gpt-6-luna";
const effort = args.effort ?? "medium";
const codexJs = path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
const proc = spawn(process.execPath, [codexJs, "app-server", "-c", 'windows.sandbox="unelevated"'], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

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
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && msg.method) { send({ jsonrpc: "2.0", id: msg.id, result: { decision: "decline" } }); continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      continue;
    }
    if (msg.method) for (const l of listeners) l(msg);
  }
});
function send(obj) { proc.stdin.write(JSON.stringify(obj) + "\n"); }
function request(method, params) {
  const id = ++nextId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); send({ jsonrpc: "2.0", id, method, params }); });
}

async function genOne(c) {
  const started = Date.now();
  const th = await request("thread/start", { cwd: outDir, sandbox: "workspace-write", approvalPolicy: "never", config: { windows: { sandbox: "unelevated" } }, model, ephemeral: false });
  const threadId = th.thread.id;
  const info = { id: c.id, image: null, failure: null, error: null };
  const done = new Promise(resolve => {
    const l = msg => {
      const p = msg.params ?? {};
      if (p.threadId !== threadId) return;
      if (msg.method === "item/completed" && p.item?.type === "imageGeneration") {
        if (p.item.status === "completed" && (p.item.savedPath || p.item.result)) info.image = { savedPath: p.item.savedPath ?? null, result: p.item.result ?? null };
        if (p.item.failure) info.failure = p.item.failure;
      }
      if (msg.method === "error") info.error = p;
      if (msg.method === "turn/completed") { listeners.delete(l); if (p.turn.error) info.error = p.turn.error; resolve(); }
    };
    listeners.add(l);
  });
  const text = `${BASE} ${c.text} Do not write any code or files yourself; just generate the image and reply with one short sentence.`;
  await request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }, { type: "localImage", path: person }, { type: "localImage", path: knot }], effort });
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error("turn timeout 300s")), 300000))]).catch(e => { info.error = String(e); });
  info.elapsedMs = Date.now() - started;
  if (info.image) {
    const bytes = info.image.savedPath && fs.existsSync(info.image.savedPath) ? fs.readFileSync(info.image.savedPath) : Buffer.from(info.image.result, "base64");
    await sharp(bytes).png().toFile(path.join(outDir, `${c.id}.png`));
  }
  return info;
}

try {
  await request("initialize", { clientInfo: { name: "gas_logo", title: "Gen Asset Studio logo concepts", version: "0.0.1" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  send({ jsonrpc: "2.0", method: "initialized" });
  const jobs = [];
  for (const c of CONCEPTS.filter(x => ids.includes(x.id))) {
    jobs.push(genOne(c).then(r => { console.log(JSON.stringify({ id: r.id, ok: !!r.image, failure: r.failure, error: r.error, sec: Math.round(r.elapsedMs / 1000) })); return r; }));
    await new Promise(r => setTimeout(r, 3000));
  }
  await Promise.all(jobs);
} catch (e) {
  console.error("FAILED", e);
  process.exitCode = 1;
} finally {
  proc.stdin.end();
  proc.kill();
  setTimeout(() => process.exit(), 300);
}
