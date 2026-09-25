/**
 * Weather from Open-Meteo: free, no account, no key, no tracking.
 * Used in the morning brief and when asked.
 */
import { config } from "../config.js";

export interface Forecast {
  place: string;
  today: { min: number; max: number; rainChance: number; summary: string };
  hours: { hour: string; temp: number; rainChance: number }[];
}

const CODES: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "rain showers",
  82: "heavy rain showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

export async function forecast(): Promise<Forecast> {
  const c = config();
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(c.WEATHER_LAT));
  url.searchParams.set("longitude", String(c.WEATHER_LON));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability");
  url.searchParams.set("timezone", c.TIMEZONE);
  url.searchParams.set("forecast_days", "1");

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const d = (await res.json()) as {
    daily: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
    hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[] };
  };

  const nowHour = new Date().getHours();
  const hours = d.hourly.time
    .map((t, i) => ({ hour: t.slice(11, 16), h: Number(t.slice(11, 13)), temp: Math.round(d.hourly.temperature_2m[i]), rainChance: d.hourly.precipitation_probability[i] ?? 0 }))
    .filter((x) => x.h >= Math.max(nowHour, 7) && x.h <= 22 && x.h % 3 === 0)
    .map(({ hour, temp, rainChance }) => ({ hour, temp, rainChance }));

  return {
    place: c.WEATHER_PLACE,
    today: {
      min: Math.round(d.daily.temperature_2m_min[0]),
      max: Math.round(d.daily.temperature_2m_max[0]),
      rainChance: d.daily.precipitation_probability_max[0] ?? 0,
      summary: CODES[d.daily.weather_code[0]] ?? "mixed",
    },
    hours,
  };
}

export function describe(f: Forecast): string {
  const rain = f.today.rainChance >= 30 ? `, ${f.today.rainChance}% chance of rain` : "";
  const byHour = f.hours.map((h) => `${h.hour} ${h.temp}°`).join(", ");
  return `${f.place}: ${f.today.summary}, ${f.today.min}° to ${f.today.max}°${rain}.\nDuring the day: ${byHour}`;
}
