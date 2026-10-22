import { useEffect, useRef, type ReactNode } from "react";
import { useToastHost } from "./Toasts";
import { Icon, Tabs } from "./ui";
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
        <Tabs
          className="drawer-tabs"
          label={t.drawer.sections}
          idPrefix="drawer-tab"
          panel="drawer-panel"
          tab={tab}
          onTab={onTab}
          tabs={tabs.map((item) => ({
            id: item.id,
            label: (
              <>
                {item.label}
                {item.count !== undefined && item.count > 0 && <span className="tab-count">{item.count}</span>}
              </>
            ),
          }))}
        />
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
