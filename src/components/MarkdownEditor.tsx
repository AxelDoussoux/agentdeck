import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { defineLanguageFacet, HighlightStyle, Language, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { GFM, parser } from "@lezer/markdown";
import { t } from "../lib/i18n";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Names the editor for screen readers. */
  label: string;
  /** What the editor holds, such as an agent: a new one starts a new undo history. */
  docKey: string;
}

// Colors come from the app's variables, so the editor follows the theme.
const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--text)" },
  ".cm-line": { padding: "0 16px 0 12px" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-2)",
    color: "var(--faint)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-focused .cm-activeLine": { backgroundColor: "var(--surface-2)" },
  "&.cm-focused .cm-activeLineGutter": { color: "var(--text)" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--text)", borderColor: "var(--border)" },
  ".cm-searchMatch": { backgroundColor: "var(--warn-soft)", outline: "1px solid var(--warn)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent-soft)" },
  // The search panel's fields and buttons are styled in App.css, over CodeMirror's own.
});

// Markdown with GitHub's tables and task lists. @codemirror/lang-markdown would
// also bring the HTML, CSS and JavaScript languages, for embedded code.
const markdown = new LanguageSupport(
  new Language(
    defineLanguageFacet({ commentTokens: { block: { open: "<!--", close: "-->" } } }),
    parser.configure(GFM),
    [],
    "markdown",
  ),
);

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "var(--accent)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--muted)", textDecoration: "underline" },
  { tag: tags.monospace, color: "var(--ok)" },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.labelName], color: "var(--faint)" },
  { tag: [tags.comment, tags.meta], color: "var(--faint)", fontStyle: "italic" },
]);

/** A Markdown editor with highlighting, line numbers, undo history and search. */
export function MarkdownEditor({ value, onChange, placeholder: hint, label, docKey }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const key = useRef(docKey);
  // The latest callback, read by the editor's listener.
  const changed = useRef(onChange);
  changed.current = onChange;

  const create = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown,
        syntaxHighlighting(highlight),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        placeholder(hint ?? ""),
        theme,
        EditorState.phrases.of(t.editor.phrases),
        EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changed.current(update.state.doc.toString());
        }),
      ],
    });

  useEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: create(value) });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  // Takes in content set from outside, such as a reload or Revert.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (key.current !== docKey) {
      key.current = docKey;
      editor.setState(create(value));
      return;
    }
    const current = editor.state.doc.toString();
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value, docKey]);

  return <div ref={host} className="markdown-editor" />;
}
