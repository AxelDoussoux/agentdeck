import { joinCommand } from "./command";
import type { Agent, McpListing, McpServer, ServerOptions, Transport } from "./types";

// What MCP servers run, and how copies of one server differ between agents.

export function describe(transport: Transport): string {
  switch (transport.kind) {
    case "stdio":
      return joinCommand([transport.command, ...transport.args]);
    case "http":
      return transport.url;
    case "sse":
      return transport.url;
  }
}

/**
 * The command a server really runs, and a hash of each variable it gets, by
 * name. Servers whose secrets are in the keychain start through `agentdeck
 * exec`, which gets the keychain id of each secret in a flag; their hash is
 * `null`, since the value is not in the config.
 */
function launch(server: McpServer): { target: string; values: Map<string, string | null> } {
  const { transport } = server;
  const values = new Map<string, string | null>([
    ...Object.entries(server.envHashes),
    ...Object.entries(server.headerHashes),
  ]);
  if (transport.kind !== "stdio") return { target: `${transport.kind} ${transport.url}`, values };
  const wrapped = /(^|[\\/])agentdeck(\.exe)?$/i.test(transport.command) && transport.args[0] === "exec";
  const end = transport.args.indexOf("--");
  if (!wrapped || end < 0) return { target: describe(transport), values };
  const flags = transport.args.slice(1, end);
  for (let i = 0; i < flags.length - 1; i++) {
    if (flags[i] === "--secret") values.set(flags[i + 1].split("=")[0], null);
  }
  return { target: joinCommand(transport.args.slice(end + 1)), values };
}

/** Agents that have the settings of `ServerOptions`. */
export const WITH_OPTIONS: Agent[] = ["codex", "gemini"];

function describeOptions(options: ServerOptions): Map<string, string> {
  const tools = (list: string[] | null) => (list ? list.join(", ") || "none" : "all");
  return new Map([
    ["Working directory", options.cwd ?? "not set"],
    ["Timeout", options.timeoutMs === null ? "default" : `${options.timeoutMs / 1000} s`],
    ["Allowed tools", tools(options.includeTools)],
    ["Blocked tools", options.excludeTools?.join(", ") || "none"],
  ]);
}

/**
 * What differs between `copy` and `reference`, empty when they run the same
 * thing with the same variables and settings. Values in the keychain are not
 * compared, nor settings one of the two agents does not have.
 */
export function differences(copy: McpServer, reference: McpServer, referenceName: string): string[] {
  return compare(copy, reference, "here", `in ${referenceName}`);
}

/** What differs between an earlier version of a server and the server now. */
export function changes(earlier: McpServer, now: McpServer): string[] {
  const found = compare(earlier, now, "then", "now");
  // The comparison sees through `agentdeck exec`, so name that change itself.
  const [before, after] = [inKeychain(earlier), inKeychain(now)];
  if (before && !after) found.push("Its secrets were in the keychain then.");
  if (after && !before) found.push("Its secrets were in the config file then.");
  return found;
}

/** Whether the server starts through `agentdeck exec`, with secrets from the keychain. */
function inKeychain(server: McpServer): boolean {
  return [...launch(server).values.values()].some((hash) => hash === null);
}

/** `here` and `there` place each side in the sentences, such as "then" and "now". */
function compare(copy: McpServer, reference: McpServer, here: string, there: string): string[] {
  const [x, y] = [launch(copy), launch(reference)];
  const found: string[] = [];
  if (x.target !== y.target) found.push(`Runs ${x.target} ${here}, ${y.target} ${there}.`);
  for (const key of [...new Set([...x.values.keys(), ...y.values.keys()])].sort()) {
    const [mine, theirs] = [x.values.get(key), y.values.get(key)];
    if (!y.values.has(key)) found.push(`${key} is set ${here}, not ${there}.`);
    else if (!x.values.has(key)) found.push(`${key} is set ${there}, not ${here}.`);
    else if (mine && theirs && mine !== theirs) found.push(`${key} has another value than ${there}.`);
  }
  if (WITH_OPTIONS.includes(copy.agent) && WITH_OPTIONS.includes(reference.agent)) {
    const theirs = describeOptions(reference.options);
    for (const [label, value] of describeOptions(copy.options)) {
      if (value !== theirs.get(label)) found.push(`${label}: ${value} ${here}, ${theirs.get(label)} ${there}.`);
    }
  }
  return found;
}

/** One server's copies, by agent, in the order the core lists them. */
export function byName(listing: McpListing): Map<string, Map<Agent, McpServer>> {
  const rows = new Map<string, Map<Agent, McpServer>>();
  for (const server of listing.servers) {
    if (!rows.has(server.name)) rows.set(server.name, new Map());
    rows.get(server.name)!.set(server.agent, server);
  }
  return rows;
}

/** Names of the servers whose copies differ from the first one. */
export function drifting(listing: McpListing): string[] {
  return [...byName(listing)]
    .filter(([, copies]) => {
      const [source, ...others] = copies.values();
      return others.some((copy) => differences(copy, source, "").length > 0);
    })
    .map(([name]) => name);
}
