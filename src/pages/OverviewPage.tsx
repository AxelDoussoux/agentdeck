import { useEffect, useState, type ReactNode } from "react";
import type { PageId } from "../App";
import { useToast } from "../components/Toasts";
import { AgentMark, Icon, PageHeader, type IconName } from "../components/ui";
import { healthReport, openConfig, repairLaunchers } from "../lib/api";
import { errorText, formatDay, formatList, t } from "../lib/i18n";
import type { AgentInfo, Finding, McpListing, SecretListing, UsageReport } from "../lib/types";
import { formatCost, recentCost, recentUsage } from "../lib/usage";

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

/** A short list of names, ending with how many more there are. */
function names(list: string[], max = 3): string {
  return list.length > max ? formatList([...list.slice(0, max), t.overview.more(list.length - max)]) : formatList(list);
}

export function OverviewPage({ agents, listing, secrets, onNavigate, onChange }: Props) {
  // The core runs the checks, the same ones as `agentdeck doctor`.
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [repairing, setRepairing] = useState(false);
  const notify = useToast();

  useEffect(() => {
    recentUsage().then(setReport, () => setReport(null));
  }, []);

  // The listing and secrets change with the configs: check again then.
  useEffect(() => {
    let current = true;
    healthReport().then(
      (found) => current && setFindings(found),
      (err) => current && notify({ tone: "error", text: errorText(err) }),
    );
    return () => {
      current = false;
    };
  }, [listing, secrets]);

  const nameOf = (agent: string) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const failed = (err: unknown) => notify({ tone: "error", text: errorText(err) });
  const go = (page: PageId, label: string) => (
    <button className="small" onClick={() => onNavigate(page)}>
      {label}
    </button>
  );

  async function repair() {
    setRepairing(true);
    try {
      const repaired = await repairLaunchers();
      notify({ tone: "success", text: t.launcher.repaired(repaired) });
    } catch (err) {
      notify({ tone: "error", text: errorText(err) });
    }
    setRepairing(false);
    onChange();
  }

  const checks: Check[] = (findings ?? []).map((finding): Check => {
    switch (finding.kind) {
      case "unreadable":
        return {
          severity: "danger",
          icon: "alert",
          title: t.overview.unreadableTitle(nameOf(finding.agent)),
          detail: errorText(finding.error),
          action: (
            <button className="small" onClick={() => openConfig(finding.agent, true).catch(failed)}>
              {t.skills.showInFolder}
            </button>
          ),
        };
      case "launcherMissing":
        return {
          severity: "danger",
          icon: "alert",
          title: t.launcher.title(finding.servers.length),
          detail: t.overview.launcherMissing(names(finding.servers.map((s) => `${s.server} (${nameOf(s.agent)})`))),
          action: (
            <button className="primary small" disabled={!secrets?.launcher || repairing} onClick={repair}>
              {repairing ? t.launcher.repairing : t.launcher.repair}
            </button>
          ),
        };
      case "plainSecrets":
        return {
          severity: "danger",
          icon: "shield",
          title: t.overview.plainTitle(finding.count),
          detail: t.overview.plainDetail(finding.count, names(finding.servers)),
          action: go("secrets", t.overview.moveToKeychain),
        };
      case "differ":
        return {
          severity: "warn",
          icon: "differs",
          title: t.overview.differTitle(finding.servers.length),
          detail: t.overview.differDetail(names(finding.servers)),
          action: go("mcp", t.overview.review),
        };
      case "partial":
        return {
          severity: "info",
          icon: "plug",
          title: t.overview.partialTitle(finding.servers.length),
          detail: names(finding.servers),
          action: go("mcp", t.overview.copy),
        };
      case "rulesDiffer":
        return {
          severity: "info",
          icon: "rules",
          title: t.overview.rulesTitle,
          detail: t.overview.rulesDetail(names(finding.agents.map(nameOf))),
          action: go("rules", t.overview.compare),
        };
    }
  });
  const serverNames = new Set(listing.servers.map((s) => s.name));

  const week = report ? recentCost(report, 7) : null;
  const weekCost = week?.reduce((sum, day) => sum + day.cost, 0) ?? 0;
  const maxDay = Math.max(0.01, ...(week?.map((day) => day.cost) ?? []));

  return (
    <>
      <PageHeader title={t.nav.overview} description={t.overview.description} />

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
        {findings?.length === 0 && (
          <li className="health-row health-ok">
            <span className="health-icon">
              <Icon name="check" />
            </span>
            <span className="health-text">
              <strong>{t.overview.allGood}</strong>
              <span>{t.overview.allGoodDetail(serverNames.size)}</span>
            </span>
          </li>
        )}
      </ul>

      <button className="card cost-card" onClick={() => onNavigate("history")}>
        <span className="cost-text">
          <span className="label">{t.overview.weekCost}</span>
          <span className="value">{week ? formatCost(weekCost) : "…"}</span>
          <span className="hint">
            {week && weekCost === 0 ? t.overview.noSession : t.overview.fromLogs}
          </span>
        </span>
        <span className="sparkline" aria-hidden="true">
          {(week ?? []).map((day) => (
            <span key={day.date} title={`${formatDay(new Date(`${day.date}T00:00`), { weekday: "short", day: "numeric" })}: ${formatCost(day.cost)}`}>
              <i style={{ height: `${Math.max(4, (day.cost / maxDay) * 100)}%` }} />
            </span>
          ))}
        </span>
        <Icon name="arrow" />
      </button>

      <h2 className="section-title">{t.rules.agents}</h2>
      <div className="agent-grid">
        {agents.map((info) => {
          const servers = listing.servers.filter((s) => s.agent === info.agent).length;
          const open = (reveal: boolean) =>
            openConfig(info.agent, reveal).catch(failed);
          return (
            <article key={info.agent} className={`agent-card ${info.installed ? "" : "agent-missing"}`}>
              <header>
                <AgentMark agent={info.agent} size={36} />
                <div>
                  <strong>{info.name}</strong>
                  <span className={`pill ${info.hasConfig ? "pill-ok" : ""}`}>
                    {info.hasConfig ? t.overview.detected : info.installed ? t.overview.noConfig : t.overview.notFound}
                  </span>
                </div>
              </header>
              <dl>
                <div>
                  <dt>{t.nav.mcp}</dt>
                  <dd>{servers}</dd>
                </div>
                <div>
                  <dt>{t.nav.rules}</dt>
                  <dd>
                    {info.rulesPath ? (
                      <button className="link" onClick={() => onNavigate("rules")}>
                        {t.mcp.edit}
                      </button>
                    ) : (
                      t.overview.inAppSettings
                    )}
                  </dd>
                </div>
              </dl>
              <code title={info.mcpConfigPath}>{info.mcpConfigPath}</code>
              <div className="agent-actions">
                <button className="small" disabled={!info.hasConfig} onClick={() => open(false)}>
                  {t.overview.openConfig}
                </button>
                <button className="small" disabled={!info.hasConfig} onClick={() => open(true)}>
                  {t.skills.showInFolder}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
