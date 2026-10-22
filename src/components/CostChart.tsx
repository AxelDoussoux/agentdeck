import { useState } from "react";
import { formatCost } from "../lib/usage";
import type { Agent } from "../lib/types";

interface Props {
  /** Local dates, oldest first. */
  dates: string[];
  /** Estimated cost per date and agent. */
  costs: Map<string, Map<Agent, number>>;
  /** Agents to stack, bottom first. */
  agents: Agent[];
  nameOf: (agent: Agent) => string;
}

/** A round top for the value axis, with four steps of 1, 2, 2.5 or 5. */
function axisTop(max: number): number {
  const step = max / 4;
  const power = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 2, 2.5, 5, 10].find((n) => n * power >= step)! * power;
  return nice * 4;
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Bars of the cost per day, stacked by agent, over a value axis. Hovering a
 * day, or moving through days with the arrow keys, shows its detail.
 */
export function CostChart({ dates, costs, agents, nameOf }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const totals = dates.map((date) => [...(costs.get(date)?.values() ?? [])].reduce((sum, cost) => sum + cost, 0));
  const top = axisTop(Math.max(0.04, ...totals));
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const labels = [0, Math.floor((dates.length - 1) / 2), dates.length - 1];

  function onKeyDown(event: React.KeyboardEvent) {
    const last = dates.length - 1;
    const current = active ?? last;
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(last, next)));
  }

  const shown = active !== null ? dates[active] : null;
  const detail = shown ? costs.get(shown) : null;

  return (
    <div className="cost-chart">
      <div className="y-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
            {formatCost(tick)}
          </span>
        ))}
      </div>
      <div
        className="plot"
        tabIndex={0}
        role="group"
        aria-label="Estimated cost per day. Use the arrow keys to read each day."
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? dates.length - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((tick) => (
          <i key={tick} className="grid-line" style={{ bottom: `${(tick / top) * 100}%` }} />
        ))}
        <div className="bars">
          {dates.map((date, i) => (
            <div
              key={date}
              className={`day ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
            >
              <div className="stack" style={{ height: `${(totals[i] / top) * 100}%` }}>
                {agents.map((agent) => {
                  const cost = costs.get(date)?.get(agent) ?? 0;
                  return cost > 0 ? (
                    <span
                      key={agent}
                      className={`segment segment-${agent}`}
                      style={{ height: `${(cost / totals[i]) * 100}%` }}
                    />
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>
        {shown && active !== null && (
          <div
            className={`chart-tip ${active > dates.length / 2 ? "chart-tip-left" : ""}`}
            style={{ left: `${((active + 0.5) / dates.length) * 100}%` }}
            role="status"
          >
            <strong>
              {shortDate(shown)} · {formatCost(totals[active])}
            </strong>
            {agents
              .filter((agent) => (detail?.get(agent) ?? 0) > 0)
              .map((agent) => (
                <span key={agent}>
                  <i className={`swatch segment-${agent}`} /> {nameOf(agent)} {formatCost(detail!.get(agent)!)}
                </span>
              ))}
            {totals[active] === 0 && <span>No usage</span>}
          </div>
        )}
      </div>
      <div className="x-axis" aria-hidden="true">
        {labels.map((i) => (
          <span key={i}>{shortDate(dates[i])}</span>
        ))}
      </div>
    </div>
  );
}
