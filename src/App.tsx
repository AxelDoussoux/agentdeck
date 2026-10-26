import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useToast } from "./components/Toasts";
import { Tooltip } from "./components/Tooltip";
import { Icon, type IconName } from "./components/ui";
import { applyProfile, copyMcpServer, listAgents, listMcpServers, listSecrets, listSkills, undoChange } from "./lib/api";
import { alertBudget, monthCost, newThreshold, remember } from "./lib/budget";
import { applyLanguage, errorText, formatList, storedLanguage, t, type LanguageSetting } from "./lib/i18n";
import { shortcut, withModifier } from "./lib/keys";
import { keepInTray, updateTray } from "./lib/tray";
import { byName } from "./lib/servers";
import { forgetUsage, recentUsage } from "./lib/usage";
import { useFilesChanged } from "./lib/watch";
import type { Agent, AgentInfo, McpListing, SecretListing } from "./lib/types";
import { HistoryPage } from "./pages/HistoryPage";
import { McpPage } from "./pages/McpPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RulesPage } from "./pages/RulesPage";
import { SecretsPage } from "./pages/SecretsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { UpdateBanner } from "./UpdateBanner";
import "./App.css";

/** The sidebar; labels are in `t.nav`, by page and section. */
const SECTIONS = [
  { title: null, pages: [{ id: "overview", icon: "overview" }] },
  {
    title: "configure",
    pages: [
      { id: "mcp", icon: "plug" },
      { id: "rules", icon: "rules" },
      { id: "skills", icon: "skills" },
      { id: "secrets", icon: "key" },
    ],
  },
  { title: "insights", pages: [{ id: "history", icon: "chart" }] },
] as const satisfies readonly {
  title: string | null;
  pages: readonly { id: string; icon: IconName }[];
}[];

export type PageId = (typeof SECTIONS)[number]["pages"][number]["id"] | "settings";

const PAGES: readonly { id: Exclude<PageId, "settings">; icon: IconName }[] = SECTIONS.flatMap(
  (section): readonly { id: Exclude<PageId, "settings">; icon: IconName }[] => section.pages,
);

/** What a page shows first when opened from the command palette. */
export type Focus =
  | { kind: "server"; name: string }
  | { kind: "add-server" }
  | { kind: "edit-server"; name: string; agent: Agent }
  | { kind: "skill"; name: string }
  | { kind: "rules"; agent: Agent };

/** Unsaved changes on the current page, which leaving it would lose. */
export interface UnsavedGuard {
  /** What is unsaved, for example "Claude Code rules", in the current language. */
  what: string;
  /** Saves the changes; resolves to false when saving failed. */
  save: () => Promise<boolean>;
}

export type Theme = "system" | "light" | "dark";
const THEMES: Theme[] = ["system", "light", "dark"];
const THEME_ICONS: Record<Theme, IconName> = { system: "monitor", light: "sun", dark: "moon" };

/** Below this width the sidebar shows only icons; see App.css. */
const NARROW = "(max-width: 760px)";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem("theme");
    return THEMES.includes(value as Theme) ? (value as Theme) : "system";
  } catch {
    return "system";
  }
}

function App() {
  const [page, setPage] = useState<PageId>("overview");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [listing, setListing] = useState<McpListing>({ servers: [], errors: [] });
  const [secrets, setSecrets] = useState<SecretListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [language, setLanguage] = useState<LanguageSetting>(storedLanguage);
  const [version, setVersion] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [palette, setPalette] = useState(false);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const notify = useToast();
  const guard = useRef<UnsavedGuard | null>(null);
  // What to do once the user has saved or discarded their changes.
  const [leaving, setLeaving] = useState<{ what: string; proceed: () => void } | null>(null);

  async function refresh() {
    try {
      setAgents(await listAgents());
      setListing(await listMcpServers());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
    // Only feeds the sidebar badge and the overview; the Secrets page loads its own.
    listSecrets().then(setSecrets, () => setSecrets(null));
    syncTray();
  }

  const syncTray = () => {
    // Without a tray icon there is nothing to update.
    updateTray().catch(() => {});
  };

  useFilesChanged("mcp", refresh);

  // Spending is checked when the app starts and when the logs change.
  const checkBudget = async () => {
    try {
      const report = await recentUsage();
      const threshold = newThreshold(report);
      if (threshold === null) return;
      // Marked before the notification goes out, so two checks at once
      // cannot both send it.
      remember(threshold);
      await alertBudget(threshold, monthCost(report));
    } catch {
      // No logs to read, or notifications refused: nothing to tell.
    }
  };
  useFilesChanged("usage", () => {
    forgetUsage();
    checkBudget();
    syncTray();
  });

  useEffect(() => {
    refresh();
    checkBudget();
    getVersion().then(setVersion, () => {});
    const closing = getCurrentWindow().onCloseRequested((event) => {
      if (keepInTray()) {
        // Hidden, the page keeps its state: nothing unsaved is lost.
        event.preventDefault();
        getCurrentWindow().hide();
        return;
      }
      const unsaved = guard.current;
      if (!unsaved) return;
      event.preventDefault();
      setLeaving({ what: unsaved.what, proceed: () => getCurrentWindow().destroy() });
    });
    return () => {
      closing.then((unlisten) => unlisten(), () => {});
    };
  }, []);

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Private mode or blocked storage: the choice just won't persist.
    }
  }, [theme]);

  function changeLanguage(setting: LanguageSetting) {
    // `t` changes at once; the new state re-renders every page with it.
    applyLanguage(setting);
    setLanguage(setting);
    syncTray();
  }

  const serverCount = new Set(listing.servers.map((s) => s.name)).size;
  const plainSecrets = secrets?.secrets.filter((s) => s.likely && !s.vaultId && !s.envVar).length ?? 0;
  const badges: Partial<Record<PageId, { value: number; danger?: boolean }>> = {
    mcp: serverCount ? { value: serverCount } : undefined,
    secrets: plainSecrets ? { value: plainSecrets, danger: true } : undefined,
  };
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

  function navigate(target: PageId, show: Focus | null = null) {
    const go = () => {
      if (target !== page) guard.current = null;
      setFocus(show);
      setPage(target);
      // Pages edit configs; keep counts in the sidebar current when coming back.
      if (target === "overview") refresh();
    };
    if (guard.current && target !== page) setLeaving({ what: guard.current.what, proceed: go });
    else go();
  }

  // What the tray menu asks for. The latest handlers are used, so they see
  // the current page and its unsaved changes.
  const tray = useRef<{ open: (page: PageId) => void; profile: (name: string) => void; quit: () => void }>(null);
  tray.current = {
    open: (target) => navigate(target),
    profile: async (name) => {
      try {
        const { undo, changed } = await applyProfile(name);
        notify({
          tone: "success",
          text: t.mcp.profileUsed(name, changed),
          undo: async () => {
            await undoChange(undo);
            await refresh();
          },
        });
      } catch (err) {
        notify({ tone: "error", text: errorText(err) });
      }
      await refresh();
    },
    quit: () => {
      const unsaved = guard.current;
      if (!unsaved) {
        exit(0);
        return;
      }
      const window = getCurrentWindow();
      window.show().then(() => window.setFocus(), () => {});
      setLeaving({ what: unsaved.what, proceed: () => exit(0) });
    },
  };
  useEffect(() => {
    const stops = [
      listen<PageId>("tray-open", (event) => tray.current?.open(event.payload)),
      listen<string>("tray-profile", (event) => tray.current?.profile(event.payload)),
      listen("tray-quit", () => tray.current?.quit()),
    ];
    return () => {
      for (const stop of stops) stop.then((unlisten) => unlisten(), () => {});
    };
  }, []);

  // A narrow window shows the sidebar as icons, with their labels as tips.
  const narrow = useMediaQuery(NARROW);

  // Shortcuts: the palette, a page by its place in the sidebar, reload.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (!withModifier(event) || leaving) return;
    const key = event.key.toLowerCase();
    const index = Number(key) - 1;
    if (key === "k") {
      event.preventDefault();
      setPalette((open) => !open);
    } else if (index >= 0 && index < PAGES.length) {
      event.preventDefault();
      setPalette(false);
      navigate(PAGES[index].id);
    } else if (key === "r") {
      // Reload the configs, not the window.
      event.preventDefault();
      refresh();
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (palette) listSkills().then((found) => setSkillNames([...new Set(found.skills.map((s) => s.name))]), () => {});
  }, [palette]);

  const nameOf = (agent: Agent) => agents.find((info) => info.agent === agent)?.name ?? agent;

  async function copyServer(name: string, from: Agent, to: Agent) {
    try {
      const { undo, lost } = await copyMcpServer(name, from, to);
      const left = lost?.length ? ` ${t.mcp.notCarried(formatList(lost))}` : "";
      notify({
        tone: "success",
        text: `${t.mcp.added(name, nameOf(to))}${left}`,
        undo: async () => {
          await undoChange(undo);
          await refresh();
        },
      });
    } catch (err) {
      notify({ tone: "error", text: errorText(err) });
    }
    await refresh();
  }

  function commands(): Command[] {
    const list: Command[] = PAGES.map((item, i) => ({
      label: t.nav[item.id],
      icon: item.icon,
      hint: shortcut(String(i + 1)),
      keywords: t.nav.keywords.page,
      run: () => navigate(item.id),
    }));
    list.push(
      { label: t.mcp.addTitle, icon: "plus", keywords: t.nav.keywords.add, run: () => navigate("mcp", { kind: "add-server" }) },
      { label: t.settings.title, icon: "settings", keywords: t.nav.keywords.settings, run: () => navigate("settings") },
      { label: t.nav.reload, icon: "refresh", hint: shortcut("R"), keywords: t.nav.keywords.reload, run: refresh },
      { label: t.nav.switchTheme[nextTheme], icon: THEME_ICONS[nextTheme], keywords: t.nav.keywords.theme, run: () => setTheme(nextTheme) },
    );
    for (const info of agents.filter((info) => info.rulesPath)) {
      list.push({
        label: t.nav.editRules(info.name),
        icon: "rules",
        keywords: info.rulesPath ?? "",
        run: () => navigate("rules", { kind: "rules", agent: info.agent }),
      });
    }
    const rows = byName(listing);
    for (const name of rows.keys()) {
      list.push({ label: name, icon: "plug", hint: t.nav.server, run: () => navigate("mcp", { kind: "server", name }) });
    }
    for (const name of skillNames) {
      list.push({ label: name, icon: "skills", hint: t.nav.skill, run: () => navigate("skills", { kind: "skill", name }) });
    }
    for (const [name, copies] of rows) {
      const [source] = copies.values();
      for (const copy of copies.values()) {
        list.push({
          label: t.serverForm.editTitle(name, nameOf(copy.agent)),
          icon: "plug",
          keywords: t.nav.keywords.edit,
          run: () => navigate("mcp", { kind: "edit-server", name, agent: copy.agent }),
        });
      }
      for (const info of agents) {
        // Codex has no SSE servers.
        if (!info.installed || copies.has(info.agent)) continue;
        if (info.agent === "codex" && source.transport.kind === "sse") continue;
        list.push({
          label: t.nav.copyTo(name, info.name),
          icon: "plus",
          keywords: t.nav.keywords.add,
          run: () => copyServer(name, source.agent, info.agent),
        });
      }
    }
    return list;
  }

  return (
    <div className="layout">
      <nav className="sidebar" aria-label={t.nav.main}>
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M5 19L12 5l7 14M8.5 13h7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <strong>AgentDeck</strong>
            <small>{version ? `v${version}` : t.nav.tagline}</small>
          </div>
        </div>

        {SECTIONS.map((section) => (
          <div key={section.title ?? "main"} className="nav-section">
            {section.title && <span className="nav-title">{t.nav[section.title]}</span>}
            {section.pages.map((item) => {
              const badge = badges[item.id];
              return (
                <Tooltip key={item.id} text={t.nav[item.id]} disabled={!narrow}>
                  <button
                    className={`nav-item ${item.id === page ? "active" : ""}`}
                    aria-current={item.id === page ? "page" : undefined}
                    onClick={() => navigate(item.id)}
                  >
                    <Icon name={item.icon} />
                    <span>{t.nav[item.id]}</span>
                    {badge && (
                      <span className={`badge ${badge.danger ? "badge-danger" : ""}`}>{badge.value}</span>
                    )}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        ))}

        <div className="sidebar-footer">
          <ul className="agent-status">
            {agents.map((info) => (
              <li
                key={info.agent}
                title={
                  info.hasConfig
                    ? info.mcpConfigPath
                    : info.installed
                      ? t.nav.noConfig(info.mcpConfigPath)
                      : t.nav.notFound
                }
              >
                <span className={`dot ${info.installed ? "dot-on" : ""}`} />
                {info.name}
              </li>
            ))}
          </ul>
          <div className="footer-actions">
            <Tooltip text={`${t.nav.search} (${shortcut("K")})`}>
              <button
                className="icon-button"
                onClick={() => setPalette(true)}
                aria-label={t.nav.search}
              >
                <Icon name="search" />
              </button>
            </Tooltip>
            <Tooltip text={`${t.nav.reload} (${shortcut("R")})`}>
              <button
                className="icon-button"
                onClick={refresh}
                aria-label={t.nav.reload}
              >
                <Icon name="refresh" />
              </button>
            </Tooltip>
            <Tooltip text={t.settings.title}>
              <button
                className={`icon-button ${page === "settings" ? "active" : ""}`}
                aria-current={page === "settings" ? "page" : undefined}
                onClick={() => navigate("settings")}
                aria-label={t.settings.title}
              >
                <Icon name="settings" />
              </button>
            </Tooltip>
          </div>
        </div>
      </nav>

      <main className="content">
        <div className="page">
          <UpdateBanner />
          {error && <p className="notice notice-error">{error}</p>}
          {page === "overview" && (
            <OverviewPage agents={agents} listing={listing} secrets={secrets} onNavigate={navigate} onChange={refresh} />
          )}
          {page === "mcp" && <McpPage agents={agents} listing={listing} onChange={refresh} focus={focus} />}
          {page === "rules" && (
            <RulesPage agents={agents} setGuard={(unsaved) => (guard.current = unsaved)} focus={focus} />
          )}
          {page === "skills" && <SkillsPage agents={agents} focus={focus} />}
          {page === "secrets" && <SecretsPage agents={agents} servers={listing} onChange={refresh} />}
          {page === "history" && <HistoryPage agents={agents} />}
          {page === "settings" && (
            <SettingsPage
              agents={agents}
              secrets={secrets}
              version={version}
              theme={theme}
              setTheme={setTheme}
              language={language}
              setLanguage={changeLanguage}
              onChange={refresh}
            />
          )}
        </div>
      </main>

      {palette && <CommandPalette commands={commands()} onClose={() => setPalette(false)} />}

      {leaving && (
        <ConfirmDialog
          title={t.common.unsaved}
          onCancel={() => setLeaving(null)}
          choices={[
            {
              label: t.common.discard,
              tone: "danger",
              onSelect: () => {
                setLeaving(null);
                leaving.proceed();
              },
            },
            {
              label: t.common.save,
              tone: "primary",
              onSelect: async () => {
                const saved = (await guard.current?.save()) ?? true;
                setLeaving(null);
                if (saved) leaving.proceed();
              },
            },
          ]}
        >
          {t.common.notSaved(leaving.what)}
        </ConfirmDialog>
      )}
    </div>
  );
}

export default App;
