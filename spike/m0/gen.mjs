import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "1"]; }));
const parallel = Number(args.parallel ?? 1);
const model = args.model ?? null;
const effort = args.effort ?? null;
const tag = args.tag ?? "run";
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const inDir = path.join(here, "in");
const outDir = path.join(here, "out");
const workDir = path.join(here, "work");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });
const eventsFile = path.join(outDir, `events-${tag}-${ts}.jsonl`);
const ev = fs.createWriteStream(eventsFile);
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
    log("in", { msg });
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
proc.on("exit", c => log("exit", { code: c }));

function send(obj) { log("out", { msg: obj }); proc.stdin.write(JSON.stringify(obj) + "\n"); }
function request(method, params) {
  const id = ++nextId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); send({ jsonrpc: "2.0", id, method, params }); });
}

function summarizeLimits(r) {
  const s = r?.rateLimits;
  return { primary: s?.primary?.usedPercent, primaryWindow: s?.primary?.windowDurationMins, secondary: s?.secondary?.usedPercent, secondaryWindow: s?.secondary?.windowDurationMins, reached: s?.rateLimitReachedType ?? null };
}

const prompt = [
  "You are reskinning a 2D mobile game UI asset.",
  "Attached image 1 is the source asset: a rounded green button (256x96, transparent background).",
  "Attached image 2 is the style reference: candy pink/purple glossy UI style.",
  "Use your image generation tool to create ONE new image: the same button shape and role, redrawn in the style of image 2 (saturated candy pink/purple, glossy highlight, dark outline).",
  "Keep the same aspect ratio as image 1 (wide button, about 8:3), centered, filling most of the canvas.",
  "Place it on a solid flat magenta #FF00FF background (no gradient, no shadow on the background, no text, no extra elements).",
  "Do not write any code or files yourself; just generate the image and reply with one short sentence."
].join(" ");

async function runThread(idx) {
  const started = Date.now();
  const tparams = { cwd: workDir, sandbox: "workspace-write", approvalPolicy: "never", config: { windows: { sandbox: "unelevated" } }, ephemeral: false };
  if (model) tparams.model = model;
  const th = await request("thread/start", tparams);
  const threadId = th.thread.id;
  const info = { idx, threadId, model: th.model, effort: effort ?? th.reasoningEffort, images: [], items: [], agentText: "", error: null };
  const done = new Promise(resolve => {
    const l = msg => {
      const p = msg.params ?? {};
      if (p.threadId !== threadId) return;
      if (msg.method === "item/started" && p.item?.type === "imageGeneration") info.imgStartedMs = Date.now() - started;
      if (msg.method === "item/completed") {
        info.items.push(p.item.type);
        if (p.item.type === "imageGeneration") info.images.push({ id: p.item.id, status: p.item.status, savedPath: p.item.savedPath ?? null, hasResult: typeof p.item.result === "string", resultLen: p.item.result?.length ?? 0, fileId: p.item.fileId ?? null, failure: p.item.failure, revisedPrompt: p.item.revisedPrompt, inputImages: p.item.inputImages, completedMs: Date.now() - started, result: p.item.result });
        if (p.item.type === "agentMessage") info.agentText += p.item.text;
      }
      if (msg.method === "error") info.error = p;
      if (msg.method === "turn/completed") { listeners.delete(l); info.turnStatus = p.turn.status; info.turnError = p.turn.error; resolve(); }
    };
    listeners.add(l);
  });
  const tp = {
    threadId,
    input: [
      { type: "text", text: prompt, text_elements: [] },
      { type: "localImage", path: path.join(inDir, "btn_green.png") },
      { type: "localImage", path: path.join(inDir, "style_ref.png") }
    ]
  };
  if (effort) tp.effort = effort;
  const turn = await request("turn/start", tp);
  info.turnId = turn.turn.id;
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error("turn timeout 600s")), 600000))]).catch(e => { info.error = String(e); });
  info.elapsedMs = Date.now() - started;
  const genDir = path.join(os.homedir(), ".codex", "generated_images", threadId);
  info.genDir = genDir;
  info.genDirFiles = fs.existsSync(genDir) ? fs.readdirSync(genDir) : null;
  info.copied = [];
  for (const [k, img] of info.images.entries()) {
    const dst = path.join(outDir, `${tag}-${ts}-t${idx}-${threadId.slice(-8)}-${k}.png`);
    if (img.savedPath && fs.existsSync(img.savedPath)) fs.copyFileSync(img.savedPath, dst);
    else if (img.result) fs.writeFileSync(dst, Buffer.from(img.result, "base64"));
    else continue;
    info.copied.push(dst);
    img.savedPathUnderThreadDir = img.savedPath ? path.resolve(path.dirname(img.savedPath)) === path.resolve(genDir) : null;
    delete img.result;
  }
  for (const img of info.images) delete img.result;
  return info;
}

try {
  const init = await request("initialize", { clientInfo: { name: "gas_m0", title: "Gen Asset Studio M0", version: "0.0.1" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  send({ jsonrpc: "2.0", method: "initialized" });
  const before = await request("account/rateLimits/read", {});
  const results = await Promise.all(Array.from({ length: parallel }, (_, i) => runThread(i)));
  await new Promise(r => setTimeout(r, 3000));
  const after = await request("account/rateLimits/read", {});
  const summary = { tag, ts, parallel, model, effort, codexHome: init.codexHome, before: summarizeLimits(before), after: summarizeLimits(after), totalMs: Date.now() - t0, results, eventsFile };
  fs.writeFileSync(path.join(outDir, `summary-${tag}-${ts}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (e) {
  console.error("FAILED", e);
  process.exitCode = 1;
} finally {
  proc.stdin.end();
  proc.kill();
  ev.end(() => process.exit());
}
