import { describe, expect, it, vi, afterEach } from "vitest";
import { describe as say, forecast } from "../src/weather/forecast.js";

// A real Open-Meteo response shape, trimmed to the fields we ask for.
const sample = {
  daily: {
    time: ["2026-09-25"],
    weather_code: [61],
    temperature_2m_max: [28.4],
    temperature_2m_min: [19.6],
    precipitation_probability_max: [55],
  },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => `2026-09-25T${String(i).padStart(2, "0")}:00`),
    temperature_2m: Array.from({ length: 24 }, (_, i) => 18 + i * 0.4),
    precipitation_probability: Array.from({ length: 24 }, () => 40),
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("weather", () => {
  it("parses a forecast and describes it in one line", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => sample })));
    vi.setSystemTime(new Date("2026-09-25T06:00:00+03:00"));
    const f = await forecast();
    expect(f.today).toMatchObject({ min: 20, max: 28, rainChance: 55, summary: "light rain" });
    expect(f.hours.length).toBeGreaterThan(0);
    const text = say(f);
    expect(text).toContain("light rain");
    expect(text).toContain("20° to 28°");
    expect(text).toContain("55% chance of rain");
    vi.useRealTimers();
  });

  it("omits the rain note when rain is unlikely", async () => {
    const dry = { ...sample, daily: { ...sample.daily, weather_code: [0], precipitation_probability_max: [5] } };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => dry })));
    const text = say(await forecast());
    expect(text).toContain("clear");
    expect(text).not.toContain("chance of rain");
  });

  it("throws a readable error when the service is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(forecast()).rejects.toThrow(/503/);
  });
});
