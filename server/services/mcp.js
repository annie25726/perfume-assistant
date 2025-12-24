/**
 * MCP（外部權威資料）
 * 目前先提供「判斷是否需要」與「呼叫介面」的骨架。
 * 你之後可以把真正的 MCP client / API 串在 callMcp() 裡。
 */

const MCP_INTENT_PATTERNS = [
  /天氣|溫度|降雨|氣象/, // 例：天氣資料（目前已由 weather route 直接處理）
  /匯率|股價|即時|今天|現在/, // 例：即時資料
  /法規|規範|官方|公告/, // 例：權威文件
];

export function shouldUseMcp(question = "") {
  const t = String(question || "");
  return MCP_INTENT_PATTERNS.some(r => r.test(t));
}

/**
 * 取得 MCP 原始資料（raw data）
 * 回傳結構化資料（建議），讓系統有機會不呼叫 ChatGPT 也能回覆。
 */
export async function callMcp({ question }) {
  // TODO: 串接你真正的 MCP。
  // 先回傳 null，代表「未使用」或「目前沒有可用資料」。
  return null;
}

/**
 * 省 token：若 MCP 回傳的是可直接回答的結構化資料，
 * 可以在這裡用規則轉成文字，避免再叫 L2。
 */
export function tryAnswerFromMcp(mcpData) {
  if (!mcpData) return null;

  // 例：如果 mcpData 已經包含 readyAnswer
  if (typeof mcpData === "object" && mcpData.readyAnswer) {
    return String(mcpData.readyAnswer);
  }

  return null;
}
