import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type ClipboardEvent, type FormEvent } from "react";
import { Icon, Notice } from "./ui";
import { CATALOG, type CatalogServer } from "../lib/catalog";
import { splitCommand } from "../lib/command";
import { parseServers, type ImportedServer } from "../lib/importServers";
import { WITH_OPTIONS } from "../lib/servers";
import type { Agent, AgentInfo, McpServer, ServerOptions, Transport } from "../lib/types";

/** What the form submits: values are `null` for variables kept as they are. */
export interface ServerDraft {
  /** The agent the server is added to or edited in. */
  agent: Agent;
  name: string;
  transport: Transport;
  env: Record<string, string | null>;
  headers: Record<string, string | null>;
  options: ServerOptions;
  /** Other agents to give the same settings. */
  alsoTo: Agent[];
}

/** One variable or header row. `value` is `null` for a kept value, which is never shown. */
interface Variable {
  id: number;
  key: string;
  value: string | null;
  shown: boolean;
  hint?: string;
}

let nextId = 0;
const variable = (key: string, value: string | null, hint?: string): Variable => ({
  id: nextId++,
  key,
  value,
  shown: false,
  hint,
});

const list = (text: string) => {
  const items = text.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
};

interface Props {
  agents: AgentInfo[];
  /** The server to edit, and the other agents that have it. Absent to add one. */
  editing?: { server: McpServer; others: Agent[] };
  /** Whether `agent` already has a server called `name`, when adding. */
  has?: (agent: Agent, name: string) => boolean;
  onSubmit: (draft: ServerDraft) => Promise<void>;
  onCancel: () => void;
}

/**
 * Adds a server to several agents at once, from a common server, pasted JSON
 * or by hand, or edits one agent's copy. Secret values are typed masked and
 * kept values are never shown.
 */
export function ServerForm({ agents, editing, has = () => false, onSubmit, onCancel }: Props) {
  const initial = editing?.server;
  // New servers go to agents on this computer, unless none was found.
  const offered = agents.some((info) => info.installed) ? agents.filter((info) => info.installed) : agents;
  const [targets, setTargets] = useState<Agent[]>(initial ? [initial.agent] : offered.map((info) => info.agent));
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<Transport["kind"]>(initial?.transport.kind ?? "stdio");
  const [command, setCommand] = useState(initial?.transport.kind === "stdio" ? initial.transport.command : "");
  const [args, setArgs] = useState<string[]>(initial?.transport.kind === "stdio" ? initial.transport.args : []);
  const [url, setUrl] = useState(initial && initial.transport.kind !== "stdio" ? initial.transport.url : "");
  const [variables, setVariables] = useState<Variable[]>(
    initial ? [...initial.envKeys, ...initial.headerKeys].map((key) => variable(key, null)) : [],
  );
  const [cwd, setCwd] = useState(initial?.options.cwd ?? "");
  const [timeoutText, setTimeoutText] = useState(
    initial?.options.timeoutMs ? String(initial.options.timeoutMs / 1000) : "",
  );
  const [includeTools, setIncludeTools] = useState(initial?.options.includeTools?.join(", ") ?? "");
  const [excludeTools, setExcludeTools] = useState(initial?.options.excludeTools?.join(", ") ?? "");
  const [disabled, setDisabled] = useState(initial?.options.disabled ?? false);
  const [alsoTo, setAlsoTo] = useState<Agent[]>([]);
  const [picked, setPicked] = useState<CatalogServer | null>(null);
  const [pasted, setPasted] = useState("");
  const [imported, setImported] = useState<ImportedServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Rows added with a button take the focus; rows filled in by the form do not.
  const [grown, setGrown] = useState(false);

  const nameOf = (agent: Agent) => agents.find((info) => info.agent === agent)?.name ?? agent;
  const trimmedName = name.trim();
  /** Why an agent cannot get this server, if it cannot. */
  const blocked = (agent: Agent) =>
    agent === "codex" && kind === "sse"
      ? "Codex does not support SSE servers"
      : !initial && trimmedName && has(agent, trimmedName)
        ? `Already has ${trimmedName}`
        : null;
  const chosen = initial ? [initial.agent] : targets.filter((agent) => !blocked(agent));
  const withOptions = chosen.filter((agent) => WITH_OPTIONS.includes(agent));
  const isHeader = kind !== "stdio";

  /** Fills the form from a common server or pasted JSON. */
  function fill(server: {
    name: string;
    transport: Transport;
    values: Record<string, string>;
    hints?: Record<string, string>;
    options?: Partial<ServerOptions>;
  }) {
    if (server.name) setName(server.name);
    setKind(server.transport.kind);
    if (server.transport.kind === "stdio") {
      setCommand(server.transport.command);
      setArgs(server.transport.args);
      setUrl("");
    } else {
      setUrl(server.transport.url);
      setCommand("");
      setArgs([]);
    }
    setVariables(
      Object.entries(server.values).map(([key, value]) => variable(key, value, server.hints?.[key])),
    );
    const options = server.options ?? {};
    setCwd(options.cwd ?? "");
    setTimeoutText(options.timeoutMs ? String(options.timeoutMs / 1000) : "");
    setIncludeTools(options.includeTools?.join(", ") ?? "");
    setExcludeTools(options.excludeTools?.join(", ") ?? "");
    setDisabled(options.disabled ?? false);
    setError(null);
  }

  function pick(server: CatalogServer) {
    setPicked(server);
    setImported([]);
    const secrets = server.secrets ?? [];
    fill({
      name: server.name,
      transport: server.transport,
      values: Object.fromEntries(secrets.map((s) => [s.key, ""])),
      hints: Object.fromEntries(secrets.map((s) => [s.key, s.hint])),
    });
  }

  function load(server: ImportedServer) {
    setPicked(null);
    fill({
      name: server.name,
      transport: server.transport,
      values: server.transport.kind === "stdio" ? server.env : server.headers,
      options: server.options,
    });
  }

  function importPasted() {
    try {
      const servers = parseServers(pasted);
      setImported(servers.length > 1 ? servers : []);
      load(servers[0]);
      setPasted("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** A whole command line pasted in the empty command field is split into words. */
  function onCommandPaste(event: ClipboardEvent<HTMLInputElement>) {
    const words = splitCommand(event.clipboardData.getData("text"));
    if (words.length > 1 && !command && args.length === 0) {
      event.preventDefault();
      setCommand(words[0]);
      setArgs(words.slice(1));
    }
  }

  const setVariable = (id: number, change: Partial<Variable>) =>
    setVariables((current) => current.map((v) => (v.id === id ? { ...v, ...change } : v)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fail = (message: string) => {
      setError(message);
      return undefined;
    };
    if (chosen.length === 0) return fail("Choose at least one agent.");
    if (kind === "stdio" && !command.trim()) return fail("Give the command that starts the server.");
    if (kind === "stdio" && args.some((arg) => arg === "")) return fail("Fill in or remove the empty argument.");
    const rows = variables.filter((v) => v.key.trim() || v.value);
    if (rows.some((v) => !v.key.trim())) return fail(`Give each ${isHeader ? "header" : "variable"} a name.`);
    const keys = rows.map((v) => v.key.trim());
    const repeated = keys.find((key, i) => keys.indexOf(key) !== i);
    if (repeated) return fail(`${repeated} is set twice.`);
    const known = new Set(initial ? [...initial.envKeys, ...initial.headerKeys] : []);
    // An empty field keeps the value of a known variable; a new one needs a value.
    const values = Object.fromEntries(
      rows.map((v) => [v.key.trim(), v.value === null || (v.value === "" && known.has(v.key.trim())) ? null : v.value]),
    );
    const unset = Object.keys(values).filter((key) => values[key] === null && !known.has(key));
    if (unset.length > 0) return fail(`Give ${unset.join(", ")} a value.`);
    const seconds = Number(timeoutText);
    if (timeoutText.trim() && !(seconds > 0)) return fail("The timeout is a number of seconds.");
    setError(null);

    const transport: Transport =
      kind === "stdio" ? { kind, command: command.trim(), args } : { kind, url: url.trim() };
    const [agent, ...others] = chosen;
    const anyOptions = withOptions.length > 0;
    setSaving(true);
    // The form closes on success and keeps its fields on failure.
    await onSubmit({
      agent,
      name: trimmedName,
      transport,
      env: kind === "stdio" ? values : {},
      headers: kind === "stdio" ? {} : values,
      options: {
        cwd: anyOptions && kind === "stdio" && cwd.trim() ? cwd.trim() : null,
        timeoutMs: anyOptions && timeoutText.trim() ? Math.round(seconds * 1000) : null,
        includeTools: anyOptions ? list(includeTools) : null,
        excludeTools: anyOptions ? list(excludeTools) : null,
        disabled: chosen.includes("codex") && disabled,
      },
      alsoTo: initial ? alsoTo : others,
    });
    setSaving(false);
  }

  return (
    <form className={initial ? "card form" : "form"} onSubmit={submit}>
      {initial && <h3>Edit {initial.name} in {nameOf(initial.agent)}</h3>}

      {!initial && (
        <section className="drawer-section start-from">
          <header>
            <strong>Start from a common server</strong>
          </header>
          <div className="catalog">
            {CATALOG.map((server) => (
              <button
                key={server.name}
                type="button"
                className={server === picked ? "catalog-item active" : "catalog-item"}
                aria-pressed={server === picked}
                onClick={() => pick(server)}
              >
                <strong>{server.title}</strong>
                <small>{server.summary}</small>
              </button>
            ))}
          </div>
          {picked && (
            <p className="hint">
              {picked.note && `${picked.note} `}
              <button type="button" className="link" onClick={() => openUrl(picked.docs).catch(() => undefined)}>
                Documentation
              </button>
            </p>
          )}
          <details className="paste-json">
            <summary>Or paste its JSON settings</summary>
            <textarea
              rows={5}
              spellCheck={false}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={'{\n  "mcpServers": {\n    "github": { "command": "npx", "args": ["-y", "…"] }\n  }\n}'}
            />
            <div className="form-actions">
              <button type="button" className="small" disabled={!pasted.trim()} onClick={importPasted}>
                Fill in the form
              </button>
              <small className="hint">From a README, or the config of Claude Code, Cursor or Gemini CLI.</small>
            </div>
          </details>
          {imported.length > 1 && (
            <div className="imported" role="group" aria-label="Servers in the pasted JSON">
              <span className="hint">The JSON has {imported.length} servers:</span>
              {imported.map((server) => (
                <button
                  key={server.name}
                  type="button"
                  className="small"
                  aria-pressed={server.name === trimmedName}
                  onClick={() => load(server)}
                >
                  {server.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <div className="fields">
        <label>
          Name
          <input
            required
            disabled={!!initial}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="github"
            spellCheck={false}
          />
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

      {!initial && (
        <fieldset className="also">
          <legend>Add to</legend>
          {offered.map((info) => {
            const reason = blocked(info.agent);
            return (
              <label key={info.agent} className="check" title={reason ?? undefined}>
                <input
                  type="checkbox"
                  disabled={!!reason}
                  checked={!reason && targets.includes(info.agent)}
                  onChange={(e) =>
                    setTargets(
                      e.target.checked ? [...targets, info.agent] : targets.filter((a) => a !== info.agent),
                    )
                  }
                />
                {info.name}
                {reason ? (
                  <small className="check-note">{reason}</small>
                ) : (
                  !info.hasConfig && info.installed && <small className="check-note">creates its config</small>
                )}
              </label>
            );
          })}
        </fieldset>
      )}

      {kind === "stdio" ? (
        <>
          <label>
            Command
            <input
              required
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onPaste={onCommandPaste}
              placeholder="npx"
              spellCheck={false}
            />
            <small className="hint">Pasting a whole command line fills in the arguments too.</small>
          </label>
          <fieldset className="rows">
            <legend>Arguments</legend>
            {args.map((arg, i) => (
              <div key={i} className="row-field">
                <input
                  autoFocus={grown && i === args.length - 1}
                  aria-label={`Argument ${i + 1}`}
                  value={arg}
                  onChange={(e) => setArgs(args.map((a, j) => (j === i ? e.target.value : a)))}
                  placeholder={i === 0 ? "-y" : "Argument"}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove argument ${i + 1}`}
                  title="Remove"
                  onClick={() => setArgs(args.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="link"
              onClick={() => {
                setGrown(true);
                setArgs([...args, ""]);
              }}
            >
              <Icon name="plus" size={12} /> Add an argument
            </button>
          </fieldset>
        </>
      ) : (
        <label>
          URL
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/mcp"
            spellCheck={false}
          />
        </label>
      )}

      <fieldset className="rows">
        <legend>{isHeader ? "Headers" : "Environment variables"}</legend>
        {variables.map((v) => (
          <div key={v.id} className="row-field">
            <input
              autoFocus={grown && v === variables[variables.length - 1]}
              aria-label="Name"
              className="variable-key"
              value={v.key}
              disabled={v.value === null && !!initial}
              onChange={(e) => setVariable(v.id, { key: e.target.value })}
              placeholder={isHeader ? "Authorization" : "API_KEY"}
              spellCheck={false}
            />
            <input
              aria-label={`Value of ${v.key || "this variable"}`}
              type={v.shown ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={v.value ?? ""}
              onChange={(e) => setVariable(v.id, { value: e.target.value })}
              placeholder={v.value === null ? "Unchanged, hidden" : (v.hint ?? "Value")}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={v.shown ? "Hide the value" : "Show the value"}
              title={v.shown ? "Hide" : "Show"}
              aria-pressed={v.shown}
              disabled={v.value === null}
              onClick={() => setVariable(v.id, { shown: !v.shown })}
            >
              <Icon name={v.shown ? "eye-off" : "eye"} size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${v.key || "this variable"}`}
              title="Remove"
              onClick={() => setVariables(variables.filter((other) => other.id !== v.id))}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="link"
          onClick={() => {
            setGrown(true);
            setVariables([...variables, variable("", "")]);
          }}
        >
          <Icon name="plus" size={12} /> Add {isHeader ? "a header" : "a variable"}
        </button>
        {initial && variables.some((v) => v.value === null) && (
          <small className="hint">Values are never shown. Type in a field to replace that value.</small>
        )}
      </fieldset>

      {withOptions.length > 0 && (
        <details className="advanced" open={Boolean(cwd || timeoutText || includeTools || excludeTools || disabled)}>
          <summary>Advanced settings</summary>
          {!initial && withOptions.length < chosen.length && (
            <p className="hint">Only {withOptions.map(nameOf).join(" and ")} use these.</p>
          )}
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
          {chosen.includes("codex") && (
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
                onChange={(e) => setAlsoTo(e.target.checked ? [...alsoTo, other] : alsoTo.filter((a) => a !== other))}
              />
              {nameOf(other)}
            </label>
          ))}
          <small className="hint">Their settings for {initial?.name} are replaced with these, secrets included.</small>
        </fieldset>
      )}

      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving}>
          {initial
            ? "Save"
            : chosen.length > 1
              ? `Add to ${chosen.length} agents`
              : chosen.length === 1
                ? `Add to ${nameOf(chosen[0])}`
                : "Add server"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
