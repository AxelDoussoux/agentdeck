import { invoke } from "@tauri-apps/api/core";
import type { Agent, AgentInfo, McpListing, Rules, ServerSpec, UsageReport } from "./types";

// Typed wrappers around the commands of src-tauri/src/lib.rs.

export const listAgents = () => invoke<AgentInfo[]>("list_agents");

export const listMcpServers = () => invoke<McpListing>("list_mcp_servers");

export const addMcpServer = (agent: Agent, name: string, spec: ServerSpec) =>
  invoke<void>("add_mcp_server", { agent, name, spec });

export const removeMcpServer = (agent: Agent, name: string) =>
  invoke<void>("remove_mcp_server", { agent, name });

export const copyMcpServer = (name: string, from: Agent, to: Agent) =>
  invoke<void>("copy_mcp_server", { name, from, to });

export const listRules = () => invoke<Rules[]>("list_rules");

export const saveRules = (agent: Agent, content: string) =>
  invoke<void>("save_rules", { agent, content });

export const usageReport = () => invoke<UsageReport>("usage_report");
