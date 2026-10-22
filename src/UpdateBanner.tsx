import { useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Icon } from "./components/ui";
import { errorText, t } from "./lib/i18n";

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
      setStatus(t.update.downloading);
      await update.downloadAndInstall();
      setStatus(t.update.restarting);
      await relaunch();
    } catch (err) {
      setStatus(t.update.failed(errorText(err)));
    }
  }

  return (
    <div className="update">
      <Icon name="download" />
      <span className="update-text">
        {t.update.available(update.version, update.currentVersion)}
      </span>
      {status ? (
        <span className="hint">{status}</span>
      ) : (
        <span className="actions">
          <button className="primary small" onClick={install}>{t.update.install}</button>
          <button className="small" onClick={() => setUpdate(null)}>{t.update.later}</button>
        </span>
      )}
    </div>
  );
}
