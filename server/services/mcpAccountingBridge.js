import { spawn } from "child_process";
import crypto from "crypto";

const DEFAULT_PYTHON = "/Users/annielee/.pyenv/versions/3.10.13/bin/python3";
const DEFAULT_CWD = "/Users/annielee/Documents/00.Work/00.專案外包/03.Project/accounting-mcp-master";
const DEFAULT_ARGS = ["-m", "accounting_mcp.server"];
const KEEPALIVE_MS = 15000;

const sessions = new Map();

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function createSession(res) {
  const sessionId = crypto.randomUUID();
  const python = process.env.ACCOUNTING_MCP_PYTHON || DEFAULT_PYTHON;
  const cwd = process.env.ACCOUNTING_MCP_CWD || DEFAULT_CWD;
  const args = (process.env.ACCOUNTING_MCP_ARGS || "").trim()
    ? String(process.env.ACCOUNTING_MCP_ARGS).split(" ")
    : DEFAULT_ARGS;

  const child = spawn(python, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const session = { id: sessionId, res, child, buffer: "" };
  sessions.set(sessionId, session);

  const keepalive = setInterval(() => {
    res.write(":\n\n");
  }, KEEPALIVE_MS);

  child.stdout.on("data", chunk => {
    session.buffer += chunk.toString("utf8");
    let idx = session.buffer.indexOf("\n");
    while (idx >= 0) {
      const line = session.buffer.slice(0, idx).trim();
      session.buffer = session.buffer.slice(idx + 1);
      if (line) {
        try {
          JSON.parse(line);
          writeSse(res, "message", line);
        } catch {
          // 忽略非 JSON 輸出
        }
      }
      idx = session.buffer.indexOf("\n");
    }
  });

  child.stderr.on("data", chunk => {
    const text = chunk.toString("utf8").trim();
    if (text) {
      console.warn(`[accounting-mcp] ${text}`);
    }
  });

  const cleanup = () => {
    clearInterval(keepalive);
    sessions.delete(sessionId);
    if (!child.killed) {
      child.kill();
    }
  };

  res.on("close", cleanup);
  child.on("exit", cleanup);

  return sessionId;
}

export function mountAccountingMcpBridge(app) {
  app.get("/mcp/accounting/sse", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const sessionId = createSession(res);
    writeSse(res, "endpoint", `/mcp/accounting/rpc/${sessionId}`);
  });

  app.post("/mcp/accounting/rpc/:sessionId", (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ ok: false, error: "session_not_found" });
    }

    try {
      session.child.stdin.write(JSON.stringify(req.body) + "\n");
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
}
