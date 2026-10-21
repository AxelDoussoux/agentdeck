import { useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Icon } from "./components/ui";

/** Offers to install a new release, checked once at startup. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    // Offline, or a build without the updater: just stay quiet.
    check().then(setUpdate, () => {});
  }, []);

  if (!update) return null;

  async function install() {
    if (!update) return;
    try {
      setStatus("Downloading…");
      await update.downloadAndInstall();
      setStatus("Restarting…");
      await relaunch();
    } catch (err) {
      setStatus(`Update failed: ${err}`);
    }
  }

  return (
    <div className="update">
      <Icon name="download" />
      <span className="update-text">
        AgentDeck {update.version} is available (you have {update.currentVersion}).
      </span>
      {status ? (
        <span className="hint">{status}</span>
      ) : (
        <span className="actions">
          <button className="primary small" onClick={install}>Install and restart</button>
          <button className="small" onClick={() => setUpdate(null)}>Later</button>
        </span>
      )}
    </div>
  );
}
