# AgentDeck

A local control center for AI coding agents. AgentDeck manages the MCP
servers, rules, skills and secrets of Claude Code, Codex, Cursor and Gemini CLI
in one place, and shows your session history and costs.

Runs on Windows, macOS and Linux. Nothing leaves your machine.

> Early development. Today AgentDeck lists the agents installed on your
> machine and the MCP servers each one declares (read-only).

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

## Config files read

| Agent | MCP servers |
| --- | --- |
| Claude Code | `~/.claude.json` |
| Codex | `~/.codex/config.toml` |
| Cursor | `~/.cursor/mcp.json` |
| Gemini CLI | `~/.gemini/settings.json` |

Environment values of MCP servers are never displayed, only their names.

## License

MIT
