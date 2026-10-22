import { useEffect, useRef, useState } from "react";
import { AgentMark, Icon, Notice, PageHeader } from "../components/ui";
import { useToast } from "../components/Toasts";
import { listRules, saveRules, undoChange } from "../lib/api";
import type { Agent, AgentInfo, Rules } from "../lib/types";

export function RulesPage({ agents }: { agents: AgentInfo[] }) {
  const [rules, setRules] = useState<Rules[]>([]);
  const [selected, setSelected] = useState<Agent>("claude-code");
  const [draft, setDraft] = useState("");
  const [pendingCopy, setPendingCopy] = useState<Agent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setLoadError(null);
    } catch (err) {
      setLoadError(String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  function select(agent: Agent) {
    if (dirty) {
      notify({ tone: "error", text: "Save or revert your changes first." });
      return;
    }
    setSelected(agent);
    setDraft(rules.find((r) => r.agent === agent)?.content ?? "");
    setPendingCopy(null);
  }

  async function write(agent: Agent, content: string, done: string) {
    try {
      const id = await saveRules(agent, content);
      notify({ tone: "success", text: done, undo: () => undo(id, agent, content) });
    } catch (err) {
      notify({ tone: "error", text: String(err) });
    }
    setPendingCopy(null);
    await load(agent !== selected);
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

  return (
    <>
      <PageHeader
        title="Rules"
        description="Global instructions each agent loads into every session. Write them once, then copy them to the other agents. Cursor keeps its user rules in its own settings, so AgentDeck cannot edit them yet."
      />
      {loadError && <Notice tone="error">{loadError}</Notice>}

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
        <button
          className="primary"
          disabled={!dirty}
          onClick={() => write(selected, draft, `Saved ${current?.name} rules.`)}
        >
          Save
        </button>
        {dirty && <button onClick={() => setDraft(saved)}>Revert</button>}

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
            return pendingCopy === info.agent ? (
              <button
                key={info.agent}
                className="danger"
                onClick={() => write(info.agent, saved, `Copied to ${info.name}.`)}
              >
                Overwrite {info.name}?
              </button>
            ) : (
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
    </>
  );
}
