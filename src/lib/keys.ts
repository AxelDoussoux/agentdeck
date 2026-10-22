/** The modifier of app shortcuts: ⌘ on macOS, Ctrl elsewhere. */
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** How a shortcut with the modifier reads, such as "⌘S" or "Ctrl+S". */
export const shortcut = (key: string) => (IS_MAC ? `⌘${key}` : `Ctrl+${key}`);

/** Whether the event holds the shortcut modifier, and no other. */
export const withModifier = (event: KeyboardEvent) =>
  (IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey;
