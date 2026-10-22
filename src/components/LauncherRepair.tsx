import { useState } from "react";
import { repairLaunchers } from "../lib/api";
import type { AgentInfo, SecretListing } from "../lib/types";
import { useToast } from "./Toasts";
import { Notice } from "./ui";

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
        text: `Repaired ${repaired} protected server${repaired === 1 ? "" : "s"}. Restart the agents that use them.`,
      });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    setBusy(false);
    onRepaired();
  }

  return (
    <Notice tone="error">
      <div className="notice-row repair">
        <span>
          <strong>
            {count} protected server{count === 1 ? " no longer starts" : "s no longer start"}
          </strong>
          Their agent runs the <code>agentdeck</code> launcher from <code>{missing[0]}</code>
          {missing.length > 1 && ` and ${missing.length - 1} other place${missing.length > 2 ? "s" : ""}`}, which is
          gone: AgentDeck was likely moved or reinstalled.{" "}
          {launcher
            ? "Repair points them at this copy; their secrets stay in the keychain."
            : "Reinstall AgentDeck, then repair them here."}
          <small>{stranded.map((s) => `${s.server} (${nameOf(s.agent)})`).join(", ")}</small>
        </span>
        <button className="primary small" disabled={!launcher || busy} onClick={repair}>
          {busy ? "Repairing…" : "Repair"}
        </button>
      </div>
    </Notice>
  );
}
