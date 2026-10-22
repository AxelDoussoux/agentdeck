import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { t } from "../lib/i18n";

/**
 * Renders the Markdown of a SKILL.md as React elements. Skills come from
 * anywhere, so no HTML in them is ever interpreted: tags show as text, images
 * as their alt text, and only http(s) and mailto links open, in the browser.
 */
export function Markdown({ text }: { text: string }) {
  const { fields, body } = splitFrontmatter(text);
  return (
    <div className="markdown">
      {fields.length > 0 && (
        <dl className="facts frontmatter">
          {fields.map(([key, value]) => (
            <Field key={key} name={key} value={value} />
          ))}
        </dl>
      )}
      {parseBlocks(body).map(renderBlock)}
    </div>
  );
}

function Field({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value || <span className="hint">{t.markdown.empty}</span>}</dd>
    </>
  );
}

/** The `key: value` lines of a leading `---` block, and the text after it. */
export function splitFrontmatter(text: string): { fields: [string, string][]; body: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { fields: [], body: text };
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { fields: [], body: text };
  const fields: [string, string][] = [];
  for (const line of lines.slice(1, end)) {
    const field = /^([\w.-]+):\s*(.*)$/.exec(line);
    if (field) {
      fields.push([field[1], unquote(field[2])]);
    } else if (fields.length > 0 && line.trim()) {
      // A nested or folded value continues the field above it.
      const last = fields[fields.length - 1];
      last[1] = `${last[1]} ${line.trim().replace(/^-\s+/, "")}`.trim();
    }
  }
  return { fields: fields.map(([key, value]) => [key, value.replace(/^[|>][+-]?\s*/, "")]), body: lines.slice(end + 1).join("\n") };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, trimmed.endsWith('"') ? -1 : undefined);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "table"; head: string[]; rows: string[][]; align: ("left" | "center" | "right" | undefined)[] }
  | { kind: "rule" };

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Splits Markdown into blocks: enough of CommonMark for skills, no HTML. */
function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (line: string) =>
    /^\s{0,3}(#{1,6}\s|>|<!--|([-*_])\s*(\2\s*){2,}$)/.test(line) || FENCE.test(line) || LIST_ITEM.test(line);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // HTML comments are not shown, as in any Markdown viewer.
    if (/^\s{0,3}<!--/.test(line)) {
      let end = i;
      while (end < lines.length && !lines[end].includes("-->")) end++;
      const after = end < lines.length ? lines[end].slice(lines[end].indexOf("-->") + 3) : "";
      // Text after the comment, on its last line, is read as a line of its own.
      if (after.trim()) {
        lines[end] = after;
        i = end;
      } else {
        i = end + 1;
      }
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", lang: fence[2], text: code.join("\n") });
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ kind: "quote", blocks: parseBlocks(quoted.join("\n")) });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const indent = item[1].length;
      const ordered = /\d/.test(item[2]);
      const items: string[][] = [];
      while (i < lines.length) {
        const current = LIST_ITEM.exec(lines[i]);
        if (current && current[1].length === indent && /\d/.test(current[2]) === ordered) {
          items.push([current[3]]);
          i++;
        } else if (lines[i].trim() && (lines[i].search(/\S/) > indent || !startsBlock(lines[i]))) {
          // Nested lines and lazy continuations belong to the item above.
          items[items.length - 1].push(lines[i].slice(Math.min(indent + 2, lines[i].search(/\S/))));
          i++;
        } else if (!lines[i].trim() && i + 1 < lines.length && lines[i + 1].search(/\S/) > indent) {
          items[items.length - 1].push("");
          i++;
        } else if (!lines[i].trim() && LIST_ITEM.exec(lines[i + 1] ?? "")?.[1].length === indent) {
          i++;
        } else {
          break;
        }
      }
      blocks.push({
        kind: "list",
        ordered,
        start: ordered ? parseInt(item[2], 10) : 1,
        items: items.map((lines) => parseBlocks(lines.join("\n"))),
      });
      continue;
    }

    if (line.includes("|") && TABLE_DIVIDER.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":")
          ? "center"
          : cell.endsWith(":")
            ? "right"
            : cell.startsWith(":")
              ? "left"
              : undefined,
      );
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", head, rows, align });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !startsBlock(lines[i]))) {
      paragraph.push(lines[i++].replace(/^\s+/, ""));
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

/** The cells of a table row, where `\\|` is a pipe inside a cell. */
function cells(row: string): string[] {
  const found = [""];
  const text = row.trim();
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "|") {
      found[found.length - 1] += "|";
      i++;
    } else if (text[i] === "|") {
      found.push("");
    } else {
      found[found.length - 1] += text[i];
    }
  }
  // Pipes at both ends only frame the row.
  if (text.startsWith("|")) found.shift();
  if (text.endsWith("|") && !text.endsWith("\\|")) found.pop();
  return found.map((cell) => cell.trim());
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      // The drawer's title is the h2, so the skill's own headings start below it.
      const Tag = (["h3", "h4", "h5", "h6", "h6", "h6"] as const)[block.level - 1];
      return <Tag key={key}>{inline(block.text)}</Tag>;
    }
    case "paragraph":
      return <p key={key}>{inline(block.text)}</p>;
    case "code":
      return (
        <pre key={key} className="markdown-code" data-lang={block.lang || undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return <blockquote key={key}>{block.blocks.map(renderBlock)}</blockquote>;
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          {/* A single paragraph sits in the item without a gap above it. */}
          {item.length === 1 && item[0].kind === "paragraph" ? inline(item[0].text) : item.map(renderBlock)}
        </li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "table":
      return (
        <div key={key} className="markdown-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} style={{ textAlign: block.align[i] }}>
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {block.head.map((_, i) => (
                    <td key={i} style={{ textAlign: block.align[i] }}>
                      {inline(row[i] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr key={key} />;
  }
}

// Code spans, images, links, autolinks, bold, italics, strikethrough and hard breaks.
const INLINE =
  /(`+)([\s\S]*?[^`]|[^`]?)\1(?!`)|!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+["'][^)]*["'])?\s*\)|\[((?:[^\]\\]|\\.)+)\]\(\s*<?([^)\s>]*)>?(?:\s+["'][^)]*["'])?\s*\)|<((?:https?:\/\/|mailto:)[^>\s]+)>|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?!\w)|\*(?=[^\s*])([\s\S]*?[^\s*])\*|~~(?=\S)([\s\S]*?\S)~~|\\([\\`*_{}[\]()#+\-.!|<>~])|( {2,}|\\)\n/g;

/** Turns inline Markdown into React nodes. Text stays text, whatever it holds. */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    last = index + match[0].length;
    const [, ticks, code, alt, , label, href, auto, bold, boldUnder, italic, strike, escaped, lineBreak] = match;
    if (ticks !== undefined) {
      nodes.push(<code key={key++}>{code.length > 2 && code.startsWith(" ") && code.endsWith(" ") ? code.slice(1, -1) : code}</code>);
    } else if (alt !== undefined) {
      // Images would load from anywhere, so they show as their description.
      nodes.push(
        <span key={key++} className="markdown-image" title={match[4]}>
          {alt || t.markdown.image}
        </span>,
      );
    } else if (label !== undefined) {
      nodes.push(<Link key={key++} href={href}>{inline(label.replace(/\\(.)/g, "$1"))}</Link>);
    } else if (auto !== undefined) {
      nodes.push(<Link key={key++} href={auto}>{auto}</Link>);
    } else if (bold !== undefined || boldUnder !== undefined) {
      nodes.push(<strong key={key++}>{inline(bold ?? boldUnder)}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key++}>{inline(italic)}</em>);
    } else if (strike !== undefined) {
      nodes.push(<del key={key++}>{inline(strike)}</del>);
    } else if (escaped !== undefined) {
      nodes.push(escaped);
    } else if (lineBreak !== undefined) {
      nodes.push(<br key={key++} />);
    }
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Opens web links in the browser. Other targets, such as files of the skill, show as text. */
function Link({ href, children }: { href: string; children: ReactNode }) {
  if (!/^(https?:\/\/|mailto:)/i.test(href)) {
    return (
      <span className="markdown-local-link" title={href}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        openUrl(href).catch(() => undefined);
      }}
    >
      {children}
    </a>
  );
}
