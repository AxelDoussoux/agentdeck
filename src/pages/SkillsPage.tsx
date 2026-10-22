import { useEffect, useState } from "react";
import { AgentMark, Empty, Icon, Notice, PageHeader } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toasts";
import { copySkill, listSkills, readSkill, removeSkill } from "../lib/api";
import type { Agent, AgentInfo, Skill, SkillListing, SkillLocation } from "../lib/types";

const LOCATION_LABELS: Record<SkillLocation, string> = {
  "claude-code": "~/.claude/skills",
  shared: "~/.agents/skills",
  codex: "~/.codex/skills",
  gemini: "~/.gemini/skills",
  cursor: "~/.cursor/skills",
};

export function SkillsPage({ agents }: { agents: AgentInfo[] }) {
  const [listing, setListing] = useState<SkillListing>({ skills: [], errors: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [pendingRemoval, setPendingRemoval] = useState<SkillLocation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const notify = useToast();

  async function load() {
    try {
      setListing(await listSkills());
      setLoadError(null);
    } catch (err) {
      setLoadError(String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Every copy of each skill, grouped by folder name.
  const byName = new Map<string, Skill[]>();
  for (const skill of listing.skills) {
    byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  }
  const copies = selected ? (byName.get(selected) ?? []) : [];

  async function open(name: string) {
    setSelected(name);
    setPendingRemoval(null);
    const [first] = byName.get(name) ?? [];
    setPreview(first ? await readSkill(first.location, name).catch(String) : "");
  }

  async function run(action: () => Promise<string>) {
    try {
      notify({ tone: "success", text: await action() });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    setPendingRemoval(null);
    await load();
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;

  return (
    <>
      <PageHeader
        title="Skills"
        description="Folders with a SKILL.md that agents load on demand. Codex, Gemini CLI and Cursor share ~/.agents/skills, and Cursor also reads the Claude Code and Codex folders, so one copy can reach several agents."
      />
      {listing.errors.map((text) => (
        <Notice key={text} tone="error">{text}</Notice>
      ))}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      {byName.size === 0 ? (
        <Empty icon="skills" title="No skill installed yet">
          Skills you add to any agent's skills folder show up here.
        </Empty>
      ) : (
        <div className="table-card">
          <table className="matrix">
            <thead>
              <tr>
                <th>Skill</th>
                {agents.map((info) => (
                  <th key={info.agent} className="agent-col">
                    <span className="th-agent">
                      <AgentMark agent={info.agent} size={20} />
                      {info.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...byName].map(([name, found]) => (
                <tr key={name} className={name === selected ? "selected" : undefined}>
                  <td className="server">
                    <button className="link" onClick={() => open(name)}>
                      <strong>{name}</strong>
                    </button>
                    {found[0].description && <small className="clamp">{found[0].description}</small>}
                  </td>
                  {agents.map(({ agent }) => {
                    const via = found.find((skill) => skill.readers.includes(agent));
                    return via ? (
                      <td key={agent} className="agent-col" title={`Loaded from ${via.path}`}>
                        <span className="cell cell-on">
                          <Icon name="check" size={14} /> {LOCATION_LABELS[via.location]}
                        </span>
                      </td>
                    ) : (
                      <td key={agent} className="agent-col">
                        <button
                          className="cell cell-add"
                          onClick={() =>
                            run(async () => {
                              await copySkill(name, found[0].location, agent);
                              return `Copied "${name}" for ${nameOf(agent)}.`;
                            })
                          }
                        >
                          <Icon name="plus" size={14} /> Add
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && copies.length > 0 && (
        <section className="card detail">
          <header className="detail-header">
            <h3>{selected}</h3>
            <button className="small" onClick={() => setSelected(null)}>Close</button>
          </header>
          <ul className="copies">
            {copies.map((skill) => (
              <li key={skill.location}>
                <div>
                  <code>{skill.path}</code>
                  <span className="hint">Loaded by {skill.readers.map(nameOf).join(", ")}</span>
                </div>
                <button className="small" onClick={() => setPendingRemoval(skill.location)}>Remove</button>
              </li>
            ))}
          </ul>
          <pre className="preview">{preview}</pre>
        </section>
      )}

      {pendingRemoval &&
        copies
          .filter((skill) => skill.location === pendingRemoval)
          .map((skill) => (
            <ConfirmDialog
              key={skill.location}
              title={`Remove ${skill.name}?`}
              onCancel={() => setPendingRemoval(null)}
              choices={[
                {
                  label: "Move to trash",
                  tone: "danger",
                  onSelect: () =>
                    run(async () => {
                      const trashed = await removeSkill(skill.location, skill.name);
                      return `Moved ${skill.name} to ${trashed}.`;
                    }),
                },
              ]}
            >
              <p>
                {skill.readers.length > 0
                  ? `${skill.readers.map(nameOf).join(", ")} will no longer load it from `
                  : "Removes "}
                <code>{skill.path}</code>. The folder moves to <code>~/.agentdeck/trash</code>, so you
                can put it back by hand.
              </p>
            </ConfirmDialog>
          ))}
    </>
  );
}
