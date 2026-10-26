import type { SkillLocation } from "./types";

/** The folder of each skills location, as the user knows it. */
export const SKILL_FOLDERS: Record<SkillLocation, string> = {
  "claude-code": "~/.claude/skills",
  shared: "~/.agents/skills",
  codex: "~/.codex/skills",
  gemini: "~/.gemini/skills",
  cursor: "~/.cursor/skills",
};
