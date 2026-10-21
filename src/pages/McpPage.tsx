import { useState } from "react";
import { addMcpServer, copyMcpServer, removeMcpServer } from "../lib/api";
import type { Agent, AgentInfo, McpListing, McpServer, ServerSpec, Transport } from "../lib/types";

function describe(transport: Transport): string {
  switch (transport.kind) {
    case "stdio":
      return [transport.command, ...transport.args].join(" ");
    case "http":
      return transport.url;
    case "sse":
      return `${transport.url} (SSE)`;
  }
}

interface Props {
  agents: AgentInfo[];
  listing: McpListing;
  onChange: () => Promise<void>;
}

export function McpPage({ agents, listing, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  // One row per server name, one column per agent.
  const rows = new Map<string, Map<Agent, McpServer>>();
  for (const server of listing.servers) {
    if (!rows.has(server.name)) rows.set(server.name, new Map());
    rows.get(server.name)!.set(server.agent, server);
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(String(err));
    }
    setPendingRemoval(null);
    await onChange();
  }

  return (
    <>
      <h2>MCP servers</h2>
      {[...listing.errors, ...(error ? [error] : [])].map((message) => (
        <p key={message} className="error">{message}</p>
      ))}

      {rows.size === 0 ? (
        <p className="empty">No MCP server configured yet.</p>
      ) : (
        <table className="matrix">
          <thead>
            <tr>
              <th>Server</th>
              {agents.map((info) => (
                <th key={info.agent}>{info.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows].map(([name, byAgent]) => {
              const [source] = byAgent.values();
              return (
                <tr key={name}>
                  <td className="server">
                    <strong>{name}</strong>
                    <code>{describe(source.transport)}</code>
                    {source.envKeys.length + source.headerKeys.length > 0 && (
                      <small>Secrets: {[...source.envKeys, ...source.headerKeys].join(", ")}</small>
                    )}
                  </td>
                  {agents.map(({ agent }) => {
                    const key = `${agent}/${name}`;
                    if (byAgent.has(agent)) {
                      return (
                        <td key={agent} className="present">
                          {pendingRemoval === key ? (
                            <button
                              className="danger"
                              onClick={() => run(() => removeMcpServer(agent, name))}
                            >
                              Remove?
                            </button>
                          ) : (
                            <button title="Click to remove" onClick={() => setPendingRemoval(key)}>
                              ✓ Installed
                            </button>
                          )}
                        </td>
                      );
                    }
                    const unsupported = agent === "codex" && source.transport.kind === "sse";
                    return (
                      <td key={agent}>
                        <button
                          className="ghost"
                          disabled={unsupported}
                          title={unsupported ? "Codex does not support SSE servers" : undefined}
                          onClick={() => run(() => copyMcpServer(name, source.agent, agent))}
                        >
                          + Add here
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <AddServerForm agents={agents} onAdd={(agent, name, spec) => run(() => addMcpServer(agent, name, spec))} />
    </>
  );
}

function parsePairs(text: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) pairs[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return pairs;
}

interface FormProps {
  agents: AgentInfo[];
  onAdd: (agent: Agent, name: string, spec: ServerSpec) => Promise<void>;
}

function AddServerForm({ agents, onAdd }: FormProps) {
  const [agent, setAgent] = useState<Agent>("claude-code");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Transport["kind"]>("stdio");
  const [target, setTarget] = useState("");
  const [secrets, setSecrets] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const [command = "", ...args] = target.trim().split(/\s+/);
    const transport: Transport =
      kind === "stdio" ? { kind, command, args } : { kind, url: target.trim() };
    const pairs = parsePairs(secrets);
    await onAdd(agent, name.trim(), {
      transport,
      env: kind === "stdio" ? pairs : {},
      headers: kind === "stdio" ? {} : pairs,
    });
    setName("");
    setTarget("");
    setSecrets("");
  }

  return (
    <form className="add-server" onSubmit={submit}>
      <h3>Add a server</h3>
      <div className="fields">
        <label>
          Agent
          <select value={agent} onChange={(e) => setAgent(e.target.value as Agent)}>
            {agents.map((info) => (
              <option key={info.agent} value={info.agent}>{info.name}</option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="github" />
        </label>
        <label>
          Transport
          <select value={kind} onChange={(e) => setKind(e.target.value as Transport["kind"])}>
            <option value="stdio">Local command</option>
            <option value="http">HTTP</option>
            <option value="sse">SSE (legacy)</option>
          </select>
        </label>
      </div>
      <label>
        {kind === "stdio" ? "Command" : "URL"}
        <input
          required
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={kind === "stdio" ? "npx -y @modelcontextprotocol/server-github" : "https://example.com/mcp"}
        />
      </label>
      <label>
        {kind === "stdio" ? "Environment variables" : "Headers"} (one KEY=VALUE per line)
        <textarea rows={3} value={secrets} onChange={(e) => setSecrets(e.target.value)} />
      </label>
      <button type="submit" className="primary">Add</button>
    </form>
  );
}
