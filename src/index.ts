import "dotenv/config";
import http from "node:http";
import { spawn } from "node:child_process";

const PORT   = parseInt(process.env.PORT   || "3099");
const SECRET = process.env.SECRET          || "";
const MODEL  = process.env.CODEX_MODEL     || "o4-mini";
const TIMEOUT_MS = 60_000;

// ── Codex CLI ─────────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
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
    const command = "codex";
    const args    = ["-a", "full-auto", "-q", "--model", MODEL, prompt];

    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Claude CLI timeout (60s)"));
    }, TIMEOUT_MS);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stripAnsi(stderr).trim() || `Codex exited with code ${code}`));
        return;
      }
      resolve(stripAnsi(stdout).trim());
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Cannot run codex CLI: ${err.message}`));
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
  console.log(`   Engine : Codex CLI`);
  console.log(`   Model  : ${MODEL}`);
  console.log(`   Secret : ${SECRET ? "✓ configured" : "⚠️  KHÔNG có secret (ai cũng gọi được!)"}`);
  console.log(`\n   Test:`);
  console.log(`   curl -X POST http://localhost:${PORT}/translate \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -H "Authorization: Bearer ${SECRET || "YOUR_SECRET"}" \\`);
  console.log(`     -d '{"text":"Hello, how are you?"}'`);
});
