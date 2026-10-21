import { useEffect, useState } from "react";
import { usageReport } from "../lib/api";
import type { Agent, AgentInfo, Tokens, UsageReport } from "../lib/types";

const PERIODS = [7, 30, 90] as const;

const totalTokens = (t: Tokens) =>
  t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;

function formatTokens(count: number): string {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}k`;
  return String(count);
}

const formatCost = (usd: number) => `$${usd.toFixed(usd < 10 ? 2 : 0)}`;

/** UTC dates from `days - 1` days ago to today, matching the core's day keys. */
function lastDays(days: number): string[] {
  const today = Date.now();
  return Array.from({ length: days }, (_, i) =>
    new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

const basename = (path: string | null) => path?.split(/[\\/]/).filter(Boolean).pop() ?? "";

export function HistoryPage({ agents }: { agents: AgentInfo[] }) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [filter, setFilter] = useState<Agent | "all">("all");

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

  const daily = report?.daily.filter((d) => d.date >= since && matches(d.agent)) ?? [];
  const sessions =
    report?.sessions.filter((s) => (s.endedAt ?? "") >= since && matches(s.agent)) ?? [];
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

  return (
    <>
      <h2>History & costs</h2>
      <p className="hint">
        Read from Claude Code and Codex session logs on this computer. Costs are estimated at API
        list prices: a Claude or ChatGPT subscription is billed differently. Cursor and Gemini CLI
        keep no usage logs locally.
      </p>

      <div className="toolbar">
        <div className="segmented">
          {PERIODS.map((period) => (
            <button
              key={period}
              className={period === days ? "active" : undefined}
              onClick={() => setDays(period)}
            >
              {period} days
            </button>
          ))}
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Agent | "all")}>
          <option value="all">All agents</option>
          {loggedAgents.map((agent) => (
            <option key={agent} value={agent}>{nameOf(agent)}</option>
          ))}
        </select>
        <span className="spacer" />
        <button onClick={load}>Reload logs</button>
      </div>

      {error && <p className="error">{error}</p>}
      {report?.errors.map((message) => (
        <p key={message} className="error">{message}</p>
      ))}
      {!report && !error && <p className="hint">Reading session logs…</p>}

      {report && (
        <>
          <div className="stats">
            {[...byAgent].map(([agent, stats]) => (
              <div key={agent} className="stat">
                <span className="label">{nameOf(agent)}</span>
                <span className="value">{formatCost(stats.cost)}</span>
                <span className="hint">
                  {formatTokens(stats.tokens)} tokens · {stats.sessions} sessions
                </span>
              </div>
            ))}
            {byAgent.size === 0 && <p className="empty">No usage in this period.</p>}
          </div>

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
            <span>Max {formatCost(maxCost)} / day</span>
            <span>{dates[dates.length - 1]}</span>
          </div>

          <table className="sessions">
            <thead>
              <tr>
                <th>Date</th>
                <th>Agent</th>
                <th>Session</th>
                <th>Model</th>
                <th className="number">Tokens</th>
                <th className="number">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 200).map((session) => (
                <tr key={`${session.agent}/${session.id}`}>
                  <td>{session.endedAt?.slice(0, 10)}</td>
                  <td>{nameOf(session.agent)}</td>
                  <td>
                    <strong>{session.title ?? "Untitled session"}</strong>
                    <small>{basename(session.project)}</small>
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
          {sessions.length > 200 && <p className="hint">Showing the 200 most recent sessions.</p>}
        </>
      )}
    </>
  );
}
