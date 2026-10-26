import { useEffect, useState } from "react";
import { CostChart } from "../components/CostChart";
import { Drawer } from "../components/Drawer";
import { useToast } from "../components/Toasts";
import { AgentMark, Empty, Notice, PageHeader, Segmented } from "../components/ui";
import { exportSessionsCsv, usageReport } from "../lib/api";
import { errorText, formatDateTime, formatDay, formatNumber, t } from "../lib/i18n";
import { budget as currentBudget, forget, monthCost, setBudget as storeBudget } from "../lib/budget";
import { dateOf, datesBetween, formatCost, lastDays, localDate, localDays } from "../lib/usage";
import type { Agent, AgentInfo, ReadProgress, Session, Tokens, UsageReport } from "../lib/types";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number] | "custom";

type View = "sessions" | "projects" | "models";
const VIEWS: View[] = ["sessions", "projects", "models"];

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

/** The days of a custom period, whichever way round its ends were picked, up to today. */
function customDates(a: string, b: string): string[] {
  const today = localDate(new Date());
  const [from, to] = [a, b].map((date) => (date < today ? date : today)).sort();
  return datesBetween(from, to);
}

/** Sessions shown at first, and added by each "Show more". */
const PAGE = 100;

const totalTokens = (tokens: Tokens) =>
  tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h;

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

/** "1.2M", "34.5k", "980", or "1,2 M" in French. */
function formatTokens(count: number): string {
  if (count >= 1e6) return `${formatNumber(count / 1e6, ONE_DECIMAL)}${t.history.million}`;
  if (count >= 1e3) return `${formatNumber(count / 1e3, ONE_DECIMAL)}${t.history.thousand}`;
  return formatNumber(count);
}

/** A `YYYY-MM-DD` local date, such as "Oct 22, 2026". */
const formatDate = (date: string) =>
  formatDay(new Date(`${date}T00:00`), { year: "numeric", month: "short", day: "numeric" });

const basename = (path: string | null) => path?.split(/[\\/]/).filter(Boolean).pop() ?? "";

export function HistoryPage({ agents }: { agents: AgentInfo[] }) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReadProgress | null>(null);
  const [period, setPeriod] = useState<Period>(30);
  const [range, setRange] = useState(() => {
    const recent = lastDays(30);
    return { from: recent[0], to: recent[recent.length - 1] };
  });
  const [opened, setOpened] = useState<Session | null>(null);
  const [filter, setFilter] = useState<Agent | "all">("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [view, setView] = useState<View>("sessions");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "date", descending: true });
  const [budget, setBudget] = useState<number | null>(currentBudget);
  const [editingBudget, setEditingBudget] = useState(false);
  const notify = useToast();
  // The save dialog is open: a second click would open another one.
  const [exporting, setExporting] = useState(false);

  async function load() {
    setReport(null);
    setProgress(null);
    try {
      setReport(await usageReport(setProgress));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const dates = period === "custom" ? customDates(range.from, range.to) : lastDays(period);
  const [since, until] = [dates[0], dates[dates.length - 1]];
  const inPeriod = (date: string) => date >= since && date <= until;
  const matches = (agent: Agent) => filter === "all" || agent === filter;

  const daily = report ? localDays(report).filter((d) => inPeriod(d.date) && matches(d.agent)) : [];
  const sessions =
    report?.sessions.filter((s) => s.endedAt && inPeriod(dateOf(s.endedAt)) && matches(s.agent)) ?? [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = sessions.filter((s) => {
    const text = [s.title, s.project, s.id, ...s.models].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });

  // A new search or period starts from the most recent sessions again.
  useEffect(() => setShown(PAGE), [query, since, until, filter, sort]);
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
      ? group(found, (s) => s.project ?? "", (key) => basename(key) || t.history.noProject)
      : group(found, (s) => s.models.join(", "), (key) => key || t.history.unknownModel);

  // The budget covers every agent since the first of the month.
  const spent = report ? monthCost(report) : 0;
  const budgetShare = budget ? spent / budget : 0;

  function saveBudget(value: string) {
    const amount = Number(value);
    const next = amount > 0 ? amount : null;
    setBudget(next);
    setEditingBudget(false);
    storeBudget(next);
    // A new budget is a new scale: alert about its thresholds again.
    forget();
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

  /** Saves the sessions of the period, agent and search, in the table's order. */
  async function exportCsv() {
    const exported = sorted;
    setExporting(true);
    try {
      const path = await exportSessionsCsv(exported, `agentdeck-sessions-${since}-to-${until}.csv`);
      if (path) notify({ tone: "success", text: t.history.exported(exported.length, basename(path)) });
    } catch (err) {
      notify({ tone: "error", text: errorText(err) });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t.nav.history}
        description={t.history.description}
        actions={
          <>
            <button
              disabled={sorted.length === 0 || exporting}
              title={sorted.length ? t.history.exportTip(sorted.length) : t.history.nothingToExport}
              onClick={exportCsv}
            >
              {t.history.exportCsv}
            </button>
            <button onClick={load}>{t.history.reload}</button>
          </>
        }
      />

      <div className="toolbar toolbar-top">
        <Segmented
          label={t.history.period}
          value={period}
          onChange={setPeriod}
          options={[
            ...PERIODS.map((option) => ({ value: option, label: t.history.days(option) })),
            { value: "custom", label: t.history.custom },
          ]}
        />
        {period === "custom" && (
          <span className="date-range">
            <input
              type="date"
              aria-label={t.history.from}
              value={since}
              max={until}
              onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
            />
            <span className="hint">{t.history.to}</span>
            <input
              type="date"
              aria-label={t.history.until}
              value={until}
              min={since}
              max={localDate(new Date())}
              onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
            />
          </span>
        )}
        <select
          aria-label={t.history.agent}
          value={filter}
          onChange={(e) => setFilter(e.target.value as Agent | "all")}
        >
          <option value="all">{t.history.allAgents}</option>
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
        <div className="skeleton" aria-busy="true" aria-label={t.history.reading}>
          <div className="stats">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card stat skeleton-block" />
            ))}
          </div>
          <div className="card skeleton-block skeleton-chart" />
          <ReadingProgress progress={progress} />
        </div>
      )}

      {report && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="label">{t.history.estimatedCost}</span>
              <span className="value">{formatCost(periodCost)}</span>
              <span className="hint">{t.history.sessionsInDays(sessions.length, dates.length)}</span>
            </div>
            {[...byAgent].map(([agent, stats]) => (
              <div key={agent} className="stat">
                <span className="label with-mark">
                  <AgentMark agent={agent} size={18} /> {nameOf(agent)}
                </span>
                <span className="value">{formatCost(stats.cost)}</span>
                <span className="hint">{t.history.agentStats(formatTokens(stats.tokens), stats.sessions)}</span>
              </div>
            ))}
            <div className="stat budget">
              <span className="label">{t.history.thisMonth}</span>
              <span className="value">
                {formatCost(spent)}
                {budget && <small> {t.history.of(formatCost(budget))}</small>}
              </span>
              {budget && (
                <span
                  className={`meter ${budgetShare >= 1 ? "meter-danger" : budgetShare >= 0.8 ? "meter-warn" : ""}`}
                  role="meter"
                  aria-label={t.history.budgetUsed}
                  aria-valuemin={0}
                  aria-valuemax={budget}
                  aria-valuenow={Math.round(spent * 100) / 100}
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
                    aria-label={t.history.budgetLabel}
                    placeholder={t.history.budgetPlaceholder}
                    defaultValue={budget ?? ""}
                  />
                  <button className="small" type="submit">
                    {t.common.save}
                  </button>
                </form>
              ) : (
                <button className="link hint" onClick={() => setEditingBudget(true)}>
                  {budget ? t.history.changeBudget : t.history.setBudget}
                </button>
              )}
            </div>
          </div>

          {budget && budgetShare >= 0.8 && (
            <Notice tone={budgetShare >= 1 ? "error" : "warning"}>
              {budgetShare >= 1
                ? t.history.overBudget(formatCost(spent), formatCost(budget))
                : t.history.nearBudget(formatNumber(budgetShare, { style: "percent" }), formatCost(budget))}
            </Notice>
          )}

          <section className="card chart-card">
            <header className="card-header">
              <h3>{t.history.costPerDay}</h3>
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
            <Segmented
              label={t.history.groupBy}
              value={view}
              onChange={setView}
              options={VIEWS.map((option) => ({ value: option, label: t.history.views[option] }))}
            />
            <span className="spacer" />
            <input
              type="search"
              placeholder={t.history.searchPlaceholder}
              aria-label={t.history.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {found.length === 0 ? (
            <Empty icon="chart" title={sessions.length === 0 ? t.history.noSession : t.history.noMatch} />
          ) : view !== "sessions" ? (
            <div className="table-card">
              <table className="sessions">
                <thead>
                  <tr>
                    <th>{view === "projects" ? t.history.project : t.history.models}</th>
                    <th className="number">{t.history.views.sessions}</th>
                    <th className="nowrap">{t.history.lastUsed}</th>
                    <th className="number">{t.history.tokens}</th>
                    <th className="number">{t.history.cost}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((entry) => (
                    <tr key={entry.key}>
                      <td title={entry.key || undefined}>
                        {view === "projects" ? <strong>{entry.label}</strong> : <code>{entry.label}</code>}
                      </td>
                      <td className="number">{formatNumber(entry.sessions)}</td>
                      <td className="nowrap">{entry.last && formatDate(entry.last)}</td>
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
                    {sortHeader("date", t.history.date)}
                    <th>{t.history.session}</th>
                    <th>{t.history.model}</th>
                    {sortHeader("tokens", t.history.tokens, "number")}
                    {sortHeader("cost", t.history.cost, "number")}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, shown).map((session) => (
                    <tr key={`${session.agent}/${session.id}`} className={session === opened ? "highlight" : undefined}>
                      <td className="nowrap">{session.endedAt && formatDate(dateOf(session.endedAt))}</td>
                      <td>
                        <span className="session-title">
                          <AgentMark agent={session.agent} size={20} />
                          <span>
                            <button className="link" onClick={() => setOpened(session)}>
                              <strong>{session.title ?? t.history.untitled}</strong>
                            </button>
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
                            ? t.history.unpriced(formatTokens(session.unpricedTokens))
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
              <span className="hint">{t.history.showing(shown, found.length)}</span>
              <button className="small" onClick={() => setShown(shown + PAGE)}>
                {t.history.showMore(Math.min(PAGE, found.length - shown))}
              </button>
            </div>
          )}
        </>
      )}

      {opened && (
        <SessionDrawer
          session={opened}
          agentName={nameOf(opened.agent)}
          onClose={() => setOpened(null)}
          onProject={(project) => {
            setOpened(null);
            setView("sessions");
            setQuery(project);
          }}
        />
      )}
    </>
  );
}

/** The kinds of tokens, in the order of the bar; labels are in `t.history.tokenKinds`. */
const TOKEN_KINDS: (keyof Tokens)[] = ["input", "cacheRead", "cacheWrite5m", "cacheWrite1h", "output"];

const formatMoment = (timestamp: string | null) => (timestamp ? formatDateTime(timestamp) : t.history.unknown);

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60000);
  if (!(minutes >= 0)) return null;
  if (minutes < 60) return t.history.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? t.history.hours(hours, minutes % 60) : t.history.daysLong(Math.round(hours / 24));
}

/** The command that reopens a session in its agent. */
const resumeCommand = (session: Session) =>
  session.agent === "codex" ? `codex resume ${session.id}` : `claude --resume ${session.id}`;

interface SessionProps {
  session: Session;
  agentName: string;
  onClose: () => void;
  /** Shows only the sessions of this project. */
  onProject: (project: string) => void;
}

/** One session's times, models, token split and cost. */
function SessionDrawer({ session, agentName, onClose, onProject }: SessionProps) {
  const notify = useToast();
  const { tokens } = session;
  const total = totalTokens(tokens);
  const read = tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h;
  const duration = formatDuration(session.startedAt, session.endedAt);
  const project = basename(session.project);

  async function copyResume() {
    try {
      await navigator.clipboard.writeText(resumeCommand(session));
      notify({ tone: "success", text: t.history.copiedCommand });
    } catch (err) {
      notify({ tone: "error", text: t.secrets.copyFailed(errorText(err)) });
    }
  }

  return (
    <Drawer
      title={session.title ?? t.history.untitled}
      subtitle={
        <span className="with-mark">
          <AgentMark agent={session.agent} size={16} /> {agentName}
          {project && ` · ${project}`}
        </span>
      }
      tabs={[{ id: "details", label: t.mcp.details }]}
      tab="details"
      onTab={() => {}}
      onClose={onClose}
    >
      <dl className="facts">
        <dt>{t.history.started}</dt>
        <dd>{formatMoment(session.startedAt)}</dd>
        <dt>{t.history.ended}</dt>
        <dd>
          {formatMoment(session.endedAt)}
          {duration && <span className="hint"> · {duration}</span>}
        </dd>
        {session.project && (
          <>
            <dt>{t.skills.folder}</dt>
            <dd>
              <code>{session.project}</code>
            </dd>
          </>
        )}
        <dt>{session.models.length > 1 ? t.history.models : t.history.model}</dt>
        <dd>
          <code>{session.models.join(", ") || t.history.unknown}</code>
        </dd>
        <dt>{t.history.session}</dt>
        <dd>
          <code>{session.id}</code>
        </dd>
      </dl>

      <section className="drawer-section">
        <header>
          <strong>{t.history.tokens}</strong>
          <span>{formatTokens(total)}</span>
        </header>
        {total > 0 && (
          <div className="token-bar" aria-hidden="true">
            {TOKEN_KINDS.filter((key) => tokens[key] > 0).map((key) => (
              <i key={key} className={`token-${key}`} style={{ width: `${(tokens[key] / total) * 100}%` }} />
            ))}
          </div>
        )}
        <ul className="token-list">
          {TOKEN_KINDS.filter((key) => tokens[key] > 0).map((key) => (
            <li key={key}>
              <i className={`swatch token-${key}`} />
              <span>{t.history.tokenKinds[key]}</span>
              <span className="number">{formatTokens(tokens[key])}</span>
              <span className="number hint">{formatNumber(tokens[key] / total, { style: "percent" })}</span>
            </li>
          ))}
        </ul>
        {read > 0 && (
          <p className="hint">{t.history.cacheHit(formatNumber(tokens.cacheRead / read, { style: "percent" }))}</p>
        )}
      </section>

      <section className="drawer-section">
        <header>
          <strong>{t.history.estimatedCost}</strong>
          <span>{formatCost(session.costUsd)}</span>
        </header>
        <p className="hint">
          {t.history.listPrices}
          {session.unpricedTokens > 0 && ` ${t.history.unpriced(formatTokens(session.unpricedTokens))}.`}
        </p>
      </section>

      <section className="drawer-section">
        <header>
          <strong>{t.history.resume}</strong>
          <button className="small" onClick={copyResume}>
            {t.secrets.copy}
          </button>
        </header>
        <code className="command">{resumeCommand(session)}</code>
        {session.project && <p className="hint">{t.history.runIn(session.project)}</p>}
      </section>

      {project && (
        <div className="drawer-footer">
          <button className="small" onClick={() => onProject(project)}>
            {t.history.sessionsOf(project)}
          </button>
        </div>
      )}
    </Drawer>
  );
}

/** How far the reading of the session logs is, once there are files to count. */
function ReadingProgress({ progress }: { progress: ReadProgress | null }) {
  if (!progress?.total) return <p className="hint">{t.history.reading}…</p>;
  const { done, total } = progress;
  return (
    <div className="reading">
      <span
        className="meter"
        role="progressbar"
        aria-label={t.history.logsRead}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <i style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <p className="hint">
        {t.history.readingFiles(formatNumber(done), formatNumber(total))}
        {done === total ? "" : "…"}
      </p>
    </div>
  );
}
