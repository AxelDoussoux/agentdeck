import { useEffect, useState } from "react";
import { CostChart } from "../components/CostChart";
import { AgentMark, Empty, Notice, PageHeader } from "../components/ui";
import { usageReport } from "../lib/api";
import { dateOf, formatCost, lastDays, localDate, localDays } from "../lib/usage";
import type { Agent, AgentInfo, Session, Tokens, UsageReport } from "../lib/types";

const PERIODS = [7, 30, 90] as const;

type View = "sessions" | "projects" | "models";
const VIEWS: Record<View, string> = { sessions: "Sessions", projects: "Projects", models: "Models" };

type SortKey = "date" | "tokens" | "cost";

/** Sessions grouped under one project or one set of models. */
interface Group {
  key: string;
  label: string;
  sessions: number;
  tokens: number;
  cost: number;
  last: string;
}

function group(sessions: Session[], keyOf: (session: Session) => string, labelOf: (key: string) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const session of sessions) {
    const key = keyOf(session);
    const entry = groups.get(key) ?? { key, label: labelOf(key), sessions: 0, tokens: 0, cost: 0, last: "" };
    entry.sessions += 1;
    entry.tokens += totalTokens(session.tokens);
    entry.cost += session.costUsd;
    const date = session.endedAt ? dateOf(session.endedAt) : "";
    if (date > entry.last) entry.last = date;
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => b.cost - a.cost);
}

/** The monthly budget, kept on this computer only. */
function storedBudget(): number | null {
  try {
    const value = Number(localStorage.getItem("monthlyBudget"));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

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
  const [view, setView] = useState<View>("sessions");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "date", descending: true });
  const [budget, setBudget] = useState<number | null>(storedBudget);
  const [editingBudget, setEditingBudget] = useState(false);

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
  useEffect(() => setShown(PAGE), [query, days, filter, sort]);
  const costs = new Map<string, Map<Agent, number>>();
  for (const day of daily) {
    const byDay = costs.get(day.date) ?? new Map<Agent, number>();
    byDay.set(day.agent, (byDay.get(day.agent) ?? 0) + day.costUsd);
    costs.set(day.date, byDay);
  }
  const chartAgents = [...new Set(daily.map((day) => day.agent))].sort();

  const sortValue = (session: Session) =>
    sort.key === "date" ? (session.endedAt ?? "") : sort.key === "tokens" ? totalTokens(session.tokens) : session.costUsd;
  const sorted = [...found].sort((a, b) => {
    const [x, y] = [sortValue(a), sortValue(b)];
    const order = x < y ? -1 : x > y ? 1 : 0;
    return sort.descending ? -order : order;
  });
  const groups =
    view === "projects"
      ? group(found, (s) => s.project ?? "", (key) => basename(key) || "No project")
      : group(found, (s) => s.models.join(", "), (key) => key || "Unknown model");

  // The budget covers every agent since the first of the month.
  const monthStart = `${localDate(new Date()).slice(0, 8)}01`;
  const monthCost = report
    ? localDays(report)
        .filter((hour) => hour.date >= monthStart)
        .reduce((sum, hour) => sum + hour.costUsd, 0)
    : 0;
  const budgetShare = budget ? monthCost / budget : 0;

  function saveBudget(value: string) {
    const amount = Number(value);
    const next = amount > 0 ? amount : null;
    setBudget(next);
    setEditingBudget(false);
    try {
      if (next) localStorage.setItem("monthlyBudget", String(next));
      else localStorage.removeItem("monthlyBudget");
    } catch {
      // Blocked storage: the budget lasts until the app closes.
    }
  }

  function sortBy(key: SortKey) {
    setSort((current) => ({ key, descending: current.key === key ? !current.descending : true }));
  }

  const sortHeader = (key: SortKey, label: string, className?: string) => (
    <th
      className={className}
      aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : undefined}
    >
      <button className="sort" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.descending ? " ↓" : " ↑"}</span>}
      </button>
    </th>
  );

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

  const periodCost = daily.reduce((sum, day) => sum + day.costUsd, 0);

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
      {!report && !error && (
        <div className="skeleton" aria-busy="true" aria-label="Reading session logs">
          <div className="stats">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card stat skeleton-block" />
            ))}
          </div>
          <div className="card skeleton-block skeleton-chart" />
          <p className="hint">Reading session logs…</p>
        </div>
      )}

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
            <div className="stat budget">
              <span className="label">This month</span>
              <span className="value">
                {formatCost(monthCost)}
                {budget && <small> of {formatCost(budget)}</small>}
              </span>
              {budget && (
                <span
                  className={`meter ${budgetShare >= 1 ? "meter-danger" : budgetShare >= 0.8 ? "meter-warn" : ""}`}
                  role="meter"
                  aria-label="Monthly budget used"
                  aria-valuemin={0}
                  aria-valuemax={budget}
                  aria-valuenow={Math.round(monthCost * 100) / 100}
                >
                  <i style={{ width: `${Math.min(100, budgetShare * 100)}%` }} />
                </span>
              )}
              {editingBudget ? (
                <form
                  className="budget-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveBudget(new FormData(e.currentTarget).get("budget") as string);
                  }}
                >
                  <input
                    name="budget"
                    type="number"
                    min="0"
                    step="1"
                    autoFocus
                    aria-label="Monthly budget in dollars"
                    placeholder="Budget in $"
                    defaultValue={budget ?? ""}
                  />
                  <button className="small" type="submit">
                    Save
                  </button>
                </form>
              ) : (
                <button className="link hint" onClick={() => setEditingBudget(true)}>
                  {budget ? "Change budget" : "Set a monthly budget"}
                </button>
              )}
            </div>
          </div>

          {budget && budgetShare >= 0.8 && (
            <Notice tone={budgetShare >= 1 ? "error" : "warning"}>
              {budgetShare >= 1
                ? `This month's estimated cost, ${formatCost(monthCost)}, is over your ${formatCost(budget)} budget.`
                : `This month's estimated cost has reached ${Math.round(budgetShare * 100)}% of your ${formatCost(budget)} budget.`}
            </Notice>
          )}

          <section className="card chart-card">
            <header className="card-header">
              <h3>Cost per day</h3>
              <span className="legend">
                {chartAgents.map((agent) => (
                  <span key={agent}>
                    <i className={`swatch segment-${agent}`} /> {nameOf(agent)}
                  </span>
                ))}
              </span>
            </header>
            <CostChart dates={dates} costs={costs} agents={chartAgents} nameOf={nameOf} />
          </section>

          <div className="toolbar sessions-bar">
            <div className="segmented" role="group" aria-label="Group by">
              {(Object.keys(VIEWS) as View[]).map((option) => (
                <button
                  key={option}
                  className={option === view ? "active" : undefined}
                  aria-pressed={option === view}
                  onClick={() => setView(option)}
                >
                  {VIEWS[option]}
                </button>
              ))}
            </div>
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
          ) : view !== "sessions" ? (
            <div className="table-card">
              <table className="sessions">
                <thead>
                  <tr>
                    <th>{view === "projects" ? "Project" : "Models"}</th>
                    <th className="number">Sessions</th>
                    <th className="nowrap">Last used</th>
                    <th className="number">Tokens</th>
                    <th className="number">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((entry) => (
                    <tr key={entry.key}>
                      <td title={entry.key || undefined}>
                        {view === "projects" ? <strong>{entry.label}</strong> : <code>{entry.label}</code>}
                      </td>
                      <td className="number">{entry.sessions}</td>
                      <td className="nowrap">{entry.last}</td>
                      <td className="number">{formatTokens(entry.tokens)}</td>
                      <td className="number">{formatCost(entry.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-card">
              <table className="sessions">
                <thead>
                  <tr>
                    {sortHeader("date", "Date")}
                    <th>Session</th>
                    <th>Model</th>
                    {sortHeader("tokens", "Tokens", "number")}
                    {sortHeader("cost", "Cost", "number")}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, shown).map((session) => (
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
          {view === "sessions" && found.length > shown && (
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
