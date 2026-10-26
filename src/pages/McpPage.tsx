import { useEffect, useState } from "react";
import type { Focus } from "../App";
import { AgentMark, Empty, Icon, Notice, PageHeader } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Drawer } from "../components/Drawer";
import { RowMenu, type MenuItem } from "../components/RowMenu";
import { ServerForm, type ServerDraft } from "../components/ServerForm";
import { ServerTestResult, type TestState } from "../components/ServerTest";
import { useToast } from "../components/Toasts";
import { Tooltip } from "../components/Tooltip";
import {
  addMcpServer,
  copyMcpServer,
  editMcpServer,
  openConfig,
  removeMcpServer,
  setMcpEnabled,
  restoreServerVersion,
  serverVersions,
  testMcpServer,
  undoChange,
} from "../lib/api";
import { byName, changes, describe, differences, drifting, WITH_OPTIONS } from "../lib/servers";
import { moveInGrid } from "../lib/grid";
import { matches } from "../lib/search";
import type { Agent, AgentInfo, McpListing, McpServer, ServerSpec, ServerVersion } from "../lib/types";
import { errorText, formatDateTime, formatList, formatNumber, t } from "../lib/i18n";

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

export function McpPage({ agents, listing, onChange, focus }: Props) {
  const notify = useToast();
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Only the servers missing from an installed agent or set up differently.
  const [unsynced, setUnsynced] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);
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
      state = { running: false, error: errorText(err) };
    }
    setTests((current) => ({ ...current, [key]: state }));
  }

  useEffect(() => {
    if (focus?.kind === "add-server") setAdding(true);
    else if (focus?.kind === "edit-server") setOpened({ name: focus.name, tab: "details", editing: focus.agent });
    if (focus?.kind !== "server") return;
    // The server may be filtered out of the grid.
    setQuery("");
    setUnsynced(false);
    setOpened({ name: focus.name, tab: "details" });
    setHighlighted(focus.name);
    document.getElementById(rowId(focus.name))?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setHighlighted(null), 1600);
    return () => clearTimeout(timer);
  }, [focus]);

  // One row per server name, one column per agent.
  const rows = byName(listing);
  // What syncing adds: each server, from its first copy, to the installed
  // agents that can run it and do not have it. Copies that differ stay as they are.
  const gaps = [...rows]
    .map(([name, byAgent]) => {
      const [source] = byAgent.values();
      const targets = agents
        .filter(({ agent, installed }) => installed && !byAgent.has(agent) && supports(source, agent))
        .map(({ agent }) => agent);
      return { name, from: source.agent, targets };
    })
    .filter((gap) => gap.targets.length > 0);
  const differing = new Set(drifting(listing));
  const outOfSync = new Set([...differing, ...gaps.map((gap) => gap.name)]);
  const searched = [...rows].filter(([name, byAgent]) =>
    matches(query, [name, ...[...byAgent.values()].map((server) => describe(server.transport))]),
  );
  const shown = unsynced ? searched.filter(([name]) => outOfSync.has(name)) : searched;

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
      notify({ tone: "error", text: errorText(err) });
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
      notify({ tone: "error", text: errorText(err) });
      ok = false;
    }
    if (ids.length > 0) {
      const left = lost.size > 0 ? ` ${t.mcp.notCarried(formatList([...lost]))}` : "";
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
        const done = formatList(targets.slice(0, count).map(nameOf));
        return overwrite ? t.mcp.nowUse(done, name, nameOf(from)) : t.mcp.added(name, done);
      },
    );
  }

  function removeFrom(name: string, targets: Agent[]) {
    return runAll(
      targets.map((agent) => async () => ({ undo: await removeMcpServer(agent, name) })),
      (count) => t.mcp.removed(name, formatList(targets.slice(0, count).map(nameOf))),
    );
  }

  async function add(draft: ServerDraft) {
    const { agent, name, transport, env, headers, options, alsoTo } = draft;
    // The form checked that new variables have values.
    const spec: ServerSpec = {
      transport,
      env: env as Record<string, string>,
      headers: headers as Record<string, string>,
      options,
    };
    const targets = [agent, ...alsoTo];
    const ok = await runAll(
      targets.map((target) => async () => ({ undo: await addMcpServer(target, name, spec) })),
      (count) => t.mcp.added(name, formatList(targets.slice(0, count).map(nameOf))),
    );
    if (ok) {
      setAdding(false);
      open(name);
    }
  }

  function syncEverywhere() {
    const steps = gaps.flatMap(({ name, from, targets }) =>
      targets.map((agent) => () => copyMcpServer(name, from, agent, false)),
    );
    return runAll(steps, (count) => t.mcp.synced(count));
  }

  async function edit(draft: ServerDraft) {
    const { agent, name, transport, env, headers, options, alsoTo } = draft;
    const ok = await runAll(
      [
        async () => ({ undo: await editMcpServer(agent, name, { transport, env, headers, options }) }),
        ...alsoTo.map((other) => () => copyMcpServer(name, agent, other, true)),
      ],
      (count) => t.mcp.saved(name, formatList([agent, ...alsoTo].slice(0, count).map(nameOf))),
    );
    if (ok) setOpened((current) => current && { ...current, editing: undefined });
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const open = (name: string, tab: ServerTab = "details", editing?: Agent) => setOpened({ name, tab, editing });

  return (
    <>
      <PageHeader
        title={t.mcp.title}
        description={t.mcp.description}
        actions={
          <>
            {rows.size > 0 && (
              <input
                type="search"
                className="header-search"
                placeholder={t.mcp.search}
                aria-label={t.mcp.searchLabel}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            {rows.size > 0 && (
              <Tooltip text={t.mcp.unsyncedTip}>
                <button
                  className="toggle"
                  aria-pressed={unsynced}
                  onClick={() => setUnsynced((on) => !on)}
                >
                  {t.mcp.unsynced(outOfSync.size)}
                </button>
              </Tooltip>
            )}
            {gaps.length > 0 && (
              <Tooltip text={t.mcp.syncTip}>
                <button onClick={() => setConfirmSync(true)}>
                  <Icon name="refresh" /> {t.mcp.sync}
                </button>
              </Tooltip>
            )}
            <button className="primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> {t.mcp.add}
            </button>
          </>
        }
      />
      {listing.errors.map((error) => (
        <Notice key={error.message} tone="error">
          {t.common.about(error.agent ?? "", errorText(error))}
        </Notice>
      ))}

      {adding && (
        <Drawer
          title={t.mcp.addTitle}
          subtitle={t.mcp.addSubtitle}
          tabs={[{ id: "form", label: t.mcp.server }]}
          tab="form"
          onTab={() => undefined}
          onClose={() => setAdding(false)}
        >
          <ServerForm
            agents={agents}
            has={(agent, name) => rows.get(name)?.has(agent) ?? false}
            onCancel={() => setAdding(false)}
            onSubmit={add}
          />
        </Drawer>
      )}

      {confirmSync && (
        <ConfirmDialog
          wide
          title={t.mcp.syncTitle}
          onCancel={() => setConfirmSync(false)}
          choices={[
            {
              label: t.mcp.syncConfirm(gaps.reduce((sum, gap) => sum + gap.targets.length, 0)),
              tone: "primary",
              onSelect: () => {
                setConfirmSync(false);
                syncEverywhere();
              },
            },
          ]}
        >
          <ul className="differences">
            {gaps.map(({ name, from, targets }) => (
              <li key={name}>
                {t.mcp.syncLine(<strong>{name}</strong>, nameOf(from), formatList(targets.map(nameOf)))}
              </li>
            ))}
          </ul>
          <p>
            {t.mcp.syncHint}
            {differing.size > 0 && ` ${t.mcp.syncDiffering(formatList([...differing]))}`}
          </p>
        </ConfirmDialog>
      )}

      {rows.size === 0 ? (
        <Empty icon="plug" title={t.mcp.emptyTitle}>
          {t.mcp.empty}
        </Empty>
      ) : shown.length === 0 && searched.length > 0 ? (
        <Empty icon="check" title={t.mcp.allInSync}>
          {t.mcp.allInSyncHint}{" "}
          <button className="link" onClick={() => setUnsynced(false)}>
            {t.mcp.showAll}
          </button>
        </Empty>
      ) : shown.length === 0 ? (
        <Empty icon="plug" title={t.mcp.noMatch(query.trim())}>
          {t.mcp.searchHint}{" "}
          <button className="link" onClick={() => setQuery("")}>
            {t.common.clearSearch}
          </button>
        </Empty>
      ) : (
        <div className="table-card">
          <table className="matrix" onKeyDown={moveInGrid}>
            <thead>
              <tr>
                <th>{t.mcp.server}</th>
                {agents.map((info) => (
                  <th
                    key={info.agent}
                    className={`agent-col ${info.installed ? "" : "agent-off"}`}
                    title={info.installed ? undefined : t.common.notFound(info.name)}
                  >
                    <span className="th-agent">
                      <AgentMark agent={info.agent} size={20} />
                      {info.name}
                    </span>
                  </th>
                ))}
                <th className="menu-col">
                  <span className="sr-only">{t.common.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(([name, byAgent]) => {
                const [source] = byAgent.values();
                const secretKeys = [...source.envKeys, ...source.headerKeys];
                const missing = agents.filter(({ agent }) => !byAgent.has(agent) && supports(source, agent));
                const menu: MenuItem[] = [
                  { label: t.mcp.details, onSelect: () => open(name) },
                  ...(missing.length > 1
                    ? [
                        {
                          label: t.mcp.addEverywhere,
                          onSelect: () => copyMany(name, source.agent, missing.map((info) => info.agent), false),
                        },
                      ]
                    : []),
                  ...[...byAgent.keys()].map((agent) => ({
                    label: byAgent.size > 1 ? t.mcp.editIn(nameOf(agent)) : t.mcp.editMenu,
                    onSelect: () => open(name, "details", agent),
                  })),
                  ...[...byAgent.values()].map(({ agent, options }) => {
                    const on = options.disabled;
                    const where = nameOf(agent);
                    return {
                      label: byAgent.size > 1 ? (on ? t.mcp.turnOnIn : t.mcp.turnOffIn)(where) : on ? t.mcp.turnOn : t.mcp.turnOff,
                      onSelect: () =>
                        run(() => setMcpEnabled(agent, name, on), (on ? t.mcp.turnedOnIn : t.mcp.turnedOffIn)(name, where)),
                    };
                  }),
                  ...[...byAgent.keys()].map((agent) => ({
                    label: t.mcp.removeFrom(nameOf(agent)),
                    tone: "danger" as const,
                    onSelect: () => run(() => removeMcpServer(agent, name), t.mcp.removed(name, nameOf(agent))),
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
                            <Tooltip text={differs.join("\n")}>
                              <button
                                className="cell cell-differs"
                                onClick={() => open(name, "differences")}
                              >
                                <Icon name="differs" size={14} /> {t.mcp.different}
                              </button>
                            </Tooltip>
                          </td>
                        );
                      }
                      if (server?.options.disabled) {
                        return (
                          <td key={agent} className={`agent-col ${off}`}>
                            <Tooltip text={t.mcp.offTip}>
                              <span className="cell cell-paused" tabIndex={0}>
                                {t.mcp.offCell}
                              </span>
                            </Tooltip>
                          </td>
                        );
                      }
                      if (server) {
                        return (
                          <td key={agent} className={`agent-col ${off}`}>
                            <span className="cell cell-on">
                              <Icon name="check" size={14} /> {t.mcp.installed}
                            </span>
                          </td>
                        );
                      }
                      if (!supports(source, agent)) {
                        return (
                          <td key={agent} className={`agent-col ${off}`}>
                            <span className="cell cell-none" title={t.mcp.noSse}>
                              {t.mcp.unsupported}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={agent} className={`agent-col ${off}`}>
                          <Tooltip text={t.mcp.copyTip(name, nameOf(source.agent), nameOf(agent))}>
                            <button
                              className="cell cell-add"
                              onClick={() => copyMany(name, source.agent, [agent], false)}
                            >
                              <Icon name="plus" size={14} /> {t.mcp.addCell}
                            </button>
                          </Tooltip>
                        </td>
                      );
                    })}
                    <td className="menu-col">
                      <RowMenu label={t.common.actionsFor(name)} items={menu} />
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
        subtitle={t.mcp.inAgents(formatList(copies.map((copy) => nameOf(copy.agent))))}
        tabs={[
          { id: "details", label: t.mcp.details },
          { id: "differences", label: t.mcp.differences, count: drifting.length },
          { id: "backups", label: t.mcp.backups, count: saved },
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
                            ? t.mcp.testLocal(describe(server.transport))
                            : t.mcp.testRemote
                        }
                        onClick={() => test(server.agent, name)}
                      >
                        {tests[`${server.agent}/${name}`]?.running ? t.mcp.testing : t.mcp.test}
                      </button>
                      <button className="small" onClick={() => setOpened({ name, tab, editing: server.agent })}>
                        {t.mcp.edit}
                      </button>
                      <button
                        className="small"
                        onClick={() =>
                          openConfig(server.agent).catch((err) => notify({ tone: "error", text: errorText(err) }))
                        }
                      >
                        {t.mcp.openFile}
                      </button>
                      <button
                        className="small"
                        onClick={() => run(() => removeMcpServer(server.agent, name), t.mcp.removed(name, nameOf(server.agent)))}
                      >
                        {t.mcp.remove}
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
                  <strong>{t.mcp.notIn(formatList(missing.map((info) => info.name)))}</strong>
                  <button
                    className="small"
                    onClick={() => copyMany(name, source.agent, missing.map((info) => info.agent), false)}
                  >
                    <Icon name="plus" size={14} /> {missing.length === 1 ? t.mcp.addTo(missing[0].name) : t.mcp.addToAll}
                  </button>
                </header>
                <p className="hint">{t.mcp.copiesSettings(nameOf(source.agent))}</p>
              </section>
            )}
            {copies.length > 1 && (
              <div className="drawer-footer">
                <button className="small danger" onClick={() => removeFrom(name, copies.map((copy) => copy.agent))}>
                  {t.mcp.removeEverywhere}
                </button>
              </div>
            )}
          </>
        )}

        {tab === "differences" &&
          (drifting.length === 0 ? (
            <p className="hint">
              {copies.length === 1 ? t.mcp.onlyOne(nameOf(source.agent), name) : t.mcp.allSame(name)}
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
                        {t.mcp.useEverywhere(nameOf(server.agent))}
                      </button>
                      <button className="small primary" onClick={() => copyMany(name, source.agent, [server.agent], true)}>
                        {t.mcp.useHere(nameOf(source.agent))}
                      </button>
                    </div>
                  </section>
                );
              })}
              <p className="hint">{t.mcp.secretsCopied}</p>
            </>
          ))}

        {tab === "backups" &&
          (saved === 0 ? (
            <p className="hint">{t.mcp.noBackups}</p>
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
                          <strong>{t.mcp.until(formatDateTime(version.replacedMs))}</strong>
                          <span className="hint">{describeVersion(version, byAgent.get(agent))}</span>
                        </div>
                        <button
                          className="small"
                          disabled={version.current}
                          title={version.current ? t.mcp.isNow : undefined}
                          onClick={() =>
                            run(
                              () => restoreServerVersion(agent, name, version.id),
                              version.server ? t.mcp.putBack(name, nameOf(agent)) : t.mcp.removedAsItWas(name, nameOf(agent)),
                            )
                          }
                        >
                          {t.mcp.restore}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <p className="hint">{t.mcp.restoreHint}</p>
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
  if (version.current) return t.mcp.sameAsNow;
  if (!version.server) return t.mcp.notSetUp;
  if (!now) return t.mcp.ran(describe(version.server.transport));
  const changed = changes(version.server, now);
  return changed.length > 0 ? changed.join(" ") : t.mcp.otherSettings;
}

/** What a server runs and with which settings, without its secret values. */
function Facts({ server }: { server: McpServer }) {
  const { transport, options } = server;
  const keys = [...server.envKeys, ...server.headerKeys];
  return (
    <dl className="facts">
      <dt>{transport.kind === "stdio" ? t.mcp.command : transport.kind === "http" ? t.mcp.httpUrl : t.mcp.sseUrl}</dt>
      <dd>
        <code>{describe(transport)}</code>
      </dd>
      <dt>{transport.kind === "stdio" ? t.mcp.variables : t.mcp.headers}</dt>
      <dd>{keys.length > 0 ? keys.join(", ") : t.common.none}</dd>
      {WITH_OPTIONS.includes(server.agent) && (
        <>
          {options.cwd && (
            <>
              <dt>{t.mcp.cwd}</dt>
              <dd>
                <code>{options.cwd}</code>
              </dd>
            </>
          )}
          {options.timeoutMs !== null && (
            <>
              <dt>{t.mcp.timeout}</dt>
              <dd>{`${formatNumber(options.timeoutMs / 1000)}\u00a0s`}</dd>
            </>
          )}
          {options.includeTools && (
            <>
              <dt>{t.mcp.onlyTools}</dt>
              <dd>{options.includeTools.join(", ") || t.common.none}</dd>
            </>
          )}
          {options.excludeTools && options.excludeTools.length > 0 && (
            <>
              <dt>{t.mcp.neverTools}</dt>
              <dd>{options.excludeTools.join(", ")}</dd>
            </>
          )}
          {options.disabled && (
            <>
              <dt>{t.mcp.state}</dt>
              <dd>{t.mcp.off}</dd>
            </>
          )}
        </>
      )}
    </dl>
  );
}

const rowId = (name: string) => `server-${name}`;
