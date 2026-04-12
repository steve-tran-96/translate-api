import "dotenv/config";
import http from "node:http";
import { execSync } from "node:child_process";
import * as pty from "node-pty";

const PORT   = parseInt(process.env.PORT   || "3099");
const SECRET = process.env.SECRET          || "";
const MODEL  = process.env.CODEX_MODEL     || "o4-mini";
const TIMEOUT_MS = 60_000;

// Resolve full path to codex binary at startup (avoids ENOENT when PATH differs)
const COMMON_PATHS = [
  "/usr/local/bin/codex",
  "/usr/bin/codex",
  `${process.env.HOME}/.npm-global/bin/codex`,
  `${process.env.HOME}/.local/bin/codex`,
  "/root/.npm-global/bin/codex",
];

let CODEX_BIN = process.env.CODEX_PATH || "";
if (!CODEX_BIN) {
  try {
    CODEX_BIN = execSync("which codex", { encoding: "utf-8" }).trim();
  } catch {
    CODEX_BIN = COMMON_PATHS.find(p => {
      try { execSync(`test -x "${p}"`); return true; } catch { return false; }
    }) || "codex";
  }
}
console.log(`   Codex  : ${CODEX_BIN}`);

// ── Codex CLI ─────────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

function callCodex(text: string): Promise<string> {
  const prompt =
    `Translate the following text to natural Vietnamese.\n` +
    `Rules:\n` +
    `- Keep product names and brand names unchanged (Claude, Claude Code, Google, Apple, API, React, etc.)\n` +
    `- Use natural, conversational Vietnamese — not stiff machine translation\n` +
    `- Return ONLY the translated text, nothing else, no explanations\n\n` +
    `Text:\n${text}`;

  return new Promise((resolve, reject) => {
    const ptyProc = pty.spawn(CODEX_BIN, ["-a", "never", "--model", MODEL, prompt], {
      name: "xterm-color",
      cols: 220,
      rows: 50,
      cwd: "/tmp",
      env: process.env as Record<string, string>,
    });

    let output = "";

    ptyProc.onData((data: string) => { output += data; });

    const timer = setTimeout(() => {
      ptyProc.kill();
      reject(new Error("Codex CLI timeout (60s)"));
    }, TIMEOUT_MS);

    ptyProc.onExit(({ exitCode }) => {
      clearTimeout(timer);
      const cleaned = stripAnsi(output).trim();
      if (exitCode !== 0) {
        reject(new Error(cleaned || `Codex exited with code ${exitCode}`));
        return;
      }
      resolve(cleaned);
    });
  });
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: object) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, { status: "ok" });
    return;
  }

  // Codex ping — public, no auth, verifies Codex CLI is alive
  if (req.method === "GET" && req.url === "/ping") {
    const t0 = Date.now();
    try {
      const reply = await callCodex('Reply with exactly one word: pong');
      json(res, 200, { status: "ok", codex: reply, ms: Date.now() - t0, model: MODEL });
    } catch (err: any) {
      json(res, 500, { status: "error", error: err.message, ms: Date.now() - t0 });
    }
    return;
  }

  // Only POST /translate
  if (req.method !== "POST" || req.url !== "/translate") {
    json(res, 404, { error: "Not found" });
    return;
  }

  // Auth
  const auth = req.headers["authorization"] || "";
  if (SECRET && auth !== `Bearer ${SECRET}`) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  // Parse body
  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", async () => {
    let text: string;
    try {
      const parsed = JSON.parse(body);
      text = parsed.text;
      if (!text || typeof text !== "string") throw new Error();
    } catch {
      json(res, 400, { error: "Body phải có dạng { \"text\": \"...\" }" });
      return;
    }

    try {
      const translated = await callCodex(text);
      json(res, 200, { translated });
    } catch (err: any) {
      console.error("[translate-api] Error:", err.message);
      json(res, 500, { error: err.message });
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ translate-api đang chạy tại http://localhost:${PORT}`);
  console.log(`   Engine : Codex CLI (node-pty)`);
  console.log(`   Model  : ${MODEL}`);
  console.log(`   Secret : ${SECRET ? "✓ configured" : "⚠️  KHÔNG có secret (ai cũng gọi được!)"}`);
  console.log(`\n   Test:`);
  console.log(`   curl -X POST http://localhost:${PORT}/translate \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -H "Authorization: Bearer ${SECRET || "YOUR_SECRET"}" \\`);
  console.log(`     -d '{"text":"Hello, how are you?"}'`);
});
