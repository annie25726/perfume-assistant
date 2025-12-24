import fetch from "node-fetch";

/**
 * L1：Ollama +（可選）RAG 片段
 * 使用 /api/chat，讓回覆更像 ChatGPT 對話。
 */
export async function askOllamaChat({
  message,
  ragHits = [],
  model = process.env.OLLAMA_CHAT_MODEL || "qwen2.5:7b",
}) {
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

  const kbBlock = ragHits.length
    ? `【知識庫】\n` + ragHits
        .map((h, i) => `(${i + 1}) score=${(h.score ?? 0).toFixed(3)} source=${h.source}\n${h.text}`)
        .join("\n\n")
    : "【知識庫】\n(無)";

  const messages = [
    {
      role: "system",
      content:
        "你是一位台灣使用的專業顧問，請一律使用繁體中文（台灣）。\n" +
        "回答時請優先根據【知識庫】內容，不足再用一般常識補齊。\n" +
        "若知識庫不足以回答，請直接說『我不確定』並建議下一步。",
    },
    { role: "user", content: `${kbBlock}\n\n【使用者問題】\n${message}` },
  ];

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama /api/chat error ${res.status}: ${t}`);
  }

  const data = await res.json();
  return data?.message?.content ?? "";
}
