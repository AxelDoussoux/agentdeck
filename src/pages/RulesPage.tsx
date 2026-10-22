import { useEffect, useRef, useState } from "react";
import type { UnsavedGuard } from "../App";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DiffView } from "../components/DiffView";
import { AgentMark, Icon, Notice, PageHeader } from "../components/ui";
import { useToast } from "../components/Toasts";
import { listRules, saveRules, undoChange } from "../lib/api";
import { lineCount } from "../lib/diff";
import { useFilesChanged } from "../lib/watch";
import type { Agent, AgentInfo, Rules } from "../lib/types";

const SAVE_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘S" : "Ctrl+S";

interface Props {
  agents: AgentInfo[];
  /** Tells the app there are unsaved changes, so leaving the page asks first. */
  setGuard: (guard: UnsavedGuard | null) => void;
}

export function RulesPage({ agents, setGuard }: Props) {
  const [rules, setRules] = useState<Rules[]>([]);
  const [selected, setSelected] = useState<Agent>("claude-code");
  const [draft, setDraft] = useState("");
  const [pendingCopy, setPendingCopy] = useState<Agent | null>(null);
  const [pendingSelect, setPendingSelect] = useState<Agent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The selected file's content on disk, when it changed while being edited.
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const notify = useToast();

  const saved = rules.find((r) => r.agent === selected)?.content ?? "";
  const dirty = draft !== saved;
  const withFile = agents.filter((info) => info.rulesPath !== null);
  const current = agents.find((info) => info.agent === selected);
  // Read by Undo, which can run after the user has moved on.
  const latest = useRef({ selected, draft });
  latest.current = { selected, draft };

  async function load(keepDraft = false) {
    try {
      const all = await listRules();
      setRules(all);
      if (!keepDraft) setDraft(all.find((r) => r.agent === selected)?.content ?? "");
      setOnDisk(null);
      setLoadError(null);
    } catch (err) {
      setLoadError(String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  // A change on disk shows up at once, unless it would overwrite edits: then
  // the editor keeps them and says the file moved on.
  useFilesChanged("rules", async () => {
    if (!dirty) return load();
    const all = await listRules().catch(() => null);
    const disk = all?.find((r) => r.agent === selected)?.content ?? "";
    if (!all) return;
    setRules(all.map((r) => (r.agent === selected ? { ...r, content: saved } : r)));
    setOnDisk(disk === saved ? null : disk);
  });

  function select(agent: Agent, force = false) {
    if (agent === selected) return;
    if (dirty && !force) {
      setPendingSelect(agent);
      return;
    }
    setPendingSelect(null);
    setSelected(agent);
    setDraft(rules.find((r) => r.agent === agent)?.content ?? "");
    setOnDisk(null);
    setPendingCopy(null);
  }

  async function write(agent: Agent, content: string, done: string): Promise<boolean> {
    let ok = true;
    try {
      const id = await saveRules(agent, content);
      notify({ tone: "success", text: done, undo: () => undo(id, agent, content) });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
      ok = false;
    }
    setPendingCopy(null);
    await load(agent !== selected || !ok);
    return ok;
  }

  async function undo(id: number, agent: Agent, written: string) {
    await undoChange(id);
    const all = await listRules();
    setRules(all);
    // Show the restored rules, unless the editor holds newer edits.
    const { selected, draft } = latest.current;
    if (agent === selected && draft === written) {
      setDraft(all.find((r) => r.agent === agent)?.content ?? "");
    }
  }

  const save = () => write(selected, draft, `Saved ${current?.name} rules.`);

  useEffect(() => {
    setGuard(dirty ? { what: `${current?.name} rules`, save } : null);
  });
  useEffect(() => () => setGuard(null), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function copyDialog(pending: Agent) {
    const target = agents.find((info) => info.agent === pending)!;
    const replaced = rules.find((r) => r.agent === target.agent)?.content ?? "";
    const lines = (text: string) => `${lineCount(text)} line${lineCount(text) === 1 ? "" : "s"}`;
    return (
      <ConfirmDialog
        wide
        title={`Replace ${target.name} rules?`}
        onCancel={() => setPendingCopy(null)}
        choices={[
          {
            label: `Replace ${target.name} rules`,
            tone: "danger",
            onSelect: () => write(target.agent, saved, `Copied ${current?.name} rules to ${target.name}.`),
          },
        ]}
      >
        <p>
          {replaced
            ? `The ${lines(replaced)} of ${target.name}'s rules are replaced with the ${lines(saved)} of ${current?.name}'s.`
            : `${target.name} has no rules yet. It gets the ${lines(saved)} of ${current?.name}'s.`}
        </p>
        {replaced && <DiffView before={replaced} after={saved} />}
      </ConfirmDialog>
    );
  }

  return (
    <>
      <PageHeader
        title="Rules"
        description="Global instructions each agent loads into every session. Write them once, then copy them to the other agents. Cursor keeps its user rules in its own settings, so AgentDeck cannot edit them yet."
      />
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {onDisk !== null && dirty && (
        <Notice tone="warning">
          <div className="notice-row">
            <span>
              {current?.name}'s rules changed on disk while you were editing. Saving replaces that
              version.
            </span>
            <button className="small" onClick={() => load()}>
              Discard my edits and reload
            </button>
          </div>
        </Notice>
      )}

      <div className="tabs" role="tablist">
        {withFile.map((info) => (
          <button
            key={info.agent}
            role="tab"
            aria-selected={info.agent === selected}
            className={info.agent === selected ? "active" : undefined}
            onClick={() => select(info.agent)}
          >
            <AgentMark agent={info.agent} size={18} />
            {info.name}
          </button>
        ))}
      </div>

      <div className="editor-card">
        <div className="editor-bar">
          {current?.rulesPath && <code>{current.rulesPath}</code>}
          {dirty && <span className="pill pill-warn">Unsaved changes</span>}
        </div>
        <textarea
          className="editor"
          spellCheck={false}
          value={draft}
          placeholder="No rules yet. Write Markdown here."
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>

      <div className="toolbar">
        <button className="primary" disabled={!dirty} onClick={save} title={`Save (${SAVE_SHORTCUT})`}>
          Save <kbd>{SAVE_SHORTCUT}</kbd>
        </button>
        {dirty && <button onClick={() => (onDisk === null ? setDraft(saved) : load())}>Revert</button>}

        <span className="spacer" />
        <span className="hint">Copy to</span>
        {withFile
          .filter((info) => info.agent !== selected)
          .map((info) => {
            const same = (rules.find((r) => r.agent === info.agent)?.content ?? "") === saved;
            if (same) {
              return (
                <button key={info.agent} disabled title="Already identical">
                  <Icon name="check" size={14} /> {info.name}
                </button>
              );
            }
            return (
              <button
                key={info.agent}
                disabled={dirty}
                title={dirty ? "Save first" : `Replace ${info.name} rules with these`}
                onClick={() => setPendingCopy(info.agent)}
              >
                {info.name}
              </button>
            );
          })}
      </div>

      {pendingCopy && copyDialog(pendingCopy)}

      {pendingSelect && (
        <ConfirmDialog
          title="Unsaved changes"
          onCancel={() => setPendingSelect(null)}
          choices={[
            { label: "Discard", tone: "danger", onSelect: () => select(pendingSelect, true) },
            {
              label: "Save",
              tone: "primary",
              onSelect: async () => {
                if (await save()) select(pendingSelect, true);
                else setPendingSelect(null);
              },
            },
          ]}
        >
          Your changes to the {current?.name} rules are not saved.
        </ConfirmDialog>
      )}
    </>
  );
}
