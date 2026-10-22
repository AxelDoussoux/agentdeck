import type { ReactNode } from "react";
import type { Agent } from "../lib/types";

// Small building blocks shared by every page.

const ICONS = {
  overview: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  plug: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
  rules: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  skills: "M12 3l2.2 5.3L20 9l-4.4 3.8L17 18.5 12 15.5 7 18.5l1.4-5.7L4 9l5.8-.7z",
  key: "M15 3a6 6 0 1 1-5.6 8.2L3 17.6V21h3.4v-2.4h2.4v-2.4l2.6-2.6A6 6 0 0 1 15 3zM16.5 7.5h.01",
  chart: "M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3",
  refresh: "M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  alert: "M12 3l10 18H2zM12 10v4M12 17.5h.01",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  close: "M6 6l12 12M18 6L6 18",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

const MONOGRAMS: Record<Agent, string> = {
  "claude-code": "Cl",
  codex: "Cx",
  cursor: "Cu",
  gemini: "Ge",
};

/** A colored monogram that identifies an agent at a glance. */
export function AgentMark({ agent, size = 28 }: { agent: Agent; size?: number }) {
  return (
    <span
      className={`agent-mark agent-${agent}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {MONOGRAMS[agent]}
    </span>
  );
}

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

type Tone = "error" | "success" | "warning" | "info";

const TONE_ICONS: Record<Tone, IconName> = {
  error: "alert",
  success: "check",
  warning: "alert",
  info: "download",
};

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={TONE_ICONS[tone]} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
