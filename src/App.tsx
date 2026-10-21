import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo, McpListing, Transport } from "./types";
import "./App.css";

function describe(transport: Transport): string {
  return transport.kind === "stdio"
    ? [transport.command, ...transport.args].join(" ")
    : transport.url;
}

function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [listing, setListing] = useState<McpListing>({ servers: [], errors: [] });
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setAgents(await invoke<AgentInfo[]>("list_agents"));
      setListing(await invoke<McpListing>("list_mcp_servers"));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const nameOf = (agent: string) => agents.find((a) => a.agent === agent)?.name ?? agent;

  return (
    <main className="app">
      <header>
        <h1>AgentDeck</h1>
        <button onClick={refresh}>Refresh</button>
      </header>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Agents</h2>
        <ul className="agents">
          {agents.map((info) => (
            <li key={info.agent} className={info.installed ? "found" : "missing"}>
              <strong>{info.name}</strong>
              <span>{info.installed ? "Found" : "Not found"}</span>
              <code>{info.mcpConfigPath}</code>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>MCP servers</h2>
        {listing.errors.map((message) => (
          <p key={message} className="error">{message}</p>
        ))}
        {listing.servers.length === 0 ? (
          <p className="empty">No MCP server configured yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Name</th>
                <th>Target</th>
                <th>Secrets</th>
              </tr>
            </thead>
            <tbody>
              {listing.servers.map((server) => (
                <tr key={`${server.agent}/${server.name}`}>
                  <td>{nameOf(server.agent)}</td>
                  <td>{server.name}</td>
                  <td><code>{describe(server.transport)}</code></td>
                  <td>{server.envKeys.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export default App;
