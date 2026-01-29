import fetch from "node-fetch";

const DEFAULT_ACCOUNTING_SSE_URL = "http://127.0.0.1:5050/mcp/accounting/sse";
const DEFAULT_MCP_TIMEOUT_MS = 8000;

const ACCOUNTING_INTENT_PATTERNS = [
  /記帳|記賬|帳本|帳戶|餘額|交易|明細|收支|支出|收入|分類|月度|財務|對帳|進帳|匯款|轉帳/,
];

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonFromText(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return safeJsonParse(match[0]);
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

const CATEGORY_KEYWORDS = [
  { id: "income", keywords: [/薪水|薪資|工資|獎金|收入|進帳|賺/] },
  { id: "food", keywords: [/餐飲|餐費|午餐|晚餐|早餐|吃|飲食|外賣|外送|美食/] },
  { id: "transport", keywords: [/交通|地鐵|捷運|公車|計程車|叫車|油錢|加油|高鐵/] },
  { id: "entertainment", keywords: [/娛樂|電影|遊戲|旅遊|演唱會|展覽/] },
  { id: "shopping", keywords: [/購物|衣服|鞋子|日用品|電商|買了/] },
  { id: "healthcare", keywords: [/醫療|看診|藥|藥品|醫院|體檢|掛號/] },
  { id: "education", keywords: [/教育|課程|書籍|學習|培訓|補習/] },
];

function detectCategory(question) {
  const text = String(question || "");
  for (const item of CATEGORY_KEYWORDS) {
    if (item.keywords.some(regex => regex.test(text))) {
      return item.id;
    }
  }
  return null;
}

function detectCategoryKeyword(question) {
  const text = String(question || "");
  for (const item of CATEGORY_KEYWORDS) {
    for (const regex of item.keywords) {
      const match = text.match(regex);
      if (match) return match[0];
    }
  }
  return null;
}

function parseChineseNumber(text) {
  const map = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const unitMap = { 十: 10, 百: 100, 千: 1000, 萬: 10000 };
  let total = 0;
  let current = 0;
  let unit = 1;
  for (const char of text) {
    if (map[char] != null) {
      current = map[char];
    } else if (unitMap[char]) {
      unit = unitMap[char];
      if (current === 0) current = 1;
      total += current * unit;
      current = 0;
      unit = 1;
    }
  }
  return total + current;
}

function detectAmount(question) {
  const text = String(question || "");
  const numberMatch = text.match(/-?\d+(?:\.\d+)?/);
  if (numberMatch) return Number(numberMatch[0]);

  const chineseMatch = text.match(/[零一二兩三四五六七八九十百千萬]+/);
  if (chineseMatch) return parseChineseNumber(chineseMatch[0]);

  return null;
}

function parseContent(content, raw) {
  const candidates = [];

  if (typeof content === "string") {
    candidates.push(content);
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.content === "string") {
      candidates.push(raw.content);
    }
    if (Array.isArray(raw.content)) {
      candidates.push(raw.content.map(item => item?.text || "").join("\n"));
    }
    if (typeof raw.result === "string") {
      candidates.push(raw.result);
    }
    if (raw.result && typeof raw.result === "object") {
      if (typeof raw.result.content === "string") {
        candidates.push(raw.result.content);
      }
      if (Array.isArray(raw.result.content)) {
        candidates.push(raw.result.content.map(item => item?.text || "").join("\n"));
      }
    }
  }

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate) || extractJsonFromText(candidate);
    if (parsed) return parsed;
  }

  if (content && typeof content === "object" && !Array.isArray(content)) {
    return content;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }

  return null;
}

function detectDate(question) {
  const text = String(question || "");
  const today = new Date();
  if (/今天/.test(text)) return today.toISOString().slice(0, 10);
  if (/昨天/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  if (/前天/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 2);
    return d.toISOString().slice(0, 10);
  }

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  const slashMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (slashMatch) {
    const year = today.getFullYear();
    const month = String(slashMatch[1]).padStart(2, "0");
    const day = String(slashMatch[2]).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
}

function normalizeAmount(question, amount) {
  if (amount == null || Number.isNaN(amount)) return null;
  const text = String(question || "");
  const isExpense = /支出|花|花費|付款|消費|買|付了|刷卡|搭捷運|捷運|公車|交通/.test(text);
  const isIncome = /收入|薪水|薪資|工資|獎金|進帳|賺/.test(text);
  const category = detectCategory(text);
  if (isExpense && amount > 0) return -amount;
  if (!isIncome && category && amount > 0) return -amount;
  if (isIncome && amount < 0) return Math.abs(amount);
  return amount;
}

function detectLimit(question) {
  const match = String(question || "").match(/最近(\d+)\s*筆/);
  if (match) return Math.min(Number(match[1]) || 20, 100);
  return null;
}

function getToolName(tool) {
  if (!tool) return null;
  if (typeof tool === "string") return tool;
  return tool.name || tool.id || tool.tool || tool.function?.name || null;
}

function getToolDescription(tool) {
  if (!tool || typeof tool !== "object") return "";
  return tool.description || tool.function?.description || "";
}

const TOOL_ALIASES = {
  get_balance: [/balance|餘額|剩餘/i],
  get_categories: [/categor|分類|類別/i],
  get_monthly_summary: [/month|summary|月|彙總|統計/i],
  list_transactions: [/list|transaction|交易|明細|紀錄/i],
  add_transaction: [/add|transaction|record|記帳|新增|記錄|支出|收入/i]
};

function resolveToolName(intent, tools) {
  const toolNames = tools.map(getToolName).filter(Boolean);
  if (!intent) return toolNames[0] || null;
  if (toolNames.includes(intent)) return intent;
  const patterns = TOOL_ALIASES[intent] || [];
  for (const tool of tools) {
    const name = getToolName(tool);
    const desc = getToolDescription(tool);
    if (!name) continue;
    if (patterns.some(re => re.test(name) || re.test(desc))) {
      return name;
    }
  }
  return toolNames[0] || null;
}

function pickToolIntent(question) {
  const text = String(question || "");
  if (/餘額|還有多少|剩多少/.test(text)) return "get_balance";
  if (/分類|類別/.test(text)) return "get_categories";
  if (/本月|月度|月報|統計|彙總/.test(text)) return "get_monthly_summary";
  if (/最近|交易|明細|列表|紀錄/.test(text)) return "list_transactions";
  if (/新增|記錄|記一筆|花了|支出|收入/.test(text)) return "add_transaction";
  return null;
}

function buildDescription(question, amountRaw, categoryKeyword) {
  let text = String(question || "");
  if (amountRaw != null) {
    text = text.replace(String(amountRaw), "");
  }
  if (categoryKeyword) {
    text = text.replace(categoryKeyword, "");
  }
  text = text.replace(/記帳|新增|記錄|記一筆|支出|收入|花了|花費|付款|消費|買了|進帳|轉帳|匯款|幫我|請幫我/g, "");
  text = text.replace(/今天|昨天|前天|元|塊/g, "");
  text = text.replace(/[，,。．！!：:;；]/g, " ").replace(/\s+/g, " ").trim();
  const cleaned = text || "";
  if (cleaned.length >= 2) return cleaned;
  if (categoryKeyword) return categoryKeyword;
  return "記帳";
}

function buildArgs(toolName, question) {
  const amountRaw = detectAmount(question);
  const amount = normalizeAmount(question, amountRaw);
  const category = detectCategory(question);
  const categoryKeyword = detectCategoryKeyword(question);
  const date = detectDate(question);

  if (toolName === "add_transaction") {
    if (amount == null) return null;
    const inferredCategory = category || (amount > 0 ? "income" : "other");
    return {
      amount,
      category: inferredCategory,
      description: buildDescription(question, amountRaw, categoryKeyword),
      ...(date ? { date } : {})
    };
  }

  if (toolName === "get_balance") {
    return { detailed: /詳細|統計/.test(String(question || "")) };
  }

  if (toolName === "list_transactions") {
    const limit = detectLimit(question);
    return {
      limit: limit || 20,
      category: category || undefined,
      ...(date ? { start_date: date, end_date: date } : {})
    };
  }

  if (toolName === "get_monthly_summary") {
    return {};
  }

  if (toolName === "get_categories") {
    return {};
  }

  return { question };
}

function hasAccountingVerb(text) {
  return /新增|記錄|記一筆|花了|支出|收入|花費|付款|消費|買了|進帳|轉帳|匯款|查詢|查看|看/.test(text);
}

export function shouldUseAccountingMcp(question = "") {
  const t = String(question || "");
  if (ACCOUNTING_INTENT_PATTERNS.some(r => r.test(t))) return true;
  if (detectCategory(t)) return true;
  const amount = detectAmount(t);
  if (amount != null && hasAccountingVerb(t)) return true;
  return false;
}

export function detectAccountingIntents(question = "") {
  const text = String(question || "");
  const intents = [];
  if (/餘額|還有多少|剩多少/.test(text)) intents.push("查詢餘額");
  if (/最近|交易|明細|列表|紀錄/.test(text)) intents.push("查詢交易");
  if (/本月|月度|月報|統計|彙總/.test(text)) intents.push("月度彙總");
  if (/分類|類別/.test(text)) intents.push("分類清單");
  if (/新增|記錄|記一筆|花了|支出|收入/.test(text)) intents.push("新增記帳");
  return [...new Set(intents)];
}

export async function callAccountingMcp({ question }) {
  const q = String(question || "").trim();
  if (!q) return null;

  const sseUrl = process.env.MCP_ACCOUNTING_SSE_URL || DEFAULT_ACCOUNTING_SSE_URL;
  const timeoutMs = Number(process.env.MCP_TIMEOUT_MS || DEFAULT_MCP_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(sseUrl, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal
    });

    if (!res.ok || !res.body) {
      console.warn(`Accounting MCP SSE 連線失敗：${res.status} ${res.statusText}`);
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
      console.warn("Accounting MCP SSE 未取得 endpoint");
      return null;
    }

    endpointUrl = resolveEndpointUrl(sseUrl, endpointUrl);

    const sendRpc = async (method, params) => {
      const id = rpcId++;
      const payload = { jsonrpc: "2.0", id, method, params };
      if (method === "tools/call" && params?.name) {
        payload.name = params.name;
        payload.arguments = params.arguments;
      }
      await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return waitForResponse(id);
    };

    const sendNotification = async (method, params) => {
      const payload = { jsonrpc: "2.0", method, params };
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
      console.warn("Accounting MCP initialize 未回傳結果");
      return null;
    }

    await sendNotification("notifications/initialized", {});

    const toolsResp = await sendRpc("tools/list", {});
    const tools = toolsResp?.result?.tools || [];
    if (!Array.isArray(tools) || tools.length === 0) {
      console.warn("Accounting MCP 未提供任何 tools");
      return null;
    }

    const runTool = async (questionSegment) => {
      const intent = pickToolIntent(questionSegment);
      const toolName = resolveToolName(intent, tools);
      if (!toolName) {
        console.warn("Accounting MCP 無法解析工具名稱");
        return null;
      }
      const toolArgs = buildArgs(intent || toolName, questionSegment);
      if (toolArgs == null) return null;
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
        return { tool: toolName, content: text, raw: toolResp?.result ?? null, input: questionSegment };
      }
      return { tool: toolName, content: toolResp?.result ?? null, raw: toolResp?.result ?? null, input: questionSegment };
    };

    const segments = q
      .split(/\n+/)
      .map(seg => seg.trim())
      .filter(Boolean);

    if (segments.length > 1) {
      const results = [];
      for (const segment of segments) {
        const res = await runTool(segment);
        if (res) results.push(res);
      }
      if (results.length === 0) return null;
      return { tool: "batch", content: null, results };
    }

    const single = await runTool(q);
    if (single?.content) {
      return { tool: single.tool, content: single.content };
    }
    return single;
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("Accounting MCP 呼叫失敗：", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export function tryAnswerFromAccountingMcp(mcpData) {
  if (!mcpData) return null;
  if (typeof mcpData === "string") return mcpData;

  const tool = mcpData.tool;
  const extractBalance = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    if (obj.balance != null) return obj.balance;
    if (obj.available_balance != null) return obj.available_balance;
    if (obj.total_balance != null) return obj.total_balance;
    if (obj.cash_balance != null) return obj.cash_balance;
    if (obj.summary?.balance != null) return obj.summary.balance;
    if (obj.result && obj.result.balance != null) return obj.result.balance;
    if (obj.data && obj.data.balance != null) return obj.data.balance;
    if (obj.account_summary && obj.account_summary.balance != null) return obj.account_summary.balance;
    if (obj.result && typeof obj.result === "string") {
      const nested = safeJsonParse(obj.result);
      const nestedBalance = extractBalance(nested);
      if (nestedBalance != null) return nestedBalance;
    }
    if (typeof obj.content === "string") {
      const match = obj.content.match(/(?:balance|餘額|剩餘)\s*[:：]?\s*(-?\d+(?:\.\d+)?)/i);
      if (match) return Number(match[1]);
      const nested = safeJsonParse(obj.content);
      return extractBalance(nested);
    }
    return null;
  };

  const formatToolReply = (toolName, parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.success === false) {
      return parsed.error ? `操作失敗：${parsed.error}` : "操作失敗，請稍後再試。";
    }

    if (toolName === "add_transaction") {
      return parsed.message || "已新增交易。";
    }

    if (toolName === "get_balance") {
      const balanceValue = extractBalance(parsed);
      const balance = balanceValue != null ? `目前餘額 NTD ${balanceValue}` : "已取得餘額資訊，但尚未回傳餘額數字。";
      const count = parsed.total_transactions != null ? `（共 ${parsed.total_transactions} 筆交易）` : "";
      return `${balance}${count}`;
    }

    if (toolName === "list_transactions") {
      const transactions =
        parsed.transactions ||
        parsed.items ||
        parsed.records ||
        parsed.data?.transactions ||
        parsed.data?.items ||
        parsed.result?.transactions ||
        parsed.result?.items ||
        [];
      const total =
        parsed.pagination?.total_count ??
        parsed.data?.pagination?.total_count ??
        parsed.result?.pagination?.total_count ??
        parsed.total_count ??
        parsed.total ??
        transactions.length ??
        0;
      const shown = Array.isArray(transactions) ? transactions.slice(0, 5) : [];
      const lines = shown.map(item =>
        `- ${item.date} ${item.category} NTD ${item.amount} ${item.description || ""}`.trim()
      );
      return [`交易筆數 ${total}，顯示 ${shown.length} 筆：`, ...lines].join("\n");
    }

    if (toolName === "get_monthly_summary") {
      const income = parsed.summary?.totals?.income ?? parsed.data?.summary?.totals?.income ?? parsed.total_income;
      const expense = parsed.summary?.totals?.expense ?? parsed.data?.summary?.totals?.expense ?? parsed.total_expense;
      const net = parsed.summary?.totals?.net_flow ?? parsed.data?.summary?.totals?.net_flow ?? parsed.net_flow;
      return `本月收入 NTD ${income}，支出 NTD ${expense}，淨流 NTD ${net}。`;
    }

    if (toolName === "get_categories") {
      const cats = parsed.categories?.all || parsed.data?.categories?.all || parsed.categories || parsed.data?.categories || [];
      const names = Array.isArray(cats) ? cats.map(c => c.name || c.id).filter(Boolean) : [];
      if (names.length > 0) {
        return `分類清單：${names.join("、")}`;
      }
    }

    return null;
  };

  if (tool === "batch") {
    const results = Array.isArray(mcpData.results) ? mcpData.results : [];
    const lines = [];
    for (const item of results) {
      const parsed = parseContent(item?.content, item?.raw);
      const summary = formatToolReply(item?.tool, parsed) || "已完成。";
      const header = item?.input ? `【${item.input}】` : `【${item?.tool || "記帳操作"}】`;
      lines.push(header);
      lines.push(summary);
      lines.push("");
    }
    return lines.join("\n").trim() || "已完成多筆記帳操作。";
  }

  const parsed = parseContent(mcpData.content, mcpData.raw);
  const summary = formatToolReply(tool, parsed);
  if (summary) return summary;

  return mcpData.content || null;
}

export async function listAccountingMcpTools() {
  const sseUrl = process.env.MCP_ACCOUNTING_SSE_URL || DEFAULT_ACCOUNTING_SSE_URL;
  const timeoutMs = Number(process.env.MCP_TIMEOUT_MS || DEFAULT_MCP_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(sseUrl, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal
    });

    if (!res.ok || !res.body) {
      console.warn(`Accounting MCP SSE 連線失敗：${res.status} ${res.statusText}`);
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
      console.warn("Accounting MCP SSE 未取得 endpoint");
      return [];
    }

    endpointUrl = resolveEndpointUrl(sseUrl, endpointUrl);

    const sendRpc = async (method, params) => {
      const id = rpcId++;
      const payload = { jsonrpc: "2.0", id, method, params };
      if (method === "tools/call" && params?.name) {
        payload.name = params.name;
        payload.arguments = params.arguments;
      }
      await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return waitForResponse(id);
    };

    const sendNotification = async (method, params) => {
      const payload = { jsonrpc: "2.0", method, params };
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
      console.warn("Accounting MCP initialize 未回傳結果");
      return [];
    }

    await sendNotification("notifications/initialized", {});

    const toolsResp = await sendRpc("tools/list", {});
    const tools = toolsResp?.result?.tools || [];
    return Array.isArray(tools) ? tools : [];
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("Accounting MCP 取得 tools 失敗：", error);
    }
    return [];
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
