import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Icon, type IconName } from "./components/ui";
import { listAgents, listMcpServers, listSecrets } from "./lib/api";
import type { AgentInfo, McpListing, SecretListing } from "./lib/types";
import { HistoryPage } from "./pages/HistoryPage";
import { McpPage } from "./pages/McpPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RulesPage } from "./pages/RulesPage";
import { SecretsPage } from "./pages/SecretsPage";
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

export type PageId = (typeof SECTIONS)[number]["pages"][number]["id"];

/** Unsaved changes on the current page, which leaving it would lose. */
export interface UnsavedGuard {
  /** What is unsaved, for example "Claude Code rules". */
  what: string;
  /** Saves the changes; resolves to false when saving failed. */
  save: () => Promise<boolean>;
}

type Theme = "system" | "light" | "dark";
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

  function navigate(target: PageId) {
    const go = () => {
      guard.current = null;
      setPage(target);
      // Pages edit configs; keep counts in the sidebar current when coming back.
      if (target === "overview") refresh();
    };
    if (guard.current && target !== page) setLeaving({ what: guard.current.what, proceed: go });
    else go();
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
              <li key={info.agent} title={info.installed ? info.mcpConfigPath : "Not found on this computer"}>
                <span className={`dot ${info.installed ? "dot-on" : ""}`} />
                {info.name}
              </li>
            ))}
          </ul>
          <div className="footer-actions">
            <button className="icon-button" onClick={refresh} title="Reload configs" aria-label="Reload configs">
              <Icon name="refresh" />
            </button>
            <button
              className="icon-button"
              onClick={() => setTheme(nextTheme)}
              title={`Theme: ${theme} (switch to ${nextTheme})`}
              aria-label={`Theme: ${theme}. Switch to ${nextTheme}`}
            >
              <Icon name={THEME_ICONS[theme]} />
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
          {page === "mcp" && <McpPage agents={agents} listing={listing} onChange={refresh} />}
          {page === "rules" && (
            <RulesPage agents={agents} setGuard={(unsaved) => (guard.current = unsaved)} />
          )}
          {page === "skills" && <SkillsPage agents={agents} />}
          {page === "secrets" && <SecretsPage agents={agents} onChange={refresh} />}
          {page === "history" && <HistoryPage agents={agents} />}
        </div>
      </main>

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
