import { formatNumber, t } from "./i18n";
import type { UsageReport } from "./types";
import { formatCost, localDate, localDays } from "./usage";

// The monthly budget, and the alerts when spending crosses it. Both are kept
// on this computer only, in local storage.

const BUDGET = "monthlyBudget";
const ALERTS = "budgetAlerts";
/** The thresholds already told about, as `YYYY-MM:80`. */
const TOLD = "budgetAlerted";

/** Shares of the budget that raise an alert, the highest first. */
export const THRESHOLDS = [1, 0.8];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode or blocked storage: no budget and no alerts.
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the setting lasts until the app closes.
  }
}

export function budget(): number | null {
  const value = Number(read(BUDGET));
  return value > 0 ? value : null;
}

export function setBudget(amount: number | null) {
  write(BUDGET, amount && amount > 0 ? String(amount) : null);
}

/** Whether a notification is sent when spending crosses a threshold. */
export function alertsOn(): boolean {
  return read(ALERTS) !== "off";
}

export function setAlertsOn(on: boolean) {
  write(ALERTS, on ? null : "off");
}

/** The first day of this month, as the rest of the app writes dates. */
export function monthStart(): string {
  return `${localDate(new Date()).slice(0, 8)}01`;
}

/** What every agent cost since the first of the month. */
export function monthCost(report: UsageReport): number {
  const since = monthStart();
  return localDays(report)
    .filter((hour) => hour.date >= since)
    .reduce((sum, hour) => sum + hour.costUsd, 0);
}

/**
 * The highest threshold this month's spending has crossed and that has not
 * been told about yet, or `null`. Each threshold is told about once a month;
 * crossing the budget itself still alerts after the 80% alert.
 */
export function newThreshold(report: UsageReport): number | null {
  if (!alertsOn()) return null;
  const amount = budget();
  if (!amount) return null;
  const share = monthCost(report) / amount;
  const told = new Set((read(TOLD) ?? "").split(",").filter(Boolean));
  const month = monthStart().slice(0, 7);
  return THRESHOLDS.find((threshold) => share >= threshold && !told.has(`${month}:${threshold}`)) ?? null;
}

/**
 * Remembers that `threshold` was told about this month, and the lower ones
 * with it: once over the budget, being near it is old news.
 */
export function remember(threshold: number) {
  const month = monthStart().slice(0, 7);
  // Only this month's marks are kept: last month's say nothing.
  const told = (read(TOLD) ?? "").split(",").filter((mark) => mark.startsWith(`${month}:`));
  const passed = THRESHOLDS.filter((each) => each <= threshold).map((each) => `${month}:${each}`);
  write(TOLD, [...new Set([...told, ...passed])].join(","));
}

/** Tells about the thresholds again, after the budget changed. */
export function forget() {
  write(TOLD, null);
}

/**
 * Tells the user that this month's `spent` crossed `threshold` of the
 * budget, as a system notification. Asks once for permission, and does
 * nothing when it is refused.
 */
export async function alertBudget(threshold: number, spent: number, amount = budget()): Promise<void> {
  if (!amount) return;
  const { isPermissionGranted, requestPermission, sendNotification } = await import(
    "@tauri-apps/plugin-notification"
  );
  const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
  if (!granted) return;
  const words = t.history;
  sendNotification({
    title: threshold >= 1 ? words.alertOverTitle : words.alertNearTitle(formatNumber(threshold, { style: "percent" })),
    body: words.alertBody(formatCost(spent), formatCost(amount)),
  });
}
