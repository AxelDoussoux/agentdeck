import { describe, expect, it } from "vitest";
import { changes, differences, drifting } from "./servers";
import { t } from "./i18n";
import type { McpServer } from "./types";

const server = (overrides: Partial<McpServer>): McpServer => ({
  agent: "claude-code",
  name: "files",
  transport: { kind: "stdio", command: "npx", args: ["-y", "files"] },
  envKeys: [],
  headerKeys: [],
  envHashes: {},
  headerHashes: {},
  options: { cwd: null, timeoutMs: null, disabled: false, includeTools: null, excludeTools: null },
  ...overrides,
});

describe("differences", () => {
  it("is empty for copies that run the same thing", () => {
    expect(differences(server({ agent: "codex" }), server({}), "Claude Code")).toEqual([]);
  });

  it("names a different command, and variables set on one side only or with another value", () => {
    const copy = server({ transport: { kind: "stdio", command: "node", args: ["files.js"] }, envHashes: { A: "1", B: "2" } });
    const reference = server({ envHashes: { A: "9", C: "3" } });
    expect(differences(copy, reference, "Codex")).toEqual([
      t.servers.runs("node files.js", t.servers.here, "npx -y files", t.servers.inAgent("Codex")),
      t.servers.otherValue("A", t.servers.inAgent("Codex")),
      t.servers.setOnly("B", t.servers.here, t.servers.inAgent("Codex")),
      t.servers.setOnly("C", t.servers.inAgent("Codex"), t.servers.here),
    ]);
  });

  it("sees through agentdeck exec and does not compare keychain values", () => {
    const wrapped = server({
      transport: { kind: "stdio", command: "/usr/bin/agentdeck", args: ["exec", "--secret", "TOKEN=files/TOKEN", "--", "npx", "-y", "files"] },
    });
    expect(differences(wrapped, server({ envHashes: { TOKEN: "abc" } }), "Codex")).toEqual([]);
  });

  it("compares settings only between agents that have them", () => {
    const withTimeout = (agent: McpServer["agent"]) =>
      server({ agent, options: { cwd: null, timeoutMs: 30000, disabled: false, includeTools: null, excludeTools: null } });
    expect(differences(withTimeout("codex"), server({ agent: "gemini" }), "Gemini CLI")).toHaveLength(1);
    expect(differences(withTimeout("codex"), server({}), "Claude Code")).toEqual([]);
  });
});

it("changes names a move of the secrets to the keychain", () => {
  const before = server({ envHashes: { TOKEN: "abc" } });
  const after = server({
    transport: { kind: "stdio", command: "agentdeck.exe", args: ["exec", "--secret", "TOKEN=files/TOKEN", "--", "npx", "-y", "files"] },
  });
  expect(changes(before, after)).toEqual([t.servers.wasInFile]);
});

it("drifting lists the servers whose copies differ", () => {
  const listing = {
    servers: [
      server({}),
      server({ agent: "codex" }),
      server({ name: "docs", transport: { kind: "http", url: "https://a" } }),
      server({ name: "docs", agent: "cursor", transport: { kind: "http", url: "https://b" } }),
    ],
    errors: [],
  };
  expect(drifting(listing)).toEqual(["docs"]);
});
