// Mirrors the serialized types of crates/agentdeck-core.

export type Agent = "claude-code" | "codex" | "cursor" | "gemini";

export interface AgentInfo {
  agent: Agent;
  name: string;
  mcpConfigPath: string;
  rulesPath: string | null;
  installed: boolean;
}

export type Transport =
  | { kind: "stdio"; command: string; args: string[] }
  | { kind: "http"; url: string }
  | { kind: "sse"; url: string };

export interface McpServer {
  agent: Agent;
  name: string;
  transport: Transport;
  envKeys: string[];
  headerKeys: string[];
}

export interface McpListing {
  servers: McpServer[];
  errors: string[];
}

export interface ServerSpec {
  transport: Transport;
  env: Record<string, string>;
  headers: Record<string, string>;
}

export interface Rules {
  agent: Agent;
  content: string | null;
}
