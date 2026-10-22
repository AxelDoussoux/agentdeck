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

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface Session {
  agent: Agent;
  id: string;
  project: string | null;
  title: string | null;
  models: string[];
  startedAt: string | null;
  endedAt: string | null;
  tokens: Tokens;
  costUsd: number;
  unpricedTokens: number;
}

export interface DayUsage {
  date: string;
  agent: Agent;
  tokens: Tokens;
  costUsd: number;
}

export interface UsageReport {
  sessions: Session[];
  daily: DayUsage[];
  errors: string[];
}

export type SkillLocation = "claude-code" | "shared" | "codex" | "gemini" | "cursor";

export interface Skill {
  name: string;
  description: string | null;
  location: SkillLocation;
  path: string;
  readers: Agent[];
}

export interface SkillListing {
  skills: Skill[];
  errors: string[];
}

export interface SecretRef {
  agent: Agent;
  server: string;
  kind: "env" | "header";
  key: string;
  vaultId: string | null;
  sameValueElsewhere: number;
  /** Looks like a credential; the others are settings such as NODE_ENV. */
  likely: boolean;
  protectable: boolean;
}

export interface SecretListing {
  secrets: SecretRef[];
  errors: string[];
  launcher: string | null;
}
