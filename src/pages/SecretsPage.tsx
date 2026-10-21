import { useEffect, useState } from "react";
import { listSecrets, protectServer, unprotectServer } from "../lib/api";
import type { Agent, AgentInfo, SecretListing, SecretRef } from "../lib/types";

export function SecretsPage({ agents }: { agents: AgentInfo[] }) {
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
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;

  // One group per server, in the order the core lists them.
  const groups = new Map<string, SecretRef[]>();
  for (const secret of listing?.secrets ?? []) {
    const key = `${secret.agent}/${secret.server}`;
    groups.set(key, [...(groups.get(key) ?? []), secret]);
  }
  const plainCount = listing?.secrets.filter((s) => !s.vaultId).length ?? 0;

  return (
    <>
      <h2>Secrets</h2>
      <p className="hint">
        API keys and tokens set in MCP server configs. In plain text, anyone or anything that can
        read these files can read them. AgentDeck can move the environment variables of local
        servers to your system keychain: the agent then starts the server through{" "}
        <code>agentdeck exec</code>, which passes them to it. Values are never shown here.
      </p>

      {listing && !listing.launcher && (
        <p className="warning">
          Moving secrets to the keychain needs the <code>agentdeck</code> command-line tool that
          ships with AgentDeck, and it was not found next to the app. Reinstall AgentDeck, or
          install the tool with <code>cargo install --path crates/agentdeck-cli</code>.
        </p>
      )}
      {listing?.errors.map((text) => (
        <p key={text} className="error">{text}</p>
      ))}
      {message && <p className={message.error ? "error" : "success"}>{message.text}</p>}

      {listing && (
        <div className="stats">
          <div className="stat">
            <span className="label">In plain text</span>
            <span className={`value ${plainCount > 0 ? "danger-text" : ""}`}>{plainCount}</span>
          </div>
          <div className="stat">
            <span className="label">In the keychain</span>
            <span className="value">{listing.secrets.length - plainCount}</span>
          </div>
        </div>
      )}

      {listing && groups.size === 0 && <p className="empty">No MCP server uses secrets.</p>}

      {groups.size > 0 && (
        <table className="secrets">
          <thead>
            <tr>
              <th>Server</th>
              <th>Secret</th>
              <th>Where</th>
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
                      <span className="success">Keychain</span>
                    ) : (
                      <span className="danger-text">Plain text</span>
                    )}
                    {secret.sameValueElsewhere > 0 && (
                      <small>Same value in {secret.sameValueElsewhere} other place(s)</small>
                    )}
                    {!secret.vaultId && !secret.protectable && (
                      <small>Headers of remote servers stay in the config for now</small>
                    )}
                  </td>
                  {index === 0 && (
                    <td rowSpan={secrets.length} className="actions">
                      {canProtect && (
                        <button
                          className="primary"
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
      )}
    </>
  );
}
