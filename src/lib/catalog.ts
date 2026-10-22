// Common MCP servers that the add form can start from.

import type { Transport } from "./types";

export interface CatalogServer {
  name: string;
  title: string;
  /** What it gives the agent, in a few words. */
  summary: string;
  transport: Transport;
  /** Variables or headers to fill in, with a hint shown in the empty field. */
  secrets?: { key: string; hint: string }[];
  /** What to do before or after adding it. */
  note?: string;
  docs: string;
}

const npx = (...args: string[]): Transport => ({ kind: "stdio", command: "npx", args: ["-y", ...args] });

export const CATALOG: CatalogServer[] = [
  {
    name: "github",
    title: "GitHub",
    summary: "Repositories, issues and pull requests",
    transport: { kind: "http", url: "https://api.githubcopilot.com/mcp/" },
    secrets: [{ key: "Authorization", hint: "Bearer ghp_…" }],
    note: "Needs a GitHub personal access token, sent as Bearer <token>.",
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    name: "context7",
    title: "Context7",
    summary: "Up-to-date documentation of libraries",
    transport: npx("@upstash/context7-mcp"),
    docs: "https://github.com/upstash/context7",
  },
  {
    name: "playwright",
    title: "Playwright",
    summary: "Drives a browser to test and browse pages",
    transport: npx("@playwright/mcp@latest"),
    docs: "https://github.com/microsoft/playwright-mcp",
  },
  {
    name: "linear",
    title: "Linear",
    summary: "Issues, projects and cycles",
    transport: { kind: "http", url: "https://mcp.linear.app/mcp" },
    note: "Each agent asks you to sign in to Linear the first time it uses it.",
    docs: "https://linear.app/docs/mcp",
  },
  {
    name: "sentry",
    title: "Sentry",
    summary: "Errors and performance issues",
    transport: { kind: "http", url: "https://mcp.sentry.dev/mcp" },
    note: "Each agent asks you to sign in to Sentry the first time it uses it.",
    docs: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    name: "notion",
    title: "Notion",
    summary: "Pages and databases of a workspace",
    transport: { kind: "http", url: "https://mcp.notion.com/mcp" },
    note: "Each agent asks you to sign in to Notion the first time it uses it.",
    docs: "https://developers.notion.com/docs/mcp",
  },
  {
    name: "filesystem",
    title: "Filesystem",
    summary: "Reads and writes files in the folders you list",
    transport: npx("@modelcontextprotocol/server-filesystem", ""),
    note: "Replace the empty argument with a folder the server may use, and add one argument per extra folder.",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    name: "memory",
    title: "Memory",
    summary: "A knowledge graph kept between sessions",
    transport: npx("@modelcontextprotocol/server-memory"),
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    name: "fetch",
    title: "Fetch",
    summary: "Fetches web pages as Markdown",
    transport: { kind: "stdio", command: "uvx", args: ["mcp-server-fetch"] },
    note: "Runs with uv, from astral.sh.",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    name: "sequential-thinking",
    title: "Sequential thinking",
    summary: "Step-by-step reasoning for hard problems",
    transport: npx("@modelcontextprotocol/server-sequential-thinking"),
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
];
