// Mirrors the serialized types of crates/agentdeck-core.

export type Agent = "claude-code" | "codex" | "cursor" | "gemini";

export interface AgentInfo {
  agent: Agent;
  name: string;
  mcpConfigPath: string;
  rulesPath: string | null;
  /** Found on this computer, even without a config file yet. */
  installed: boolean;
  hasConfig: boolean;
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

/** An earlier version of a server, from the backups of its agent's config. */
export interface ServerVersion {
  /** The backup it comes from. */
  id: string;
  /** When AgentDeck replaced it. */
  replacedMs: number;
  /** `null` when the agent did not have the server then. */
  server: McpServer | null;
  /** The same as the server now. */
  current: boolean;
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

/** What starting a server showed. Never holds a secret value. */
export interface ProbeReport {
  ok: boolean;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  tools: { name: string; description: string | null }[];
  /** The server has no tools, only prompts or resources. */
  noTools: boolean;
  error: string | null;
  /** The server asks to sign in, which each agent does on its own. */
  needsSignIn: boolean;
  /** The end of what a local server wrote to stderr. */
  log: string;
  elapsedMs: number;
}

/** How protecting a server changes its command. No secret value is in it. */
export interface ProtectPreview {
  before: Transport;
  after: Transport;
  /** Variables that move to the keychain. */
  moved: string[];
  /** Variables that stay in the config. */
  kept: string[];
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

/** How many session log files are read so far. */
export interface ReadProgress {
  done: number;
  total: number;
}

export type SkillLocation = "claude-code" | "shared" | "codex" | "gemini" | "cursor";

export interface Skill {
  name: string;
  description: string | null;
  location: SkillLocation;
  path: string;
  readers: Agent[];
  /** Latest change of any file in the folder. */
  modifiedMs: number;
  /** Copies with the same hash are identical. */
  hash: string;
}

/** A file in a skill folder. */
export interface SkillFile {
  /** Inside the folder, with `/` between folders. */
  path: string;
  size: number;
}

/** A skill folder in `~/.agentdeck/trash`. */
export interface TrashedSkill {
  id: string;
  name: string;
  description: string | null;
  location: SkillLocation;
  removedMs: number;
}

export interface SkillListing {
  skills: Skill[];
  errors: string[];
  trash: TrashedSkill[];
}

export interface SecretRef {
  agent: Agent;
  server: string;
  kind: "env" | "header";
  key: string;
  vaultId: string | null;
  sameValueElsewhere: number;
  /** Looks like a credential, or was marked as one; the others are settings such as NODE_ENV. */
  likely: boolean;
  /** `likely` comes from how the user marked the name. */
  marked: boolean;
  protectable: boolean;
}

/** A protected server whose `agentdeck` launcher is missing, so it no longer starts. */
export interface Stranded {
  agent: Agent;
  server: string;
  launcher: string;
}

export interface SecretListing {
  secrets: SecretRef[];
  errors: string[];
  launcher: string | null;
  stranded: Stranded[];
}

/** Where an agent's files are, and whether a variable moved them. */
export interface AgentFolder {
  agent: Agent;
  path: string;
  variable: string | null;
  moved: boolean;
}

/** AgentDeck's own files, for the Settings page. */
export interface AppSettings {
  folders: AgentFolder[];
  launcher: string | null;
  backups: string;
  backupCount: number;
  backupsKept: number;
  trash: string;
  trashCount: number;
}
