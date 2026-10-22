// Splitting and joining command lines typed in the MCP server form.

/**
 * Splits a command line into words like a POSIX shell: single and double
 * quotes group words, and a backslash escapes the next character outside
 * single quotes. A backslash before anything but a quote, a space or another
 * backslash is kept, so Windows paths such as `C:\tools\server.exe` survive.
 */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else if (c === "\\" && quote === '"' && (line[i + 1] === '"' || line[i + 1] === "\\")) {
        word += line[++i];
      } else {
        word += c;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else if (c === "\\" && i + 1 < line.length && /[\s"'\\]/.test(line[i + 1])) {
      word += line[++i];
      inWord = true;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/** Joins words back into a line that `splitCommand` reads the same way. */
export function joinCommand(words: string[]): string {
  return words
    .map((word) => {
      if (word !== "" && !/[\s"']|\\$/.test(word) && !/\\[\s"'\\]/.test(word)) return word;
      // Inside double quotes only a backslash before a quote, a backslash or
      // the closing quote needs escaping; Windows paths stay readable.
      return `"${word.replace(/\\(?=["\\]|$)/g, "\\\\").replace(/"/g, '\\"')}"`;
    })
    .join(" ");
}
