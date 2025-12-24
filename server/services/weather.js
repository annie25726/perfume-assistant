import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// 確保載入 .env 檔案
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const CWA_API_KEY = process.env.CWA_API_KEY;

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: "JSON_PARSE_FAILED", raw: text };
  }
}

function normalizeCityName(city) {
  const map = {
    台北: "臺北市",
    新北: "新北市",
    桃園: "桃園市",
    台中: "臺中市",
    台南: "臺南市",
    高雄: "高雄市",
  };
  return map[city] || city;
}

export async function getCityWeather(city) {
  if (!CWA_API_KEY) {
    return { error: true, message: "CWA_API_KEY 未設定" };
  }

  const cityName = normalizeCityName(city);
  const url =
    "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001" +
    `?Authorization=${CWA_API_KEY}` +
    `&locationName=${encodeURIComponent(cityName)}`;

  const res = await fetch(url);
  const text = await res.text();
  const data = safeParseJSON(text);

  return {
    city: cityName,
    source: "CWA",
    raw: data
  };
}

export async function getTaiwanSummary() {
  if (!CWA_API_KEY) {
    return { error: true, message: "CWA_API_KEY 未設定" };
  }

  const url =
    "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001" +
    `?Authorization=${CWA_API_KEY}`;

  const res = await fetch(url);
  const text = await res.text();
  const data = safeParseJSON(text);

  return {
    source: "CWA",
    raw: data
  };
}

/* ======================
   將 CWA raw 轉成「人看得懂」
====================== */
export function formatCityWeather(raw, city) {
  try {
    // 檢查是否有錯誤
    if (raw?.error || !raw?.records) {
      console.error("CWA API 錯誤或無資料:", raw);
      return null;
    }

    const loc = raw?.records?.location?.[0];
    if (!loc) {
      console.error("找不到城市資料:", city);
      return null;
    }

    const elements = loc.weatherElement || [];

    const wx = elements.find(e => e.elementName === "Wx")
      ?.time?.[0]?.parameter?.parameterName;

    const minT = elements.find(e => e.elementName === "MinT")
      ?.time?.[0]?.parameter?.parameterName;

    const maxT = elements.find(e => e.elementName === "MaxT")
      ?.time?.[0]?.parameter?.parameterName;

    const pop = elements.find(e => e.elementName === "PoP")
      ?.time?.[0]?.parameter?.parameterName;

    // 計算平均溫度（用於顯示）
    const avgTemp = minT && maxT ? Math.round((parseInt(minT) + parseInt(maxT)) / 2) : null;

    return {
      city,
      weather: wx || "—",
      // 回傳多種格式以支援 buildWeatherReply 的查找邏輯
      temp: avgTemp,
      temperature: minT && maxT ? `${minT}～${maxT}` : null,
      minTemp: minT ? parseInt(minT) : null,
      maxTemp: maxT ? parseInt(maxT) : null,
      // 降雨機率（純數字，讓 buildWeatherReply 自己加 %）
      rain: pop ? parseInt(pop) : null,
      rainProbability: pop ? parseInt(pop) : null,
      precipitation_probability: pop ? parseInt(pop) : null,
      // 濕度：CWA F-C0032-001 API 不提供濕度資料，所以設為 null
      humidity: null,
      time: loc.weatherElement?.[0]?.time?.[0]?.startTime || ""
    };
  } catch (error) {
    console.error("formatCityWeather 錯誤:", error);
    return null;
  }
}
