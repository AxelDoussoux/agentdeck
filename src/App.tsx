import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useToast } from "./components/Toasts";
import { Icon, type IconName } from "./components/ui";
import { copyMcpServer, listAgents, listMcpServers, listSecrets, listSkills, undoChange } from "./lib/api";
import { shortcut, withModifier } from "./lib/keys";
import { byName } from "./lib/servers";
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

const SECTIONS = [
  { title: null, pages: [{ id: "overview", label: "Overview", icon: "overview" }] },
  {
    title: "Configure",
    pages: [
      { id: "mcp", label: "MCP servers", icon: "plug" },
      { id: "rules", label: "Rules", icon: "rules" },
      { id: "skills", label: "Skills", icon: "skills" },
      { id: "secrets", label: "Secrets", icon: "key" },
    ],
  },
  { title: "Insights", pages: [{ id: "history", label: "History & costs", icon: "chart" }] },
] as const satisfies readonly {
  title: string | null;
  pages: readonly { id: string; label: string; icon: IconName }[];
}[];

export type PageId = (typeof SECTIONS)[number]["pages"][number]["id"] | "settings";

const PAGES: readonly { id: PageId; label: string; icon: IconName }[] = SECTIONS.flatMap(
  (section): readonly { id: PageId; label: string; icon: IconName }[] => section.pages,
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
  /** What is unsaved, for example "Claude Code rules". */
  what: string;
  /** Saves the changes; resolves to false when saving failed. */
  save: () => Promise<boolean>;
}

export type Theme = "system" | "light" | "dark";
const THEMES: Theme[] = ["system", "light", "dark"];
const THEME_ICONS: Record<Theme, IconName> = { system: "monitor", light: "sun", dark: "moon" };

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
      setError(String(err));
    }
    // Only feeds the sidebar badge and the overview; the Secrets page loads its own.
    listSecrets().then(setSecrets, () => setSecrets(null));
  }

  useFilesChanged("mcp", refresh);

  useEffect(() => {
    refresh();
    getVersion().then(setVersion, () => {});
    const closing = getCurrentWindow().onCloseRequested((event) => {
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

  const serverCount = new Set(listing.servers.map((s) => s.name)).size;
  const plainSecrets = secrets?.secrets.filter((s) => s.likely && !s.vaultId).length ?? 0;
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
      const left = lost?.length ? ` Not carried over: ${lost.join(", ")}.` : "";
      notify({
        tone: "success",
        text: `Added ${name} to ${nameOf(to)}.${left}`,
        undo: async () => {
          await undoChange(undo);
          await refresh();
        },
      });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    await refresh();
  }

  function commands(): Command[] {
    const list: Command[] = PAGES.map((item, i) => ({
      label: item.label,
      icon: item.icon,
      hint: shortcut(String(i + 1)),
      keywords: "go to page",
      run: () => navigate(item.id),
    }));
    list.push(
      { label: "Add an MCP server", icon: "plus", keywords: "new", run: () => navigate("mcp", { kind: "add-server" }) },
      { label: "Settings", icon: "settings", keywords: "preferences theme updates backups trash folders", run: () => navigate("settings") },
      { label: "Reload configs", icon: "refresh", hint: shortcut("R"), keywords: "refresh", run: refresh },
      { label: `Switch to the ${nextTheme} theme`, icon: THEME_ICONS[nextTheme], keywords: "theme dark light", run: () => setTheme(nextTheme) },
    );
    for (const info of agents.filter((info) => info.rulesPath)) {
      list.push({
        label: `Edit ${info.name} rules`,
        icon: "rules",
        keywords: info.rulesPath ?? "",
        run: () => navigate("rules", { kind: "rules", agent: info.agent }),
      });
    }
    const rows = byName(listing);
    for (const name of rows.keys()) {
      list.push({ label: name, icon: "plug", hint: "MCP server", run: () => navigate("mcp", { kind: "server", name }) });
    }
    for (const name of skillNames) {
      list.push({ label: name, icon: "skills", hint: "Skill", run: () => navigate("skills", { kind: "skill", name }) });
    }
    for (const [name, copies] of rows) {
      const [source] = copies.values();
      for (const copy of copies.values()) {
        list.push({
          label: `Edit ${name} in ${nameOf(copy.agent)}`,
          icon: "plug",
          keywords: "change settings",
          run: () => navigate("mcp", { kind: "edit-server", name, agent: copy.agent }),
        });
      }
      for (const info of agents) {
        // Codex has no SSE servers.
        if (!info.installed || copies.has(info.agent)) continue;
        if (info.agent === "codex" && source.transport.kind === "sse") continue;
        list.push({
          label: `Copy ${name} to ${info.name}`,
          icon: "plus",
          keywords: "add",
          run: () => copyServer(name, source.agent, info.agent),
        });
      }
    }
    return list;
  }

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M5 19L12 5l7 14M8.5 13h7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <strong>AgentDeck</strong>
            <small>{version ? `v${version}` : "Control center"}</small>
          </div>
        </div>

        {SECTIONS.map((section) => (
          <div key={section.title ?? "main"} className="nav-section">
            {section.title && <span className="nav-title">{section.title}</span>}
            {section.pages.map((item) => {
              const badge = badges[item.id];
              return (
                <button
                  key={item.id}
                  className={`nav-item ${item.id === page ? "active" : ""}`}
                  aria-current={item.id === page ? "page" : undefined}
                  title={item.label}
                  onClick={() => navigate(item.id)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {badge && (
                    <span className={`badge ${badge.danger ? "badge-danger" : ""}`}>{badge.value}</span>
                  )}
                </button>
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
                      ? `Installed, no ${info.mcpConfigPath} yet`
                      : "Not found on this computer"
                }
              >
                <span className={`dot ${info.installed ? "dot-on" : ""}`} />
                {info.name}
              </li>
            ))}
          </ul>
          <div className="footer-actions">
            <button
              className="icon-button"
              onClick={() => setPalette(true)}
              title={`Search and commands (${shortcut("K")})`}
              aria-label="Search and commands"
            >
              <Icon name="search" />
            </button>
            <button
              className="icon-button"
              onClick={refresh}
              title={`Reload configs (${shortcut("R")})`}
              aria-label="Reload configs"
            >
              <Icon name="refresh" />
            </button>
            <button
              className={`icon-button ${page === "settings" ? "active" : ""}`}
              aria-current={page === "settings" ? "page" : undefined}
              onClick={() => navigate("settings")}
              title="Settings"
              aria-label="Settings"
            >
              <Icon name="settings" />
            </button>
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
              onChange={refresh}
            />
          )}
        </div>
      </main>

      {palette && <CommandPalette commands={commands()} onClose={() => setPalette(false)} />}

      {leaving && (
        <ConfirmDialog
          title="Unsaved changes"
          onCancel={() => setLeaving(null)}
          choices={[
            {
              label: "Discard",
              tone: "danger",
              onSelect: () => {
                setLeaving(null);
                leaving.proceed();
              },
            },
            {
              label: "Save",
              tone: "primary",
              onSelect: async () => {
                const saved = (await guard.current?.save()) ?? true;
                setLeaving(null);
                if (saved) leaving.proceed();
              },
            },
          ]}
        >
          Your changes to the {leaving.what} are not saved.
        </ConfirmDialog>
      )}
    </div>
  );
}

export default App;
