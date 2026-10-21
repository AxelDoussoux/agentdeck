import { useEffect, useState } from "react";
import { listAgents, listMcpServers } from "./lib/api";
import type { AgentInfo, McpListing } from "./lib/types";
import { AgentsPage } from "./pages/AgentsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { McpPage } from "./pages/McpPage";
import { RulesPage } from "./pages/RulesPage";
import { SecretsPage } from "./pages/SecretsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { UpdateBanner } from "./UpdateBanner";
import "./App.css";

const PAGES = [
  { id: "agents", label: "Agents" },
  { id: "mcp", label: "MCP servers" },
  { id: "rules", label: "Rules" },
  { id: "skills", label: "Skills" },
  { id: "secrets", label: "Secrets" },
  { id: "history", label: "History & costs" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

function App() {
  const [page, setPage] = useState<PageId>("mcp");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [listing, setListing] = useState<McpListing>({ servers: [], errors: [] });
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setAgents(await listAgents());
      setListing(await listMcpServers());
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>AgentDeck</h1>
        {PAGES.map((item) => (
          <button
            key={item.id}
            className={item.id === page ? "active" : undefined}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button className="refresh" onClick={refresh}>Refresh</button>
      </nav>

      <main className="content">
        <UpdateBanner />
        {error && <p className="error">{error}</p>}
        {page === "agents" && <AgentsPage agents={agents} />}
        {page === "mcp" && <McpPage agents={agents} listing={listing} onChange={refresh} />}
        {page === "rules" && <RulesPage agents={agents} />}
        {page === "skills" && <SkillsPage agents={agents} />}
        {page === "secrets" && <SecretsPage agents={agents} />}
        {page === "history" && <HistoryPage agents={agents} />}
      </main>
    </div>
  );
}

export default App;
