import fs from "fs";
import path from "path";
import { askChatGPT } from "../chatgpt.js";

const OUTPUT_PATH = path.join(process.cwd(), "learning", "synthetic_questions.json");

export async function generatePurchaseQuestions() {
  const prompt = `
請產生 20 種「詢問購買、官網、通路」的使用者問法，
全部用台灣繁體中文，僅輸出 JSON array。

範例：
["哪裡可以買？", "有沒有官方網站？"]
  `.trim();

  const result = await askChatGPT({
    question: prompt,
    mode: "analysis"
  });

  let questions;
  try {
    questions = JSON.parse(result);
  } catch {
    console.error("GPT output not valid JSON");
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(questions, null, 2));
  console.log("✅ 生成式訓練資料完成");
}
