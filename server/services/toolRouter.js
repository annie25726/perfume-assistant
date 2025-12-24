import { getWeather, listCities } from "./tools.weather.js";

/**
 * 判斷是否為天氣問題
 */
function detectWeatherIntent(text) {
  const cities = listCities();
  const city = cities.find(c => text.includes(c));

  if (!city) return null;

  let day = "today";
  if (text.includes("明天")) day = "tomorrow";
  if (text.includes("後天")) day = "day_after";
  if (text.includes("今晚")) day = "tonight";

  return { city, day };
}

/**
 * 主 Router
 */
export async function routeToolIfNeeded(userMessage) {
  const weatherIntent = detectWeatherIntent(userMessage);

  if (weatherIntent) {
    const result = await getWeather(weatherIntent);
    return {
      usedTool: "weather",
      toolResult: result
    };
  }

  return null;
}
