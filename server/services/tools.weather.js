import fetch from "node-fetch";

const CITY_COORDS = {
  台北: { lat: 25.033, lon: 121.5654 },
  新北: { lat: 25.012, lon: 121.4637 },
  桃園: { lat: 24.9936, lon: 121.301 },
  台中: { lat: 24.1477, lon: 120.6736 },
  台南: { lat: 22.9999, lon: 120.227 },
  高雄: { lat: 22.6273, lon: 120.3014 }
};

export function listCities() {
  return Object.keys(CITY_COORDS);
}

export async function getWeather({ city, day = "tomorrow" }) {
  if (!CITY_COORDS[city]) {
    return { ok: false, error: `未知城市：${city}。可用：${listCities().join("、")}` };
  }

  // day: today|tonight|tomorrow|day_after
  const dayIndex =
    day === "today" || day === "tonight" ? 0 :
    day === "tomorrow" ? 1 : 2;

  const coord = CITY_COORDS[city];

  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: coord.lat,
      longitude: coord.lon,
      timezone: "Asia/Taipei",
      hourly: "precipitation_probability,temperature_2m",
      forecast_days: "3"
    });

  const res = await fetch(url);
  const data = await res.json();
  const h = data.hourly;

  const baseDate = h.time[0].slice(0, 10);
  const targetDate = new Date(baseDate);
  targetDate.setDate(targetDate.getDate() + dayIndex);
  const targetStr = targetDate.toISOString().slice(0, 10);

  const idxs = h.time
    .map((t, i) => ({ t, i }))
    .filter(o => o.t.startsWith(targetStr))
    .map(o => o.i);

  const maxProb = Math.max(...idxs.map(i => h.precipitation_probability[i]));
  const minTemp = Math.min(...idxs.map(i => h.temperature_2m[i]));
  const maxTemp = Math.max(...idxs.map(i => h.temperature_2m[i]));

  return {
    ok: true,
    city,
    day,
    maxProb,
    minTemp,
    maxTemp
  };
}
