import { useEffect, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Empty, Icon, Notice, PageHeader } from "../components/ui";
import { LauncherRepair } from "../components/LauncherRepair";
import { useToast } from "../components/Toasts";
import { listSecrets, markSecretName, previewProtect, protectServer, undoChange, unprotectServer } from "../lib/api";
import { IS_MAC } from "../lib/keys";
import { describe } from "../lib/servers";
import { useFilesChanged } from "../lib/watch";
import type { Agent, AgentInfo, McpListing, ProtectPreview, SecretListing, SecretRef } from "../lib/types";

/** Where protected secrets go on this system. */
const KEYCHAIN = IS_MAC
  ? "macOS Keychain"
  : /Windows/.test(navigator.userAgent)
    ? "Windows Credential Manager"
    : "Secret Service";

interface Props {
  agents: AgentInfo[];
  /** The MCP servers, to show what each agent runs. */
  servers: McpListing;
  onChange: () => void;
}

export function SecretsPage({ agents, servers, onChange }: Props) {
  const [listing, setListing] = useState<SecretListing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  // The server about to be protected, and how its command changes.
  const [pending, setPending] = useState<{ agent: Agent; server: string; preview: ProtectPreview } | null>(null);
  const notify = useToast();

  async function load() {
    try {
      setListing(await listSecrets());
      setLoadError(null);
    } catch (err) {
      setLoadError(String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);
  useFilesChanged("mcp", load);

  async function refresh() {
    await load();
    onChange();
  }

  /** Runs `steps` in order and shows one toast whose Undo reverts all that ran. */
  async function run(key: string, steps: (() => Promise<number>)[], done: (count: number) => string) {
    setBusy(key);
    const ids: number[] = [];
    try {
      for (const step of steps) ids.push(await step());
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    if (ids.length > 0) {
      notify({
        tone: "success",
        text: done(ids.length),
        undo: async () => {
          for (const id of [...ids].reverse()) await undoChange(id);
          await refresh();
        },
      });
    }
    setBusy(null);
    await refresh();
  }

  async function askToProtect(agent: Agent, server: string) {
    try {
      setPending({ agent, server, preview: await previewProtect(agent, server) });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
  }

  async function mark(name: string, secret: boolean | null) {
    try {
      await markSecretName(name, secret);
      notify({
        tone: "success",
        text:
          secret === null
            ? `${name} is judged by its name and value again.`
            : secret
              ? `${name} is now treated as a secret on every server.`
              : `${name} is now treated as a setting on every server.`,
      });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    await refresh();
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const commandOf = (agent: Agent, server: string) => {
    const found = servers.servers.find((s) => s.agent === agent && s.name === server);
    return found ? describe(found.transport) : null;
  };

  // One group per server, in the order the core lists them.
  const all = listing?.secrets ?? [];
  const secrets = groupByServer(all.filter((s) => s.likely || s.vaultId));
  const others = all.filter((s) => !s.likely && !s.vaultId);
  const plainCount = all.filter((s) => s.likely && !s.vaultId).length;
  const vaultCount = all.filter((s) => s.vaultId).length;
  // Servers with variables that Protect moves, and those variables.
  const toProtect = [...secrets].filter(([, group]) => group.some((s) => s.protectable));

  return (
    <>
      <PageHeader
        title="Secrets"
        description={
          <>
            API keys and tokens set in MCP server configs. In plain text, anything that can read
            these files can read them. AgentDeck moves the environment variables of local servers
            to your system keychain, and the agent then starts the server through{" "}
            <code>agentdeck exec</code>, which passes them back. Values are never shown here.
          </>
        }
        actions={
          toProtect.length > 0 && (
            <button
              className="primary"
              disabled={!listing?.launcher || busy !== null}
              onClick={() => setConfirmAll(true)}
            >
              <Icon name="shield" /> Protect all
            </button>
          )
        }
      />

      {listing && !listing.launcher && (
        <Notice tone="warning">
          Moving secrets to the keychain needs the <code>agentdeck</code> command-line tool that
          ships with AgentDeck, and it was not found next to the app. Reinstall AgentDeck, or
          install the tool with <code>cargo install --path crates/agentdeck-cli</code>.
        </Notice>
      )}
      {listing && <LauncherRepair agents={agents} listing={listing} onRepaired={refresh} />}
      {listing?.errors.map((text) => (
        <Notice key={text} tone="error">{text}</Notice>
      ))}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      {listing && (
        <div className="stats">
          <div className="stat">
            <span className="label">In plain text</span>
            <span className={`value ${plainCount > 0 ? "danger-text" : ""}`}>{plainCount}</span>
            <span className="hint">
              {toProtect.length > 0
                ? `${toProtect.length} server${toProtect.length === 1 ? "" : "s"} can be protected`
                : "Nothing left to protect"}
            </span>
          </div>
          <div className="stat">
            <span className="label">In the keychain</span>
            <span className="value ok-text">{vaultCount}</span>
            <span className="hint">{KEYCHAIN}</span>
          </div>
          <div className="stat">
            <span className="label">Launcher</span>
            <span className={`value ${listing.launcher ? "ok-text" : "danger-text"}`}>
              {listing.launcher ? "Ready" : "Missing"}
            </span>
            <span className="hint clamp" title={listing.launcher ?? undefined}>
              {listing.stranded.length > 0
                ? `${listing.stranded.length} protected server${listing.stranded.length === 1 ? "" : "s"} to repair`
                : (listing.launcher ?? "agentdeck was not found")}
            </span>
          </div>
        </div>
      )}

      {listing && all.length === 0 && (
        <Empty icon="shield" title="No MCP server uses secrets">
          Servers with API keys or tokens in their config show up here.
        </Empty>
      )}

      {secrets.size > 0 && (
        <div className="table-card">
          <table className="secrets">
            <thead>
              <tr>
                <th>Server</th>
                <th>Secret</th>
                <th>Stored</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...secrets].map(([key, group]) => {
                const { agent, server } = group[0];
                const canProtect = group.some((s) => s.protectable);
                const protectedCount = group.filter((s) => s.vaultId).length;
                const stranded = listing?.stranded.some((s) => s.agent === agent && s.server === server);
                const command = commandOf(agent, server);
                return group.map((secret, index) => (
                  <tr key={`${key}/${secret.kind}/${secret.key}`}>
                    {index === 0 && (
                      <td rowSpan={group.length}>
                        <strong>{server}</strong>
                        <small>{nameOf(agent)}</small>
                        {stranded && (
                          <span className="pill pill-danger" title="The agentdeck launcher this server starts through is missing">
                            <Icon name="alert" size={12} /> Won't start
                          </span>
                        )}
                        {command && (
                          <details className="runs">
                            <summary>What {nameOf(agent)} runs</summary>
                            <code>{command}</code>
                          </details>
                        )}
                      </td>
                    )}
                    <td>
                      <code>{secret.key}</code>
                      <small>{secret.kind === "env" ? "Environment variable" : "HTTP header"}</small>
                    </td>
                    <td>
                      {secret.vaultId ? (
                        <span className="pill pill-ok"><Icon name="shield" size={12} /> Keychain</span>
                      ) : (
                        <span className="pill pill-danger"><Icon name="alert" size={12} /> Plain text</span>
                      )}
                      {!secret.vaultId && secret.sameValueElsewhere > 0 && (
                        <small>Same value in {secret.sameValueElsewhere} other place(s)</small>
                      )}
                      {!secret.vaultId && !secret.protectable && (
                        <small>Headers of remote servers stay in the config for now</small>
                      )}
                      {!secret.vaultId && (
                        <MarkButton secret={secret} onMark={mark} />
                      )}
                    </td>
                    {index === 0 && (
                      <td rowSpan={group.length} className="actions">
                        {canProtect && (
                          <button
                            className="primary small"
                            disabled={!listing?.launcher || busy !== null}
                            onClick={() => askToProtect(agent, server)}
                          >
                            {busy === key ? "Moving…" : "Move to keychain"}
                          </button>
                        )}
                        {protectedCount > 0 && (
                          <button
                            className="small"
                            disabled={busy !== null}
                            onClick={() =>
                              run(key, [() => unprotectServer(agent, server)], () => `Put the secrets of ${server} back in its config.`)
                            }
                          >
                            Restore to config
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}

      {others.length > 0 && (
        <details className="card other-variables">
          <summary>
            <strong>Other variables</strong>
            <span className="hint">
              {others.length} setting{others.length === 1 ? "" : "s"} such as <code>{others[0].key}</code>, kept in the
              config
            </span>
          </summary>
          <ul className="copies">
            {others.map((secret) => (
              <li key={`${secret.agent}/${secret.server}/${secret.kind}/${secret.key}`}>
                <div>
                  <code>{secret.key}</code>
                  <span className="hint">
                    {secret.server} · {nameOf(secret.agent)} ·{" "}
                    {secret.kind === "env" ? "environment variable" : "HTTP header"}
                  </span>
                </div>
                <MarkButton secret={secret} onMark={mark} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {pending && (
        <ConfirmDialog
          wide
          title={`Move the secrets of ${pending.server} to the keychain?`}
          onCancel={() => setPending(null)}
          choices={[
            {
              label: "Move to keychain",
              tone: "primary",
              onSelect: () => {
                const { agent, server } = pending;
                setPending(null);
                run(
                  `${agent}/${server}`,
                  [() => protectServer(agent, server)],
                  () => `Moved the secrets of ${server} to the keychain.`,
                );
              },
            },
          ]}
        >
          <p>
            {listOf(pending.preview.moved)} {pending.preview.moved.length === 1 ? "moves" : "move"} to the {KEYCHAIN}
            {pending.preview.kept.length > 0 &&
              `, and ${listOf(pending.preview.kept)} ${pending.preview.kept.length === 1 ? "stays" : "stay"} in the config`}
            . {nameOf(pending.agent)} then starts {pending.server} through <code>agentdeck exec</code>, which reads
            them back. It can be undone.
          </p>
          <dl className="facts command-change">
            <dt>Now</dt>
            <dd>
              <code>{describe(pending.preview.before)}</code>
            </dd>
            <dt>After</dt>
            <dd>
              <code>{describe(pending.preview.after)}</code>
            </dd>
          </dl>
        </ConfirmDialog>
      )}

      {confirmAll && (
        <ConfirmDialog
          wide
          title={`Move the secrets of ${toProtect.length} server${toProtect.length === 1 ? "" : "s"} to the keychain?`}
          onCancel={() => setConfirmAll(false)}
          choices={[
            {
              label: "Protect all",
              tone: "primary",
              onSelect: () => {
                setConfirmAll(false);
                run(
                  "all",
                  toProtect.map(([, group]) => () => protectServer(group[0].agent, group[0].server)),
                  (count) => `Moved the secrets of ${count} server${count === 1 ? "" : "s"} to the keychain.`,
                );
              },
            },
          ]}
        >
          <ul className="differences">
            {toProtect.map(([key, group]) => (
              <li key={key}>
                <strong>{group[0].server}</strong> ({nameOf(group[0].agent)}):{" "}
                {group
                  .filter((s) => s.protectable)
                  .map((s) => s.key)
                  .join(", ")}
              </li>
            ))}
          </ul>
          <p>
            Before: {plainCount} secret{plainCount === 1 ? "" : "s"} in plain text. After:{" "}
            {plainCount - countProtectable(toProtect)} in plain text, {vaultCount + countProtectable(toProtect)} in the{" "}
            {KEYCHAIN}. Each server then starts through <code>agentdeck exec</code>, which reads them back. It can be
            undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function groupByServer(secrets: SecretRef[]): Map<string, SecretRef[]> {
  const groups = new Map<string, SecretRef[]>();
  for (const secret of secrets) {
    const key = `${secret.agent}/${secret.server}`;
    groups.set(key, [...(groups.get(key) ?? []), secret]);
  }
  return groups;
}

/** "A", "A and B", "A, B and C". */
function listOf(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const countProtectable = (groups: [string, SecretRef[]][]) =>
  groups.reduce((sum, [, group]) => sum + group.filter((s) => s.protectable).length, 0);

/** Lets the user say whether a variable name holds a secret, or undo that. */
function MarkButton({ secret, onMark }: { secret: SecretRef; onMark: (name: string, secret: boolean | null) => void }) {
  if (secret.marked) {
    return (
      <small>
        Marked as {secret.likely ? "a secret" : "a setting"} by you ·{" "}
        <button className="link" onClick={() => onMark(secret.key, null)}>
          Reset
        </button>
      </small>
    );
  }
  return (
    <small>
      <button className="link" onClick={() => onMark(secret.key, !secret.likely)}>
        {secret.likely ? "Not a secret" : "Treat as a secret"}
      </button>
    </small>
  );
}
