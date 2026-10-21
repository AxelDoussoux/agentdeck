# AgentDeck

A local control center for AI coding agents. AgentDeck manages the MCP
servers, rules, skills and secrets of Claude Code, Codex, Cursor and Gemini CLI
in one place, and shows your session history and costs.

Runs on Windows, macOS and Linux. Nothing leaves your machine.

> Early development. Today AgentDeck lists the agents installed on your
> machine, lets you add, remove and copy MCP servers between them, and
> edit or sync their global rules files, share skills between agents, and shows the token usage and
> estimated cost of your Claude Code and Codex sessions.

## Layout

| Path | What it is |
| --- | --- |
| `crates/agentdeck-core` | Rust library that reads and writes agent configs. All logic lives here. |
| `crates/agentdeck-cli` | `agentdeck` command-line tool, built on the core. |
| `src-tauri` | Tauri 2 desktop shell exposing the core to the UI. |
| `src` | React + TypeScript frontend (Vite). |

## Develop

Prerequisites: [Rust](https://rustup.rs), Node 22, pnpm 10 and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```sh
pnpm install
pnpm tauri dev                          # desktop app
cargo run -p agentdeck-cli -- mcp list  # CLI
cargo test --workspace
```

## CLI

```sh
agentdeck agents
agentdeck mcp list [--json]
agentdeck mcp add claude-code github -e GITHUB_TOKEN=ghp_x -- npx -y @modelcontextprotocol/server-github
agentdeck mcp add cursor linear --url https://mcp.linear.app/mcp
agentdeck mcp copy github --from claude-code --to codex gemini
agentdeck mcp remove codex github
agentdeck rules list
agentdeck rules show claude-code
agentdeck rules copy --from claude-code --to codex gemini
agentdeck skills list
agentdeck skills copy pdf --from claude-code --to codex gemini
agentdeck skills remove pdf --from shared   # moved to ~/.agentdeck/trash
agentdeck usage --days 30
```

## Config files read

| Agent | MCP servers | Global rules |
| --- | --- | --- |
| Claude Code | `~/.claude.json` | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/config.toml` | `~/.codex/AGENTS.md` |
| Cursor | `~/.cursor/mcp.json` | stored in Cursor's settings, not editable yet |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/GEMINI.md` |

Skills are read from `~/.claude/skills` (Claude Code), `~/.agents/skills`
(shared by Codex, Gemini CLI and Cursor), `~/.codex/skills`, `~/.gemini/skills`
and `~/.cursor/skills`. Copying a skill for Codex writes it to the shared
folder. Removing a skill moves its folder to `~/.agentdeck/trash`.

Session history is read from `~/.claude/projects` (Claude Code) and
`~/.codex/sessions` (Codex). Costs are estimates at API list prices
(`crates/agentdeck-core/src/pricing.rs`); subscriptions are billed
differently, and models without a known price are left out of the total.

Environment and header values of MCP servers are never displayed, only
their names. When copying a server between agents, secrets are copied by the
Rust core and never reach the UI.

Before changing a config file, AgentDeck saves the previous version next to
it as `<file>.agentdeck.bak` and writes the new one atomically. Other settings,
key order and TOML comments are kept.

## License

MIT
