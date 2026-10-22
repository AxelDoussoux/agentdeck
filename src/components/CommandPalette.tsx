import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./ui";
import { t } from "../lib/i18n";

export interface Command {
  label: string;
  icon: IconName;
  /** Shown on the right: a shortcut, or what kind of item it is. */
  hint?: string;
  /** More words the search matches. */
  keywords?: string;
  run: () => void;
}

const SHOWN = 50;

/** Ctrl/⌘ K: type a few words, pick with the arrows and Enter. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  // Every word must match, in any order.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = commands.filter((command) => {
    const text = `${command.label} ${command.hint ?? ""} ${command.keywords ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const shown = matches.slice(0, SHOWN);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(command: Command) {
    onClose();
    command.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const last = shown.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]);
    } else if (event.key === "Enter" && shown[active]) {
      event.preventDefault();
      choose(shown[active]);
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog palette"
      aria-label={t.palette.label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="palette-search">
        <Icon name="search" size={16} />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[active] ? `palette-${active}` : undefined}
          aria-autocomplete="list"
          placeholder={t.palette.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul id="palette-list" role="listbox" ref={list} aria-label={t.palette.commands}>
        {shown.map((command, i) => (
          <li
            key={`${command.label} ${command.hint}`}
            id={`palette-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? "active" : undefined}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(command)}
          >
            <Icon name={command.icon} size={16} />
            <span>{command.label}</span>
            {command.hint && <small>{command.hint}</small>}
          </li>
        ))}
        {shown.length === 0 && <li className="palette-empty">{t.palette.nothing(query)}</li>}
      </ul>
      {matches.length > SHOWN && (
        <p className="palette-more">{t.palette.more(matches.length - SHOWN)}</p>
      )}
    </dialog>
  );
}
