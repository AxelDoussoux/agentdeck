import { useEffect, useState } from "react";
import { Empty, Icon, Notice, PageHeader } from "../components/ui";
import { listSecrets, protectServer, unprotectServer } from "../lib/api";
import type { Agent, AgentInfo, SecretListing, SecretRef } from "../lib/types";

export function SecretsPage({ agents, onChange }: { agents: AgentInfo[]; onChange: () => void }) {
  const [listing, setListing] = useState<SecretListing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function load() {
    try {
      setListing(await listSecrets());
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function run(key: string, action: () => Promise<void>, done: string) {
    setBusy(key);
    try {
      await action();
      setMessage({ error: false, text: done });
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    }
    setBusy(null);
    await load();
    onChange();
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;

  // One group per server, in the order the core lists them.
  const groups = new Map<string, SecretRef[]>();
  for (const secret of listing?.secrets ?? []) {
    const key = `${secret.agent}/${secret.server}`;
    groups.set(key, [...(groups.get(key) ?? []), secret]);
  }
  const plainCount = listing?.secrets.filter((s) => s.likely && !s.vaultId).length ?? 0;
  const vaultCount = listing?.secrets.filter((s) => s.vaultId).length ?? 0;

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
      />

      {listing && !listing.launcher && (
        <Notice tone="warning">
          Moving secrets to the keychain needs the <code>agentdeck</code> command-line tool that
          ships with AgentDeck, and it was not found next to the app. Reinstall AgentDeck, or
          install the tool with <code>cargo install --path crates/agentdeck-cli</code>.
        </Notice>
      )}
      {listing?.errors.map((text) => (
        <Notice key={text} tone="error">{text}</Notice>
      ))}
      {message && <Notice tone={message.error ? "error" : "success"}>{message.text}</Notice>}

      {listing && (
        <div className="stats">
          <div className="stat">
            <span className="label">In plain text</span>
            <span className={`value ${plainCount > 0 ? "danger-text" : ""}`}>{plainCount}</span>
          </div>
          <div className="stat">
            <span className="label">In the keychain</span>
            <span className="value ok-text">{vaultCount}</span>
          </div>
        </div>
      )}

      {listing && groups.size === 0 && (
        <Empty icon="shield" title="No MCP server uses secrets">
          Servers with API keys or tokens in their config show up here.
        </Empty>
      )}

      {groups.size > 0 && (
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
              {[...groups].map(([key, secrets]) => {
                const { agent, server } = secrets[0];
                const canProtect = secrets.some((s) => s.protectable);
                const protectedCount = secrets.filter((s) => s.vaultId).length;
                return secrets.map((secret, index) => (
                  <tr key={`${key}/${secret.kind}/${secret.key}`}>
                    {index === 0 && (
                      <td rowSpan={secrets.length}>
                        <strong>{server}</strong>
                        <small>{nameOf(agent)}</small>
                      </td>
                    )}
                    <td>
                      <code>{secret.key}</code>
                      <small>{secret.kind === "env" ? "Environment variable" : "HTTP header"}</small>
                    </td>
                    <td>
                      {secret.vaultId ? (
                        <span className="pill pill-ok"><Icon name="shield" size={12} /> Keychain</span>
                      ) : secret.likely ? (
                        <span className="pill pill-danger"><Icon name="alert" size={12} /> Plain text</span>
                      ) : (
                        <span className="pill" title="Does not look like a credential, so it stays in the config">Setting</span>
                      )}
                      {secret.likely && secret.sameValueElsewhere > 0 && (
                        <small>Same value in {secret.sameValueElsewhere} other place(s)</small>
                      )}
                      {!secret.vaultId && secret.likely && !secret.protectable && (
                        <small>Headers of remote servers stay in the config for now</small>
                      )}
                    </td>
                    {index === 0 && (
                      <td rowSpan={secrets.length} className="actions">
                        {canProtect && (
                          <button
                            className="primary small"
                            disabled={!listing?.launcher || busy !== null}
                            onClick={() =>
                              run(key, () => protectServer(agent, server), `Moved the secrets of ${server} to the keychain.`)
                            }
                          >
                            {busy === key ? "Moving…" : "Move to keychain"}
                          </button>
                        )}
                        {protectedCount > 0 && (
                          <button
                            className="small"
                            disabled={busy !== null}
                            onClick={() =>
                              run(key, () => unprotectServer(agent, server), `Put the secrets of ${server} back in its config.`)
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
    </>
  );
}
