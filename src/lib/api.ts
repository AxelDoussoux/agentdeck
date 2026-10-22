import { invoke } from "@tauri-apps/api/core";
import type {
  Agent,
  AgentInfo,
  McpListing,
  Rules,
  SecretListing,
  ServerEdit,
  ServerSpec,
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

/** Opens an agent's MCP config in the default editor, or shows it in its folder. */
export const openConfig = (agent: Agent, reveal = false) => invoke<void>("open_config", { agent, reveal });

export const listSecrets = () => invoke<SecretListing>("list_secrets");

export const protectServer = (agent: Agent, server: string) =>
  invoke<number>("protect_server", { agent, server });

export const unprotectServer = (agent: Agent, server: string) =>
  invoke<number>("unprotect_server", { agent, server });

/** Points protected servers whose launcher is missing at the current one. Returns how many. */
export const repairLaunchers = () => invoke<number>("repair_launchers");

/** Reverts the change that returned `id`. Each change can be undone once. */
export const undoChange = (id: number) => invoke<void>("undo_change", { id });
