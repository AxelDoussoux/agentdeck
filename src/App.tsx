import { useEffect, useState } from "react";
import { listAgents, listMcpServers } from "./lib/api";
import type { AgentInfo, McpListing } from "./lib/types";
import { AgentsPage } from "./pages/AgentsPage";
import { McpPage } from "./pages/McpPage";
import { RulesPage } from "./pages/RulesPage";
import "./App.css";

const PAGES = [
  { id: "agents", label: "Agents", ready: true },
  { id: "mcp", label: "MCP servers", ready: true },
  { id: "rules", label: "Rules", ready: true },
  { id: "skills", label: "Skills", ready: false },
  { id: "secrets", label: "Secrets", ready: false },
  { id: "history", label: "History & costs", ready: false },
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
            disabled={!item.ready}
            onClick={() => setPage(item.id)}
          >
            {item.label}
            {!item.ready && <span className="soon">soon</span>}
          </button>
        ))}
        <button className="refresh" onClick={refresh}>Refresh</button>
      </nav>

      <main className="content">
        {error && <p className="error">{error}</p>}
        {page === "agents" && <AgentsPage agents={agents} />}
        {page === "mcp" && <McpPage agents={agents} listing={listing} onChange={refresh} />}
        {page === "rules" && <RulesPage agents={agents} />}
      </main>
    </div>
  );
}

export default App;
