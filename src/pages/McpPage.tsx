import { useState } from "react";
import { AgentMark, Empty, Icon, Notice, PageHeader } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { RowMenu, type MenuItem } from "../components/RowMenu";
import { useToast } from "../components/Toasts";
import { addMcpServer, copyMcpServer, removeMcpServer, undoChange } from "../lib/api";
import { joinCommand, splitCommand } from "../lib/command";
import type { Agent, AgentInfo, McpListing, McpServer, ServerOptions, ServerSpec, Transport } from "../lib/types";

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

/**
 * The command a server really runs, and a hash of each variable it gets, by
 * name. Servers whose secrets are in the keychain start through `agentdeck
 * exec`, which gets the keychain id of each secret in a flag; their hash is
 * `null`, since the value is not in the config.
 */
function launch(server: McpServer): { target: string; values: Map<string, string | null> } {
  const { transport } = server;
  const values = new Map<string, string | null>([
    ...Object.entries(server.envHashes),
    ...Object.entries(server.headerHashes),
  ]);
  if (transport.kind !== "stdio") return { target: `${transport.kind} ${transport.url}`, values };
  const wrapped = /(^|[\\/])agentdeck(\.exe)?$/i.test(transport.command) && transport.args[0] === "exec";
  const end = transport.args.indexOf("--");
  if (!wrapped || end < 0) return { target: describe(transport), values };
  const flags = transport.args.slice(1, end);
  for (let i = 0; i < flags.length - 1; i++) {
    if (flags[i] === "--secret") values.set(flags[i + 1].split("=")[0], null);
  }
  return { target: joinCommand(transport.args.slice(end + 1)), values };
}

/** Agents that have the settings of `ServerOptions`. */
const WITH_OPTIONS: Agent[] = ["codex", "gemini"];

function describeOptions(options: ServerOptions): Map<string, string> {
  const tools = (list: string[] | null) => (list ? list.join(", ") || "none" : "all");
  return new Map([
    ["Working directory", options.cwd ?? "not set"],
    ["Timeout", options.timeoutMs === null ? "default" : `${options.timeoutMs / 1000} s`],
    ["Allowed tools", tools(options.includeTools)],
    ["Blocked tools", options.excludeTools?.join(", ") || "none"],
  ]);
}

/**
 * What differs between `copy` and `reference`, empty when they run the same
 * thing with the same variables and settings. Values in the keychain are not
 * compared, nor settings one of the two agents does not have.
 */
function differences(copy: McpServer, reference: McpServer, referenceName: string): string[] {
  const [x, y] = [launch(copy), launch(reference)];
  const found: string[] = [];
  if (x.target !== y.target) found.push(`Runs ${x.target} here, ${y.target} in ${referenceName}.`);
  for (const key of [...new Set([...x.values.keys(), ...y.values.keys()])].sort()) {
    const [here, there] = [x.values.get(key), y.values.get(key)];
    if (!y.values.has(key)) found.push(`${key} is set here, not in ${referenceName}.`);
    else if (!x.values.has(key)) found.push(`${key} is set in ${referenceName}, not here.`);
    else if (here && there && here !== there) found.push(`${key} has another value than in ${referenceName}.`);
  }
  if (WITH_OPTIONS.includes(copy.agent) && WITH_OPTIONS.includes(reference.agent)) {
    const theirs = describeOptions(reference.options);
    for (const [label, value] of describeOptions(copy.options)) {
      if (value !== theirs.get(label)) found.push(`${label}: ${value} here, ${theirs.get(label)} in ${referenceName}.`);
    }
  }
  return found;
}

interface Props {
  agents: AgentInfo[];
  listing: McpListing;
  onChange: () => Promise<void>;
}

export function McpPage({ agents, listing, onChange }: Props) {
  const notify = useToast();
  const [adding, setAdding] = useState(false);
  const [aligning, setAligning] = useState<{ name: string; agent: Agent } | null>(null);

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
    await onChange();
    return ok;
  }

  /**
   * Copies `name` from `from` to every agent in `targets`, with one toast and
   * one Undo for all. With `overwrite`, replaces the copies they have.
   */
  async function copyMany(name: string, from: Agent, targets: Agent[], overwrite: boolean) {
    const ids: number[] = [];
    const lost = new Set<string>();
    try {
      for (const agent of targets) {
        const result = await copyMcpServer(name, from, agent, overwrite);
        ids.push(result.undo);
        result.lost.forEach((setting) => lost.add(setting));
      }
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    if (ids.length > 0) {
      const done = targets.slice(0, ids.length).map(nameOf).join(", ");
      const left = lost.size > 0 ? ` Not carried over: ${[...lost].join(", ")}.` : "";
      notify({
        tone: "success",
        text: (overwrite ? `${done} now use the ${name} settings of ${nameOf(from)}.` : `Added ${name} to ${done}.`) + left,
        undo: async () => {
          for (const id of ids.reverse()) await undoChange(id);
          await onChange();
        },
      });
    }
    await onChange();
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
                  <th
                    key={info.agent}
                    className={`agent-col ${info.installed ? "" : "agent-off"}`}
                    title={info.installed ? undefined : `${info.name} was not found on this computer`}
                  >
                    <span className="th-agent">
                      <AgentMark agent={info.agent} size={20} />
                      {info.name}
                    </span>
                  </th>
                ))}
                <th className="menu-col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...rows].map(([name, byAgent]) => {
                const [source] = byAgent.values();
                const secretKeys = [...source.envKeys, ...source.headerKeys];
                const supports = (agent: Agent) => !(agent === "codex" && source.transport.kind === "sse");
                const missing = agents.filter(({ agent }) => !byAgent.has(agent) && supports(agent));
                const menu: MenuItem[] = [
                  ...(missing.length > 1
                    ? [
                        {
                          label: "Add to every agent",
                          onSelect: () => copyMany(name, source.agent, missing.map((info) => info.agent), false),
                        },
                      ]
                    : []),
                  ...[...byAgent.keys()].map((agent) => ({
                    label: `Remove from ${nameOf(agent)}`,
                    tone: "danger" as const,
                    onSelect: () => run(() => removeMcpServer(agent, name), `Removed ${name} from ${nameOf(agent)}.`),
                  })),
                ];
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
                    {agents.map(({ agent, installed }) => {
                      const off = installed ? "" : "agent-off";
                      const server = byAgent.get(agent);
                      const differs = server && server !== source ? differences(server, source, nameOf(source.agent)) : [];
                      if (differs.length > 0) {
                        return (
                          <td key={agent} className={`agent-col ${off}`}>
                            <button
                              className="cell cell-differs"
                              title={differs.join("\n")}
                              onClick={() => setAligning({ name, agent })}
                            >
                              <Icon name="differs" size={14} /> Different
                            </button>
                          </td>
                        );
                      }
                      if (server) {
                        return (
                          <td key={agent} className={`agent-col ${off}`}>
                            <span className="cell cell-on">
                              <Icon name="check" size={14} /> Installed
                            </span>
                          </td>
                        );
                      }
                      if (!supports(agent)) {
                        return (
                          <td key={agent} className={`agent-col ${off}`}>
                            <span className="cell cell-none" title="Codex does not support SSE servers">
                              Not supported
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={agent} className={`agent-col ${off}`}>
                          <button
                            className="cell cell-add"
                            title={`Copy ${name} from ${nameOf(source.agent)} to ${nameOf(agent)}`}
                            onClick={() => copyMany(name, source.agent, [agent], false)}
                          >
                            <Icon name="plus" size={14} /> Add
                          </button>
                        </td>
                      );
                    })}
                    <td className="menu-col">
                      <RowMenu label={`Actions for ${name}`} items={menu} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {aligning && alignDialog(aligning.name, aligning.agent)}
    </>
  );

  function alignDialog(name: string, agent: Agent) {
    const byAgent = rows.get(name);
    const server = byAgent?.get(agent);
    const [source] = byAgent?.values() ?? [];
    if (!byAgent || !server || !source) return null;
    const others = [...byAgent.keys()].filter((other) => other !== agent);
    const close = () => setAligning(null);
    return (
      <ConfirmDialog
        wide
        title={`${name} is set up differently in ${nameOf(agent)}`}
        onCancel={close}
        choices={[
          {
            label: `Use ${nameOf(agent)}'s everywhere`,
            onSelect: () => {
              close();
              copyMany(name, agent, others, true);
            },
          },
          {
            label: `Use ${nameOf(source.agent)}'s here`,
            tone: "primary",
            onSelect: () => {
              close();
              copyMany(name, source.agent, [agent], true);
            },
          },
        ]}
      >
        <ul className="differences">
          {differences(server, source, nameOf(source.agent)).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>Secrets are copied by AgentDeck without being shown. Each change can be undone.</p>
      </ConfirmDialog>
    );
  }
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
