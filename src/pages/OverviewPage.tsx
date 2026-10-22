import { useEffect, useState, type ReactNode } from "react";
import type { PageId } from "../App";
import { useToast } from "../components/Toasts";
import { AgentMark, Icon, PageHeader, type IconName } from "../components/ui";
import { listRules, openConfig, repairLaunchers, usageReport } from "../lib/api";
import { drifting } from "../lib/servers";
import type { AgentInfo, McpListing, Rules, SecretListing, UsageReport } from "../lib/types";
import { formatCost, recentCost } from "../lib/usage";

interface Props {
  agents: AgentInfo[];
  listing: McpListing;
  secrets: SecretListing | null;
  onNavigate: (page: PageId) => void;
  onChange: () => void;
}

type Severity = "danger" | "warn" | "info";

interface Check {
  severity: Severity;
  icon: IconName;
  title: string;
  detail: ReactNode;
  action: ReactNode;
}

const ORDER: Severity[] = ["danger", "warn", "info"];

/** Reading months of logs takes a while: the overview reuses a recent read. */
let usage: { at: number; report: Promise<UsageReport> } | null = null;
const USAGE_MAX_AGE = 5 * 60 * 1000;

function recentUsage(): Promise<UsageReport> {
  if (!usage || Date.now() - usage.at > USAGE_MAX_AGE) {
    usage = { at: Date.now(), report: usageReport() };
    usage.report.catch(() => (usage = null));
  }
  return usage.report;
}

/** A short list of names, ending with how many more there are. */
function names(list: string[], max = 3): string {
  const shown = list.slice(0, max).join(", ");
  return list.length > max ? `${shown} and ${list.length - max} more` : shown;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function OverviewPage({ agents, listing, secrets, onNavigate, onChange }: Props) {
  const [rules, setRules] = useState<Rules[] | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [repairing, setRepairing] = useState(false);
  const notify = useToast();

  useEffect(() => {
    listRules().then(setRules, () => setRules(null));
    recentUsage().then(setReport, () => setReport(null));
  }, []);

  const nameOf = (agent: string) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const go = (page: PageId, label: string) => (
    <button className="small" onClick={() => onNavigate(page)}>
      {label}
    </button>
  );

  async function repair() {
    setRepairing(true);
    try {
      const repaired = await repairLaunchers();
      notify({
        tone: "success",
        text: `Repaired ${plural(repaired, "protected server", "protected servers")}. Restart the agents that use them.`,
      });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    setRepairing(false);
    onChange();
  }

  const checks: Check[] = [];
  const stranded = secrets?.stranded ?? [];
  if (stranded.length > 0) {
    checks.push({
      severity: "danger",
      icon: "alert",
      title: `${plural(stranded.length, "protected server no longer starts", "protected servers no longer start")}`,
      detail: `The agentdeck launcher they run is missing: ${names(stranded.map((s) => `${s.server} (${nameOf(s.agent)})`))}.`,
      action: (
        <button className="primary small" disabled={!secrets?.launcher || repairing} onClick={repair}>
          {repairing ? "Repairing…" : "Repair"}
        </button>
      ),
    });
  }

  const plain = secrets?.secrets.filter((s) => s.likely && !s.vaultId) ?? [];
  if (plain.length > 0) {
    checks.push({
      severity: "danger",
      icon: "shield",
      title: `${plural(plain.length, "API key is", "API keys are")} stored in plain text`,
      detail: `Any program that can read the configs can read ${plain.length === 1 ? "it" : "them"}: ${names([...new Set(plain.map((s) => s.server))])}.`,
      action: go("secrets", "Move to keychain"),
    });
  }

  const different = drifting(listing);
  if (different.length > 0) {
    checks.push({
      severity: "warn",
      icon: "differs",
      title: `${plural(different.length, "server differs", "servers differ")} between agents`,
      detail: `Another command, variable or setting: ${names(different)}.`,
      action: go("mcp", "Review"),
    });
  }

  const serverNames = [...new Set(listing.servers.map((s) => s.name))];
  // Servers some detected agent is missing: one click away from being synced.
  const partial = serverNames.filter((name) =>
    agents.some((info) => info.installed && !listing.servers.some((s) => s.name === name && s.agent === info.agent)),
  );
  if (partial.length > 0) {
    checks.push({
      severity: "info",
      icon: "plug",
      title: `${plural(partial.length, "server is", "servers are")} not on every agent`,
      detail: names(partial),
      action: go("mcp", "Copy"),
    });
  }

  // Agents with rules whose rules differ from the others'.
  const written = (rules ?? []).filter((r) => r.content?.trim());
  if (new Set(written.map((r) => r.content!.trim())).size > 1) {
    checks.push({
      severity: "info",
      icon: "rules",
      title: "Rules differ between agents",
      detail: `${names(written.map((r) => nameOf(r.agent)))} each load their own instructions.`,
      action: go("rules", "Compare"),
    });
  }
  checks.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));

  const week = report ? recentCost(report, 7) : null;
  const weekCost = week?.reduce((sum, day) => sum + day.cost, 0) ?? 0;
  const maxDay = Math.max(0.01, ...(week?.map((day) => day.cost) ?? []));

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every AI coding agent on this computer, and what needs your attention."
      />

      <ul className="health">
        {checks.map((check) => (
          <li key={check.title} className={`health-row health-${check.severity}`}>
            <span className="health-icon">
              <Icon name={check.icon} />
            </span>
            <span className="health-text">
              <strong>{check.title}</strong>
              <span>{check.detail}</span>
            </span>
            {check.action}
          </li>
        ))}
        {checks.length === 0 && (
          <li className="health-row health-ok">
            <span className="health-icon">
              <Icon name="check" />
            </span>
            <span className="health-text">
              <strong>Everything is in order</strong>
              <span>
                {plural(serverNames.length, "server is", "servers are")} the same on every agent and no
                secret sits in plain text.
              </span>
            </span>
          </li>
        )}
      </ul>

      <button className="card cost-card" onClick={() => onNavigate("history")}>
        <span className="cost-text">
          <span className="label">Estimated cost, last 7 days</span>
          <span className="value">{week ? formatCost(weekCost) : "…"}</span>
          <span className="hint">
            {week && weekCost === 0 ? "No session logged this week" : "From Claude Code and Codex logs"}
          </span>
        </span>
        <span className="sparkline" aria-hidden="true">
          {(week ?? []).map((day) => (
            <span key={day.date} title={`${day.date}: ${formatCost(day.cost)}`}>
              <i style={{ height: `${Math.max(4, (day.cost / maxDay) * 100)}%` }} />
            </span>
          ))}
        </span>
        <Icon name="arrow" />
      </button>

      <h2 className="section-title">Agents</h2>
      <div className="agent-grid">
        {agents.map((info) => {
          const servers = listing.servers.filter((s) => s.agent === info.agent).length;
          const open = (reveal: boolean) =>
            openConfig(info.agent, reveal).catch((err) => notify({ tone: "error", text: String(err) }));
          return (
            <article key={info.agent} className={`agent-card ${info.installed ? "" : "agent-missing"}`}>
              <header>
                <AgentMark agent={info.agent} size={36} />
                <div>
                  <strong>{info.name}</strong>
                  <span className={`pill ${info.hasConfig ? "pill-ok" : ""}`}>
                    {info.hasConfig ? "Detected" : info.installed ? "No config yet" : "Not found"}
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
                  <dd>
                    {info.rulesPath ? (
                      <button className="link" onClick={() => onNavigate("rules")}>
                        Edit
                      </button>
                    ) : (
                      "In app settings"
                    )}
                  </dd>
                </div>
              </dl>
              <code title={info.mcpConfigPath}>{info.mcpConfigPath}</code>
              <div className="agent-actions">
                <button className="small" disabled={!info.hasConfig} onClick={() => open(false)}>
                  Open config
                </button>
                <button className="small" disabled={!info.hasConfig} onClick={() => open(true)}>
                  Show in folder
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
