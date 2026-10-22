import type { HourUsage, UsageReport } from "./types";

export const formatCost = (usd: number) => `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

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

/** Local date of a UTC timestamp from the logs. */
export const dateOf = (timestamp: string) => localDate(new Date(timestamp));

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
