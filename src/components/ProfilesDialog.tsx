import { useState } from "react";
import { deleteProfile, saveProfile } from "../lib/api";
import { errorText, t } from "../lib/i18n";
import type { Profile } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toasts";
import { Notice } from "./ui";

interface Props {
  profiles: Profile[];
  /** Every server name, for the checkboxes. */
  servers: string[];
  /** The servers on now: a new profile starts from them. */
  serversOn: string[];
  /** The profile to show first; a new one when missing. */
  initial?: string;
  onClose: () => void;
  onChange: () => void;
}

const NEW = "";

/** Creates, edits and deletes profiles. Nothing is turned on or off here. */
export function ProfilesDialog({ profiles, servers, serversOn, initial, onClose, onChange }: Props) {
  const [picked, setPicked] = useState(initial ?? NEW);
  const [name, setName] = useState(initial ?? "");
  const [chosen, setChosen] = useState<Set<string>>(
    new Set(profiles.find((p) => p.name === initial)?.servers ?? serversOn),
  );
  const [error, setError] = useState<string | null>(null);
  const notify = useToast();
  const m = t.mcp;

  function pick(value: string) {
    const profile = profiles.find((p) => p.name === value);
    setPicked(value);
    setName(profile?.name ?? "");
    setChosen(new Set(profile?.servers ?? serversOn));
    setError(null);
  }

  function toggle(server: string, on: boolean) {
    const next = new Set(chosen);
    if (on) next.add(server);
    else next.delete(server);
    setChosen(next);
  }

  async function save() {
    try {
      // Servers the profile names that no agent has any more stay in it.
      const kept = profiles.find((p) => p.name === picked)?.servers.filter((s) => !servers.includes(s)) ?? [];
      await saveProfile(name, [...chosen, ...kept]);
      if (picked !== NEW && picked !== name.trim()) await deleteProfile(picked);
      notify({ tone: "success", text: m.profileSaved(name.trim()) });
      onChange();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove() {
    try {
      await deleteProfile(picked);
      notify({ tone: "success", text: m.profileDeleted(picked) });
      onChange();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <ConfirmDialog
      title={m.profileTitle}
      onCancel={onClose}
      choices={[
        ...(picked === NEW ? [] : [{ label: m.delete, tone: "danger" as const, onSelect: remove }]),
        { label: t.common.save, tone: "primary", onSelect: save },
      ]}
    >
      <div className="form">
        {profiles.length > 0 && (
          <label>
            {m.profilePick}
            <select value={picked} onChange={(e) => pick(e.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.name} value={profile.name}>
                  {profile.name}
                </option>
              ))}
              <option value={NEW}>{m.newProfile}</option>
            </select>
          </label>
        )}
        <label>
          {m.profileName}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={m.profileNameHint} autoFocus />
        </label>
        <fieldset className="also">
          <legend>{m.profileServers}</legend>
          {servers.map((server) => (
            <label key={server} className="check">
              <input type="checkbox" checked={chosen.has(server)} onChange={(e) => toggle(server, e.target.checked)} />
              {server}
            </label>
          ))}
          <p className="hint">{m.profileHint}</p>
        </fieldset>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </ConfirmDialog>
  );
}
