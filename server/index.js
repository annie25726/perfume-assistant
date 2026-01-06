import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 明確指定 .env 檔案路徑
dotenv.config({ path: path.join(__dirname, ".env") });

// 設定檔案上傳
const uploadsDir = path.join(__dirname, "data", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/* ===== Services ===== */
import {
  getCityWeather,
  getTaiwanSummary,
  formatCityWeather
} from "./services/weather.js";

import {
  getOrCreateSession,
  getIntentState,
  setIntentState
} from "./services/memory.js";

import { chatWithHuggingFace } from "./services/llm.js";

/* ======================
   Basic Setup
====================== */
const app = express();
const PORT = process.env.PORT || 5050;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

// 檔案上傳 API
app.post("/api/upload", upload.array("files", 10), (req, res) => {
  try {
    const files = req.files.map(file => ({
      name: file.originalname,
      size: file.size,
      path: file.path,
      url: `/uploads/${file.filename}`
    }));
    
    res.json({
      ok: true,
      files: files,
      message: `成功上傳 ${files.length} 個檔案`
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* ======================
   Utils
====================== */
function isWeatherIntent(text = "") {
  // 更精確的天氣查詢意圖判斷
  // 需要明確的查詢關鍵字，而不是單純提到天氣相關詞彙
  const weatherQueryPatterns = [
    /(查|看|問|想知道|了解).*天氣/,
    /天氣.*(如何|怎樣|怎麼樣|好嗎|如何|怎樣|如何|如何)/,
    /(今天|明天|後天|這週|下週).*天氣/,
    /(台北|新北|台中|台南|高雄|桃園|新竹|基隆|彰化|屏東|花蓮|台東).*天氣/,
    /天氣.*(台北|新北|台中|台南|高雄|桃園|新竹|基隆|彰化|屏東|花蓮|台東)/,
    /(北部|中部|南部|東部|全台).*天氣/,
    /天氣.*(北部|中部|南部|東部|全台)/,
    /(會|要|可能).*下雨/,
    /降雨機率/,
    /氣溫.*(多少|幾度)/
  ];
  
  // 排除純抱怨或描述性的句子
  const complaintPatterns = [
    /(很|非常|超|太).*(機車|煩|討厭|討厭|不爽)/,
    /(原本|剛才|剛剛).*(但|可是|不過)/
  ];
  
  // 如果是抱怨語氣，不觸發天氣查詢
  if (complaintPatterns.some(pattern => pattern.test(text))) {
    return false;
  }
  
  // 需要明確的查詢意圖
  return weatherQueryPatterns.some(pattern => pattern.test(text));
}

function extractCity(text = "") {
  const cities = [
    "台北","新北","基隆",
    "桃園","新竹",
    "台中","彰化",
    "台南","高雄",
    "屏東",
    "花蓮","台東"
  ];
  return cities.find(c => text.includes(c)) || null;
}

function extractRegion(text = "") {
  if (/北/.test(text)) return "北部";
  if (/中/.test(text)) return "中部";
  if (/南/.test(text)) return "南部";
  if (/東/.test(text)) return "東部";
  if (/全/.test(text)) return "全台";
  return null;
}

/* ======================
   100% 防 null
====================== */
function buildWeatherReply(city, weatherInput) {
  const weather =
    weatherInput && typeof weatherInput === "object"
      ? weatherInput
      : {};

  // 優先使用溫度範圍，否則使用平均溫度或單一溫度值
  let temp = "N/A";
  if (weather.temperature && typeof weather.temperature === "string") {
    // 如果已經是格式化的字串（如 "20～25"）
    temp = weather.temperature;
  } else if (weather.minTemp !== null && weather.maxTemp !== null) {
    // 如果有最小和最大溫度，顯示範圍
    temp = `${weather.minTemp}～${weather.maxTemp}`;
  } else if (weather.temp !== null && weather.temp !== undefined) {
    temp = weather.temp;
  } else if (weather.temperature_2m !== null && weather.temperature_2m !== undefined) {
    temp = weather.temperature_2m;
  }

  const rain =
    weather.rain ??
    weather.rainProbability ??
    weather.precipitation_probability ??
    "N/A";

  return [
    `這是目前【${city}】的天氣 ☀️`,
    ``,
    `🌡 氣溫：${temp}${temp !== "N/A" ? "°C" : ""}`,
    `🌧 降雨機率：${rain}${rain !== "N/A" ? "%" : ""}`
  ].join("\n");
}

/* ======================
   API: Chat
====================== */
app.post("/api/chat", async (req, res) => {
  const userText = String(req.body.message || "").trim();
  const sessionId = getOrCreateSession(req.body.sessionId);
  const intentState = getIntentState(sessionId);

  if (intentState?.intent === "weather" && !intentState?.done) {
    const city = extractCity(userText);
    const region = extractRegion(userText);

    if (city) {
      const raw = await getCityWeather(city);
      
      // 檢查 API 錯誤
      if (raw?.error) {
        setIntentState(sessionId, { intent: "weather", done: true });
        return res.json({
          ok: true,
          sessionId,
          type: "text",
          reply: `無法取得【${city}】的天氣資料：${raw.message || "API 錯誤"}`,
          engine: "weather",
          modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" }
        });
      }

      const weather = formatCityWeather(raw?.raw, city);
      
      if (!weather) {
        console.error("formatCityWeather 返回 null，原始資料:", JSON.stringify(raw?.raw, null, 2));
        setIntentState(sessionId, { intent: "weather", done: true });
        return res.json({
          ok: true,
          sessionId,
          type: "text",
          reply: `無法解析【${city}】的天氣資料，請稍後再試`,
          engine: "weather",
          modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" }
        });
      }

      setIntentState(sessionId, { intent: "weather", done: true });

      return res.json({
        ok: true,
        sessionId,
        type: "text",
        reply: buildWeatherReply(city, weather),
        engine: "weather",
        modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" },
        suggestions: [
          "還有什麼需要為您服務的嗎？",
          "其他城市的天氣如何？",
          "還有其他問題嗎？"
        ]
      });
    }

    if (region) {
      const summary = await getTaiwanSummary();
      setIntentState(sessionId, { intent: "weather", done: true });

      return res.json({
        ok: true,
        sessionId,
        type: "text",
        reply: `【${region}】天氣概況：\n${summary || "暫無資料"}`,
        engine: "weather",
        modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" }
      });
    }

    return res.json({
      ok: true,
      sessionId,
      type: "text",
      reply: "請選擇城市或直接告訴我縣市名稱",
      engine: "weather",
      modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" },
      showCityCards: true
    });
  }

  if (isWeatherIntent(userText)) {
    const city = extractCity(userText);
    const region = extractRegion(userText);

    if (city) {
      const raw = await getCityWeather(city);
      
      // 檢查 API 錯誤
      if (raw?.error) {
        setIntentState(sessionId, { intent: "weather", done: true });
        return res.json({
          ok: true,
          sessionId,
          type: "text",
          reply: `無法取得【${city}】的天氣資料：${raw.message || "API 錯誤"}`,
          engine: "weather",
          modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" }
        });
      }

      const weather = formatCityWeather(raw?.raw, city);
      
      if (!weather) {
        console.error("formatCityWeather 返回 null，原始資料:", JSON.stringify(raw?.raw, null, 2));
        setIntentState(sessionId, { intent: "weather", done: true });
        return res.json({
          ok: true,
          sessionId,
          type: "text",
          reply: `無法解析【${city}】的天氣資料，請稍後再試`,
          engine: "weather",
          modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" }
        });
      }

      setIntentState(sessionId, { intent: "weather", done: true });

      return res.json({
        ok: true,
        sessionId,
        type: "text",
        reply: buildWeatherReply(city, weather),
        engine: "weather",
        modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" },
        suggestions: [
          "還有什麼需要為您服務的嗎？",
          "其他城市的天氣如何？",
          "還有其他問題嗎？"
        ]
      });
    }

    if (region) {
      const summary = await getTaiwanSummary();
      setIntentState(sessionId, { intent: "weather", done: true });

      return res.json({
        ok: true,
        sessionId,
        type: "text",
        reply: `【${region}】天氣概況：\n${summary || "暫無資料"}`,
        engine: "weather",
        modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" }
      });
    }

    setIntentState(sessionId, { intent: "weather", done: false });

    return res.json({
      ok: true,
      sessionId,
      type: "text",
      reply: "你想查哪裡的天氣？請選擇城市或直接告訴我縣市名稱",
      engine: "weather",
      modelInfo: { model: "CWA API", api: "中央氣象署開放資料平台", provider: "CWA" },
      showCityCards: true
    });
  }

  // 檢查是否為否定回答（取消天氣查詢）
  if (/沒有|不用|不需要|不用了|算了|取消/.test(userText) && intentState?.intent === "weather") {
    setIntentState(sessionId, { intent: null, done: true });
  }

  const result = await chatWithHuggingFace({
    message: userText,
    sessionId
  });

  // 確保每次回答後都有建議問題（像 ChatGPT 一樣）
  // 除非是正在進行中的天氣查詢流程
  const suggestions = (!intentState || !intentState.intent || intentState.done) 
    ? (result.suggestions || [
        "還有什麼需要為您服務的嗎？",
        "還有其他問題嗎？",
        "想聊聊其他話題嗎？"
      ])
    : null;

  return res.json({
    ok: true,
    sessionId,
    type: "text",
    reply: result.reply,
    engine: result.engine,
    modelInfo: result.modelInfo,
    suggestions
  });
});

/* ======================
   Static Page
====================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat.html"));
});

/* ======================
   Start Server
====================== */
app.listen(PORT, () => {
  console.log(`✅ Server running http://localhost:${PORT}`);
});
