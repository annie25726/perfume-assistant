import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * 自動學習落地檔案（先落地，再由 ingest 進 RAG）
 * 優點：可回滾、可審核、不會污染
 */
const learnedDir = path.resolve("data/learned");
fs.mkdirSync(learnedDir, { recursive: true });

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

/** 基礎去重：同一個問題(正規化後) 不重複記 */
function normalizeQ(q) {
  return String(q || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[！？!?。．…]+$/g, "");
}

/** 避免把不該學的東西寫進去（你可以再加規則） */
export function shouldAutoLearn({ userMessage, engine, intent }) {
  // 1) 只在 fallback 時學（你想要的：問過就學起來）
  if (!String(engine || "").startsWith("L2-fallback")) return false;

  const text = String(userMessage || "");

  // 2) 明確「即時資訊」不學（例如天氣：下次也應該查 CWA）
  const realtimeKeywords = ["天氣", "下雨", "降雨", "溫度", "氣象", "今天", "明天", "後天", "現在"];
  if (realtimeKeywords.some(k => text.includes(k))) return false;
  if (intent === "weather") return false;

  // 3) 太短/太像寒暄不學
  if (normalizeQ(text).length < 6) return false;

  // 4) 個資風險（先粗略擋）
  const piiLike = /(電話|手機|地址|身分證|信用卡|帳號|密碼|OTP|驗證碼)/i;
  if (piiLike.test(text)) return false;

  return true;
}

/**
 * 把 fallback 的 Q/A 轉成「可檢索知識」文本
 * 這裡做成「規則/指南」格式，比原封不動更好用
 */
export function buildLearnedNote({ userMessage, assistantAnswer }) {
  const q = normalizeQ(userMessage);
  const a = String(assistantAnswer || "").trim();

  const content = [
    `【使用者問題】${q}`,
    `【最佳回答】${a}`,
    `【可重用結論】請把上面的回答視為可重用的知識規則/指南，下次遇到同類問題優先引用。`
  ].join("\n");

  return { q, a, content };
}

/**
 * 落地成 JSONL（每行一筆）
 * 你後面可以用 ingestFilesToRagStore() 把這些也吃進 RAG
 */
export function persistLearned({ userMessage, assistantAnswer, tags = [] }) {
  const { q, a, content } = buildLearnedNote({ userMessage, assistantAnswer });

  const key = sha1(q);
  const file = path.join(learnedDir, `${key}.json`);

  // 已存在就不覆寫（避免重複）
  if (fs.existsSync(file)) {
    return { ok: true, skipped: true, file };
  }

  const payload = {
    id: key,
    createdAt: new Date().toISOString(),
    q,
    a,
    tags,
    content
  };

  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  return { ok: true, skipped: false, file, id: key };
}

/** 讀取所有已學到的筆記（可做後台檢視/審核） */
export function listLearned() {
  const files = fs.readdirSync(learnedDir).filter(f => f.endsWith(".json"));
  return files.map(f => {
    const p = path.join(learnedDir, f);
    const j = JSON.parse(fs.readFileSync(p, "utf-8"));
    return { id: j.id, createdAt: j.createdAt, q: j.q, tags: j.tags };
  }).sort((a,b) => (a.createdAt < b.createdAt ? 1 : -1));
}
