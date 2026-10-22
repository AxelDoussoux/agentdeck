import { useEffect, useState, type FormEvent } from "react";
import type { Focus } from "../App";
import { AgentMark, Empty, Icon, Notice, PageHeader } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DiffView } from "../components/DiffView";
import { Drawer } from "../components/Drawer";
import { Markdown } from "../components/Markdown";
import { useToast } from "../components/Toasts";
import {
  copySkill,
  createSkill,
  listSkills,
  openFolder,
  readSkill,
  removeSkill,
  replaceSkill,
  restoreSkill,
  skillFiles,
} from "../lib/api";
import { matches } from "../lib/search";
import { useFilesChanged } from "../lib/watch";
import type { Agent, AgentInfo, Skill, SkillFile, SkillListing, SkillLocation, TrashedSkill } from "../lib/types";

const LOCATION_LABELS: Record<SkillLocation, string> = {
  "claude-code": "~/.claude/skills",
  shared: "~/.agents/skills",
  codex: "~/.codex/skills",
  gemini: "~/.gemini/skills",
  cursor: "~/.cursor/skills",
};

/** Short names for the grid, where the full path is the cell's tooltip. */
const SHORT_LABELS: Record<SkillLocation, string> = {
  "claude-code": "Claude",
  shared: "shared",
  codex: "Codex",
  gemini: "Gemini",
  cursor: "Cursor",
};

/** The agents that load each folder, as the core lists them. */
const FOLDER_READERS: Record<SkillLocation, string> = {
  "claude-code": "Claude Code and Cursor",
  shared: "Codex, Gemini CLI and Cursor",
  codex: "Codex and Cursor",
  gemini: "Gemini CLI",
  cursor: "Cursor",
};

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const formatDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

type SkillTab = "details" | "differences" | "backups";

/** The copy edited last, which a new copy starts from. */
const newest = (copies: Skill[]) => copies.reduce((a, b) => (b.modifiedMs > a.modifiedMs ? b : a));

/** `focus` names a skill to open, chosen in the command palette. */
export function SkillsPage({ agents, focus }: { agents: AgentInfo[]; focus?: Focus | null }) {
  const [listing, setListing] = useState<SkillListing>({ skills: [], errors: [], trash: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<SkillTab>("details");
  const [previewed, setPreviewed] = useState<SkillLocation | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [files, setFiles] = useState<SkillFile[] | null>(null);
  const [source, setSource] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<SkillLocation | null>(null);
  const [pendingSpread, setPendingSpread] = useState<SkillLocation | null>(null);
  const [pendingRestore, setPendingRestore] = useState<TrashedSkill | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [query, setQuery] = useState("");
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
      // The skill may be filtered out of the grid.
      setQuery("");
      open(focus.name);
    }
  }, [focus, listing]);

  // Every copy of each skill, grouped by folder name.
  const byName = new Map<string, Skill[]>();
  for (const skill of listing.skills) {
    byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  }
  const shown = [...byName].filter(([name, found]) =>
    matches(query, [name, ...found.map((skill) => skill.description)]),
  );
  const copies = selected ? (byName.get(selected) ?? []) : [];
  const trashed = listing.trash.filter((skill) => skill.name === selected);
  const differ = (found: Skill[]) => new Set(found.map((skill) => skill.hash)).size > 1;

  async function show(name: string, location: SkillLocation) {
    setPreviewed(location);
    setFiles(null);
    setPreview(await readSkill(location, name).catch(String));
    setFiles(await skillFiles(location, name).catch(() => []));
  }

  async function open(name: string, opening: SkillTab = "details") {
    setSelected(name);
    setTab(opening);
    setPendingRemoval(null);
    const found = byName.get(name);
    if (found) await show(name, newest(found).location);
  }

  // Opens a skill created here once the listing has it.
  useEffect(() => {
    if (created && byName.has(created)) {
      setCreated(null);
      open(created);
    }
  }, [created, listing]);

  useFilesChanged("skills", async () => {
    await load();
    if (selected && previewed) {
      setPreview(await readSkill(previewed, selected).catch(() => ""));
      setFiles(await skillFiles(previewed, selected).catch(() => []));
    }
  });

  async function create(location: SkillLocation, name: string, description: string) {
    await createSkill(location, name, description);
    notify({ tone: "success", text: `Created ${name} in ${LOCATION_LABELS[location]}. Fill in its SKILL.md.` });
    setCreating(false);
    setCreated(name);
    await load();
  }

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
          <>
            {byName.size > 0 && (
              <input
                type="search"
                className="header-search"
                placeholder="Search skills"
                aria-label="Search skills by name or description"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            <button aria-pressed={showTrash} onClick={() => setShowTrash(!showTrash)}>
              Trash{listing.trash.length > 0 && ` (${listing.trash.length})`}
            </button>
            <button className="primary" onClick={() => setCreating(!creating)}>
              <Icon name="plus" /> New skill
            </button>
          </>
        }
      />
      {creating && (
        <NewSkillForm
          taken={(location, name) => listing.skills.some((s) => s.location === location && s.name === name)}
          onSubmit={create}
          onCancel={() => setCreating(false)}
        />
      )}
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
      ) : shown.length === 0 ? (
        <Empty icon="skills" title={`No skill matches “${query.trim()}”`}>
          Search looks at names and descriptions.{" "}
          <button className="link" onClick={() => setQuery("")}>
            Clear the search
          </button>
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
              {shown.map(([name, found]) => {
                const source = newest(found);
                return (
                  <tr key={name} className={name === selected ? "selected" : undefined}>
                    <td className="server">
                      <button className="link" onClick={() => open(name)}>
                        <strong>{name}</strong>
                      </button>
                      {source.description && <small className="clamp">{source.description}</small>}
                      {differ(found) && (
                        <button className="link differ-note" onClick={() => open(name, "differences")}>
                          <Icon name="differs" size={12} /> Copies differ
                        </button>
                      )}
                    </td>
                    {agents.map(({ agent }) => {
                      const via = found.find((skill) => skill.readers.includes(agent));
                      return via ? (
                        <td key={agent} className="agent-col" title={`Loaded from ${via.path}`}>
                          <span className="cell cell-on">
                            <Icon name={via.location === "shared" ? "share" : "folder"} size={14} />{" "}
                            {SHORT_LABELS[via.location]}
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
        <Drawer
          title={selected}
          subtitle={newest(copies).description ?? undefined}
          tabs={[
            { id: "details", label: "Details" },
            {
              id: "differences",
              label: "Differences",
              count: copies.filter((skill) => skill.hash !== newest(copies).hash).length,
            },
            { id: "backups", label: "Backups", count: trashed.length },
          ]}
          tab={tab}
          onTab={setTab}
          onClose={() => setSelected(null)}
        >
          {tab === "details" && (
            <>
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
                          {others.length > 0 &&
                            ` · differs from ${others.length === 1 ? "the other copy" : `${others.length} copies`}`}
                        </span>
                      </div>
                      <span className="copy-actions">
                        {others.length > 0 && (
                          <button className="small" onClick={() => setPendingSpread(skill.location)}>
                            Use everywhere
                          </button>
                        )}
                        <button className="small" onClick={() => setPendingRemoval(skill.location)}>
                          Remove
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="drawer-section">
                <header>
                  <strong>SKILL.md</strong>
                  <div className="segmented" role="group" aria-label="How to show SKILL.md">
                    <button aria-pressed={!source} className={source ? undefined : "active"} onClick={() => setSource(false)}>
                      Preview
                    </button>
                    <button aria-pressed={source} className={source ? "active" : undefined} onClick={() => setSource(true)}>
                      Source
                    </button>
                  </div>
                </header>
                {source ? <pre className="preview">{preview}</pre> : <Markdown text={preview} />}
              </div>
              {previewed && (
                <div className="drawer-section">
                  <header>
                    <strong>
                      Files{files && files.length > 0 && <span className="tab-count">{files.length}</span>}
                    </strong>
                    <button
                      className="small"
                      onClick={() =>
                        openFolder({ skill: { location: previewed, name: selected } }).catch((err) =>
                          notify({ tone: "error", text: String(err) }),
                        )
                      }
                    >
                      <Icon name="folder" size={14} /> Show in folder
                    </button>
                  </header>
                  {files === null ? (
                    <p className="hint">Reading the folder…</p>
                  ) : (
                    <ul className="skill-files">
                      {files.map((file) => (
                        <li key={file.path}>
                          <code>{file.path}</code>
                          <span className="hint">{formatSize(file.size)}</span>
                        </li>
                      ))}
                      {files.length >= 500 && <li className="hint">Only the first 500 files are listed.</li>}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          {tab === "differences" && <SkillDifferences copies={copies} />}

          {tab === "backups" &&
            (trashed.length === 0 ? (
              <p className="hint">
                No removed or replaced copy of {selected}. AgentDeck moves them to ~/.agentdeck/trash.
              </p>
            ) : (
              <ul className="copies">
                {trashed.map((skill) => (
                  <li key={skill.id}>
                    <div>
                      <strong>{LOCATION_LABELS[skill.location]}</strong>
                      <span className="hint">Removed {formatDate(skill.removedMs)}</span>
                    </div>
                    <button className="small" onClick={() => restore(skill)}>
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </Drawer>
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

interface NewSkillProps {
  taken: (location: SkillLocation, name: string) => boolean;
  onSubmit: (location: SkillLocation, name: string, description: string) => Promise<void>;
  onCancel: () => void;
}

/** Names a new skill and the folder it goes in; the core writes a SKILL.md to fill in. */
function NewSkillForm({ taken, onSubmit, onCancel }: NewSkillProps) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState<SkillLocation>("shared");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && name.length <= 64;
  const exists = name !== "" && taken(location, name);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await onSubmit(location, name, description);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>New skill</h3>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="fields">
        <label>
          Name
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="pdf-tools"
            aria-invalid={(name !== "" && !valid) || exists}
            aria-describedby="new-skill-name"
          />
          <small id="new-skill-name" className={(name !== "" && !valid) || exists ? "danger-text" : "hint"}>
            {exists
              ? `${LOCATION_LABELS[location]} already has a skill named ${name}.`
              : "Lowercase letters, digits and single hyphens. It names the folder."}
          </small>
        </label>
        <label>
          Folder
          <select value={location} onChange={(e) => setLocation(e.target.value as SkillLocation)}>
            {(Object.keys(LOCATION_LABELS) as SkillLocation[]).map((option) => (
              <option key={option} value={option}>
                {LOCATION_LABELS[option]}
              </option>
            ))}
          </select>
          <small className="hint">Loaded by {FOLDER_READERS[location]}</small>
        </label>
      </div>
      <label>
        Description
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What the skill does, and when the agent should use it"
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={!valid || exists}>
          Create
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The SKILL.md of each copy that differs from the newest one, against it. */
function SkillDifferences({ copies }: { copies: Skill[] }) {
  const base = newest(copies);
  const others = copies.filter((skill) => skill.hash !== base.hash);
  const [compared, setCompared] = useState<SkillLocation | null>(others[0]?.location ?? null);
  const [texts, setTexts] = useState<Partial<Record<SkillLocation, string>>>({});

  useEffect(() => {
    let current = true;
    Promise.all(
      copies.map((skill) =>
        readSkill(skill.location, skill.name)
          .catch(String)
          .then((text) => [skill.location, text] as const),
      ),
    ).then((found) => current && setTexts(Object.fromEntries(found)));
    return () => {
      current = false;
    };
  }, [copies.map((skill) => `${skill.location}:${skill.hash}`).join()]);

  if (others.length === 0) return <p className="hint">Every copy of {base.name} is the same.</p>;
  const other = others.find((skill) => skill.location === compared) ?? others[0];
  const [before, after] = [texts[other.location], texts[base.location]];

  return (
    <>
      {others.length > 1 && (
        <div className="segmented" role="group" aria-label="Copy to compare">
          {others.map((skill) => (
            <button
              key={skill.location}
              aria-pressed={skill === other}
              className={skill === other ? "active" : undefined}
              onClick={() => setCompared(skill.location)}
            >
              {LOCATION_LABELS[skill.location]}
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        What changes in SKILL.md from <code>{LOCATION_LABELS[other.location]}</code> to the newest copy, in{" "}
        <code>{LOCATION_LABELS[base.location]}</code>.
      </p>
      {before === undefined || after === undefined ? (
        <p className="hint">Reading the copies…</p>
      ) : before === after ? (
        <p className="hint">SKILL.md is the same: other files in the folders differ.</p>
      ) : (
        <DiffView before={before} after={after} />
      )}
    </>
  );
}
