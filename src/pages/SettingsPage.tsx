import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { Theme } from "../App";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LauncherRepair } from "../components/LauncherRepair";
import { useToast } from "../components/Toasts";
import { AgentMark, Icon, Notice, PageHeader } from "../components/ui";
import { appSettings, emptySkillTrash, openFolder } from "../lib/api";
import type { AgentInfo, AppSettings, SecretListing } from "../lib/types";

const RELEASES = "https://github.com/AxelDoussoux/agentdeck/releases";

const THEME_LABELS: Record<Theme, string> = { system: "Match the system", light: "Light", dark: "Dark" };

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; update: Update }
  | { kind: "installing"; text: string }
  | { kind: "error"; text: string };

interface Props {
  agents: AgentInfo[];
  secrets: SecretListing | null;
  version: string | null;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onChange: () => void;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function SettingsPage({ agents, secrets, version, theme, setTheme, onChange }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<UpdateState>({ kind: "idle" });
  const [emptying, setEmptying] = useState(false);
  const notify = useToast();

  async function load() {
    try {
      setSettings(await appSettings());
      setLoadError(null);
    } catch (err) {
      setLoadError(String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const nameOf = (agent: string) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const open = (folder: Parameters<typeof openFolder>[0]) =>
    openFolder(folder).catch((err) => notify({ tone: "error", text: String(err) }));

  async function checkUpdates() {
    setUpdates({ kind: "checking" });
    try {
      const update = await check();
      setUpdates(update ? { kind: "available", update } : { kind: "latest" });
    } catch (err) {
      setUpdates({ kind: "error", text: `Could not check for updates: ${err}` });
    }
  }

  async function install(update: Update) {
    try {
      setUpdates({ kind: "installing", text: "Downloading…" });
      await update.downloadAndInstall();
      setUpdates({ kind: "installing", text: "Restarting…" });
      await relaunch();
    } catch (err) {
      setUpdates({ kind: "error", text: `Update failed: ${err}` });
    }
  }

  async function emptyTrash() {
    try {
      const count = await emptySkillTrash();
      notify({ tone: "success", text: `Deleted ${plural(count, "skill", "skills")} for good.` });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    setEmptying(false);
    load();
  }

  return (
    <>
      <PageHeader title="Settings" description="How AgentDeck looks, where it finds each agent, and the files it keeps." />
      {loadError && <Notice tone="error">{loadError}</Notice>}

      <section className="card settings-section">
        <h2>Appearance</h2>
        <div className="setting-row">
          <span className="setting-label">Theme</span>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(Object.keys(THEME_LABELS) as Theme[]).map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={theme === option}
                className={theme === option ? "active" : undefined}
                onClick={() => setTheme(option)}
              >
                {THEME_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card settings-section">
        <h2>Updates</h2>
        <div className="setting-row">
          <span className="setting-label">
            AgentDeck {version ? `v${version}` : ""}
            <small>
              {updates.kind === "idle" && "Checked when the app starts."}
              {updates.kind === "checking" && "Checking…"}
              {updates.kind === "latest" && "This is the latest version."}
              {updates.kind === "available" && `Version ${updates.update.version} is available.`}
              {updates.kind === "installing" && updates.text}
              {updates.kind === "error" && updates.text}
            </small>
          </span>
          <span className="setting-actions">
            <button className="small" onClick={() => openUrl(RELEASES)}>
              Release notes
            </button>
            {updates.kind === "available" ? (
              <button className="primary small" onClick={() => install(updates.update)}>
                Install and restart
              </button>
            ) : (
              <button
                className="small"
                disabled={updates.kind === "checking" || updates.kind === "installing"}
                onClick={checkUpdates}
              >
                Check now
              </button>
            )}
          </span>
        </div>
      </section>

      <section className="card settings-section">
        <h2>Agent folders</h2>
        <p className="hint">
          Where AgentDeck reads and writes each agent's files. Claude Code and Codex use another folder when{" "}
          <code>CLAUDE_CONFIG_DIR</code> or <code>CODEX_HOME</code> is set, and AgentDeck follows them.
        </p>
        {settings?.folders.map((folder) => (
          <div className="setting-row" key={folder.agent}>
            <span className="setting-label">
              <span className="setting-agent">
                <AgentMark agent={folder.agent} size={18} /> {nameOf(folder.agent)}
              </span>
              <code>{folder.path}</code>
              {folder.variable && (
                <small>{folder.moved ? `Set by ${folder.variable}.` : `Set ${folder.variable} to move it.`}</small>
              )}
            </span>
            <button className="small" onClick={() => open({ agent: folder.agent })}>
              Open
            </button>
          </div>
        ))}
      </section>

      <section className="card settings-section">
        <h2>Protected servers</h2>
        <div className="setting-row">
          <span className="setting-label">
            Launcher
            {settings?.launcher ? <code>{settings.launcher}</code> : <small>Not found: reinstall AgentDeck.</small>}
            <small>Servers whose keys are in the keychain start through this <code>agentdeck</code> command.</small>
          </span>
        </div>
        {secrets && <LauncherRepair agents={agents} listing={secrets} onRepaired={onChange} />}
      </section>

      <section className="card settings-section">
        <h2>Backups</h2>
        <div className="setting-row">
          <span className="setting-label">
            <code>{settings?.backups}</code>
            <small>
              {settings &&
                `${plural(settings.backupCount, "backup", "backups")}. Each write keeps the previous version; the last ${settings.backupsKept} of each file are kept.`}
            </small>
          </span>
          <button className="small" onClick={() => open("backups")}>
            Open
          </button>
        </div>
      </section>

      <section className="card settings-section">
        <h2>Skills trash</h2>
        <div className="setting-row">
          <span className="setting-label">
            <code>{settings?.trash}</code>
            <small>
              {settings &&
                (settings.trashCount === 0
                  ? "Empty."
                  : `${plural(settings.trashCount, "skill", "skills")} removed or replaced, which you can restore from the Skills page.`)}
            </small>
          </span>
          <span className="setting-actions">
            <button className="small" onClick={() => open("trash")}>
              Open
            </button>
            <button className="small" disabled={!settings?.trashCount} onClick={() => setEmptying(true)}>
              <Icon name="close" size={14} /> Empty trash
            </button>
          </span>
        </div>
      </section>

      {emptying && settings && (
        <ConfirmDialog
          title="Empty the skills trash?"
          onCancel={() => setEmptying(false)}
          choices={[{ label: "Delete for good", tone: "danger", onSelect: emptyTrash }]}
        >
          <p>
            {plural(settings.trashCount, "skill is", "skills are")} deleted for good. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
