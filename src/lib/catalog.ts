// Common MCP servers that the add form can start from.

import { t } from "./i18n";
import type { Transport } from "./types";

export interface CatalogServer {
  /** Also the key of its summary and note in the translations. */
  name: keyof typeof t.catalog;
  title: string;
  transport: Transport;
  /** Variables or headers to fill in, with a hint shown in the empty field. */
  secrets?: { key: string; hint: string }[];
  docs: string;
}

/** What it gives the agent, in a few words, and what to do before or after adding it. */
export const describeServer = (server: CatalogServer): { summary: string; note?: string } => t.catalog[server.name];

const npx = (...args: string[]): Transport => ({ kind: "stdio", command: "npx", args: ["-y", ...args] });

export const CATALOG: CatalogServer[] = [
  {
    name: "github",
    title: "GitHub",
    transport: { kind: "http", url: "https://api.githubcopilot.com/mcp/" },
    secrets: [{ key: "Authorization", hint: "Bearer ghp_…" }],
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    name: "context7",
    title: "Context7",
    transport: npx("@upstash/context7-mcp"),
    docs: "https://github.com/upstash/context7",
  },
  {
    name: "playwright",
    title: "Playwright",
    transport: npx("@playwright/mcp@latest"),
    docs: "https://github.com/microsoft/playwright-mcp",
  },
  {
    name: "linear",
    title: "Linear",
    transport: { kind: "http", url: "https://mcp.linear.app/mcp" },
    docs: "https://linear.app/docs/mcp",
  },
  {
    name: "sentry",
    title: "Sentry",
    transport: { kind: "http", url: "https://mcp.sentry.dev/mcp" },
    docs: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    name: "notion",
    title: "Notion",
    transport: { kind: "http", url: "https://mcp.notion.com/mcp" },
    docs: "https://developers.notion.com/docs/mcp",
  },
  {
    name: "filesystem",
    title: "Filesystem",
    transport: npx("@modelcontextprotocol/server-filesystem", ""),
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    name: "memory",
    title: "Memory",
    transport: npx("@modelcontextprotocol/server-memory"),
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    name: "fetch",
    title: "Fetch",
    transport: { kind: "stdio", command: "uvx", args: ["mcp-server-fetch"] },
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    name: "sequential-thinking",
    title: "Sequential thinking",
    transport: npx("@modelcontextprotocol/server-sequential-thinking"),
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
];
