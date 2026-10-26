import { usageReport } from "./api";
import { formatNumber } from "./i18n";
import type { HourUsage, UsageReport } from "./types";

/** Dollars, with cents below $10: "$4.20", "$37", or "4,20 $" in French. */
export const formatCost = (usd: number) =>
  formatNumber(usd, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: usd < 10 ? 2 : 0,
    maximumFractionDigits: usd < 10 ? 2 : 0,
  });

/** `YYYY-MM-DD` of a moment in the local time zone. */
export function localDate(moment: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;
}

/** Local dates from `days - 1` days ago to today. */
export function lastDays(days: number): string[] {
  const now = new Date();
  return Array.from({ length: days }, (_, i) =>
    localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i))),
  );
}

/** Local dates from `from` to `to`, both `YYYY-MM-DD` and included. */
export function datesBetween(from: string, to: string): string[] {
  const [y, m, d] = from.split("-").map(Number);
  const dates: string[] = [];
  for (let day = new Date(y, m - 1, d); localDate(day) <= to; day.setDate(day.getDate() + 1)) {
    dates.push(localDate(day));
  }
  return dates;
}

/** Local date of a UTC timestamp from the logs. */
export const dateOf = (timestamp: string) => localDate(new Date(timestamp));

/** Reading months of logs takes a while: a recent read is reused. */
let recent: { at: number; report: Promise<UsageReport> } | null = null;
const MAX_AGE = 5 * 60 * 1000;

/** The usage report, read again when the last one is old or the logs changed. */
export function recentUsage(): Promise<UsageReport> {
  if (!recent || Date.now() - recent.at > MAX_AGE) {
    recent = { at: Date.now(), report: usageReport() };
    recent.report.catch(() => (recent = null));
  }
  return recent.report;
}

/** Drops the cached report, so the next read sees the logs as they are. */
export function forgetUsage() {
  recent = null;
}

/** The core counts per UTC hour; days start at local midnight here. */
export const localDays = (report: UsageReport): (HourUsage & { date: string })[] =>
  report.hourly.map((h) => ({ ...h, date: dateOf(`${h.hour}:00:00Z`) }));

/** Estimated cost of each of the last `days` local days, oldest first. */
export function recentCost(report: UsageReport, days: number): { date: string; cost: number }[] {
  const dates = lastDays(days);
  const costs = new Map(dates.map((date) => [date, 0]));
  for (const hour of localDays(report)) {
    if (costs.has(hour.date)) costs.set(hour.date, costs.get(hour.date)! + hour.costUsd);
  }
  return dates.map((date) => ({ date, cost: costs.get(date)! }));
}
