import type { KeyboardEvent } from "react";

const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex='-1'])";

/**
 * Arrow keys move between the controls of a table, a cell at a time, as in a
 * spreadsheet: cells without one are skipped. Home and End go to the first
 * and last control of the row. Attach it to the table's onKeyDown.
 */
export function moveInGrid(event: KeyboardEvent<HTMLTableElement>) {
  const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const edge = event.key === "Home" ? -1 : event.key === "End" ? 1 : 0;
  const move = moves[event.key];
  if (event.defaultPrevented || (!move && !edge) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const from = event.target as HTMLElement;
  // Text fields and open menus keep their own keys.
  if (from.matches("input, textarea, [role='menuitem']")) return;
  const cell = from.closest("td, th");
  const row = cell?.parentElement as HTMLTableRowElement | null;
  if (!cell || !row) return;
  const rows = [...event.currentTarget.rows];
  const target = (r: number, c: number) => rows[r]?.cells[c]?.querySelector<HTMLElement>(FOCUSABLE) ?? null;

  let next: HTMLElement | null = null;
  if (edge) {
    const columns = [...row.cells].map((_, c) => c);
    for (const c of edge < 0 ? columns : columns.reverse()) {
      next = target(row.rowIndex, c);
      if (next) break;
    }
  } else {
    let [r, c] = [row.rowIndex, (cell as HTMLTableCellElement).cellIndex];
    while (!next) {
      [r, c] = [r + move[0], c + move[1]];
      if (r < 0 || r >= rows.length || c < 0 || c >= (rows[r]?.cells.length ?? 0)) return;
      next = target(r, c);
    }
  }
  if (!next || next === from) return;
  event.preventDefault();
  next.focus();
}
