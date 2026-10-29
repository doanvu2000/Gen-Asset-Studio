import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const args = process.argv.slice(2);
const isolated = args.includes("--isolated");
const viaShim = args.includes("--shim");
const outFile = (() => {
  const i = args.indexOf("--out");
  return i >= 0 ? args[i + 1] : null;
})();

const npmRoot = path.join(process.env.APPDATA || "", "npm");
const pkgRoot = path.join(npmRoot, "node_modules", "@openai", "codex");
const nativeExe = path.join(pkgRoot, "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
const codexJs = path.join(pkgRoot, "bin", "codex.js");

const env = { ...process.env };
let codexHome = null;
if (isolated) {
  codexHome = path.join(os.tmpdir(), "codex-home-probe");
  mkdirSync(codexHome, { recursive: true });
  env.CODEX_HOME = codexHome;
}

let child;
if (viaShim) {
  child = spawn("codex", ["app-server"], { env, shell: true, stdio: ["pipe", "pipe", "pipe"] });
} else if (existsSync(nativeExe)) {
  child = spawn(nativeExe, ["app-server"], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
} else {
  child = spawn(process.execPath, [codexJs, "app-server"], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
}

const results = { spawn: viaShim ? "shim(shell:true)" : existsSync(nativeExe) ? nativeExe : codexJs, codexHome: codexHome || "(default)", calls: {}, notifications: [], stderr: "" };
const pending = new Map();
let nextId = 1;

child.stderr.on("data", (d) => { results.stderr += d.toString(); });
const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { results.notifications.push({ raw: line }); return; }
  if (msg.id !== undefined && pending.has(msg.id) && (msg.result !== undefined || msg.error !== undefined)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    p(msg);
  } else if (msg.method && msg.id !== undefined) {
    results.notifications.push({ serverRequest: msg });
  } else if (msg.method) {
    results.notifications.push({ method: msg.method, params: msg.params });
  }
});

function request(method, params, timeoutMs = 20000) {
  const id = nextId++;
  const payload = params === undefined ? { id, method } : { id, method, params };
  child.stdin.write(JSON.stringify(payload) + "\n");
  return new Promise((resolve) => {
    const t = setTimeout(() => { pending.delete(id); resolve({ timeout: true }); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); resolve(m.error ? { error: m.error } : { result: m.result }); });
  });
}

function notify(method, params) {
  const payload = params === undefined ? { method } : { method, params };
  child.stdin.write(JSON.stringify(payload) + "\n");
}

async function call(label, method, params, timeoutMs) {
  const t0 = Date.now();
  const r = await request(method, params, timeoutMs);
  results.calls[label] = { method, params: params ?? null, ms: Date.now() - t0, ...r };
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listeningPorts(pid) {
  try {
    const out = execSync("netstat -ano -p TCP", { encoding: "utf8" });
    return out.split(/\r?\n/).filter((l) => /LISTENING/.test(l) && l.trim().endsWith(" " + pid)).map((l) => l.trim().split(/\s+/)[1]);
  } catch { return []; }
}

try {
  await call("initialize", "initialize", { clientInfo: { name: "gen_asset_studio_probe", title: "Gen Asset Studio Probe", version: "0.0.1" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  notify("initialized");

  await call("accountRead", "account/read", { refreshToken: false });

  if (!isolated) {
    await call("rateLimitsRead", "account/rateLimits/read", { excludeResetCreditDetails: true });
    await call("modelList", "model/list", { includeHidden: true, limit: 100 });
    await call("usageRead", "account/usage/read", undefined);
    await call("configRead", "config/read", { includeLayers: false });
  } else {
    await call("rateLimitsReadLoggedOut", "account/rateLimits/read", {});
    await call("modelListLoggedOut", "model/list", { includeHidden: false, limit: 100 });
    const login = await call("loginStart", "account/login/start", { type: "chatgpt" });
    await sleep(1500);
    results.listeningPortsAfterLogin = listeningPorts(child.pid);
    if (login.result && login.result.loginId) {
      await call("loginCancel", "account/login/cancel", { loginId: login.result.loginId });
    }
    await call("loginCancelUnknown", "account/login/cancel", { loginId: "does-not-exist" });
    await sleep(800);
    results.listeningPortsAfterCancel = listeningPorts(child.pid);
    const dev = await call("loginStartDeviceCode", "account/login/start", { type: "chatgptDeviceCode" });
    if (dev.result && dev.result.loginId) {
      await call("loginCancelDeviceCode", "account/login/cancel", { loginId: dev.result.loginId });
    }
    await call("logout", "account/logout", undefined);
    await call("accountReadAfterLogout", "account/read", {});
  }
  await sleep(500);
} finally {
  child.stdin.end();
  child.kill();
}

const json = JSON.stringify(results, null, 2);
if (outFile) writeFileSync(outFile, json);
console.log(json);
