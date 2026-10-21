import type { PageId } from "../App";
import { AgentMark, Icon, PageHeader } from "../components/ui";
import type { AgentInfo, McpListing, SecretListing } from "../lib/types";

interface Props {
  agents: AgentInfo[];
  listing: McpListing;
  secrets: SecretListing | null;
  onNavigate: (page: PageId) => void;
}

export function OverviewPage({ agents, listing, secrets, onNavigate }: Props) {
  const detected = agents.filter((info) => info.installed).length;
  const names = new Set(listing.servers.map((s) => s.name));
  // Servers some detected agent is missing: one click away from being synced.
  const partial = [...names].filter((name) =>
    agents.some(
      (info) => info.installed && !listing.servers.some((s) => s.name === name && s.agent === info.agent),
    ),
  ).length;
  const plain = secrets?.secrets.filter((s) => !s.vaultId).length ?? 0;
  const vaulted = (secrets?.secrets.length ?? 0) - plain;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every AI coding agent on this computer, and what they are set up with."
      />

      <div className="stats">
        <div className="stat">
          <span className="label">Agents detected</span>
          <span className="value">
            {detected}
            <small> / {agents.length}</small>
          </span>
        </div>
        <button className="stat stat-link" onClick={() => onNavigate("mcp")}>
          <span className="label">MCP servers</span>
          <span className="value">{names.size}</span>
          <span className="hint">
            {partial > 0 ? `${partial} not on every agent` : "In sync across agents"}
          </span>
        </button>
        <button className="stat stat-link" onClick={() => onNavigate("secrets")}>
          <span className="label">Secrets in plain text</span>
          <span className={`value ${plain > 0 ? "danger-text" : ""}`}>{plain}</span>
          <span className="hint">{vaulted} in the system keychain</span>
        </button>
      </div>

      {plain > 0 && (
        <button className="callout" onClick={() => onNavigate("secrets")}>
          <Icon name="shield" size={20} />
          <span>
            <strong>
              {plain} API key{plain > 1 ? "s are" : " is"} stored in plain text
            </strong>
            Move them to your system keychain in one click.
          </span>
          <Icon name="arrow" />
        </button>
      )}

      <h2 className="section-title">Agents</h2>
      <div className="agent-grid">
        {agents.map((info) => {
          const servers = listing.servers.filter((s) => s.agent === info.agent).length;
          return (
            <article key={info.agent} className={`agent-card ${info.installed ? "" : "agent-missing"}`}>
              <header>
                <AgentMark agent={info.agent} size={36} />
                <div>
                  <strong>{info.name}</strong>
                  <span className={`pill ${info.installed ? "pill-ok" : ""}`}>
                    {info.installed ? "Detected" : "Not found"}
                  </span>
                </div>
              </header>
              <dl>
                <div>
                  <dt>MCP servers</dt>
                  <dd>{servers}</dd>
                </div>
                <div>
                  <dt>Rules</dt>
                  <dd>{info.rulesPath ? "File" : "In app settings"}</dd>
                </div>
              </dl>
              <code title={info.mcpConfigPath}>{info.mcpConfigPath}</code>
            </article>
          );
        })}
      </div>
    </>
  );
}
