// 新知識可信度確認（來源 / 穩定性 / 結構化）

const HEDGE_PATTERNS = [
  "可能",
  "也許",
  "不一定",
  "未必",
  "我猜",
  "推測",
  "大概",
  "應該",
];

/**
 * @param {Object} args
 * @param {string} args.question
 * @param {string} args.answer
 * @param {string} args.source  e.g. "l2:chatgpt" | "l2:chatgpt+mcp"
 */
export function validateKnowledge({ question, answer, source }) {
  const reasons = [];

  const q = (question || "").trim();
  const a = (answer || "").trim();

  // 1) 來源（只有 L2 產出才可回存）
  if (!String(source || "").startsWith("l2:")) {
    reasons.push("來源不是 L2（僅允許 L2 產生的新知識回存）");
  }

  // 2) 基本品質
  if (q.length < 2) reasons.push("問題過短");
  if (a.length < 40) reasons.push("答案過短（資訊不足）");

  // 3) 穩定性：避免太多不確定措辭
  const hedgeHits = HEDGE_PATTERNS.filter(p => a.includes(p));
  if (hedgeHits.length >= 3) {
    reasons.push(`不確定措辭過多（${hedgeHits.join("、")}）`);
  }

  // 4) 結構化：至少要能變成「可檢索」的 QA
  // （先用最簡單規則：要有句號/分段或條列，避免一行帶過）
  const hasStructure = /\n|\d+\.|\-|•|：|。/.test(a);
  if (!hasStructure) reasons.push("缺乏結構（不利於回存成可檢索知識）");

  return {
    ok: reasons.length === 0,
    reasons,
  };
}
