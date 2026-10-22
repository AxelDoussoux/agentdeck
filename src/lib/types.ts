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
  /** A hash of each value, by name: equal values have equal hashes. */
  envHashes: Record<string, string>;
  headerHashes: Record<string, string>;
  options: ServerOptions;
}

/** Settings only Codex and Gemini CLI have, except `disabled`: Codex only. */
export interface ServerOptions {
  cwd: string | null;
  timeoutMs: number | null;
  disabled: boolean;
  includeTools: string[] | null;
  excludeTools: string[] | null;
}

export interface McpListing {
  servers: McpServer[];
  errors: string[];
}

export interface ServerSpec {
  transport: Transport;
  env: Record<string, string>;
  headers: Record<string, string>;
  options?: Partial<ServerOptions>;
}

/** Changes to a server: a `null` value keeps the current one, unseen. */
export interface ServerEdit {
  transport: Transport;
  env: Record<string, string | null>;
  headers: Record<string, string | null>;
  options: Partial<ServerOptions>;
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

/** Usage during one UTC hour; `hour` is `YYYY-MM-DDTHH`. */
export interface HourUsage {
  hour: string;
  agent: Agent;
  tokens: Tokens;
  costUsd: number;
}

export interface UsageReport {
  sessions: Session[];
  /** Grouped by UTC day; the app groups `hourly` by local day instead. */
  daily: DayUsage[];
  hourly: HourUsage[];
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
