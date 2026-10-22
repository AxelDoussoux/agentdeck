import { Fragment, useEffect, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Empty, Icon, Notice, PageHeader } from "../components/ui";
import { LauncherRepair } from "../components/LauncherRepair";
import { useToast } from "../components/Toasts";
import { listSecrets, markSecretName, previewProtect, protectServer, undoChange, unprotectServer } from "../lib/api";
import { errorText, formatList, t } from "../lib/i18n";
import { IS_MAC } from "../lib/keys";
import { describe } from "../lib/servers";
import { useFilesChanged } from "../lib/watch";
import type { Agent, AgentInfo, McpListing, ProtectPreview, SecretListing, SecretRef } from "../lib/types";

/** Where protected secrets go on this system. */
const IS_WINDOWS = /Windows/.test(navigator.userAgent);

const SYSTEM = IS_MAC ? "mac" : IS_WINDOWS ? "windows" : "linux";
/** The keychain's name, and the phrase that names it in sentences. */
const keychain = () => t.secrets.keychains[SYSTEM];

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
      setLoadError(errorText(err));
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
      notify({ tone: "error", text: errorText(err) });
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
      notify({ tone: "error", text: errorText(err) });
    }
  }

  async function mark(name: string, secret: boolean | null) {
    try {
      await markSecretName(name, secret);
      notify({
        tone: "success",
        text: secret === null ? t.secrets.judgedAgain(name) : t.secrets.nowTreated(name, secret),
      });
    } catch (err) {
      notify({ tone: "error", text: errorText(err) });
    }
    await refresh();
  }

  async function copyHook() {
    try {
      await navigator.clipboard.writeText(listing?.shellHook ?? "");
      notify({ tone: "success", text: t.secrets.copiedLine });
    } catch (err) {
      notify({ tone: "error", text: t.secrets.copyFailed(errorText(err)) });
    }
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const commandOf = (agent: Agent, server: string) => {
    const found = servers.servers.find((s) => s.agent === agent && s.name === server);
    return found ? describe(found.transport) : null;
  };

  // One group per server, in the order the core lists them.
  const all = listing?.secrets ?? [];
  const isProtected = (s: SecretRef) => s.vaultId !== null || s.envVar !== null;
  const secrets = groupByServer(all.filter((s) => s.likely || isProtected(s)));
  const others = all.filter((s) => !s.likely && !isProtected(s));
  const plainCount = all.filter((s) => s.likely && !isProtected(s)).length;
  const vaultCount = all.filter(isProtected).length;
  // Headers of remote servers that read a variable, which the shell sets.
  const variables = [...new Set(all.filter((s) => s.kind === "header" && s.envVar).map((s) => s.envVar!))];
  // Servers with variables that Protect moves, and those variables.
  const toProtect = [...secrets].filter(([, group]) => group.some((s) => s.protectable));

  return (
    <>
      <PageHeader
        title={t.nav.secrets}
        description={t.secrets.description}
        actions={
          toProtect.length > 0 && (
            <button
              className="primary"
              disabled={!listing?.launcher || busy !== null}
              onClick={() => setConfirmAll(true)}
            >
              <Icon name="shield" /> {t.secrets.protectAll}
            </button>
          )
        }
      />

      {listing && !listing.launcher && (
        <Notice tone="warning">{t.secrets.noLauncher}</Notice>
      )}
      {listing && <LauncherRepair agents={agents} listing={listing} onRepaired={refresh} />}
      {listing?.errors.map((text) => (
        <Notice key={text} tone="error">{text}</Notice>
      ))}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      {listing && (
        <div className="stats">
          <div className="stat">
            <span className="label">{t.secrets.inPlainText}</span>
            <span className={`value ${plainCount > 0 ? "danger-text" : ""}`}>{plainCount}</span>
            <span className="hint">
              {toProtect.length > 0 ? t.secrets.canProtect(toProtect.length) : t.secrets.nothingLeft}
            </span>
          </div>
          <div className="stat">
            <span className="label">{t.secrets.protected}</span>
            <span className="value ok-text">{vaultCount}</span>
            <span className="hint">
              {variables.length > 0 ? t.secrets.andVariables(keychain().name) : keychain().name}
            </span>
          </div>
          <div className="stat">
            <span className="label">{t.settings.launcher}</span>
            <span className={`value ${listing.launcher ? "ok-text" : "danger-text"}`}>
              {listing.launcher ? t.secrets.ready : t.secrets.missing}
            </span>
            <span className="hint clamp" title={listing.launcher ?? undefined}>
              {listing.stranded.length > 0
                ? t.secrets.toRepair(listing.stranded.length)
                : (listing.launcher ?? t.secrets.launcherNotFound)}
            </span>
          </div>
        </div>
      )}

      {variables.length > 0 && listing?.shellHook && (
        <div className="card shell-hook">
          <p>
            {t.secrets.shellHook(
              formatList(variables.map((name) => `$${name}`)),
              variables.length,
              IS_WINDOWS,
              keychain().the,
            )}
          </p>
          <div className="hook-line">
            <code>{listing.shellHook}</code>
            <button className="small" onClick={copyHook}>
              {t.secrets.copy}
            </button>
          </div>
        </div>
      )}

      {listing && all.length === 0 && (
        <Empty icon="shield" title={t.secrets.emptyTitle}>
          {t.secrets.empty}
        </Empty>
      )}

      {secrets.size > 0 && (
        <div className="table-card">
          <table className="secrets">
            <thead>
              <tr>
                <th>{t.mcp.server}</th>
                <th>{t.secrets.secret}</th>
                <th>{t.secrets.stored}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...secrets].map(([key, group]) => {
                const { agent, server } = group[0];
                const canProtect = group.some((s) => s.protectable);
                const protectedCount = group.filter(isProtected).length;
                const stranded = listing?.stranded.some((s) => s.agent === agent && s.server === server);
                const command = commandOf(agent, server);
                return group.map((secret, index) => (
                  <tr key={`${key}/${secret.kind}/${secret.key}`}>
                    {index === 0 && (
                      <td rowSpan={group.length}>
                        <strong>{server}</strong>
                        <small>{nameOf(agent)}</small>
                        {stranded && (
                          <span className="pill pill-danger" title={t.secrets.wontStartTip}>
                            <Icon name="alert" size={12} /> {t.secrets.wontStart}
                          </span>
                        )}
                        {command && (
                          <details className="runs">
                            <summary>{t.secrets.runs(nameOf(agent))}</summary>
                            <code>{command}</code>
                          </details>
                        )}
                      </td>
                    )}
                    <td>
                      <code>{secret.key}</code>
                      <small>{secret.kind === "env" ? t.secrets.envVariable : t.secrets.httpHeader}</small>
                    </td>
                    <td>
                      {secret.vaultId ? (
                        <span className="pill pill-ok"><Icon name="shield" size={12} /> {t.secrets.keychain}</span>
                      ) : secret.envVar ? (
                        <span className="pill pill-ok" title={t.secrets.readsVariable}>
                          <Icon name="shield" size={12} /> ${secret.envVar}
                        </span>
                      ) : (
                        <span className="pill pill-danger"><Icon name="alert" size={12} /> {t.secrets.plainText}</span>
                      )}
                      {!isProtected(secret) && secret.sameValueElsewhere > 0 && (
                        <small>{t.secrets.sameValue(secret.sameValueElsewhere)}</small>
                      )}
                      {!isProtected(secret) && (
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
                            {busy === key ? t.secrets.moving : t.overview.moveToKeychain}
                          </button>
                        )}
                        {protectedCount > 0 && (
                          <button
                            className="small"
                            disabled={busy !== null}
                            onClick={() =>
                              run(key, [() => unprotectServer(agent, server)], () => t.secrets.putBack(server))
                            }
                          >
                            {t.secrets.restoreToConfig}
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
            <strong>{t.secrets.otherVariables}</strong>
            <span className="hint">{t.secrets.othersHint(others.length, <code>{others[0].key}</code>)}</span>
          </summary>
          <ul className="copies">
            {others.map((secret) => (
              <li key={`${secret.agent}/${secret.server}/${secret.kind}/${secret.key}`}>
                <div>
                  <code>{secret.key}</code>
                  <span className="hint">
                    {secret.server} · {nameOf(secret.agent)} ·{" "}
                    {secret.kind === "env" ? t.secrets.envVariableLower : t.secrets.httpHeaderLower}
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
          title={t.secrets.protectTitle(pending.server)}
          onCancel={() => setPending(null)}
          choices={[
            {
              label: t.overview.moveToKeychain,
              tone: "primary",
              onSelect: () => {
                const { agent, server } = pending;
                setPending(null);
                run(
                  `${agent}/${server}`,
                  [() => protectServer(agent, server)],
                  () => t.secrets.moved(server),
                );
              },
            },
          ]}
        >
          <p>
            {t.secrets.moves(pending.preview.moved, pending.preview.kept, keychain().the)}{" "}
            {pending.preview.headers.length > 0
              ? t.secrets.readsHeaders(
                  nameOf(pending.agent),
                  pending.preview.headers.length,
                  formatList(pending.preview.headers.map((change) => `$${change.variable}`)),
                )
              : t.secrets.startsThroughExec(nameOf(pending.agent), pending.server)}
          </p>
          {pending.preview.headers.length > 0 ? (
            <>
              <dl className="facts command-change">
                {pending.preview.headers.map((change) => (
                  <Fragment key={change.header}>
                    <dt>{change.header}</dt>
                    <dd>
                      <code>{change.value}</code>
                    </dd>
                  </Fragment>
                ))}
              </dl>
              {listing?.shellHook && (
                <div className="hook-line">
                  <code>{listing.shellHook}</code>
                  <button className="small" onClick={copyHook}>
                    {t.secrets.copy}
                  </button>
                </div>
              )}
            </>
          ) : (
            <dl className="facts command-change">
              <dt>{t.secrets.now}</dt>
              <dd>
                <code>{describe(pending.preview.before)}</code>
              </dd>
              <dt>{t.secrets.after}</dt>
              <dd>
                <code>{describe(pending.preview.after)}</code>
              </dd>
            </dl>
          )}
        </ConfirmDialog>
      )}

      {confirmAll && (
        <ConfirmDialog
          wide
          title={t.secrets.protectAllTitle(toProtect.length)}
          onCancel={() => setConfirmAll(false)}
          choices={[
            {
              label: t.secrets.protectAll,
              tone: "primary",
              onSelect: () => {
                setConfirmAll(false);
                run(
                  "all",
                  toProtect.map(([, group]) => () => protectServer(group[0].agent, group[0].server)),
                  (count) => t.secrets.movedAll(count),
                );
              },
            },
          ]}
        >
          <ul className="differences">
            {toProtect.map(([key, group]) => (
              <li key={key}>
                <strong>{group[0].server}</strong> ({nameOf(group[0].agent)}):{" "}
                {formatList(group.filter((s) => s.protectable).map((s) => s.key))}
              </li>
            ))}
          </ul>
          <p>
            {t.secrets.beforeAfter(
              plainCount,
              plainCount - countProtectable(toProtect),
              vaultCount + countProtectable(toProtect),
              keychain().the,
            )}
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

const countProtectable = (groups: [string, SecretRef[]][]) =>
  groups.reduce((sum, [, group]) => sum + group.filter((s) => s.protectable).length, 0);

/** Lets the user say whether a variable name holds a secret, or undo that. */
function MarkButton({ secret, onMark }: { secret: SecretRef; onMark: (name: string, secret: boolean | null) => void }) {
  if (secret.marked) {
    return (
      <small>
        {t.secrets.markedAs(secret.likely)} ·{" "}
        <button className="link" onClick={() => onMark(secret.key, null)}>
          {t.secrets.reset}
        </button>
      </small>
    );
  }
  return (
    <small>
      <button className="link" onClick={() => onMark(secret.key, !secret.likely)}>
        {secret.likely ? t.secrets.notSecret : t.secrets.treatAsSecret}
      </button>
    </small>
  );
}
