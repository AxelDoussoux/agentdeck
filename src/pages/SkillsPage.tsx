import { useEffect, useState } from "react";
import type { Focus } from "../App";
import { AgentMark, Empty, Icon, Notice, PageHeader } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toasts";
import { copySkill, listSkills, readSkill, removeSkill, replaceSkill, restoreSkill } from "../lib/api";
import { useFilesChanged } from "../lib/watch";
import type { Agent, AgentInfo, Skill, SkillListing, SkillLocation, TrashedSkill } from "../lib/types";

const LOCATION_LABELS: Record<SkillLocation, string> = {
  "claude-code": "~/.claude/skills",
  shared: "~/.agents/skills",
  codex: "~/.codex/skills",
  gemini: "~/.gemini/skills",
  cursor: "~/.cursor/skills",
};

const formatDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The copy edited last, which a new copy starts from. */
const newest = (copies: Skill[]) => copies.reduce((a, b) => (b.modifiedMs > a.modifiedMs ? b : a));

/** `focus` names a skill to open, chosen in the command palette. */
export function SkillsPage({ agents, focus }: { agents: AgentInfo[]; focus?: Focus | null }) {
  const [listing, setListing] = useState<SkillListing>({ skills: [], errors: [], trash: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [previewed, setPreviewed] = useState<SkillLocation | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [pendingRemoval, setPendingRemoval] = useState<SkillLocation | null>(null);
  const [pendingSpread, setPendingSpread] = useState<SkillLocation | null>(null);
  const [pendingRestore, setPendingRestore] = useState<TrashedSkill | null>(null);
  const [showTrash, setShowTrash] = useState(false);
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

  // Opens the skill once the listing has it.
  const [focused, setFocused] = useState<Focus | null>(null);
  useEffect(() => {
    if (focus?.kind === "skill" && focus !== focused && listing.skills.some((s) => s.name === focus.name)) {
      setFocused(focus);
      open(focus.name);
    }
  }, [focus, listing]);

  // Every copy of each skill, grouped by folder name.
  const byName = new Map<string, Skill[]>();
  for (const skill of listing.skills) {
    byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  }
  const copies = selected ? (byName.get(selected) ?? []) : [];
  const differ = (found: Skill[]) => new Set(found.map((skill) => skill.hash)).size > 1;

  async function show(name: string, location: SkillLocation) {
    setPreviewed(location);
    setPreview(await readSkill(location, name).catch(String));
  }

  async function open(name: string) {
    setSelected(name);
    setPendingRemoval(null);
    const found = byName.get(name);
    if (found) await show(name, newest(found).location);
  }

  useFilesChanged("skills", async () => {
    await load();
    if (selected && previewed) setPreview(await readSkill(previewed, selected).catch(() => ""));
  });

  async function run(action: () => Promise<string>) {
    try {
      notify({ tone: "success", text: await action() });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    setPendingRemoval(null);
    setPendingSpread(null);
    setPendingRestore(null);
    await load();
  }

  async function restore(skill: TrashedSkill, overwrite = false) {
    const where = LOCATION_LABELS[skill.location];
    try {
      await restoreSkill(skill.id, overwrite);
      notify({ tone: "success", text: `Restored ${skill.name} to ${where}.` });
      setPendingRestore(null);
      await load();
    } catch (err) {
      // A skill of that name is there now: ask before swapping them.
      if (!overwrite && listing.skills.some((s) => s.name === skill.name && s.location === skill.location)) {
        setPendingRestore(skill);
      } else {
        notify({ tone: "error", text: String(err) });
      }
    }
  }

  const nameOf = (agent: Agent) => agents.find((a) => a.agent === agent)?.name ?? agent;

  return (
    <>
      <PageHeader
        title="Skills"
        description="Folders with a SKILL.md that agents load on demand. Codex, Gemini CLI and Cursor share ~/.agents/skills, and Cursor also reads the Claude Code and Codex folders, so one copy can reach several agents."
        actions={
          <button aria-pressed={showTrash} onClick={() => setShowTrash(!showTrash)}>
            Trash{listing.trash.length > 0 && ` (${listing.trash.length})`}
          </button>
        }
      />
      {listing.errors.map((text) => (
        <Notice key={text} tone="error">{text}</Notice>
      ))}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      {showTrash && (
        <section className="card">
          <header className="detail-header">
            <h3>Trash</h3>
            <span className="hint">Skills removed or replaced from AgentDeck, in ~/.agentdeck/trash</span>
          </header>
          {listing.trash.length === 0 ? (
            <p className="hint">The trash is empty.</p>
          ) : (
            <ul className="copies">
              {listing.trash.map((skill) => (
                <li key={skill.id}>
                  <div>
                    <strong>{skill.name}</strong>
                    <span className="hint">
                      From {LOCATION_LABELS[skill.location]} · removed {formatDate(skill.removedMs)}
                    </span>
                  </div>
                  <button className="small" onClick={() => restore(skill)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
              {[...byName].map(([name, found]) => {
                const source = newest(found);
                return (
                  <tr key={name} className={name === selected ? "selected" : undefined}>
                    <td className="server">
                      <button className="link" onClick={() => open(name)}>
                        <strong>{name}</strong>
                      </button>
                      {source.description && <small className="clamp">{source.description}</small>}
                      {differ(found) && (
                        <button className="link differ-note" onClick={() => open(name)}>
                          <Icon name="differs" size={12} /> Copies differ
                        </button>
                      )}
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
                            title={`Copies ${source.path}, the copy edited last`}
                            onClick={() =>
                              run(async () => {
                                await copySkill(name, source.location, agent);
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
                );
              })}
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
            {copies.map((skill) => {
              const others = copies.filter((other) => other.hash !== skill.hash);
              return (
                <li key={skill.location} className={skill.location === previewed ? "active" : undefined}>
                  <div>
                    <button className="link" title="Show this copy" onClick={() => show(skill.name, skill.location)}>
                      <code>{skill.path}</code>
                    </button>
                    <span className="hint">
                      Loaded by {skill.readers.map(nameOf).join(", ") || "no agent"} · edited{" "}
                      {formatDate(skill.modifiedMs)}
                      {copies.length > 1 && skill === newest(copies) && " · newest"}
                      {others.length > 0 && ` · differs from ${others.length === 1 ? "the other copy" : `${others.length} copies`}`}
                    </span>
                  </div>
                  <span className="copy-actions">
                    {others.length > 0 && (
                      <button className="small" onClick={() => setPendingSpread(skill.location)}>
                        Use everywhere
                      </button>
                    )}
                    <button className="small" onClick={() => setPendingRemoval(skill.location)}>Remove</button>
                  </span>
                </li>
              );
            })}
          </ul>
          <pre className="preview">{preview}</pre>
        </section>
      )}

      {pendingSpread &&
        copies
          .filter((skill) => skill.location === pendingSpread)
          .map((skill) => {
            const replaced = copies.filter((other) => other.hash !== skill.hash);
            return (
              <ConfirmDialog
                key={skill.location}
                title={`Use this copy of ${skill.name} everywhere?`}
                onCancel={() => setPendingSpread(null)}
                choices={[
                  {
                    label: `Replace ${replaced.length === 1 ? "1 copy" : `${replaced.length} copies`}`,
                    tone: "danger",
                    onSelect: () =>
                      run(async () => {
                        for (const other of replaced) await replaceSkill(skill.name, skill.location, other.location);
                        return replaced.length === 1
                          ? `Replaced 1 copy of ${skill.name}. The old one is in the trash.`
                          : `Replaced ${replaced.length} copies of ${skill.name}. The old ones are in the trash.`;
                      }),
                  },
                ]}
              >
                <p>
                  The copy in <code>{LOCATION_LABELS[skill.location]}</code> replaces the one in{" "}
                  {replaced.map((other, i) => (
                    <span key={other.location}>
                      {i > 0 && ", "}
                      <code>{LOCATION_LABELS[other.location]}</code>
                    </span>
                  ))}
                  . The replaced folders move to the trash, where you can restore them.
                </p>
              </ConfirmDialog>
            );
          })}

      {pendingRestore && (
        <ConfirmDialog
          title={`Replace the current ${pendingRestore.name}?`}
          onCancel={() => setPendingRestore(null)}
          choices={[
            {
              label: "Restore and replace",
              tone: "danger",
              onSelect: () => restore(pendingRestore, true),
            },
          ]}
        >
          <p>
            <code>{LOCATION_LABELS[pendingRestore.location]}</code> already has a skill named{" "}
            {pendingRestore.name}. It moves to the trash and the one removed on{" "}
            {formatDate(pendingRestore.removedMs)} takes its place.
          </p>
        </ConfirmDialog>
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
                      await removeSkill(skill.location, skill.name);
                      return `Moved ${skill.name} to the trash.`;
                    }),
                },
              ]}
            >
              <p>
                {skill.readers.length > 0
                  ? `${skill.readers.map(nameOf).join(", ")} will no longer load it from `
                  : "Removes "}
                <code>{skill.path}</code>. The folder moves to the trash, where you can restore it.
              </p>
            </ConfirmDialog>
          ))}
    </>
  );
}
