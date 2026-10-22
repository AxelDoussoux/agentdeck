/** Whether every word of `query` is in one of `texts`, ignoring case. */
export function matches(query: string, texts: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}
