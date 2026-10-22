// The shared base of rules files, as crates/agentdeck-core/src/rules.rs reads it.

export const SHARED_START = "<!-- agentdeck:shared -->";
export const SHARED_END = "<!-- /agentdeck:shared -->";

function sharedBlock(content: string): { start: number; end: number; inner: string } | null {
  const start = content.indexOf(SHARED_START);
  if (start < 0) return null;
  const innerStart = start + SHARED_START.length;
  const innerEnd = content.indexOf(SHARED_END, innerStart);
  if (innerEnd < 0) return null;
  return { start, end: innerEnd + SHARED_END.length, inner: content.slice(innerStart, innerEnd) };
}

/** The text between the shared base markers, without the line breaks that frame it. */
export function sharedPart(content: string): string | null {
  const block = sharedBlock(content);
  return block ? block.inner.replace(/^\r?\n/, "").replace(/\r?\n$/, "") : null;
}

/** `content` with its shared base replaced by `shared`, or added on top. */
export function withShared(content: string, shared: string): string {
  const block = `${SHARED_START}\n${shared}\n${SHARED_END}`;
  const found = sharedBlock(content);
  if (found) return content.slice(0, found.start) + block + content.slice(found.end);
  return content.trim() ? `${block}\n\n${content}` : `${block}\n`;
}

/** Turns all of `content` into the shared base, for the agent's own rules to follow. */
export const startShared = (content: string) => `${SHARED_START}\n${content.trimEnd()}\n${SHARED_END}\n`;
