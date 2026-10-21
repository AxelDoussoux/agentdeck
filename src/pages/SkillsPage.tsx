import { useEffect, useState } from "react";
import { copySkill, listSkills, readSkill, removeSkill } from "../lib/api";
import type { Agent, AgentInfo, Skill, SkillListing, SkillLocation } from "../lib/types";

const LOCATION_LABELS: Record<SkillLocation, string> = {
  "claude-code": "~/.claude/skills",
  shared: "~/.agents/skills (shared)",
  codex: "~/.codex/skills",
  gemini: "~/.gemini/skills",
  cursor: "~/.cursor/skills",
};

export function SkillsPage({ agents }: { agents: AgentInfo[] }) {
  const [listing, setListing] = useState<SkillListing>({ skills: [], errors: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [pendingRemoval, setPendingRemoval] = useState<SkillLocation | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function load() {
    try {
      setListing(await listSkills());
    } catch (err) {
      setMessage({ error: true, text: String(err) });
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
    setMessage(null);
    const [first] = byName.get(name) ?? [];
    setPreview(first ? await readSkill(first.location, name).catch(String) : "");
  }

  async function run(action: () => Promise<string>) {
    try {
      setMessage({ error: false, text: await action() });
    } catch (err) {
      setMessage({ error: true, text: String(err) });
    }
    setPendingRemoval(null);
    await load();
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;

  return (
    <>
      <h2>Skills</h2>
      <p className="hint">
        Folders with a SKILL.md that agents load on demand. Codex, Gemini CLI and Cursor share
        ~/.agents/skills, and Cursor also reads the Claude Code and Codex folders, so one copy can
        reach several agents.
      </p>
      {listing.errors.map((text) => (
        <p key={text} className="error">{text}</p>
      ))}

      {byName.size === 0 ? (
        <p className="empty">No skill installed yet.</p>
      ) : (
        <table className="matrix">
          <thead>
            <tr>
              <th>Skill</th>
              {agents.map((info) => (
                <th key={info.agent}>{info.name}</th>
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
                  {found[0].description && <small>{found[0].description}</small>}
                </td>
                {agents.map(({ agent }) => {
                  const via = found.find((skill) => skill.readers.includes(agent));
                  return via ? (
                    <td key={agent} className="present" title={`Loaded from ${via.path}`}>
                      ✓ <small>{LOCATION_LABELS[via.location]}</small>
                    </td>
                  ) : (
                    <td key={agent}>
                      <button
                        className="ghost"
                        onClick={() =>
                          run(async () => {
                            await copySkill(name, found[0].location, agent);
                            return `Copied "${name}" for ${nameOf(agent)}.`;
                          })
                        }
                      >
                        + Add here
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {message && <p className={message.error ? "error" : "success"}>{message.text}</p>}

      {selected && (
        <section className="detail">
          <h3>{selected}</h3>
          <ul className="copies">
            {copies.map((skill) => (
              <li key={skill.location}>
                <code>{skill.path}</code>
                <span className="hint">
                  Loaded by {skill.readers.map(nameOf).join(", ")}
                </span>
                {pendingRemoval === skill.location ? (
                  <button
                    className="danger"
                    onClick={() =>
                      run(async () => {
                        const trashed = await removeSkill(skill.location, skill.name);
                        return `Moved to ${trashed}.`;
                      })
                    }
                  >
                    Move to trash?
                  </button>
                ) : (
                  <button onClick={() => setPendingRemoval(skill.location)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
          <pre className="preview">{preview}</pre>
        </section>
      )}
    </>
  );
}
