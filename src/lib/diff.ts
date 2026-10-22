export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

/** Above this many lines on each side, no diff is computed (it is quadratic). */
const MAX_LINES = 2000;

/** Line by line differences from `before` to `after`, or `null` for long texts. */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;

  // Length of the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      lines.push({ kind: "remove", text: a[i++] });
    } else {
      lines.push({ kind: "add", text: b[j++] });
    }
  }
  return lines;
}

/** Number of lines of a text, as an editor counts them. */
export function lineCount(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}
