import { useEffect, useRef, type ReactNode } from "react";

export interface DialogChoice {
  label: string;
  tone?: "primary" | "danger";
  onSelect: () => void;
}

interface Props {
  title: string;
  children?: ReactNode;
  choices: DialogChoice[];
  /** Escape, the Cancel button, or a click outside. */
  onCancel: () => void;
  /** Room for a preview, such as a diff. */
  wide?: boolean;
}

/** A modal question with a Cancel button, focused first, and one or more choices. */
export function ConfirmDialog({ title, children, choices, onCancel, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
    >
      <h3 id="dialog-title">{title}</h3>
      {children && <div className="dialog-body">{children}</div>}
      <div className="dialog-actions">
        <button onClick={onCancel}>Cancel</button>
        {choices.map((choice) => (
          <button key={choice.label} className={choice.tone} onClick={choice.onSelect}>
            {choice.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}
