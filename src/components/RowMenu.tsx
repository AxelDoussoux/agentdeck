import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./ui";
import { Tooltip } from "./Tooltip";

export interface MenuItem {
  label: string;
  tone?: "danger";
  /** For a choice among the items, such as the profile in use. */
  checked?: boolean;
  onSelect: () => void;
}

interface Props {
  label: string;
  items: MenuItem[];
  /** A text button instead of "⋯", for a page's header. */
  text?: ReactNode;
}

/** A "⋯" button that opens a list of actions, for the end of a table row. */
export function RowMenu({ label, items, text }: Props) {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = position !== null;
  // Items line up when some are choices, with room for the check mark.
  const choices = items.some((item) => item.checked !== undefined);

  function toggle() {
    if (open) return setPosition(null);
    // Fixed, so the scrolling table does not clip it. Opens upward near the bottom.
    const rect = trigger.current!.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    setPosition(
      rect.bottom + 36 * items.length + 16 > window.innerHeight
        ? { right, bottom: window.innerHeight - rect.top + 4 }
        : { right, top: rect.bottom + 4 },
    );
  }

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("[role^=menuitem]")?.focus();
    const close = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setPosition(null);
    };
    const dismiss = () => setPosition(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (!open) return;
    const entries = [...root.current!.querySelectorAll<HTMLButtonElement>("[role^=menuitem]")];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setPosition(null);
      trigger.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(index + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Tab") {
      setPosition(null);
    }
  }

  return (
    <div ref={root} className={`row-menu ${open ? "open" : ""}`} onKeyDown={onKeyDown}>
      {text ? (
        <Tooltip text={label}>
          <button ref={trigger} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
            {text}
          </button>
        </Tooltip>
      ) : (
        <Tooltip text={label}>
          <button
            ref={trigger}
            className="icon-button"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
          >
            <Icon name="more" />
          </button>
        </Tooltip>
      )}
      {position && (
        <div className="menu" role="menu" aria-label={label} style={position}>
          {items.map((item) => (
            <button
              key={item.label}
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              className={item.tone}
              onClick={() => {
                setPosition(null);
                item.onSelect();
              }}
            >
              {choices && <span className="menu-check">{item.checked && <Icon name="check" size={14} />}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
