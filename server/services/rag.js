import fs from "fs";
import path from "path";
import crypto from "crypto";

/* =========================
   Paths
========================= */
export const RAG_STORE_PATH = path.resolve("data/rag/rag_store.json");
export const UPLOAD_DIR = path.resolve("data/uploads");
export const LEARNED_DIR = path.resolve("data/learned");

fs.mkdirSync(path.dirname(RAG_STORE_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(LEARNED_DIR, { recursive: true });

console.log("🧠 RAG_STORE_PATH =", RAG_STORE_PATH);

/* =========================
   Utils
========================= */
function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function normalizeText(t) {
  return String(t || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[！？!?。．…]+$/g, "");
}

/* =========================
   Store I/O（關鍵）
========================= */
function loadStore() {
  if (!fs.existsSync(RAG_STORE_PATH)) {
    return { chunks: [] };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(RAG_STORE_PATH, "utf-8"));

    // 🔒 防呆：確保一定有 chunks array
    if (!raw || typeof raw !== "object") {
      return { chunks: [] };
    }

    if (!Array.isArray(raw.chunks)) {
      raw.chunks = [];
    }

    return raw;
  } catch (e) {
    console.error("❌ RAG load error:", e);
    return { chunks: [] };
  }
}

function saveStore(store) {
  if (!store || !Array.isArray(store.chunks)) {
    throw new Error("RAG store must be { chunks: [] }");
  }

  fs.writeFileSync(
    RAG_STORE_PATH,
    JSON.stringify(store, null, 2),
    "utf-8"
  );
}

/* =========================
   Stats
========================= */
export function getRagStoreStats() {
  const store = loadStore();
  return {
    documents: store.chunks.length,
    learned: store.chunks.filter(c => c.source === "learned").length
  };
}

/* =========================
   Ingest uploads (.txt)
========================= */
export async function ingestFilesToRagStore() {
  const files = fs
    .readdirSync(UPLOAD_DIR)
    .filter(f => f.toLowerCase().endsWith(".txt"));

  const store = loadStore();
  let chunks = 0;

  for (const file of files) {
    const full = path.join(UPLOAD_DIR, file);
    const text = normalizeText(fs.readFileSync(full, "utf-8"));
    if (!text) continue;

    const id = sha1(file + text);

    const exists = store.chunks.some(c => c.id === id);
    if (exists) continue;

    store.chunks.push({
      id,
      source: file,
      origin: "upload",
      text,
      createdAt: new Date().toISOString()
    });

    chunks += 1;
  }

  saveStore(store);
  return { files: files.length, chunks };
}

/* =========================
   Ingest learned knowledge
========================= */
export async function ingestLearnedToRagStore() {
  const files = fs
    .readdirSync(LEARNED_DIR)
    .filter(f => f.endsWith(".json"));

  const store = loadStore();
  let chunks = 0;

  for (const file of files) {
    const full = path.join(LEARNED_DIR, file);
    const data = JSON.parse(fs.readFileSync(full, "utf-8"));

    const text = normalizeText(data.content || "");
    if (!text) continue;

    const id = data.id || sha1(text);
    const exists = store.chunks.some(c => c.id === id);
    if (exists) continue;

    store.chunks.push({
      id,
      source: "learned",
      origin: "fallback_gpt",
      question: data.q,
      text,
      tags: data.tags || [],
      createdAt: data.createdAt || new Date().toISOString()
    });

    chunks += 1;
  }

  saveStore(store);
  return { learnedFiles: files.length, chunks };
}

/* =========================
   學習入口（給 index.js 用）
========================= */
export function addToRagStore({ text, source = "learned", tags = [] }) {
  const store = loadStore();
  const clean = normalizeText(text);
  if (!clean) return;

  const id = sha1(source + clean);

  const exists = store.chunks.some(c => c.id === id);
  if (exists) return;

  store.chunks.push({
    id,
    source,
    origin: "runtime",
    text: clean,
    tags,
    createdAt: new Date().toISOString()
  });

  saveStore(store);
}

/* =========================
   Search（learned 加權）
========================= */
export async function searchRAG(query, { topK = 3 } = {}) {
  const store = loadStore();
  if (!store.chunks.length) return [];

  const q = normalizeText(query);
  if (!q) return [];

  const tokens = Array.from(
    new Set(q.split(/\s+/).filter(Boolean).concat(q.split("")))
  );

  const scored = store.chunks
    .map(item => {
      const t = item.text || "";
      let hit = 0;

      for (const tok of tokens) {
        if (!tok) continue;
        hit += t.split(tok).length - 1;
      }

      // raw_score：原始命中密度分數（通常會很小，例如 0.01~0.05）
      const raw_score = hit / Math.max(80, Math.min(800, t.length));

      // score：映射到 0~1（用於「分類門檻 / 回答門檻」）
      // 目前 RAG 是關鍵字命中密度，不是 embedding cosine。
      // 為了配合 0.6 / 0.8 的門檻，我們把 raw_score 做一個簡單放大再截斷。
      // 你之後若改成向量 cosine（0~1），這段可直接改回 score = cosine。
      let score = Math.min(1, raw_score * 25);

      // ⭐ learned 知識優先
      if (item.source === "learned") score = Math.min(1, score * 1.1);

      return { ...item, score, raw_score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}
