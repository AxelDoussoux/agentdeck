import type { AgentInfo } from "../lib/types";

export function AgentsPage({ agents }: { agents: AgentInfo[] }) {
  return (
    <>
      <h2>Agents</h2>
      <ul className="agents">
        {agents.map((info) => (
          <li key={info.agent} className={info.installed ? "found" : "missing"}>
            <strong>{info.name}</strong>
            <span>{info.installed ? "Found" : "Not found"}</span>
            <code>{info.mcpConfigPath}</code>
          </li>
        ))}
      </ul>
    </>
  );
}
