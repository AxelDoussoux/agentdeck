import { afterEach, describe, expect, it, vi } from "vitest";
import { datesBetween, formatCost, lastDays, recentCost } from "./usage";
import { applyLanguage } from "./i18n";
import type { UsageReport } from "./types";

afterEach(() => {
  vi.useRealTimers();
  applyLanguage("en");
});

describe("dates", () => {
  it("datesBetween includes both ends and crosses a daylight saving change", () => {
    expect(datesBetween("2026-03-28", "2026-03-31")).toEqual(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    expect(datesBetween("2026-03-02", "2026-03-01")).toEqual([]);
  });

  it("lastDays ends today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 9));
    expect(lastDays(3)).toEqual(["2025-12-31", "2026-01-01", "2026-01-02"]);
  });
});

it("recentCost adds up hours by local day", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 15, 12));
  const hour = (utcHour: string, costUsd: number) => ({
    hour: utcHour,
    agent: "codex" as const,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    costUsd,
  });
  // Paris is two hours ahead in July: 22:00 UTC on the 13th is the 14th there.
  const report = {
    sessions: [],
    daily: [],
    errors: [],
    hourly: [hour("2026-07-13T21", 1), hour("2026-07-13T22", 2), hour("2026-07-15T08", 4), hour("2026-07-01T08", 8)],
  } as unknown as UsageReport;
  expect(recentCost(report, 3)).toEqual([
    { date: "2026-07-13", cost: 1 },
    { date: "2026-07-14", cost: 2 },
    { date: "2026-07-15", cost: 4 },
  ]);
});

it("formatCost keeps cents below ten dollars, in each language", () => {
  applyLanguage("en");
  expect(formatCost(4.2)).toBe("$4.20");
  expect(formatCost(37.4)).toBe("$37");
  applyLanguage("fr");
  expect(formatCost(4.2)).toBe("4,20\u00a0$");
});
