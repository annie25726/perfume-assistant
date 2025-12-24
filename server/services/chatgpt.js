import OpenAI from "openai";
import { postProcessLLMOutput } from "./textPostProcess.js";

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

/**
 * Ask ChatGPT (basic)
 * @param {string} userMessage
 */
export async function askChatGPT(userMessage) {
  const client = getClient();
  if (!client) {
    throw new Error("Missing OPENAI_API_KEY. Please set it in server/.env");
  }

  const safeMessage =
    typeof userMessage === "string" && userMessage.trim()
      ? userMessage.trim()
      : "請根據上下文，提供最合理且正確的專業回答。";

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "你是專業助理。請用繁體中文（台灣用語）回答。避免英文與引用（作者、年份）。",
      },
      { role: "user", content: safeMessage },
    ],
  });

  const raw = response?.choices?.[0]?.message?.content ?? "";
  return postProcessLLMOutput(raw).text;
}

/**
 * Ask ChatGPT with RAG + optional MCP context
 */
export async function askChatGPTWithContext({ question, ragHits = [], mcp = null }) {
  const client = getClient();
  if (!client) {
    throw new Error("Missing OPENAI_API_KEY. Please set it in server/.env");
  }

  const q = (question || "").trim();
  const kbBlock = ragHits.length
    ? `【知識庫】\n` +
      ragHits
        .map(
          (h, i) =>
            `(${i + 1}) score=${(h.score ?? 0).toFixed(3)} source=${h.source}\n${h.text}`
        )
        .join("\n\n")
    : "【知識庫】\n(無)";

  const mcpBlock = mcp
    ? `【外部權威資料（MCP）】\n${
        typeof mcp === "string" ? mcp : JSON.stringify(mcp, null, 2)
      }`
    : "";

  const prompt = [
    "你是一位溫暖、親切、博學的聊天夥伴，就像 ChatGPT 一樣自然流暢。",
    "",
    "【核心原則 - 最重要！】",
    "1. **理解對話上下文**：仔細閱讀對話歷史，理解用戶的問題是在回應什麼，不要重新開始對話",
    "2. **直接回答問題**：用戶問什麼就答什麼，不要一直反問或繞圈子",
    "3. **理解簡短問句**：",
    "   - 「推的」= 推薦",
    "   - 「問你啊」= 用戶在問你，請直接回答",
    "   - 「有嗎」= 詢問是否有某個東西",
    "   - 「你可以幫我看嗎」= 用戶在問你能不能幫忙查詢/查看（通常是回應你剛才建議查詢外部網站）",
    "4. **延續對話**：如果用戶在回應你剛才的建議或回答，要延續那個話題，不要說「您好！我可以幫助您解答任何問題」這種重新開始的話",
    "5. **先給答案，再問問題**：如果用戶問推薦，先給推薦，然後可以問「還想了解其他嗎？」",
    "6. **簡潔有力**：回答要簡潔，不要過度囉嗦，避免重複說同樣的話",
    "",
    "【對話風格】",
    "- 用自然、口語化的方式回應，就像和朋友聊天一樣",
    "- 適時使用表情符號讓對話更有溫度（但不要過度使用，1-2個即可）",
    "- 回答要具體、實用、直接",
    "- 語氣要親切但不失專業",
    "",
    "【回答策略】",
    "- 如果用戶問「推薦」、「推的」，直接給推薦，不要反問「你想要什麼推薦？」",
    "- 如果用戶問「有嗎」，直接回答有或沒有，並說明",
    "- 如果問題不清楚，先給一個合理的回答，然後再問需要更多資訊",
    "- 避免連續問多個問題，一次最多問1個問題",
    "",
    "【即時資訊處理 - 非常重要！】",
    "當用戶問「最近」、「最新」、「現在」、「今年」等需要即時資訊的問題時：",
    "- **不要給過時的資訊**：如果你不知道最新的資訊，誠實說明",
    "- **不要編造資訊**：不要為了回答而給出可能過時的資訊",
    "- **誠實告知限制**：可以說「我的知識可能不是最新的，建議你查詢最新的資訊來源」",
    "- **提供替代方案**：可以建議用戶查詢哪些網站或平台（如 IMDb、豆瓣、Google 等）",
    "",
    "【回答要求】",
    "- 請用繁體中文（台灣用語）回答",
    "- 請不要使用英文（專有名詞除外）",
    "- 請不要加入引用、作者、年份、註解或參考資料",
    "- 如果知識庫內容不足，請明確說明你缺少哪些資訊，並提出需要的補充問題",
    "- 如果問題需要即時資訊但你不知道最新資訊，誠實說明並建議查詢最新來源",
    "",
    kbBlock,
    mcpBlock,
    "",
    `【使用者問題】\n${q}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response?.choices?.[0]?.message?.content ?? "";
  return raw;
}
