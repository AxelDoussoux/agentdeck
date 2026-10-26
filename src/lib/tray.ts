import { invoke } from "@tauri-apps/api/core";
import { healthReport, listProfiles } from "./api";
import { budget, monthCost } from "./budget";
import { t } from "./i18n";
import { formatCost, recentUsage } from "./usage";

// The tray icon's menu, and whether closing the window keeps the app there.
// The setting is kept on this computer only, in local storage.

const KEEP = "keepInTray";

export function keepInTray(): boolean {
  try {
    return localStorage.getItem(KEEP) === "on";
  } catch {
    return false;
  }
}

export function setKeepInTray(on: boolean) {
  try {
    if (on) localStorage.setItem(KEEP, "on");
    else localStorage.removeItem(KEEP);
  } catch {
    // Blocked storage: the setting lasts until the app closes.
  }
}

/** Fills the tray menu with what needs attention, the cost and the profiles. */
export async function updateTray(): Promise<void> {
  const words = t.tray;
  const [findings, report, listing] = await Promise.all([
    healthReport().catch(() => null),
    recentUsage().catch(() => null),
    listProfiles().catch(() => null),
  ]);
  const amount = budget();
  const spent = report ? formatCost(monthCost(report)) : null;
  await invoke("update_tray", {
    summary: {
      tooltip: "AgentDeck",
      health: findings === null ? null : findings.length ? words.attention(findings.length) : words.healthy,
      cost: spent === null ? null : amount ? words.costOf(spent, formatCost(amount)) : words.cost(spent),
      profilesTitle: words.profiles,
      profiles: listing?.profiles.map((profile) => profile.name) ?? [],
      active: listing?.active ?? null,
      open: words.open,
      quit: words.quit,
    },
  });
}
