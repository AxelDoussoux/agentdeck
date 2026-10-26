import { useState } from "react";
import { applyImport, undoChange } from "../lib/api";
import { errorText, t } from "../lib/i18n";
import { SKILL_FOLDERS } from "../lib/skills";
import type { AgentInfo, ImportChange, ImportItem, ImportPreview } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toasts";
import { Notice } from "./ui";

interface Props {
  preview: ImportPreview;
  agents: AgentInfo[];
  onClose: () => void;
  onChange: () => void;
}

const CHANGES: ImportChange[] = ["add", "replace", "same", "skip"];

/** What an import file changes, and the secret values its servers need. */
export function ImportDialog({ preview, agents, onClose, onChange }: Props) {
  const { items, secrets } = preview.plan;
  const [replace, setReplace] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const s = t.settings;

  const nameOf = (agent: string) => agents.find((a) => a.agent === agent)?.name ?? agent;
  const where = (item: ImportItem) =>
    item.kind === "skill" && item.location
      ? SKILL_FOLDERS[item.location]
      : item.agent && item.kind !== "rules"
        ? nameOf(item.agent)
        : "";
  const id = (server: string, key: string) => `${server}\u0000${key}`;
  const toImport = items.filter((item) => item.change === "add" || (replace && item.change === "replace"));

  async function run() {
    setBusy(true);
    try {
      const given = secrets.map(({ server, key }) => ({ server, key, value: values[id(server, key)] ?? "" }));
      const { undo, summary } = await applyImport(given, replace);
      const missing = summary.missingSecrets.length;
      notify({
        tone: "success",
        text: s.imported(summary.imported) + (missing > 0 ? s.importMissing(missing) : ""),
        undo: async () => {
          await undoChange(undo);
          onChange();
        },
      });
      onChange();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      wide
      title={s.importTitle}
      onCancel={onClose}
      choices={toImport.length > 0 && !busy ? [{ label: s.importGo, tone: "primary", onSelect: run }] : []}
    >
      <p>{s.importFrom(preview.file)}</p>
      {toImport.length === 0 && !items.some((item) => item.change === "replace") && <p>{s.importNothing}</p>}
      <div className="import-groups">
        {CHANGES.map((change) => {
          const group = items.filter((item) => item.change === change);
          if (group.length === 0) return null;
          return (
            <div key={change} className={`import-group import-${change}`}>
              <h4>
                {s.importChanges[change]} <span className="count">{group.length}</span>
              </h4>
              <ul>
                {group.map((item) => (
                  <li key={`${item.kind}-${item.agent}-${item.location}-${item.name}`}>
                    <span className="tag">{s.importKinds[item.kind]}</span> {item.name}
                    {where(item) && <small> · {where(item)}</small>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {items.some((item) => item.change === "replace") && (
        <label className="check import-overwrite">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          <span>
            {s.importReplace}
            <small>{s.importReplaceHint}</small>
          </span>
        </label>
      )}
      {secrets.length > 0 && toImport.length > 0 && (
        <fieldset className="import-secrets">
          <legend>{s.importSecrets}</legend>
          <p className="hint">{s.importSecretsHint}</p>
          {secrets.map(({ server, key }) => (
            <label key={id(server, key)}>
              <span>
                {server} · <code>{key}</code>
              </span>
              <input
                type="password"
                autoComplete="off"
                value={values[id(server, key)] ?? ""}
                onChange={(e) => setValues({ ...values, [id(server, key)]: e.target.value })}
              />
            </label>
          ))}
        </fieldset>
      )}
      {toImport.length > 0 && <p className="hint">{s.importUndoHint}</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </ConfirmDialog>
  );
}
