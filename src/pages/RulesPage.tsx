import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Focus, UnsavedGuard } from "../App";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DiffView } from "../components/DiffView";
import { Markdown } from "../components/Markdown";
import { AgentMark, Icon, Notice, PageHeader, Tabs } from "../components/ui";
import { useToast } from "../components/Toasts";
import { Tooltip } from "../components/Tooltip";
import { listRules, saveRules, undoChange } from "../lib/api";
import { lineCount } from "../lib/diff";
import { SHARED_END, SHARED_START, sharedPart, startShared, withShared } from "../lib/rules";
import { shortcut, withModifier } from "../lib/keys";
import { useFilesChanged } from "../lib/watch";
import type { Agent, AgentInfo, Rules } from "../lib/types";
import { errorText, t } from "../lib/i18n";

// CodeMirror is most of the app's code, so it loads with the Rules page.
const MarkdownEditor = lazy(() => import("../components/MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));

const SAVE_SHORTCUT = shortcut("S");
const PREVIEW_KEY = "agentdeck.rules.preview";

/** Whether the preview was left open, if this browser storage can tell. */
function previewWasOpen(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

interface Props {
  agents: AgentInfo[];
  /** Tells the app there are unsaved changes, so leaving the page asks first. */
  setGuard: (guard: UnsavedGuard | null) => void;
  /** The agent whose rules to show, chosen in the command palette. */
  focus?: Focus | null;
}

export function RulesPage({ agents, setGuard, focus }: Props) {
  const [rules, setRules] = useState<Rules[]>([]);
  const [selected, setSelected] = useState<Agent>(focus?.kind === "rules" ? focus.agent : "claude-code");
  const [draft, setDraft] = useState("");
  const [pendingCopy, setPendingCopy] = useState<Agent | null>(null);
  const [pendingSelect, setPendingSelect] = useState<Agent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The selected file's content on disk, when it changed while being edited.
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const [preview, setPreview] = useState(previewWasOpen);
  const notify = useToast();

  function togglePreview() {
    setPreview(!preview);
    try {
      localStorage.setItem(PREVIEW_KEY, preview ? "0" : "1");
    } catch {
      // The choice is only kept for this session.
    }
  }

  const contentOf = (agent: Agent) => rules.find((r) => r.agent === agent)?.content ?? "";
  const saved = contentOf(selected);
  // The shared base of the saved rules, which copies carry when it exists.
  const base = sharedPart(saved);
  const draftHasBase = sharedPart(draft) !== null;
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
      setLoadError(errorText(err));
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

  useEffect(() => {
    if (focus?.kind === "rules") select(focus.agent);
  }, [focus]);

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
      notify({ tone: "error", text: errorText(err) });
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

  const save = () => write(selected, draft, t.rules.saved(current?.name ?? ""));

  useEffect(() => {
    setGuard(dirty ? { what: t.rules.what(current?.name ?? ""), save } : null);
  });
  useEffect(() => () => setGuard(null), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (withModifier(event) && event.key.toLowerCase() === "s") {
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
    const lines = (text: string) => t.rules.lines(lineCount(text));
    const [from, to] = [current?.name ?? "", target.name];
    if (base !== null) {
      const merged = withShared(replaced, base);
      return (
        <ConfirmDialog
          wide
          title={t.rules.copyBaseTitle(to)}
          onCancel={() => setPendingCopy(null)}
          choices={[
            {
              label: t.rules.replaceEverything,
              tone: "danger",
              onSelect: () => write(target.agent, saved, t.rules.copied(from, to)),
            },
            {
              label: t.rules.copyBase,
              tone: "primary",
              onSelect: () => write(target.agent, merged, t.rules.copiedBase(from, to)),
            },
          ]}
        >
          <p>
            {sharedPart(replaced) !== null ? t.rules.baseReplaced(to, from) : t.rules.baseAdded(to, from)}{" "}
            {t.rules.orReplaceAll(to, lines(saved), from)}
          </p>
          {merged !== replaced && <DiffView before={replaced} after={merged} />}
        </ConfirmDialog>
      );
    }
    return (
      <ConfirmDialog
        wide
        title={t.rules.replaceTitle(to)}
        onCancel={() => setPendingCopy(null)}
        choices={[
          {
            label: t.rules.replace(to),
            tone: "danger",
            onSelect: () => write(target.agent, saved, t.rules.copied(from, to)),
          },
        ]}
      >
        <p>
          {replaced ? t.rules.replacedWith(lines(replaced), to, lines(saved), from) : t.rules.getsRules(to, lines(saved), from)}
        </p>
        {replaced && <DiffView before={replaced} after={saved} />}
      </ConfirmDialog>
    );
  }

  return (
    <>
      <PageHeader
        title={t.rules.title}
        description={t.rules.description}
      />
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {onDisk !== null && dirty && (
        <Notice tone="warning">
          <div className="notice-row">
            <span>{t.rules.changedOnDisk(current?.name ?? "")}</span>
            <button className="small" onClick={() => load()}>
              {t.rules.reload}
            </button>
          </div>
        </Notice>
      )}

      <Tabs
        label={t.rules.agents}
        idPrefix="rules-tab"
        panel="rules-panel"
        tab={selected}
        onTab={(agent) => select(agent)}
        tabs={withFile.map((info) => ({
          id: info.agent,
          label: (
            <>
              <AgentMark agent={info.agent} size={18} />
              {info.name}
              {info.agent !== selected && (
                <SameBadge theirs={contentOf(info.agent)} ours={saved} base={base} name={current?.name} />
              )}
            </>
          ),
        }))}
      />

      <div className="editor-card" id="rules-panel" role="tabpanel" aria-labelledby={`rules-tab-${selected}`}>
        <div className="editor-bar">
          {current?.rulesPath && <code>{current.rulesPath}</code>}
          <span className="editor-bar-actions">
            {dirty && <span className="pill pill-warn">{t.common.unsaved}</span>}
            {!draftHasBase && (
              <Tooltip text={t.rules.makeBaseTip}>
                <button className="small" onClick={() => setDraft(startShared(draft))}>
                  {t.rules.makeBase}
                </button>
              </Tooltip>
            )}
            <button className="small" aria-pressed={preview} onClick={togglePreview}>
              {preview ? t.rules.hidePreview : t.skills.preview}
            </button>
          </span>
        </div>
        <div className={preview ? "rules-split" : "rules-single"}>
          <Suspense fallback={<div className="markdown-editor" />}>
            <MarkdownEditor
              docKey={selected}
              value={draft}
              onChange={setDraft}
              label={t.rules.what(current?.name ?? "")}
              placeholder={t.rules.placeholder}
            />
          </Suspense>
          {preview && (
            <div className="rules-preview" aria-label={t.skills.preview}>
              {draft.trim() ? <Markdown text={draft} /> : <p className="hint">{t.rules.nothingToPreview}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="toolbar">
        <Tooltip text={`${t.common.save} (${SAVE_SHORTCUT})`}>
          <button className="primary" disabled={!dirty} onClick={save}>
            {t.common.save} <kbd>{SAVE_SHORTCUT}</kbd>
          </button>
        </Tooltip>
        {dirty && <button onClick={() => (onDisk === null ? setDraft(saved) : load())}>{t.rules.revert}</button>}

        <span className="spacer" />
        <span className="hint">{base !== null ? t.rules.copyBaseTo : t.rules.copyTo}</span>
        {withFile
          .filter((info) => info.agent !== selected)
          .map((info) => {
            const theirs = contentOf(info.agent);
            const same = base !== null ? sharedPart(theirs) === base : theirs === saved;
            if (same) {
              return (
                <button key={info.agent} disabled title={base !== null ? t.rules.sameBase : t.rules.identical}>
                  <Icon name="check" size={14} /> {info.name}
                </button>
              );
            }
            return (
              <Tooltip
                key={info.agent}
                text={base !== null ? t.rules.putBase(info.name) : t.rules.replaceWithThese(info.name)}
              >
                {/* A disabled button gets no mouse events, so its reason stays a title. */}
                <button disabled={dirty} title={dirty ? t.rules.saveFirst : undefined} onClick={() => setPendingCopy(info.agent)}>
                  {info.name}
                </button>
              </Tooltip>
            );
          })}
      </div>

      {draftHasBase && (
        <p className="hint shared-hint">{t.rules.sharedHint(<code>{SHARED_START}</code>, <code>{SHARED_END}</code>)}</p>
      )}

      {pendingCopy && copyDialog(pendingCopy)}

      {pendingSelect && (
        <ConfirmDialog
          title={t.common.unsaved}
          onCancel={() => setPendingSelect(null)}
          choices={[
            { label: t.common.discard, tone: "danger", onSelect: () => select(pendingSelect, true) },
            {
              label: t.common.save,
              tone: "primary",
              onSelect: async () => {
                if (await save()) select(pendingSelect, true);
                else setPendingSelect(null);
              },
            },
          ]}
        >
          {t.common.notSaved(t.rules.what(current?.name ?? ""))}
        </ConfirmDialog>
      )}
    </>
  );
}

interface BadgeProps {
  theirs: string;
  ours: string;
  /** The shared base of `ours`: when there is one, only bases are compared. */
  base: string | null;
  name?: string;
}

/** Whether another agent's saved rules, or their shared base, match the shown agent's. */
function SameBadge({ theirs, ours, base, name }: BadgeProps) {
  if (base !== null) {
    const their = sharedPart(theirs);
    if (their === null) {
      return (
        <span className="tab-badge" title={t.rules.noBaseTip(name ?? "")}>
          {t.rules.noBase}
        </span>
      );
    }
    return their === base ? (
      <span className="tab-badge tab-badge-same" title={t.rules.sameBaseTip(name ?? "")}>
        {t.rules.sameBaseBadge}
      </span>
    ) : (
      <span className="tab-badge tab-badge-differs" title={t.rules.baseDiffersTip(name ?? "")}>
        {t.rules.baseDiffers}
      </span>
    );
  }
  if (!theirs.trim() && !ours.trim()) return null;
  if (!theirs.trim()) {
    return (
      <span className="tab-badge" title={t.rules.noRules}>
        {t.markdown.empty}
      </span>
    );
  }
  return theirs === ours ? (
    <span className="tab-badge tab-badge-same" title={t.rules.sameTip(name ?? "")}>
      {t.rules.same}
    </span>
  ) : (
    <span className="tab-badge tab-badge-differs" title={t.rules.differsTip(name ?? "")}>
      {t.rules.differs}
    </span>
  );
}
