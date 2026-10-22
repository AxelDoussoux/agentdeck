import { useEffect, useState } from "react";
import type { Focus } from "../App";
import { AgentMark, Empty, Icon, Notice, PageHeader } from "../components/ui";
import { Drawer } from "../components/Drawer";
import { RowMenu, type MenuItem } from "../components/RowMenu";
import { ServerTestResult, type TestState } from "../components/ServerTest";
import { useToast } from "../components/Toasts";
import {
  addMcpServer,
  copyMcpServer,
  editMcpServer,
  openConfig,
  removeMcpServer,
  restoreServerVersion,
  serverVersions,
  testMcpServer,
  undoChange,
} from "../lib/api";
import { splitCommand } from "../lib/command";
import { byName, changes, describe, differences, WITH_OPTIONS } from "../lib/servers";
import type {
  Agent,
  AgentInfo,
  McpListing,
  McpServer,
  ServerOptions,
  ServerSpec,
  ServerVersion,
  Transport,
} from "../lib/types";

interface Props {
  agents: AgentInfo[];
  listing: McpListing;
  onChange: () => Promise<void>;
  /** A server to show, or a form to open, chosen in the command palette. */
  focus?: Focus | null;
}

type ServerTab = "details" | "differences" | "backups";

/** The server shown in the drawer, its tab, and the agent whose copy is being edited. */
interface Opened {
  name: string;
  tab: ServerTab;
  editing?: Agent;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function McpPage({ agents, listing, onChange, focus }: Props) {
  const notify = useToast();
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [versions, setVersions] = useState<Map<Agent, ServerVersion[]>>(new Map());
  // Server tests by `agent/name`, kept while the page is open.
  const [tests, setTests] = useState<Record<string, TestState>>({});

  async function test(agent: Agent, name: string) {
    const key = `${agent}/${name}`;
    setTests((current) => ({ ...current, [key]: { running: true } }));
    let state: TestState;
    try {
      state = { running: false, report: await testMcpServer(agent, name) };
    } catch (err) {
      state = { running: false, error: String(err) };
    }
    setTests((current) => ({ ...current, [key]: state }));
  }

  useEffect(() => {
    if (focus?.kind === "add-server") setAdding(true);
    else if (focus?.kind === "edit-server") setOpened({ name: focus.name, tab: "details", editing: focus.agent });
    if (focus?.kind !== "server") return;
    setOpened({ name: focus.name, tab: "details" });
    setHighlighted(focus.name);
    document.getElementById(rowId(focus.name))?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setHighlighted(null), 1600);
    return () => clearTimeout(timer);
  }, [focus]);

  // One row per server name, one column per agent.
  const rows = byName(listing);

  // The drawer closes once no agent has the server any more.
  useEffect(() => {
    if (opened && !rows.has(opened.name)) setOpened(null);
  }, [opened, listing]);

  // Earlier versions of the opened server, read again after each change.
  useEffect(() => {
    if (!opened) return setVersions(new Map());
    let current = true;
    const withConfig = agents.filter((info) => info.hasConfig).map((info) => info.agent);
    Promise.all(
      withConfig.map((agent) =>
        serverVersions(agent, opened.name)
          .catch(() => [])
          .then((found) => [agent, found] as const),
      ),
    ).then((found) => {
      if (current) setVersions(new Map(found.filter(([, list]) => list.length > 0)));
    });
    return () => {
      current = false;
    };
  }, [opened?.name, listing, agents]);

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

  function removeFrom(name: string, targets: Agent[]) {
    return runAll(
      targets.map((agent) => async () => ({ undo: await removeMcpServer(agent, name) })),
      (count) => `Removed ${name} from ${targets.slice(0, count).map(nameOf).join(", ")}.`,
    );
  }

  async function add(draft: ServerDraft) {
    const { agent, name, transport, env, headers, options } = draft;
    // The form checked that new variables have values.
    const spec: ServerSpec = {
      transport,
      env: env as Record<string, string>,
      headers: headers as Record<string, string>,
      options,
    };
    if (await run(() => addMcpServer(agent, name, spec), `Added ${name} to ${nameOf(agent)}.`)) setAdding(false);
  }

  async function edit(draft: ServerDraft) {
    const { agent, name, transport, env, headers, options, alsoTo } = draft;
    const ok = await runAll(
      [
        async () => ({ undo: await editMcpServer(agent, name, { transport, env, headers, options }) }),
        ...alsoTo.map((other) => () => copyMcpServer(name, agent, other, true)),
      ],
      (count) => `Saved ${name} in ${[agent, ...alsoTo].slice(0, count).map(nameOf).join(", ")}.`,
    );
    if (ok) setOpened((current) => current && { ...current, editing: undefined });
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const open = (name: string, tab: ServerTab = "details", editing?: Agent) => setOpened({ name, tab, editing });

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

      {adding && <ServerForm agents={agents} onCancel={() => setAdding(false)} onSubmit={add} />}

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
                const missing = agents.filter(({ agent }) => !byAgent.has(agent) && supports(source, agent));
                const menu: MenuItem[] = [
                  { label: "Details", onSelect: () => open(name) },
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
                    onSelect: () => open(name, "details", agent),
                  })),
                  ...[...byAgent.keys()].map((agent) => ({
                    label: `Remove from ${nameOf(agent)}`,
                    tone: "danger" as const,
                    onSelect: () => run(() => removeMcpServer(agent, name), `Removed ${name} from ${nameOf(agent)}.`),
                  })),
                ];
                return (
                  <tr
                    key={name}
                    id={rowId(name)}
                    className={name === highlighted || name === opened?.name ? "highlight" : undefined}
                  >
                    <td className="server">
                      <button className="link" onClick={() => open(name)}>
                        <strong>{name}</strong>
                      </button>
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
                              onClick={() => open(name, "differences")}
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
                      if (!supports(source, agent)) {
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

      {opened && rows.has(opened.name) && drawer(opened, rows.get(opened.name)!)}
    </>
  );

  function drawer({ name, tab, editing }: Opened, byAgent: Map<Agent, McpServer>) {
    const copies = [...byAgent.values()];
    const [source] = copies;
    const drifting = copies.filter((copy) => copy !== source && differences(copy, source, "").length > 0);
    const missing = agents.filter(({ agent }) => !byAgent.has(agent) && supports(source, agent));
    const saved = [...versions.values()].reduce((sum, list) => sum + list.length, 0);
    return (
      <Drawer
        title={name}
        subtitle={`In ${copies.map((copy) => nameOf(copy.agent)).join(", ")}`}
        tabs={[
          { id: "details", label: "Details" },
          { id: "differences", label: "Differences", count: drifting.length },
          { id: "backups", label: "Backups", count: saved },
        ]}
        tab={tab}
        onTab={(next) => setOpened({ name, tab: next, editing })}
        onClose={() => setOpened(null)}
      >
        {tab === "details" && (
          <>
            {copies.map((server) =>
              server.agent === editing ? (
                <ServerForm
                  key={server.agent}
                  agents={agents}
                  editing={{ server, others: copies.map((c) => c.agent).filter((a) => a !== server.agent) }}
                  onCancel={() => setOpened({ name, tab, editing: undefined })}
                  onSubmit={edit}
                />
              ) : (
                <section key={server.agent} className="drawer-section">
                  <header>
                    <span className="setting-agent">
                      <AgentMark agent={server.agent} size={20} />
                      {nameOf(server.agent)}
                    </span>
                    <span className="copy-actions">
                      <button
                        className="small"
                        disabled={tests[`${server.agent}/${name}`]?.running}
                        title={
                          server.transport.kind === "stdio"
                            ? `Runs ${describe(server.transport)} on this computer, lists its tools, then stops it`
                            : "Connects to the server and lists its tools"
                        }
                        onClick={() => test(server.agent, name)}
                      >
                        {tests[`${server.agent}/${name}`]?.running ? "Testing…" : "Test"}
                      </button>
                      <button className="small" onClick={() => setOpened({ name, tab, editing: server.agent })}>
                        Edit
                      </button>
                      <button
                        className="small"
                        onClick={() =>
                          openConfig(server.agent).catch((err) => notify({ tone: "error", text: String(err) }))
                        }
                      >
                        Open file
                      </button>
                      <button
                        className="small"
                        onClick={() => run(() => removeMcpServer(server.agent, name), `Removed ${name} from ${nameOf(server.agent)}.`)}
                      >
                        Remove
                      </button>
                    </span>
                  </header>
                  <Facts server={server} />
                  {tests[`${server.agent}/${name}`] && <ServerTestResult state={tests[`${server.agent}/${name}`]} />}
                </section>
              ),
            )}
            {missing.length > 0 && (
              <section className="drawer-section">
                <header>
                  <strong>Not in {missing.map((info) => info.name).join(", ")}</strong>
                  <button
                    className="small"
                    onClick={() => copyMany(name, source.agent, missing.map((info) => info.agent), false)}
                  >
                    <Icon name="plus" size={14} /> Add to {missing.length === 1 ? missing[0].name : "all"}
                  </button>
                </header>
                <p className="hint">Copies the settings of {nameOf(source.agent)}, secrets included.</p>
              </section>
            )}
            {copies.length > 1 && (
              <div className="drawer-footer">
                <button className="small danger" onClick={() => removeFrom(name, copies.map((copy) => copy.agent))}>
                  Remove from every agent
                </button>
              </div>
            )}
          </>
        )}

        {tab === "differences" &&
          (drifting.length === 0 ? (
            <p className="hint">
              {copies.length === 1
                ? `Only ${nameOf(source.agent)} has ${name}.`
                : `Every agent runs ${name} the same way.`}
            </p>
          ) : (
            <>
              {drifting.map((server) => {
                const others = copies.map((copy) => copy.agent).filter((agent) => agent !== server.agent);
                return (
                  <section key={server.agent} className="drawer-section">
                    <header>
                      <span className="setting-agent">
                        <AgentMark agent={server.agent} size={20} />
                        {nameOf(server.agent)}
                      </span>
                    </header>
                    <ul className="differences">
                      {differences(server, source, nameOf(source.agent)).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <div className="copy-actions">
                      <button className="small" onClick={() => copyMany(name, server.agent, others, true)}>
                        Use {nameOf(server.agent)}'s everywhere
                      </button>
                      <button className="small primary" onClick={() => copyMany(name, source.agent, [server.agent], true)}>
                        Use {nameOf(source.agent)}'s here
                      </button>
                    </div>
                  </section>
                );
              })}
              <p className="hint">Secrets are copied by AgentDeck without being shown. Each change can be undone.</p>
            </>
          ))}

        {tab === "backups" &&
          (saved === 0 ? (
            <p className="hint">
              No earlier version yet. AgentDeck keeps a backup of each config file it changes, in ~/.agentdeck/backups.
            </p>
          ) : (
            <>
              {[...versions].map(([agent, list]) => (
                <section key={agent} className="drawer-section">
                  <header>
                    <span className="setting-agent">
                      <AgentMark agent={agent} size={20} />
                      {nameOf(agent)}
                    </span>
                  </header>
                  <ul className="copies">
                    {list.map((version) => (
                      <li key={version.id}>
                        <div>
                          <strong>Until {formatDate(version.replacedMs)}</strong>
                          <span className="hint">{describeVersion(version, byAgent.get(agent))}</span>
                        </div>
                        <button
                          className="small"
                          disabled={version.current}
                          title={version.current ? "This is how it is now" : undefined}
                          onClick={() =>
                            run(
                              () => restoreServerVersion(agent, name, version.id),
                              version.server
                                ? `Put back ${name} in ${nameOf(agent)} as it was.`
                                : `Removed ${name} from ${nameOf(agent)}, as it was.`,
                            )
                          }
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <p className="hint">Restoring changes only this server. Secrets stay hidden, and it can be undone.</p>
            </>
          ))}
      </Drawer>
    );
  }
}

/** Codex has no SSE servers. */
const supports = (server: McpServer, agent: Agent) => !(agent === "codex" && server.transport.kind === "sse");

/** How a version differs from the server now, or what it ran. */
function describeVersion(version: ServerVersion, now: McpServer | undefined): string {
  if (version.current) return "Same as now.";
  if (!version.server) return "Not set up.";
  if (!now) return `Ran ${describe(version.server.transport)}.`;
  const changed = changes(version.server, now);
  return changed.length > 0 ? changed.join(" ") : "Other settings than now.";
}

/** What a server runs and with which settings, without its secret values. */
function Facts({ server }: { server: McpServer }) {
  const { transport, options } = server;
  const keys = [...server.envKeys, ...server.headerKeys];
  return (
    <dl className="facts">
      <dt>{transport.kind === "stdio" ? "Command" : transport.kind === "http" ? "HTTP URL" : "SSE URL"}</dt>
      <dd>
        <code>{describe(transport)}</code>
      </dd>
      <dt>{transport.kind === "stdio" ? "Variables" : "Headers"}</dt>
      <dd>{keys.length > 0 ? keys.join(", ") : "None"}</dd>
      {WITH_OPTIONS.includes(server.agent) && (
        <>
          {options.cwd && (
            <>
              <dt>Working directory</dt>
              <dd>
                <code>{options.cwd}</code>
              </dd>
            </>
          )}
          {options.timeoutMs !== null && (
            <>
              <dt>Timeout</dt>
              <dd>{options.timeoutMs / 1000} s</dd>
            </>
          )}
          {options.includeTools && (
            <>
              <dt>Only these tools</dt>
              <dd>{options.includeTools.join(", ") || "None"}</dd>
            </>
          )}
          {options.excludeTools && options.excludeTools.length > 0 && (
            <>
              <dt>Never these tools</dt>
              <dd>{options.excludeTools.join(", ")}</dd>
            </>
          )}
          {options.disabled && (
            <>
              <dt>State</dt>
              <dd>Turned off</dd>
            </>
          )}
        </>
      )}
    </dl>
  );
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
