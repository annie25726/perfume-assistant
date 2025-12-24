import { searchRAG, addToRagStore } from "./rag.js";
import { askChatGPT } from "./chatgpt.js";

const UNCERTAIN_PATTERNS = [
  "可能是",
  "如果你指的是",
  "也許",
  "未必",
  "不一定",
  "我猜",
];

export async function shouldEscalate({
  userMessage,
  assistantReply,
  ragHits,
  correctionCount,
}) {
  if (correctionCount >= 2) return true;
  if (ragHits.length === 0) return true;

  if (assistantReply) {
    return UNCERTAIN_PATTERNS.some(p =>
      assistantReply.includes(p)
    );
  }
  return false;
}

export async function escalateAndLearn({
  userMessage,
  sessionId,
}) {
  const gptReply = await askChatGPT(userMessage);

  // 🔁 學起來（重點）
  await addToRagStore({
    text: `Q: ${userMessage}\nA: ${gptReply}`,
    source: "learned-from-gpt",
    tags: ["brand", "cleanstation"],
  });

  return gptReply;
}
