import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { Theme } from "../App";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LauncherRepair } from "../components/LauncherRepair";
import { useToast } from "../components/Toasts";
import { Tooltip } from "../components/Tooltip";
import { AgentMark, Icon, Notice, PageHeader } from "../components/ui";
import { appSettings, emptySkillTrash, openFolder, pickAgentFolder, resetAgentFolder } from "../lib/api";
import type { Agent, AgentInfo, AppSettings, SecretListing } from "../lib/types";
import { errorText, LANGUAGES, t, type LanguageSetting } from "../lib/i18n";

const RELEASES = "https://github.com/AxelDoussoux/agentdeck/releases";

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
  language: LanguageSetting;
  setLanguage: (language: LanguageSetting) => void;
  onChange: () => void;
}

const THEMES: Theme[] = ["system", "light", "dark"];
const LANGUAGE_SETTINGS: LanguageSetting[] = ["system", "en", "fr"];

export function SettingsPage({ agents, secrets, version, theme, setTheme, language, setLanguage, onChange }: Props) {
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
      setLoadError(errorText(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const nameOf = (agent: string) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const open = (folder: Parameters<typeof openFolder>[0]) =>
    openFolder(folder).catch((err) => notify({ tone: "error", text: errorText(err) }));

  // Every page reads the agent's files from the new folder: reload them all.
  async function choose(agent: Agent) {
    try {
      if (!(await pickAgentFolder(agent))) return;
      notify({ tone: "success", text: t.settings.folderChosen(nameOf(agent)) });
    } catch (err) {
      notify({ tone: "error", text: errorText(err) });
    }
    await load();
    onChange();
  }

  async function reset(agent: Agent) {
    try {
      await resetAgentFolder(agent);
      notify({ tone: "success", text: t.settings.folderReset(nameOf(agent)) });
    } catch (err) {
      notify({ tone: "error", text: errorText(err) });
    }
    await load();
    onChange();
  }

  async function checkUpdates() {
    setUpdates({ kind: "checking" });
    try {
      const update = await check();
      setUpdates(update ? { kind: "available", update } : { kind: "latest" });
    } catch (err) {
      setUpdates({ kind: "error", text: t.settings.checkFailed(errorText(err)) });
    }
  }

  async function install(update: Update) {
    try {
      setUpdates({ kind: "installing", text: t.update.downloading });
      await update.downloadAndInstall();
      setUpdates({ kind: "installing", text: t.update.restarting });
      await relaunch();
    } catch (err) {
      setUpdates({ kind: "error", text: t.update.failed(errorText(err)) });
    }
  }

  async function emptyTrash() {
    try {
      const count = await emptySkillTrash();
      notify({ tone: "success", text: t.settings.trashEmptied(count) });
    } catch (err) {
      notify({ tone: "error", text: errorText(err) });
    }
    setEmptying(false);
    load();
  }

  return (
    <>
      <PageHeader title={t.settings.title} description={t.settings.description} />
      {loadError && <Notice tone="error">{loadError}</Notice>}

      <section className="card settings-section">
        <h2>{t.settings.appearance}</h2>
        <div className="setting-row">
          <span className="setting-label">{t.settings.theme}</span>
          <div className="segmented" role="radiogroup" aria-label={t.settings.theme}>
            {THEMES.map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={theme === option}
                className={theme === option ? "active" : undefined}
                onClick={() => setTheme(option)}
              >
                {t.settings.themes[option]}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">{t.settings.language}</span>
          <div className="segmented" role="radiogroup" aria-label={t.settings.language}>
            {LANGUAGE_SETTINGS.map((option) => (
              <button
                key={option}
                role="radio"
                aria-checked={language === option}
                className={language === option ? "active" : undefined}
                lang={option === "system" ? undefined : option}
                onClick={() => setLanguage(option)}
              >
                {option === "system" ? t.settings.systemLanguage : LANGUAGES[option].name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card settings-section">
        <h2>{t.settings.updates}</h2>
        <div className="setting-row">
          <span className="setting-label">
            AgentDeck {version ? `v${version}` : ""}
            <small>
              {updates.kind === "idle" && t.settings.checkedAtStart}
              {updates.kind === "checking" && t.settings.checking}
              {updates.kind === "latest" && t.settings.latest}
              {updates.kind === "available" && t.settings.versionAvailable(updates.update.version)}
              {updates.kind === "installing" && updates.text}
              {updates.kind === "error" && updates.text}
            </small>
          </span>
          <span className="setting-actions">
            <button className="small" onClick={() => openUrl(RELEASES)}>
              {t.settings.releaseNotes}
            </button>
            {updates.kind === "available" ? (
              <button className="primary small" onClick={() => install(updates.update)}>
                {t.update.install}
              </button>
            ) : (
              <button
                className="small"
                disabled={updates.kind === "checking" || updates.kind === "installing"}
                onClick={checkUpdates}
              >
                {t.settings.checkNow}
              </button>
            )}
          </span>
        </div>
      </section>

      <section className="card settings-section">
        <h2>{t.settings.folders}</h2>
        <p className="hint">{t.settings.foldersHint}</p>
        {settings?.folders.map((folder) => (
          <div className="setting-row" key={folder.agent}>
            <span className="setting-label">
              <span className="setting-agent">
                <AgentMark agent={folder.agent} size={18} /> {nameOf(folder.agent)}
              </span>
              <code>{folder.path}</code>
              {folder.moved && folder.variable ? (
                <small>{t.settings.setBy(folder.variable)}</small>
              ) : (
                folder.chosen && <small>{t.settings.chosen}</small>
              )}
            </span>
            <span className="setting-actions">
              <button className="small" onClick={() => open({ agent: folder.agent })}>
                {t.common.open}
              </button>
              <Tooltip text={folder.moved && folder.variable ? t.settings.setBy(folder.variable) : null}>
                <button className="small" disabled={folder.moved} onClick={() => choose(folder.agent)}>
                  {t.settings.change}
                </button>
              </Tooltip>
              {folder.chosen && !folder.moved && (
                <button className="small" onClick={() => reset(folder.agent)}>
                  {t.settings.useDefault}
                </button>
              )}
            </span>
          </div>
        ))}
      </section>

      <section className="card settings-section">
        <h2>{t.settings.protected}</h2>
        <div className="setting-row">
          <span className="setting-label">
            {t.settings.launcher}
            {settings?.launcher ? <code>{settings.launcher}</code> : <small>{t.settings.launcherMissing}</small>}
            <small>{t.settings.launcherHint}</small>
          </span>
        </div>
        {secrets && <LauncherRepair agents={agents} listing={secrets} onRepaired={onChange} />}
      </section>

      <section className="card settings-section">
        <h2>{t.settings.backups}</h2>
        <div className="setting-row">
          <span className="setting-label">
            <code>{settings?.backups}</code>
            <small>
              {settings && t.settings.backupsHint(settings.backupCount, settings.backupsKept)}
            </small>
          </span>
          <button className="small" onClick={() => open("backups")}>
            {t.common.open}
          </button>
        </div>
      </section>

      <section className="card settings-section">
        <h2>{t.settings.trash}</h2>
        <div className="setting-row">
          <span className="setting-label">
            <code>{settings?.trash}</code>
            <small>
              {settings &&
                (settings.trashCount === 0 ? t.settings.trashEmpty : t.settings.trashHint(settings.trashCount))}
            </small>
          </span>
          <span className="setting-actions">
            <button className="small" onClick={() => open("trash")}>
              {t.common.open}
            </button>
            <button className="small" disabled={!settings?.trashCount} onClick={() => setEmptying(true)}>
              <Icon name="close" size={14} /> {t.settings.emptyTrash}
            </button>
          </span>
        </div>
      </section>

      {emptying && settings && (
        <ConfirmDialog
          title={t.settings.emptyTitle}
          onCancel={() => setEmptying(false)}
          choices={[{ label: t.settings.deleteForGood, tone: "danger", onSelect: emptyTrash }]}
        >
          <p>{t.settings.emptyBody(settings.trashCount)}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
