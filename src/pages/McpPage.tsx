import { useState } from "react";
import { AgentMark, Empty, Icon, Notice, PageHeader } from "../components/ui";
import { useToast } from "../components/Toasts";
import { addMcpServer, copyMcpServer, removeMcpServer, undoChange } from "../lib/api";
import { joinCommand, splitCommand } from "../lib/command";
import type { Agent, AgentInfo, McpListing, McpServer, ServerSpec, Transport } from "../lib/types";

function describe(transport: Transport): string {
  switch (transport.kind) {
    case "stdio":
      return joinCommand([transport.command, ...transport.args]);
    case "http":
      return transport.url;
    case "sse":
      return transport.url;
  }
}

interface Props {
  agents: AgentInfo[];
  listing: McpListing;
  onChange: () => Promise<void>;
}

export function McpPage({ agents, listing, onChange }: Props) {
  const notify = useToast();
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // One row per server name, one column per agent.
  const rows = new Map<string, Map<Agent, McpServer>>();
  for (const server of listing.servers) {
    if (!rows.has(server.name)) rows.set(server.name, new Map());
    rows.get(server.name)!.set(server.agent, server);
  }

  async function run(action: () => Promise<number>, done: string): Promise<boolean> {
    let ok = true;
    try {
      const id = await action();
      notify({
        tone: "success",
        text: done,
        undo: async () => {
          await undoChange(id);
          await onChange();
        },
      });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
      ok = false;
    }
    setPendingRemoval(null);
    await onChange();
    return ok;
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;

  return (
    <>
      <PageHeader
        title="MCP servers"
        description="Each row is a server, each column an agent. Add a server to another agent in one click: its settings and secrets are copied for you."
        actions={
          <button className="primary" onClick={() => setAdding(!adding)}>
            <Icon name="plus" /> Add server
          </button>
        }
      />
      {listing.errors.map((message) => (
        <Notice key={message} tone="error">{message}</Notice>
      ))}

      {adding && (
        <AddServerForm
          agents={agents}
          onCancel={() => setAdding(false)}
          onAdd={async (agent, name, spec) => {
            if (await run(() => addMcpServer(agent, name, spec), `Added ${name} to ${nameOf(agent)}.`)) setAdding(false);
          }}
        />
      )}

      {rows.size === 0 ? (
        <Empty icon="plug" title="No MCP server configured yet">
          Add one above, or install one in any agent: it shows up here.
        </Empty>
      ) : (
        <div className="table-card">
          <table className="matrix">
            <thead>
              <tr>
                <th>Server</th>
                {agents.map((info) => (
                  <th key={info.agent} className="agent-col">
                    <span className="th-agent">
                      <AgentMark agent={info.agent} size={20} />
                      {info.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].map(([name, byAgent]) => {
                const [source] = byAgent.values();
                const secretKeys = [...source.envKeys, ...source.headerKeys];
                return (
                  <tr key={name}>
                    <td className="server">
                      <strong>{name}</strong>
                      <span className="meta">
                        <span className="tag">{source.transport.kind}</span>
                        <code title={describe(source.transport)}>{describe(source.transport)}</code>
                      </span>
                      {secretKeys.length > 0 && (
                        <small>
                          <Icon name="key" size={12} /> {secretKeys.join(", ")}
                        </small>
                      )}
                    </td>
                    {agents.map(({ agent }) => {
                      const key = `${agent}/${name}`;
                      if (byAgent.has(agent)) {
                        return (
                          <td key={agent} className="agent-col">
                            {pendingRemoval === key ? (
                              <span className="confirm">
                                <button
                                  className="danger small"
                                  onClick={() => run(() => removeMcpServer(agent, name), `Removed ${name} from ${nameOf(agent)}.`)}
                                >
                                  Remove
                                </button>
                                <button className="small" onClick={() => setPendingRemoval(null)}>
                                  Keep
                                </button>
                              </span>
                            ) : (
                              <button
                                className="cell-on"
                                title="Installed. Click to remove"
                                onClick={() => setPendingRemoval(key)}
                              >
                                <Icon name="check" size={14} /> Installed
                              </button>
                            )}
                          </td>
                        );
                      }
                      const unsupported = agent === "codex" && source.transport.kind === "sse";
                      return (
                        <td key={agent} className="agent-col">
                          <button
                            className="cell-add"
                            disabled={unsupported}
                            title={unsupported ? "Codex does not support SSE servers" : `Copy ${name} to this agent`}
                            onClick={() => run(() => copyMcpServer(name, source.agent, agent), `Added ${name} to ${nameOf(agent)}.`)}
                          >
                            <Icon name="plus" size={14} /> Add
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
  onCancel: () => void;
}

function AddServerForm({ agents, onAdd, onCancel }: FormProps) {
  const [agent, setAgent] = useState<Agent>("claude-code");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Transport["kind"]>("stdio");
  const [target, setTarget] = useState("");
  const [secrets, setSecrets] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const [command = "", ...args] = splitCommand(target);
    const transport: Transport =
      kind === "stdio" ? { kind, command, args } : { kind, url: target.trim() };
    const pairs = parsePairs(secrets);
    // The form closes on success and keeps its fields on failure.
    await onAdd(agent, name.trim(), {
      transport,
      env: kind === "stdio" ? pairs : {},
      headers: kind === "stdio" ? {} : pairs,
    });
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>New MCP server</h3>
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
        {kind === "stdio" && (
          <small className="hint">Put quotes around paths or arguments that contain spaces.</small>
        )}
      </label>
      <label>
        {kind === "stdio" ? "Environment variables" : "Headers"}
        <textarea rows={3} placeholder="GITHUB_TOKEN=ghp_…" value={secrets} onChange={(e) => setSecrets(e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary">Add server</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
