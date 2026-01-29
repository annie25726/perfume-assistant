/**
 * MCP（外部權威資料）
 * 目前先提供「判斷是否需要」與「呼叫介面」的骨架。
 * 你之後可以把真正的 MCP client / API 串在 callMcp() 裡。
 */

import fetch from "node-fetch";

const DEFAULT_MCP_INTENT_PATTERNS = [
  /天氣|溫度|降雨|氣象/, // 例：天氣資料（目前已由 weather route 直接處理）
  /匯率|股價|即時|今天|現在/, // 例：即時資料
  /法規|規範|官方|公告/, // 例：權威文件
  /醫療|醫學|疾病|症狀|用藥|藥物|副作用|診斷|治療|檢查|疫苗|健康/, // 例：醫療相關資訊
  /清淨機|空氣清淨機|空淨|濾網|HEPA|PM2\.5/, // 例：空氣清淨機一般資訊
];

const DEFAULT_MCP_SSE_URL = "http://127.0.0.1:8000/sse";
const DEFAULT_MCP_TIMEOUT_MS = 60000;

const MCP_QUERY_HINTS = [
  /ICD-?10|ICD|診斷碼|代碼|code/i,
  /藥品|藥物|藥名|藥證|許可證|成分|適應症/,
  /檢驗|檢查|LOINC|檢驗項目/i,
  /診療指引|用藥建議|治療目標/
];

const MCP_EXCLUDE_HINTS = [
  /為什麼|原因|怎麼辦|要不要|會不會|是否|風險|預防|改善|導致|造成/,
  /情緒|感受|心情|煩|焦慮/
];

const MCP_MEDICAL_ENTITY_HINTS = [
  /癌|腫瘤|肺癌|乳癌|肝癌|胃癌|大腸癌|白血病/,
  /糖尿病|高血壓|心臟病|中風|氣喘|過敏|肺炎|感染/,
  /發炎|發燒|疼痛|頭痛|咳嗽|胸痛/
];

function buildIntentPatterns() {
  const raw = process.env.MCP_INTENT_REGEX || "";
  const parts = raw
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return DEFAULT_MCP_INTENT_PATTERNS;
  }

  const patterns = parts
    .map(pattern => {
      try {
        return new RegExp(pattern);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return patterns.length > 0 ? patterns : DEFAULT_MCP_INTENT_PATTERNS;
}

const MCP_INTENT_PATTERNS = buildIntentPatterns();

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveEndpointUrl(sseUrl, endpoint) {
  try {
    return new URL(endpoint, sseUrl).toString();
  } catch {
    return endpoint;
  }
}

async function* sseEventStream(readable) {
  let buffer = "";
  for await (const chunk of readable) {
    buffer += chunk.toString("utf8").replace(/\r\n/g, "\n");
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      const data = dataLines.join("\n");
      if (data) {
        yield { event, data };
      }
    }
  }
}

function simplifyKeyword(question) {
  const text = String(question || "").trim();
  if (!text) return text;
  const cleaned = text
    .replace(/ICD-?10/gi, "")
    .replace(/診斷碼|代碼|程式碼|是什麼|是什麼呢|是啥|是什麼意思|請問|想問|請告訴我|請教|請幫我/g, "")
    .replace(/[？?，,。．！!：:;；()（）「」"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || text;
}

function pickToolArgs(tool, question) {
  const schema = tool?.inputSchema;
  if (schema?.properties && typeof schema.properties === "object") {
    const props = schema.properties;
    const keyword = simplifyKeyword(question);
    if (props.keyword) return { keyword };
    if (props.question) return { question };
    if (props.query) return { query: keyword };
    if (props.input) return { input: keyword };
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.length === 1) {
      return { [required[0]]: keyword };
    }
  }
  return { question };
}

export function shouldUseMcp(question = "") {
  if (String(process.env.MCP_ALWAYS_ON || "").toLowerCase() === "true" || process.env.MCP_ALWAYS_ON === "1") {
    return true;
  }
  const t = String(question || "");
  const matchesIntent = MCP_INTENT_PATTERNS.some(r => r.test(t));
  if (!matchesIntent) return false;

  // MCP 目前是醫療/健康工具為主，需「查詢型」問題才導入
  const isQueryIntent = MCP_QUERY_HINTS.some(r => r.test(t));
  const isShortMedical = t.length <= 6 && MCP_MEDICAL_ENTITY_HINTS.some(r => r.test(t));
  const isExcluded = MCP_EXCLUDE_HINTS.some(r => r.test(t));

  return (isQueryIntent || isShortMedical) && !isExcluded;
}

/**
 * 取得 MCP 原始資料（raw data）
 * 回傳結構化資料（建議），讓系統有機會不呼叫 ChatGPT 也能回覆。
 */
export async function callMcp({ question }) {
  const q = String(question || "").trim();
  if (!q) return null;

  const sseUrl = process.env.MCP_SSE_URL || DEFAULT_MCP_SSE_URL;
  const timeoutMs = Number(process.env.MCP_TIMEOUT_MS || DEFAULT_MCP_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(sseUrl, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal
    });

    if (!res.ok || !res.body) {
      console.warn(`MCP SSE 連線失敗：${res.status} ${res.statusText}`);
      return null;
    }

    const events = sseEventStream(res.body);
    const iterator = events[Symbol.asyncIterator]();
    let endpointUrl = null;
    let rpcId = 1;

    const nextEvent = async () => {
      const { value, done } = await iterator.next();
      return done ? null : value;
    };

    const waitForEndpoint = async () => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const evt = await nextEvent();
        if (!evt) break;
        if (evt.event === "endpoint") {
          return evt.data.trim();
        }
        const msg = safeJsonParse(evt.data);
        if (msg?.endpoint) {
          return String(msg.endpoint);
        }
      }
      return null;
    };

    const waitForResponse = async (id) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const evt = await nextEvent();
        if (!evt) break;
        if (evt.event !== "message") continue;
        const msg = safeJsonParse(evt.data);
        if (msg?.id === id) return msg;
      }
      return null;
    };

    endpointUrl = await waitForEndpoint();
    if (!endpointUrl) {
      console.warn("MCP SSE 未取得 endpoint");
      return null;
    }

    endpointUrl = resolveEndpointUrl(sseUrl, endpointUrl);

    const sendRpc = async (method, params) => {
      const id = rpcId++;
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };
      await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return waitForResponse(id);
    };

    const sendNotification = async (method, params) => {
      const payload = {
        jsonrpc: "2.0",
        method,
        params
      };
      await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    };

    const initResp = await sendRpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "perfume-assistant", version: "1.0.0" }
    });
    if (!initResp?.result) {
      console.warn("MCP initialize 未回傳結果");
      return null;
    }

    await sendNotification("initialized", {});

    const toolsResp = await sendRpc("tools/list", {});
    const tools = toolsResp?.result?.tools || [];
    if (!Array.isArray(tools) || tools.length === 0) {
      console.warn("MCP 未提供任何 tools");
      return null;
    }

    let toolName = process.env.MCP_TOOL_NAME;
    if (toolName && !tools.some(t => t.name === toolName)) {
      console.warn(`MCP_TOOL_NAME 找不到：${toolName}`);
      toolName = null;
    }

    if (!toolName) {
      const preferred = tools.find(t => /ask|query|search|lookup|answer/i.test(t.name));
      toolName = preferred?.name || tools[0].name;
    }

    const tool = tools.find(t => t.name === toolName);
    const toolArgs = pickToolArgs(tool, q);
    const toolResp = await sendRpc("tools/call", {
      name: toolName,
      arguments: toolArgs
    });

    const content = toolResp?.result?.content;
    if (Array.isArray(content)) {
      const text = content
        .map(item => item?.text || "")
        .filter(Boolean)
        .join("\n");
      if (text) {
        return { tool: toolName, content: text };
      }
    }

    return toolResp?.result ?? null;
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("MCP 呼叫失敗：", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/**
 * 取得 MCP tools 清單
 */
export async function listMcpTools() {
  const sseUrl = process.env.MCP_SSE_URL || DEFAULT_MCP_SSE_URL;
  const timeoutMs = Number(process.env.MCP_TIMEOUT_MS || DEFAULT_MCP_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(sseUrl, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal
    });

    if (!res.ok || !res.body) {
      console.warn(`MCP SSE 連線失敗：${res.status} ${res.statusText}`);
      return [];
    }

    const events = sseEventStream(res.body);
    const iterator = events[Symbol.asyncIterator]();
    let endpointUrl = null;
    let rpcId = 1;

    const nextEvent = async () => {
      const { value, done } = await iterator.next();
      return done ? null : value;
    };

    const waitForEndpoint = async () => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const evt = await nextEvent();
        if (!evt) break;
        if (evt.event === "endpoint") {
          return evt.data.trim();
        }
        const msg = safeJsonParse(evt.data);
        if (msg?.endpoint) {
          return String(msg.endpoint);
        }
      }
      return null;
    };

    const waitForResponse = async (id) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const evt = await nextEvent();
        if (!evt) break;
        if (evt.event !== "message") continue;
        const msg = safeJsonParse(evt.data);
        if (msg?.id === id) return msg;
      }
      return null;
    };

    endpointUrl = await waitForEndpoint();
    if (!endpointUrl) {
      console.warn("MCP SSE 未取得 endpoint");
      return [];
    }

    endpointUrl = resolveEndpointUrl(sseUrl, endpointUrl);

    const sendRpc = async (method, params) => {
      const id = rpcId++;
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        params
      };
      await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return waitForResponse(id);
    };

    const sendNotification = async (method, params) => {
      const payload = {
        jsonrpc: "2.0",
        method,
        params
      };
      await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    };

    const initResp = await sendRpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "perfume-assistant", version: "1.0.0" }
    });
    if (!initResp?.result) {
      console.warn("MCP initialize 未回傳結果");
      return [];
    }

    await sendNotification("initialized", {});

    const toolsResp = await sendRpc("tools/list", {});
    const tools = toolsResp?.result?.tools || [];
    return Array.isArray(tools) ? tools : [];
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("MCP 取得 tools 失敗：", error);
    }
    return [];
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
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

  if (typeof mcpData === "object" && mcpData.tool === "search_medical_codes" && mcpData.content) {
    const parsed = safeJsonParse(mcpData.content);
    const diagnoses = Array.isArray(parsed?.diagnoses) ? parsed.diagnoses : [];
    const procedures = Array.isArray(parsed?.procedures) ? parsed.procedures : [];
    const lines = [];

    if (diagnoses.length > 0) {
      lines.push("ICD-10 診斷碼：");
      for (const item of diagnoses.slice(0, 10)) {
        const code = item?.code || "";
        const name = item?.name_zh || item?.name_en || "";
        if (code || name) {
          lines.push(`- ${code}${name ? `：${name}` : ""}`);
        }
      }
    }

    if (procedures.length > 0) {
      lines.push("");
      lines.push("ICD-10 程序碼：");
      for (const item of procedures.slice(0, 10)) {
        const code = item?.code || "";
        const name = item?.name_zh || item?.name_en || "";
        if (code || name) {
          lines.push(`- ${code}${name ? `：${name}` : ""}`);
        }
      }
    }

    if (lines.length > 0) {
      return lines.join("\n");
    }
  }

  return null;
}
