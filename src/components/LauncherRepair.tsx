import { useState } from "react";
import { repairLaunchers } from "../lib/api";
import type { AgentInfo, SecretListing } from "../lib/types";
import { useToast } from "./Toasts";
import { Notice } from "./ui";
import { errorText, t } from "../lib/i18n";

/**
 * Warns that some protected servers no longer start because the `agentdeck`
 * launcher they run is gone, and points them at the current one.
 */
export function LauncherRepair({
  agents,
  listing,
  onRepaired,
}: {
  agents: AgentInfo[];
  listing: SecretListing;
  onRepaired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const { stranded, launcher } = listing;
  if (stranded.length === 0) return null;

  const nameOf = (agent: string) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const missing = [...new Set(stranded.map((s) => s.launcher))];
  const count = stranded.length;

  async function repair() {
    setBusy(true);
    try {
      const repaired = await repairLaunchers();
      notify({
        tone: "success",
        text: t.launcher.repaired(repaired),
      });
    } catch (err) {
      notify({ tone: "error", text: errorText(err) });
    }
    setBusy(false);
    onRepaired();
  }

  return (
    <Notice tone="error">
      <div className="notice-row repair">
        <span>
          <strong>{t.launcher.title(count)}</strong>
          {t.launcher.gone(<code>{missing[0]}</code>, missing.length - 1)}{" "}
          {launcher ? t.launcher.repairHint : t.launcher.reinstall}
          <small>{stranded.map((s) => `${s.server} (${nameOf(s.agent)})`).join(", ")}</small>
        </span>
        <button className="primary small" disabled={!launcher || busy} onClick={repair}>
          {busy ? t.launcher.repairing : t.launcher.repair}
        </button>
      </div>
    </Notice>
  );
}
