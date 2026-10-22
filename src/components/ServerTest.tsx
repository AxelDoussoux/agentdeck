import { Icon, Notice } from "./ui";
import type { ProbeReport } from "../lib/types";
import { formatNumber, t } from "../lib/i18n";

/** A test of one agent's copy of a server: running, or what it showed. */
export type TestState = { running: true } | { running: false; report: ProbeReport } | { running: false; error: string };

const seconds = (ms: number) =>
  `${formatNumber(ms / 1000, { maximumFractionDigits: ms < 10000 ? 1 : 0, minimumFractionDigits: ms < 10000 ? 1 : 0 })}\u00a0s`;

/** The outcome of a server test: its tools, or why it failed and what it printed. */
export function ServerTestResult({ state }: { state: TestState }) {
  if (state.running) {
    return (
      <p className="hint test-running" role="status">
        {t.test.starting}
      </p>
    );
  }
  if ("error" in state) return <Notice tone="error">{state.error}</Notice>;
  const { report } = state;
  const server = [report.serverName, report.serverVersion].filter(Boolean).join(" ");
  return (
    <div className="test-result" role="status">
      {report.ok ? (
        <p className="test-ok">
          <Icon name="check" size={14} /> {t.test.works(server, seconds(report.elapsedMs))}{" "}
          {report.noTools ? t.test.noTools : t.test.tools(report.tools.length)}
        </p>
      ) : (
        <Notice tone={report.needsSignIn ? "warning" : "error"}>{report.error}</Notice>
      )}
      {report.tools.length > 0 && (
        <ul className="tool-list">
          {report.tools.map((tool) => (
            <li key={tool.name} title={tool.description ?? undefined}>
              <code>{tool.name}</code>
              {tool.description && <span className="hint">{tool.description.split("\n")[0]}</span>}
            </li>
          ))}
        </ul>
      )}
      {report.log && (
        <details className="test-log" open={!report.ok}>
          <summary>{t.test.output}</summary>
          <pre className="preview">{report.log}</pre>
        </details>
      )}
    </div>
  );
}
