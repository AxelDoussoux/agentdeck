import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";
import { Tooltip } from "./Tooltip";
import { errorText, t } from "../lib/i18n";

interface Toast {
  tone: "success" | "error";
  text: string;
  /** Reverts the change the toast reports. Offered once. */
  undo?: () => Promise<unknown>;
}

interface ShownToast extends Toast {
  id: number;
  busy?: boolean;
}

/** At most this many toasts are on screen; older ones make room. */
const SHOWN = 4;
const SUCCESS_MS = 6000;
const UNDO_MS = 10000;

const ToastContext = createContext<(toast: Toast) => void>(() => {});

/** Shows a toast at the bottom of the window. Errors stay until closed. */
export const useToast = () => useContext(ToastContext);

const HostContext = createContext<(host: HTMLElement | null) => void>(() => {});

/**
 * Shows the toasts inside `host`, an open modal dialog, while it is set: the
 * rest of the page is out of reach under a modal, Undo included.
 */
export function useToastHost(host: React.RefObject<HTMLElement | null>) {
  const setHost = useContext(HostContext);
  useEffect(() => {
    setHost(host.current);
    return () => setHost(null);
  }, []);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ShownToast[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const nextId = useRef(0);

  const notify = useCallback((toast: Toast) => {
    const id = ++nextId.current;
    setToasts((all) => [...all.slice(1 - SHOWN), { ...toast, id }]);
  }, []);

  const update = useCallback((id: number, patch: Partial<ShownToast>) => {
    setToasts((all) => all.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((toast) => toast.id !== id));
  }, []);

  async function undo(toast: ShownToast) {
    update(toast.id, { busy: true });
    try {
      await toast.undo!();
      update(toast.id, { tone: "success", text: t.toast.undone, undo: undefined, busy: false });
    } catch (err) {
      update(toast.id, { tone: "error", text: t.toast.undoFailed(errorText(err)), undo: undefined, busy: false });
    }
  }

  const region = (
    <div className="toasts" role="region" aria-label={t.toast.region} aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onUndo={() => undo(toast)} onClose={() => dismiss(toast.id)} />
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={notify}>
      <HostContext.Provider value={setHost}>
        {children}
        {host ? createPortal(region, host) : region}
      </HostContext.Provider>
    </ToastContext.Provider>
  );
}

interface ItemProps {
  toast: ShownToast;
  onUndo: () => void;
  onClose: () => void;
}

function ToastItem({ toast, onUndo, onClose }: ItemProps) {
  // Hovering or focusing a toast keeps it on screen, so there is time to read it or reach Undo.
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (toast.tone === "error" || held || toast.busy) return;
    const timer = setTimeout(onClose, toast.undo ? UNDO_MS : SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [toast.tone, toast.text, toast.undo, toast.busy, held]);

  return (
    <div
      className={`toast toast-${toast.tone}`}
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <Icon name={toast.tone === "error" ? "alert" : "check"} />
      <span className="toast-text">{toast.text}</span>
      {toast.undo && (
        <button className="small" disabled={toast.busy} onClick={onUndo}>
          <Icon name="undo" size={14} /> {toast.busy ? t.toast.undoing : t.toast.undo}
        </button>
      )}
      <Tooltip text={t.toast.dismiss}>
        <button className="icon-button" aria-label={t.toast.dismiss} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </Tooltip>
    </div>
  );
}
