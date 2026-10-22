import { describe, expect, it } from "vitest";
import { parseServers } from "./importServers";
import { t } from "./i18n";

describe("parseServers", () => {
  it("reads an mcpServers block", () => {
    const servers = parseServers(`{"mcpServers": {
      "files": {"command": "npx", "args": ["-y", "server-files"], "env": {"ROOT": "/tmp", "DEPTH": 2}},
      "docs": {"url": "https://example.com/mcp", "headers": {"Authorization": "Bearer x"}}
    }}`);
    expect(servers).toEqual([
      {
        name: "files",
        transport: { kind: "stdio", command: "npx", args: ["-y", "server-files"] },
        env: { ROOT: "/tmp", DEPTH: "2" },
        headers: {},
        options: {},
      },
      {
        name: "docs",
        transport: { kind: "http", url: "https://example.com/mcp" },
        env: {},
        headers: { Authorization: "Bearer x" },
        options: {},
      },
    ]);
  });

  it("accepts a bare entry with comments and trailing commas", () => {
    const [server] = parseServers(`
      // From the README
      "files": {
        "command": "files-server", /* no args */
        "args": ["--url", "http://x//y"],
      },
    `);
    expect(server.name).toBe("files");
    expect(server.transport).toEqual({ kind: "stdio", command: "files-server", args: ["--url", "http://x//y"] });
  });

  it("reads a single server without its name", () => {
    expect(parseServers(`{"command": "srv"}`)[0].name).toBe("");
  });

  it("reads Codex and Gemini CLI settings", () => {
    const [codex] = parseServers(`{"mcp_servers": {"a": {"command": "a", "tool_timeout_sec": 30, "enabled_tools": ["x"], "enabled": false}}}`);
    expect(codex.options).toEqual({ timeoutMs: 30000, includeTools: ["x"], disabled: true });
    const [gemini] = parseServers(`{"mcpServers": {"b": {"httpUrl": "https://b", "timeout": 5000, "excludeTools": ["y"], "cwd": "/w"}}}`);
    expect(gemini.transport).toEqual({ kind: "http", url: "https://b" });
    expect(gemini.options).toEqual({ timeoutMs: 5000, excludeTools: ["y"], cwd: "/w" });
  });

  it("tells SSE servers from their type or URL", () => {
    expect(parseServers(`{"a": {"url": "https://a/sse"}}`)[0].transport.kind).toBe("sse");
    expect(parseServers(`{"a": {"url": "https://a/mcp", "type": "sse"}}`)[0].transport.kind).toBe("sse");
    expect(parseServers(`{"a": {"url": "https://a/sse", "type": "http"}}`)[0].transport.kind).toBe("http");
  });

  it("says what is wrong with the text", () => {
    expect(() => parseServers("not json")).toThrow(t.importing.notJson);
    expect(() => parseServers("[1, 2]")).toThrow(t.importing.notObject);
    expect(() => parseServers(`{"mcpServers": {"a": {"args": []}}}`)).toThrow(t.importing.noServer);
  });
});
