import { invoke } from "@tauri-apps/api/core";
import type {
  Agent,
  AgentInfo,
  AppSettings,
  McpListing,
  Rules,
  SecretListing,
  ServerEdit,
  ServerSpec,
  ServerVersion,
  SkillListing,
  SkillLocation,
  UsageReport,
} from "./types";

// Typed wrappers around the commands of src-tauri/src/lib.rs. Commands that
// change a config return an id to pass to `undoChange`.

export const listAgents = () => invoke<AgentInfo[]>("list_agents");

export const listMcpServers = () => invoke<McpListing>("list_mcp_servers");

export const addMcpServer = (agent: Agent, name: string, spec: ServerSpec) =>
  invoke<number>("add_mcp_server", { agent, name, spec });

/** Changes a server. A `null` value keeps that variable's current value. */
export const editMcpServer = (agent: Agent, name: string, edit: ServerEdit) =>
  invoke<number>("edit_mcp_server", { agent, name, edit });

export const removeMcpServer = (agent: Agent, name: string) =>
  invoke<number>("remove_mcp_server", { agent, name });

/**
 * With `overwrite`, replaces the server in `to` if it already has one.
 * Returns the undo id and the settings `to` could not take.
 */
export const copyMcpServer = (name: string, from: Agent, to: Agent, overwrite = false) =>
  invoke<{ undo: number; lost: string[] }>("copy_mcp_server", { name, from, to, overwrite });

/** Earlier versions of a server in `agent`, most recent first. */
export const serverVersions = (agent: Agent, name: string) =>
  invoke<ServerVersion[]>("server_versions", { agent, name });

/** Puts a server back as it was in a version from `serverVersions`. */
export const restoreServerVersion = (agent: Agent, name: string, id: string) =>
  invoke<number>("restore_server_version", { agent, name, id });

export const listRules = () => invoke<Rules[]>("list_rules");

export const saveRules = (agent: Agent, content: string) =>
  invoke<number>("save_rules", { agent, content });

export const usageReport = () => invoke<UsageReport>("usage_report");

export const listSkills = () => invoke<SkillListing>("list_skills");

export const readSkill = (location: SkillLocation, name: string) =>
  invoke<string>("read_skill", { location, name });

export const copySkill = (name: string, from: SkillLocation, to: Agent) =>
  invoke<void>("copy_skill", { name, from, to });

/** Returns where the skill folder was moved. */
export const removeSkill = (location: SkillLocation, name: string) =>
  invoke<string>("remove_skill", { location, name });

/** Replaces the copy in `to` with the one in `from`; the old one goes to the trash. */
export const replaceSkill = (name: string, from: SkillLocation, to: SkillLocation) =>
  invoke<void>("replace_skill", { name, from, to });

/** Puts a skill back from the trash, and returns where. */
export const restoreSkill = (id: string, overwrite = false) =>
  invoke<SkillLocation>("restore_skill", { id, overwrite });

/** Opens an agent's MCP config in the default editor, or shows it in its folder. */
export const openConfig = (agent: Agent, reveal = false) => invoke<void>("open_config", { agent, reveal });

export const listSecrets = () => invoke<SecretListing>("list_secrets");

export const protectServer = (agent: Agent, server: string) =>
  invoke<number>("protect_server", { agent, server });

export const unprotectServer = (agent: Agent, server: string) =>
  invoke<number>("unprotect_server", { agent, server });

/** Points protected servers whose launcher is missing at the current one. Returns how many. */
/** Marks a variable name as a secret, a setting, or (`null`) lets AgentDeck judge it. */
export const markSecretName = (name: string, secret: boolean | null) =>
  invoke<void>("mark_secret_name", { name, secret });

export const repairLaunchers = () => invoke<number>("repair_launchers");

/** Reverts the change that returned `id`. Each change can be undone once. */
export const undoChange = (id: number) => invoke<void>("undo_change", { id });

export const appSettings = () => invoke<AppSettings>("app_settings");

/** Shows one of AgentDeck's folders, or an agent's, in the file manager. */
export const openFolder = (folder: "backups" | "trash" | { agent: Agent }) => invoke<void>("open_folder", { folder });

export const emptySkillTrash = () => invoke<number>("empty_skill_trash");
