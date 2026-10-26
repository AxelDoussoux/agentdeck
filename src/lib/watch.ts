import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

/** Parts of the app whose files the Rust side watches. */
export type Scope = "mcp" | "rules" | "skills" | "usage";

/**
 * Calls `onChange` when files of `scope` change outside the app, such as a
 * `claude mcp add` run in a terminal. The latest `onChange` is used, so it
 * can read the current state.
 */
export function useFilesChanged(scope: Scope, onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const unlisten = listen<Scope[]>("files-changed", (event) => {
      if (event.payload.includes(scope)) latest.current();
    });
    return () => {
      unlisten.then((stop) => stop(), () => {});
    };
  }, [scope]);
}
