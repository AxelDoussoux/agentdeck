import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useToastHost } from "./Toasts";
import { Icon } from "./ui";
import { Tooltip } from "./Tooltip";
import { t } from "../lib/i18n";

export interface DrawerTab<T extends string> {
  id: T;
  label: string;
  /** Shown after the label, such as how many items the tab lists. */
  count?: number;
}

interface Props<T extends string> {
  title: ReactNode;
  subtitle?: ReactNode;
  /** With a single tab, no tab list is shown. */
  tabs: DrawerTab<T>[];
  tab: T;
  onTab: (tab: T) => void;
  /** Escape, the close button, or a click outside. */
  onClose: () => void;
  children: ReactNode;
}

/** A side panel with tabs, for the details of one server, skill or session. */
export function Drawer<T extends string>({ title, subtitle, tabs, tab, onTab, onClose, children }: Props<T>) {
  const ref = useRef<HTMLDialogElement>(null);
  useToastHost(ref);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  /** Arrow keys, Home and End move between tabs, as in any tab list. */
  function onTabKey(event: KeyboardEvent) {
    const index = tabs.findIndex((t) => t.id === tab);
    const last = tabs.length - 1;
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = tabs[(target + tabs.length) % tabs.length];
    onTab(next.id);
    document.getElementById(`drawer-tab-${next.id}`)?.focus();
  }

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className="drawer-header">
        <div>
          <h2 id="drawer-title">{title}</h2>
          {subtitle && <div className="hint">{subtitle}</div>}
        </div>
        <Tooltip text={t.common.close}>
          <button className="icon-button" aria-label={t.common.close} onClick={onClose}>
            <Icon name="close" />
          </button>
        </Tooltip>
      </header>
      {tabs.length > 1 && (
        <div className="tabs drawer-tabs" role="tablist" aria-label={t.drawer.sections} onKeyDown={onTabKey}>
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`drawer-tab-${t.id}`}
              role="tab"
              aria-selected={t.id === tab}
              aria-controls="drawer-panel"
              tabIndex={t.id === tab ? 0 : -1}
              className={t.id === tab ? "active" : undefined}
              onClick={() => onTab(t.id)}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className="tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
      )}
      <div
        className="drawer-body"
        id="drawer-panel"
        role={tabs.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={tabs.length > 1 ? `drawer-tab-${tab}` : undefined}
      >
        {children}
      </div>
    </dialog>
  );
}
