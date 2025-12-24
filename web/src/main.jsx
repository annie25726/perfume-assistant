/**
 * PERFUME AI – 單檔完整版
 * Ollama → 香氛運算 / RAG → 不行再轉 OpenAI GPT
 */

import express from "express";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* =======================
   基本設定
======================= */
const PORT = 5050;

const OLLAMA_HOST = "http://127.0.0.1:11434";
const CHAT_MODEL = "qwen2.5:7b";
const EMBED_MODEL = "nomic-embed-text";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = "gpt-5.2";

const STORE_FILE = "./rag_store.json";

/* =======================
   初始化知識庫
======================= */
if (!fs.existsSync(STORE_FILE)) {
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify(
      {
        chunks: [
          {
            text: `
【香氛運算核心規則】
1. 配方總和必須 = 100%
2. 常見比例：
   - 清新型：前調40% 中調40% 後調20%
   - 花香型：前25% 中50% 後25%
   - 木質型：前15% 中35% 後50%
3. 若使用者未指定 ml，預設以 10ml 香精計算
4. 安全提示：
   - 孕婦 / 嬰幼兒：避免高濃度薄荷、尤加利
   - 敏感體質：總濃度 ≤ 5%
5. 感覺 → 原料骨架：
   - 乾淨：佛手柑 + 白花 + 白麝香
   - 放鬆：薰衣草 + 雪松
   - 高級：玫瑰 + 依蘭 + 檀香
`
          }
        ]
      },
      null,
      2
    )
  );
}

/* =======================
   工具函式
======================= */
function loadStore() {
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
}

async function embed(text) {
  const r = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });
  const d = await r.json();
  return d.embedding;
}

function cosine(a, b) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/* =======================
   香氛 RAG + 判斷
======================= */
async function askOllama(userQuestion) {
  const store = loadStore();
  const qv = await embed(userQuestion);

  const scored = store.chunks.map(c => ({
    text: c.text,
    score: cosine(qv, c.embedding ?? qv) // 首次保險
  }));

  const context = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c, i) => `【知識${i + 1}】\n${c.text}`)
    .join("\n\n");

  const system = `
你是「MORAN 香氛調香 AI」。
你必須根據知識給出「可實際調香的比例與步驟」。
如果資訊不足，請回答 answerable=false。
輸出格式一定是 JSON。
`;

  const prompt = `
${context}

使用者問題：
${userQuestion}

請輸出：
{
  "answerable": true/false,
  "answer": "...",
  "confidence": 0~1
}
`;

  const r = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      system,
      prompt,
      format: "json",
      stream: false
    })
  });

  const d = await r.json();
  try {
    return JSON.parse(d.response);
  } catch {
    return { answerable: false, confidence: 0 };
  }
}

/* =======================
   OpenAI Fallback
======================= */
async function askGPT(question) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: question
    })
  });

  const d = await r.json();
  return d.output_text || "GPT 無回應";
}

/* =======================
   API（ModelView 只接這）
======================= */
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;

  const local = await askOllama(message);

  if (local.answerable && local.confidence >= 0.4) {
    return res.json({
      route: "ollama",
      answer: local.answer
    });
  }

  const gpt = await askGPT(message);
  res.json({
    route: "gpt",
    answer: gpt
  });
});

/* =======================
   啟動
======================= */
app.listen(PORT, () => {
  console.log(`🌸 Perfume AI running at http://localhost:${PORT}`);
});
