import { useEffect, useState } from "react";
import type { Focus } from "../App";
import { AgentMark, Empty, Icon, Notice, PageHeader } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { RowMenu, type MenuItem } from "../components/RowMenu";
import { useToast } from "../components/Toasts";
import { addMcpServer, copyMcpServer, editMcpServer, removeMcpServer, undoChange } from "../lib/api";
import { splitCommand } from "../lib/command";
import { byName, describe, differences, WITH_OPTIONS } from "../lib/servers";
import type { Agent, AgentInfo, McpListing, McpServer, ServerOptions, ServerSpec, Transport } from "../lib/types";

interface Props {
  agents: AgentInfo[];
  listing: McpListing;
  onChange: () => Promise<void>;
  /** A server to show, or a form to open, chosen in the command palette. */
  focus?: Focus | null;
}

export function McpPage({ agents, listing, onChange, focus }: Props) {
  const notify = useToast();
  /** The form shown: `true` to add a server, or the server to edit. */
  const [form, setForm] = useState<true | { agent: Agent; name: string } | null>(null);
  const [aligning, setAligning] = useState<{ name: string; agent: Agent } | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    if (focus?.kind === "add-server") setForm(true);
    else if (focus?.kind === "edit-server") setForm({ agent: focus.agent, name: focus.name });
    if (focus?.kind !== "server") return;
    setHighlighted(focus.name);
    document.getElementById(rowId(focus.name))?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setHighlighted(null), 1600);
    return () => clearTimeout(timer);
  }, [focus]);

  // One row per server name, one column per agent.
  const rows = byName(listing);

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
   * Runs `steps` in order, stopping at the first error, then shows one toast
   * whose Undo reverts every step that ran. `done` gets how many ran.
   * Resolves to whether they all ran.
   */
  async function runAll(
    steps: (() => Promise<{ undo: number; lost?: string[] }>)[],
    done: (count: number) => string,
  ): Promise<boolean> {
    const ids: number[] = [];
    const lost = new Set<string>();
    let ok = true;
    try {
      for (const step of steps) {
        const result = await step();
        ids.push(result.undo);
        result.lost?.forEach((setting) => lost.add(setting));
      }
    } catch (err) {
      notify({ tone: "error", text: String(err) });
      ok = false;
    }
    if (ids.length > 0) {
      const left = lost.size > 0 ? ` Not carried over: ${[...lost].join(", ")}.` : "";
      notify({
        tone: "success",
        text: done(ids.length) + left,
        undo: async () => {
          for (const id of ids.reverse()) await undoChange(id);
          await onChange();
        },
      });
    }
    await onChange();
    return ok;
  }

  /** Copies `name` from `from` to `targets`. With `overwrite`, replaces the copies they have. */
  function copyMany(name: string, from: Agent, targets: Agent[], overwrite: boolean) {
    return runAll(
      targets.map((agent) => () => copyMcpServer(name, from, agent, overwrite)),
      (count) => {
        const done = targets.slice(0, count).map(nameOf).join(", ");
        return overwrite ? `${done} now use the ${name} settings of ${nameOf(from)}.` : `Added ${name} to ${done}.`;
      },
    );
  }

  async function save(draft: ServerDraft) {
    const { agent, name, transport, env, headers, options, alsoTo } = draft;
    let ok: boolean;
    if (form === true) {
      // The form checked that new variables have values.
      const spec: ServerSpec = {
        transport,
        env: env as Record<string, string>,
        headers: headers as Record<string, string>,
        options,
      };
      ok = await run(() => addMcpServer(agent, name, spec), `Added ${name} to ${nameOf(agent)}.`);
    } else {
      ok = await runAll(
        [
          async () => ({ undo: await editMcpServer(agent, name, { transport, env, headers, options }) }),
          ...alsoTo.map((other) => () => copyMcpServer(name, agent, other, true)),
        ],
        (count) => `Saved ${name} in ${[agent, ...alsoTo].slice(0, count).map(nameOf).join(", ")}.`,
      );
    }
    if (ok) setForm(null);
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;

  return (
    <>
      <PageHeader
        title="MCP servers"
        description="Each row is a server, each column an agent. Add a server to another agent in one click: its settings and secrets are copied for you."
        actions={
          <button className="primary" onClick={() => setForm(form === true ? null : true)}>
            <Icon name="plus" /> Add server
          </button>
        }
      />
      {listing.errors.map((message) => (
        <Notice key={message} tone="error">{message}</Notice>
      ))}

      {form && (form === true || editing(form)) && (
        <ServerForm
          key={form === true ? "new" : `${form.agent}/${form.name}`}
          agents={agents}
          editing={editing(form)}
          onCancel={() => setForm(null)}
          onSubmit={save}
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
                    label: byAgent.size > 1 ? `Edit in ${nameOf(agent)}…` : "Edit…",
                    onSelect: () => {
                      setForm({ agent, name });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    },
                  })),
                  ...[...byAgent.keys()].map((agent) => ({
                    label: `Remove from ${nameOf(agent)}`,
                    tone: "danger" as const,
                    onSelect: () => run(() => removeMcpServer(agent, name), `Removed ${name} from ${nameOf(agent)}.`),
                  })),
                ];
                return (
                  <tr key={name} id={rowId(name)} className={name === highlighted ? "highlight" : undefined}>
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

  function editing(target: true | { agent: Agent; name: string }) {
    if (target === true) return undefined;
    const byAgent = rows.get(target.name);
    const server = byAgent?.get(target.agent);
    if (!byAgent || !server) return undefined;
    return { server, others: [...byAgent.keys()].filter((other) => other !== target.agent) };
  }

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

/** What the form submits: values are `null` for variables kept as they are. */
export interface ServerDraft {
  agent: Agent;
  name: string;
  transport: Transport;
  env: Record<string, string | null>;
  headers: Record<string, string | null>;
  options: ServerOptions;
  /** Other agents to give the same settings, when editing. */
  alsoTo: Agent[];
}

/** Reads `NAME=value` lines. A name alone keeps its current value (`null`). */
function parseVariables(text: string): Record<string, string | null> {
  const variables: Record<string, string | null> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    const key = (index < 0 ? line : line.slice(0, index)).trim();
    if (key) variables[key] = index < 0 ? null : line.slice(index + 1).trim();
  }
  return variables;
}

const list = (text: string) => {
  const items = text.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
};

interface FormProps {
  agents: AgentInfo[];
  /** The server to edit, and the other agents that have it. Absent to add one. */
  editing?: { server: McpServer; others: Agent[] };
  onSubmit: (draft: ServerDraft) => Promise<void>;
  onCancel: () => void;
}

function ServerForm({ agents, editing, onSubmit, onCancel }: FormProps) {
  const initial = editing?.server;
  // New servers go to an agent on this computer, unless none was found.
  const offered = agents.some((info) => info.installed) ? agents.filter((info) => info.installed) : agents;
  const [agent, setAgent] = useState<Agent>(initial?.agent ?? offered[0]?.agent ?? "claude-code");
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<Transport["kind"]>(initial?.transport.kind ?? "stdio");
  const [target, setTarget] = useState(initial ? describe(initial.transport) : "");
  const [variables, setVariables] = useState(
    initial ? [...initial.envKeys, ...initial.headerKeys].join("\n") : "",
  );
  const [cwd, setCwd] = useState(initial?.options.cwd ?? "");
  const [timeoutText, setTimeoutText] = useState(
    initial?.options.timeoutMs ? String(initial.options.timeoutMs / 1000) : "",
  );
  const [includeTools, setIncludeTools] = useState(initial?.options.includeTools?.join(", ") ?? "");
  const [excludeTools, setExcludeTools] = useState(initial?.options.excludeTools?.join(", ") ?? "");
  const [disabled, setDisabled] = useState(initial?.options.disabled ?? false);
  const [alsoTo, setAlsoTo] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const withOptions = WITH_OPTIONS.includes(agent);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const [command = "", ...args] = splitCommand(target);
    const transport: Transport =
      kind === "stdio" ? { kind, command, args } : { kind, url: target.trim() };
    const parsed = parseVariables(variables);
    const known = new Set(initial ? [...initial.envKeys, ...initial.headerKeys] : []);
    const unset = Object.keys(parsed).filter((key) => parsed[key] === null && !known.has(key));
    if (unset.length > 0) {
      setError(`Give ${unset.join(", ")} a value, as NAME=value.`);
      return;
    }
    const seconds = Number(timeoutText);
    if (timeoutText.trim() && !(seconds > 0)) {
      setError("The timeout is a number of seconds.");
      return;
    }
    setError(null);
    // The form closes on success and keeps its fields on failure.
    await onSubmit({
      agent,
      name: name.trim(),
      transport,
      env: kind === "stdio" ? parsed : {},
      headers: kind === "stdio" ? {} : parsed,
      options: {
        cwd: withOptions && kind === "stdio" && cwd.trim() ? cwd.trim() : null,
        timeoutMs: withOptions && timeoutText.trim() ? Math.round(seconds * 1000) : null,
        includeTools: withOptions ? list(includeTools) : null,
        excludeTools: withOptions ? list(excludeTools) : null,
        disabled: agent === "codex" && disabled,
      },
      alsoTo,
    });
  }

  const nameOf = (other: Agent) => agents.find((info) => info.agent === other)?.name ?? other;

  return (
    <form className="card form" onSubmit={submit}>
      <h3>{initial ? `Edit ${initial.name} in ${nameOf(initial.agent)}` : "New MCP server"}</h3>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="fields">
        <label>
          Agent
          <select value={agent} disabled={!!initial} onChange={(e) => setAgent(e.target.value as Agent)}>
            {(initial ? agents : offered).map((info) => (
              <option key={info.agent} value={info.agent}>
                {info.name}
                {!info.hasConfig && info.installed && " (creates its config)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input required disabled={!!initial} value={name} onChange={(e) => setName(e.target.value)} placeholder="github" />
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
        <textarea
          rows={3}
          spellCheck={false}
          placeholder="GITHUB_TOKEN=ghp_…"
          value={variables}
          onChange={(e) => setVariables(e.target.value)}
        />
        <small className="hint">
          One NAME=value per line.
          {initial && " Values are never shown: a name alone keeps its current value. Delete a line to remove it."}
        </small>
      </label>

      {withOptions && (
        <details className="advanced" open={Boolean(cwd || timeoutText || includeTools || excludeTools || disabled)}>
          <summary>Advanced settings</summary>
          <div className="fields">
            {kind === "stdio" && (
              <label>
                Working directory
                <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="Default" />
              </label>
            )}
            <label>
              Tool timeout (seconds)
              <input inputMode="decimal" value={timeoutText} onChange={(e) => setTimeoutText(e.target.value)} placeholder="Default" />
            </label>
            <label>
              Only these tools
              <input value={includeTools} onChange={(e) => setIncludeTools(e.target.value)} placeholder="All, or tool_a, tool_b" />
            </label>
            <label>
              Never these tools
              <input value={excludeTools} onChange={(e) => setExcludeTools(e.target.value)} placeholder="None" />
            </label>
          </div>
          {agent === "codex" && (
            <label className="check">
              <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
              Turned off: Codex keeps the server but does not start it
            </label>
          )}
        </details>
      )}

      {editing && editing.others.length > 0 && (
        <fieldset className="also">
          <legend>Also apply to</legend>
          {editing.others.map((other) => (
            <label key={other} className="check">
              <input
                type="checkbox"
                checked={alsoTo.includes(other)}
                onChange={(e) =>
                  setAlsoTo(e.target.checked ? [...alsoTo, other] : alsoTo.filter((a) => a !== other))
                }
              />
              {nameOf(other)}
            </label>
          ))}
          <small className="hint">Their settings for {initial?.name} are replaced with these, secrets included.</small>
        </fieldset>
      )}

      <div className="form-actions">
        <button type="submit" className="primary">{initial ? "Save" : "Add server"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const rowId = (name: string) => `server-${name}`;
