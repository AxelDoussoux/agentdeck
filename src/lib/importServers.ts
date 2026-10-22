// Reading MCP server settings pasted from a README or another agent's config.

import type { ServerOptions, Transport } from "./types";
import { t } from "./i18n";

/** A server read from pasted JSON, with the values it gives in clear. */
export interface ImportedServer {
  /** Empty when the JSON held a single server without its name. */
  name: string;
  transport: Transport;
  env: Record<string, string>;
  headers: Record<string, string>;
  options: Partial<ServerOptions>;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isServer = (value: unknown): value is Json =>
  isObject(value) && ["command", "url", "httpUrl", "serverUrl"].some((key) => typeof value[key] === "string");

/**
 * Reads the servers of a `{"mcpServers": {…}}` block, as Claude Code, Cursor
 * and Gemini CLI write them, and of the `servers` and `mcp_servers` variants.
 * A bare `"name": {…}` entry, a map of them or a single server work too.
 * Comments and trailing commas are allowed, as in JSONC files.
 */
export function parseServers(text: string): ImportedServer[] {
  const root = readJson(text);
  const found = !isObject(root)
    ? null
    : isObject(root.mcpServers)
      ? root.mcpServers
      : isObject(root.mcp_servers)
        ? root.mcp_servers
        : isObject(root.servers)
          ? root.servers
          : isObject(root.mcp) && isObject(root.mcp.servers)
            ? root.mcp.servers
            : root;
  if (!found) throw new Error(t.importing.notObject);
  if (isServer(found)) return [toServer("", found)];
  const servers = Object.entries(found)
    .filter(([, value]) => isServer(value))
    .map(([name, value]) => toServer(name, value as Json));
  if (servers.length === 0) throw new Error(t.importing.noServer);
  return servers;
}

function readJson(text: string): unknown {
  const trimmed = text.trim();
  const attempts = [trimmed, `{${trimmed}}`];
  for (const attempt of attempts) {
    for (const candidate of [attempt, relaxed(attempt)]) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next reading.
      }
    }
  }
  throw new Error(t.importing.notJson);
}

/** Drops comments and trailing commas outside of strings. */
function relaxed(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const strings = (value: unknown): Record<string, string> =>
  isObject(value)
    ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, typeof v === "string" ? v : JSON.stringify(v)]))
    : {};

const names = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

function toServer(name: string, server: Json): ImportedServer {
  const options: Partial<ServerOptions> = {};
  if (typeof server.cwd === "string") options.cwd = server.cwd;
  // Gemini CLI counts milliseconds, Codex seconds.
  if (typeof server.timeout === "number") options.timeoutMs = server.timeout;
  if (typeof server.tool_timeout_sec === "number") options.timeoutMs = server.tool_timeout_sec * 1000;
  const include = names(server.includeTools) ?? names(server.enabled_tools);
  const exclude = names(server.excludeTools) ?? names(server.disabled_tools);
  if (include) options.includeTools = include;
  if (exclude) options.excludeTools = exclude;
  if (server.disabled === true || server.enabled === false) options.disabled = true;

  const env = strings(server.env);
  if (typeof server.command === "string") {
    const args = names(server.args) ?? [];
    return { name, transport: { kind: "stdio", command: server.command, args }, env, headers: {}, options };
  }
  const url = (server.url ?? server.httpUrl ?? server.serverUrl) as string;
  const type = String(server.type ?? server.transport ?? "").toLowerCase();
  const kind = type.includes("sse") || (!type && !server.httpUrl && /\/sse\/?$/.test(url)) ? "sse" : "http";
  return { name, transport: { kind, url }, env: {}, headers: strings(server.headers), options };
}
