import fetch from "node-fetch";

export async function askOllamaWithConfidence(question) {
  const prompt = `
你是一位AI顧問。

請用「台灣繁體中文」回答。
請只根據你有把握的知識作答。

請用 JSON 格式回傳（格式必須正確）：
{
  "answer": "你的回答",
  "confidence": 0 到 1 的數字
}

問題：
${question}
`.trim();

  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5:3b-instruct-q4_K_M",
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: 180
      }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.response;
}
