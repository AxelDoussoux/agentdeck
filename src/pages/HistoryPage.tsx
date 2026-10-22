import { useEffect, useState } from "react";
import { AgentMark, Empty, Notice, PageHeader } from "../components/ui";
import { usageReport } from "../lib/api";
import { dateOf, formatCost, lastDays, localDays } from "../lib/usage";
import type { Agent, AgentInfo, Tokens, UsageReport } from "../lib/types";

const PERIODS = [7, 30, 90] as const;

/** Sessions shown at first, and added by each "Show more". */
const PAGE = 100;

const totalTokens = (t: Tokens) =>
  t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;

function formatTokens(count: number): string {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}k`;
  return String(count);
}

const basename = (path: string | null) => path?.split(/[\\/]/).filter(Boolean).pop() ?? "";

export function HistoryPage({ agents }: { agents: AgentInfo[] }) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [filter, setFilter] = useState<Agent | "all">("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  async function load() {
    setReport(null);
    try {
      setReport(await usageReport());
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const dates = lastDays(days);
  const since = dates[0];
  const matches = (agent: Agent) => filter === "all" || agent === filter;

  const daily = report ? localDays(report).filter((d) => d.date >= since && matches(d.agent)) : [];
  const sessions =
    report?.sessions.filter((s) => s.endedAt && dateOf(s.endedAt) >= since && matches(s.agent)) ?? [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = sessions.filter((s) => {
    const text = [s.title, s.project, s.id, ...s.models].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });

  // A new search or period starts from the most recent sessions again.
  useEffect(() => setShown(PAGE), [query, days, filter]);
  const costByDate = new Map<string, number>();
  for (const day of daily) costByDate.set(day.date, (costByDate.get(day.date) ?? 0) + day.costUsd);
  const maxCost = Math.max(0.01, ...costByDate.values());

  const byAgent = new Map<Agent, { cost: number; tokens: number; sessions: number }>();
  for (const day of daily) {
    const entry = byAgent.get(day.agent) ?? { cost: 0, tokens: 0, sessions: 0 };
    entry.cost += day.costUsd;
    entry.tokens += totalTokens(day.tokens);
    byAgent.set(day.agent, entry);
  }
  for (const session of sessions) {
    const entry = byAgent.get(session.agent);
    if (entry) entry.sessions += 1;
  }
  const loggedAgents = [...new Set(report?.sessions.map((s) => s.agent) ?? [])];

  const periodCost = [...costByDate.values()].reduce((sum, cost) => sum + cost, 0);

  return (
    <>
      <PageHeader
        title="History & costs"
        description="Read from Claude Code and Codex session logs on this computer. Costs are estimated at API list prices: a Claude or ChatGPT subscription is billed differently. Cursor and Gemini CLI keep no usage logs locally."
        actions={<button onClick={load}>Reload logs</button>}
      />

      <div className="toolbar toolbar-top">
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((period) => (
            <button
              key={period}
              className={period === days ? "active" : undefined}
              aria-pressed={period === days}
              onClick={() => setDays(period)}
            >
              {period} days
            </button>
          ))}
        </div>
        <select
          aria-label="Agent"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Agent | "all")}
        >
          <option value="all">All agents</option>
          {loggedAgents.map((agent) => (
            <option key={agent} value={agent}>{nameOf(agent)}</option>
          ))}
        </select>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {report?.errors.map((message) => (
        <Notice key={message} tone="error">{message}</Notice>
      ))}
      {!report && !error && <p className="hint loading">Reading session logs…</p>}

      {report && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="label">Estimated cost</span>
              <span className="value">{formatCost(periodCost)}</span>
              <span className="hint">{sessions.length} sessions in {days} days</span>
            </div>
            {[...byAgent].map(([agent, stats]) => (
              <div key={agent} className="stat">
                <span className="label with-mark">
                  <AgentMark agent={agent} size={18} /> {nameOf(agent)}
                </span>
                <span className="value">{formatCost(stats.cost)}</span>
                <span className="hint">
                  {formatTokens(stats.tokens)} tokens · {stats.sessions} sessions
                </span>
              </div>
            ))}
          </div>

          <section className="card chart-card">
            <header className="card-header">
              <h3>Cost per day</h3>
              <span className="hint">Peak {formatCost(maxCost)}</span>
            </header>
            <div className="chart" role="img" aria-label={`Estimated cost per day over ${days} days`}>
              {dates.map((date) => {
                const cost = costByDate.get(date) ?? 0;
                return (
                  <div key={date} className="bar" title={`${date}: ${formatCost(cost)}`}>
                    <div style={{ height: `${(cost / maxCost) * 100}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="chart-axis">
              <span>{since}</span>
              <span>{dates[dates.length - 1]}</span>
            </div>
          </section>

          <div className="toolbar sessions-bar">
            <h2 className="section-title">Sessions</h2>
            <span className="spacer" />
            <input
              type="search"
              placeholder="Search titles, projects, models"
              aria-label="Search sessions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {found.length === 0 ? (
            <Empty icon="chart" title={sessions.length === 0 ? "No session in this period" : "No session matches"} />
          ) : (
            <div className="table-card">
              <table className="sessions">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Session</th>
                    <th>Model</th>
                    <th className="number">Tokens</th>
                    <th className="number">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {found.slice(0, shown).map((session) => (
                    <tr key={`${session.agent}/${session.id}`}>
                      <td className="nowrap">{session.endedAt && dateOf(session.endedAt)}</td>
                      <td>
                        <span className="session-title">
                          <AgentMark agent={session.agent} size={20} />
                          <span>
                            <strong>{session.title ?? "Untitled session"}</strong>
                            <small>{basename(session.project)}</small>
                          </span>
                        </span>
                      </td>
                      <td><code>{session.models.join(", ")}</code></td>
                      <td className="number">{formatTokens(totalTokens(session.tokens))}</td>
                      <td
                        className="number"
                        title={
                          session.unpricedTokens > 0
                            ? `${formatTokens(session.unpricedTokens)} tokens from models without a known price are not counted`
                            : undefined
                        }
                      >
                        {formatCost(session.costUsd)}
                        {session.unpricedTokens > 0 && "*"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {found.length > shown && (
            <div className="more">
              <span className="hint">
                Showing {shown} of {found.length} sessions
              </span>
              <button className="small" onClick={() => setShown(shown + PAGE)}>
                Show {Math.min(PAGE, found.length - shown)} more
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
