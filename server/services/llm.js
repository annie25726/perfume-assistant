import fetch from "node-fetch";
import { getOrCreateSession, loadMessages, appendMessages } from "./memory.js";
import { searchRAG, addToRagStore } from "./rag.js";
import { getWeather, listCities } from "./tools.weather.js";
import { askHuggingFace } from "./huggingface.js";
import { askChatGPTWithContext } from "./chatgpt.js";
import { postProcessLLMOutput } from "./textPostProcess.js";

/**
 * 我們用「LLM 自己決定要不要用工具」的方式：
 * - 先讓 LLM 回覆（可能會要求工具）
 * - 若它輸出一段 JSON 指令：{"tool":"weather","args":{...}}
 *   我們就執行工具，把結果再丟回 LLM 繼續回答
 */
function tryParseToolCall(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (obj && obj.tool && obj.args) return obj;
  } catch {}
  return null;
}

function systemPrompt() {
  return `
你是一位溫暖、親切、博學的聊天夥伴，就像 ChatGPT 一樣自然流暢。

【核心原則 - 最重要！】
1. **理解對話上下文**：仔細閱讀對話歷史，理解用戶的問題是在回應什麼，不要重新開始對話
2. **直接回答問題**：用戶問什麼就答什麼，不要一直反問或繞圈子
3. **理解簡短問句**：
   - 「推的」= 推薦
   - 「問你啊」= 用戶在問你，請直接回答
   - 「有嗎」= 詢問是否有某個東西
   - 「你可以幫我看嗎」= 用戶在問你能不能幫忙查詢/查看（通常是回應你剛才建議查詢外部網站）
4. **延續對話**：如果用戶在回應你剛才的建議或回答，要延續那個話題，不要說「您好！我可以幫助您解答任何問題」這種重新開始的話
5. **先給答案，再問問題**：如果用戶問推薦，先給推薦，然後可以問「還想了解其他嗎？」
6. **簡潔有力**：回答要簡潔，不要過度囉嗦，避免重複說同樣的話

【對話風格】
- 用自然、口語化的方式回應，就像和朋友聊天一樣
- 適時使用表情符號讓對話更有溫度（但不要過度使用，1-2個即可）
- 回答要具體、實用、直接
- 保持對話的連續性，記住之前的對話內容
- 語氣要親切但不失專業

【回答策略】
- 如果用戶問「推薦」、「推的」，直接給推薦，不要反問「你想要什麼推薦？」
- 如果用戶問「有嗎」，直接回答有或沒有，並說明
- 如果問題不清楚，先給一個合理的回答，然後再問需要更多資訊
- 避免連續問多個問題，一次最多問1個問題

【話題範圍】
什麼都可以聊！無論是：
- 日常聊天、生活分享、心情抒發
- 知識問答、學習輔導、專業諮詢
- 創意發想、腦力激盪、問題解決
- 娛樂話題、時事討論、興趣愛好
- 情感支持、人生建議、價值觀討論

【知識庫】
系統會提供你最多 4 段檢索到的知識片段（可能來自使用者上傳的文件），請優先引用其內容回答。如果知識庫有相關內容，直接使用，不要說「我可以幫你找」。

【即時資訊處理 - 非常重要！】
當用戶問「最近」、「最新」、「現在」、「今年」等需要即時資訊的問題時：
- **不要給過時的資訊**：如果你不知道最新的資訊，誠實說明
- **不要編造資訊**：不要為了回答而給出可能過時的資訊
- **誠實告知限制**：可以說「我的知識可能不是最新的，建議你查詢最新的資訊來源」
- **提供替代方案**：可以建議用戶查詢哪些網站或平台（如 IMDb、豆瓣、Google 等）

例如：
- 用戶問「最近有什麼好看的電影？」→ 如果不知道最新電影，誠實說明並建議查詢最新資訊
- 用戶問「今年最熱門的...」→ 如果不知道，不要給過時的資訊，誠實說明

【工具呼叫規則】
當你需要查天氣才回答得更準時，你可以輸出「純 JSON」呼叫工具，格式如下（不要多餘文字）：
{"tool":"weather","args":{"city":"台北","day":"tomorrow"}}

day 可用：today / tonight / tomorrow / day_after
城市可用：${listCities().join("、")}

如果不需要工具，就直接正常回答，不要輸出 JSON。
`.trim();
}

async function ollamaChat(messages) {
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_CHAT_MODEL || "qwen2.5:7b";

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    })
  });

  const data = await res.json();
  // Ollama chat response: { message: { role, content } }
  return data?.message?.content ?? "";
}

export async function chatWithAgent({ message, sessionId }) {
  const sid = getOrCreateSession(sessionId);
  const history = loadMessages(sid);

  // RAG 檢索（如果沒有 ingest，retrieve 會回空）
  const hits = await searchRAG(message, 4);
  const kbBlock = hits.length
    ? `【知識庫檢索】\n` + hits.map((h, i) =>
        `(${i + 1}) source=${h.source}, score=${h.score}\n${h.text}`
      ).join("\n\n")
    : `【知識庫檢索】\n(目前沒有可用知識片段)`;

  const messages = [
    { role: "system", content: systemPrompt() },
    ...history,
    { role: "user", content: `${kbBlock}\n\n【使用者問題】\n${message}` }
  ];

  // 第一次讓 LLM 回覆
  let assistant = await ollamaChat(messages);

  // 看看它是否要呼叫工具
  const call = tryParseToolCall(assistant);

  if (call?.tool === "weather") {
    const toolResult = await getWeather(call.args);

    // 把工具結果回餵給 LLM，請它生成「最後回答」
    const messages2 = [
      ...messages,
      { role: "assistant", content: assistant },
      { role: "tool", content: JSON.stringify({ tool: "weather", result: toolResult }) },
      {
        role: "user",
        content:
          "以上是工具結果。請用自然口吻完成最終回答（不要再輸出 JSON）。"
      }
    ];

    assistant = await ollamaChat(messages2);
  }

  // 寫回 memory（保留上下文）
  appendMessages(sid, [
    { role: "user", content: message },
    { role: "assistant", content: assistant }
  ]);

  return {
    sessionId: sid,
    engine: "ollama+rag+tools",
    reply: assistant,
    rag_hits: hits,
    ...(String(process.env.DEBUG_OUTPUT || "0")==="1" ? { debug } : {})
  };
}

// 新增一個 chatWithHuggingFace 函式
export async function chatWithHuggingFace({ message, sessionId }) {
  const sid = getOrCreateSession(sessionId);
  const history = loadMessages(sid);
  const hits = await searchRAG(message, 4);
  const kbBlock = hits.length
    ? `【知識庫檢索】\n` + hits.map((h, i) =>
        `(${i + 1}) source=${h.source}, score=${h.score}\n${h.text}`
      ).join("\n\n")
    : `【知識庫檢索】\n(目前沒有可用知識片段)`;

  // 合併知識庫與歷史訊息
  // 改善對話歷史格式，讓 LLM 更清楚理解上下文
  const historyContext = history.length > 0 ? 
    `【對話歷史】\n${history.slice(-6).map((m, i) => {
      if (m.role === 'user') return `用戶：${m.content}`;
      if (m.role === 'assistant') return `助手：${m.content}`;
      return `${m.role}：${m.content}`;
    }).join('\n')}\n\n` : '';
  
  // 如果用戶問的是簡短問句，加入上下文提示
  const isShortQuestion = message.length < 15;
  const messageContext = isShortQuestion ? 
    `⚠️ 注意：這是一個簡短的問句，可能是對之前對話的回應。請仔細理解上下文：
- 「推的」= 推薦
- 「問你啊」= 用戶在問你，請直接回答
- 「有嗎」= 詢問是否有某個東西
- 「你可以幫我看嗎」= 用戶在問你能不能幫忙查詢/查看（通常是回應你剛才建議查詢外部網站）
- 「幫我」= 用戶請你幫忙做某事

請根據對話歷史理解用戶意圖，不要重新開始對話，要延續之前的對話內容。\n\n` : '';
  
  // 檢測是否需要即時資訊
  const needsRealtimeInfo = /最近|最新|現在|今年|這個月|這個星期|當下|目前/.test(message);
  const realtimeContext = needsRealtimeInfo ? 
    `⚠️ 重要提示：用戶問的是需要「即時資訊」的問題（包含「最近」、「最新」等關鍵字）。
請注意：
- 如果你不知道最新的資訊，請誠實說明，不要給過時的資訊
- 不要編造或猜測最新資訊
- 可以建議用戶查詢最新資訊來源（如 Google、相關網站等）
- 如果知識庫有相關內容但可能過時，請說明「這可能是較舊的資訊，建議查詢最新資料」\n\n` : '';
  
  // 檢測是否在回應之前的建議
  const isResponseToSuggestion = /可以|幫我|幫你看|幫我查|幫我找/.test(message) && 
    history.some(m => m.role === 'assistant' && /建議|查詢|網站|搜尋/.test(m.content));
  const suggestionResponseContext = isResponseToSuggestion ?
    `⚠️ 重要：用戶在回應你剛才的建議（例如你建議查詢外部網站，用戶問「你可以幫我看嗎」）。
請理解：
- 用戶是在問你能不能幫忙查詢/查看，而不是要重新開始對話
- 你應該說明你的能力限制（例如無法直接查詢外部網站），但可以提供其他幫助方式
- 不要說「您好！我可以幫助您解答任何問題」這種重新開始的話\n\n` : '';
  
  const prompt = [
    systemPrompt(),
    historyContext,
    `user: ${kbBlock}\n\n${realtimeContext}${suggestionResponseContext}${messageContext}【使用者問題】\n${message}`
  ].filter(Boolean).join("\n\n");

  const hf = await askHuggingFace({ message: prompt });

  // 若 HuggingFace 仍出現英文比例過高/亂碼，就降級到 ChatGPT（L2）
  const hfBad = hf.meta.garbled || hf.meta.english_ratio > Number(process.env.EN_RATIO_THRESHOLD || 0.18) || hf.text.length < 4;

  let assistant = hf.text;
  let engine = "huggingface+rag";
  let modelInfo = { 
    model: process.env.HF_MODEL || "Meta-Llama-3-8B-Instruct", 
    api: "Hugging Face Router", 
    provider: "Hugging Face" 
  };
  let debug = null;

  if (hfBad && process.env.OPENAI_API_KEY) {
    const gptRaw = await askChatGPTWithContext({ question: message, ragHits: hits, mcp: null });
    const gpt = postProcessLLMOutput(gptRaw, { keepChineseOnly: false });
    assistant = gpt.text;
    engine = "chatgpt+rag";
    modelInfo = { 
      model: "gpt-3.5-turbo", 
      api: "OpenAI API", 
      provider: "OpenAI" 
    };
    debug = { fallback: true, hf_meta: hf.meta, hf_usedRetry: hf.usedRetry, gpt_meta: gpt.meta, raw_hf: hf.raw, cleaned_hf: hf.cleaned, raw_gpt: gpt.raw, cleaned_gpt: gpt.cleaned };
  } else {
    debug = { fallback: false, hf_meta: hf.meta, hf_usedRetry: hf.usedRetry, raw_hf: hf.raw, cleaned_hf: hf.cleaned };
  }

  // 不處理工具呼叫，僅純 LLM 回答
  appendMessages(sid, [
    { role: "user", content: message },
    { role: "assistant", content: assistant }
  ]);

  // 生成動態建議問題（根據對話內容）
  let suggestions = null;
  try {
    // 提取關鍵字和主題
    const allText = `${message} ${assistant}`.toLowerCase();
    const keywords = {
      weather: /天氣|下雨|溫度|氣溫|降雨/.test(allText),
      perfume: /香水|香氛|香味|調香|香調/.test(allText),
      mood: /心情|情緒|感覺|感受|開心|難過/.test(allText),
      life: /生活|日常|工作|學習|興趣/.test(allText),
      advice: /建議|推薦|應該|如何|怎樣/.test(allText)
    };

    // 根據關鍵字生成相關建議
    const suggestionTemplates = [];
    
    if (keywords.weather) {
      suggestionTemplates.push(
        "其他城市的天氣如何？",
        "這種天氣適合做什麼活動？",
        "天氣對心情有什麼影響？"
      );
    }
    
    if (keywords.perfume) {
      suggestionTemplates.push(
        "還有其他香調推薦嗎？",
        "不同場合適合什麼香水？",
        "如何選擇適合自己的香水？"
      );
    }
    
    if (keywords.mood) {
      suggestionTemplates.push(
        "如何改善心情？",
        "有什麼放鬆的方法？",
        "想聊聊其他感受嗎？"
      );
    }
    
    if (keywords.life) {
      suggestionTemplates.push(
        "想分享更多生活點滴嗎？",
        "還有其他想聊的話題嗎？",
        "有什麼需要建議的嗎？"
      );
    }
    
    if (keywords.advice) {
      suggestionTemplates.push(
        "還有其他問題需要建議嗎？",
        "想了解更多相關資訊嗎？",
        "有什麼其他想討論的？"
      );
    }

    // 如果沒有匹配到特定主題，使用通用建議
    if (suggestionTemplates.length === 0) {
      // 從對話中提取可能的關鍵詞
      const extractedKeywords = message.match(/[天氣|香水|心情|生活|工作|學習|興趣|問題|建議|推薦|方法|如何|怎樣]/g) || [];
      if (extractedKeywords.length > 0) {
        const keyword = extractedKeywords[0];
        suggestionTemplates.push(
          `關於${keyword}，還有什麼想了解的嗎？`,
          "還有其他相關問題嗎？",
          "想深入討論哪個方面？"
        );
      } else {
        suggestionTemplates.push(
          "還有什麼想聊的嗎？",
          "有什麼其他問題嗎？",
          "想聊聊其他話題嗎？"
        );
      }
    }

    // 選擇 3-4 個建議
    suggestions = suggestionTemplates.slice(0, 4);
    
  } catch (e) {
    console.error("生成建議問題失敗:", e);
    // 備用建議
    suggestions = [
      "還有什麼想聊的嗎？",
      "有什麼其他問題嗎？",
      "想深入討論哪個話題？"
    ];
  }

  return {
    sessionId: sid,
    engine,
    reply: assistant,
    rag_hits: hits,
    modelInfo,
    suggestions,
    ...(String(process.env.DEBUG_OUTPUT || "0")==="1" ? { debug } : {})
  };
}
