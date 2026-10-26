import { beforeEach, expect, it } from "vitest";
import { alertsOn, budget, forget, monthCost, newThreshold, remember, setAlertsOn, setBudget } from "./budget";
import type { UsageReport } from "./types";

/** A report whose hours are all in this month, costing `total` in all. */
function report(total: number, hour?: string): UsageReport {
  // Midday on the 2nd, so the local day is this month in every time zone.
  const when = hour ?? `${new Date().toISOString().slice(0, 7)}-02T12`;
  return {
    hourly: [{ agent: "claude-code", hour: when, costUsd: total, tokens: {} }],
    daily: [],
    sessions: [],
    errors: [],
  } as unknown as UsageReport;
}

beforeEach(() => {
  localStorage.clear();
});

it("has no budget and alerts on by default", () => {
  expect(budget()).toBe(null);
  expect(alertsOn()).toBe(true);
  expect(newThreshold(report(100))).toBe(null);
});

it("tells about each threshold once a month", () => {
  setBudget(100);
  expect(budget()).toBe(100);
  expect(newThreshold(report(79))).toBe(null);

  expect(newThreshold(report(80))).toBe(0.8);
  remember(0.8);
  expect(newThreshold(report(90))).toBe(null);

  // Over the budget itself still alerts, and only once.
  expect(newThreshold(report(101))).toBe(1);
  remember(1);
  expect(newThreshold(report(300))).toBe(null);

  // Spending that jumps straight past the budget reports the budget, and
  // then not the 80% it skipped.
  forget();
  expect(newThreshold(report(300))).toBe(1);
  remember(1);
  expect(newThreshold(report(300))).toBe(null);
});

it("says nothing when alerts are off", () => {
  setBudget(10);
  setAlertsOn(false);
  expect(alertsOn()).toBe(false);
  expect(newThreshold(report(50))).toBe(null);
  setAlertsOn(true);
  expect(newThreshold(report(50))).toBe(1);
});

it("counts only this month", () => {
  expect(monthCost(report(50, "2020-01-01T10"))).toBe(0);
  expect(monthCost(report(12.5))).toBe(12.5);
});

it("forgets the budget when it is cleared", () => {
  setBudget(10);
  setBudget(null);
  expect(budget()).toBe(null);
  expect(newThreshold(report(50))).toBe(null);
});
