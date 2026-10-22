import { diffLines } from "../lib/diff";

/** Unchanged lines kept around each change. */
const CONTEXT = 2;

/** The differences between two texts, with long unchanged stretches folded. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after);
  if (!lines) return <p className="hint">Too long to show the differences.</p>;

  const near = lines.map((_, index) =>
    lines
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some((line) => line.kind !== "same"),
  );
  const rows: { key: number; className: string; text: string }[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!near[index]) {
      let end = index;
      while (end + 1 < lines.length && !near[end + 1]) end++;
      const hidden = end - index + 1;
      rows.push({ key: index, className: "diff-fold", text: `⋯ ${hidden} unchanged line${hidden > 1 ? "s" : ""}` });
      index = end;
      continue;
    }
    const { kind, text } = lines[index];
    const sign = kind === "add" ? "+" : kind === "remove" ? "−" : " ";
    rows.push({ key: index, className: `diff-${kind}`, text: `${sign} ${text}` });
  }

  return (
    <pre className="diff" aria-label="Differences">
      {rows.map((row) => (
        <span key={row.key} className={row.className}>
          {row.text}
        </span>
      ))}
    </pre>
  );
}
