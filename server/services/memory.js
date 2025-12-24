import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

/* ======================
   路徑基準（關鍵修正）
   一律以 server/ 為基準
====================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/data/memory
const memDir = path.resolve(__dirname, "../data/memory");

/* ======================
   確保資料夾存在
====================== */
fs.mkdirSync(memDir, { recursive: true });

function fileOf(sessionId) {
  return path.join(memDir, `${sessionId}.json`);
}

/* ======================
   Session 操作
====================== */
export function getOrCreateSession(sessionId) {
  const id = sessionId || uuidv4();
  const f = fileOf(id);

  if (!fs.existsSync(f)) {
    fs.writeFileSync(
      f,
      JSON.stringify(
        {
          sessionId: id,
          messages: [],
          intentState: null,
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  return id;
}

export function loadSession(sessionId) {
  const f = fileOf(sessionId);
  if (!fs.existsSync(f)) {
    return { sessionId, messages: [], intentState: null };
  }

  try {
    const data = JSON.parse(fs.readFileSync(f, "utf-8"));
    return {
      sessionId: data.sessionId || sessionId,
      messages: Array.isArray(data.messages) ? data.messages : [],
      intentState: data.intentState || null,
    };
  } catch {
    return { sessionId, messages: [], intentState: null };
  }
}

export function saveSession(sessionId, partial) {
  const base = loadSession(sessionId);
  const merged = {
    ...base,
    ...partial,
    sessionId: base.sessionId || sessionId,
  };

  fs.writeFileSync(fileOf(sessionId), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

/* ======================
   Intent State
====================== */
export function getIntentState(sessionId) {
  return loadSession(sessionId).intentState || null;
}

export function setIntentState(sessionId, intentState) {
  return saveSession(sessionId, { intentState }).intentState;
}

/* ======================
   Messages
====================== */
export function loadMessages(sessionId) {
  return loadSession(sessionId).messages || [];
}

export function appendMessages(sessionId, newMsgs) {
  const data = loadSession(sessionId);
  data.messages = [...(data.messages || []), ...newMsgs].slice(-80);
  fs.writeFileSync(fileOf(sessionId), JSON.stringify(data, null, 2), "utf-8");
}

/* ======================
   Reset
====================== */
export function resetSession(sessionId) {
  const f = fileOf(sessionId);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
