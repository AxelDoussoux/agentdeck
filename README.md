# AgentDeck

A local control center for AI coding agents. AgentDeck manages the MCP
servers, rules, skills and secrets of Claude Code, Codex, Cursor and Gemini CLI
in one place, and shows your session history and costs.

Runs on Windows, macOS and Linux. Nothing leaves your machine.

> Early development. Today AgentDeck lists the agents installed on your
> machine, lets you add, remove and copy MCP servers between them, and
> edit or sync their global rules files, share skills between agents, move plain-text secrets to the system
> keychain, and shows the token usage and
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
pnpm tauri build                        # installers in target/release/bundle
cargo run -p agentdeck-cli -- mcp list  # CLI
pnpm sidecar --debug && cargo test --workspace
```

The app bundles the CLI as a Tauri sidecar. `pnpm tauri dev` and
`pnpm tauri build` build it first; before a plain `cargo build` or
`cargo test` of the whole workspace, run `pnpm sidecar` once, or the app's
build script fails because `src-tauri/binaries/agentdeck-<target>` is missing.

## Release

Bump `version` in `Cargo.toml`, `package.json` and `src-tauri/tauri.conf.json`,
then push a tag:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The `Release` workflow builds the installers (Windows `.msi`/`.exe`, macOS
`.dmg` for Apple Silicon and Intel, Linux `.deb`/`.rpm`/`.AppImage`) and
attaches them to a draft GitHub release. Publishing the draft makes it the
latest release, which installed apps offer to update to at startup.

Updates are signed: the workflow needs the `TAURI_SIGNING_PRIVATE_KEY`
repository secret, and the matching public key is in
`src-tauri/tauri.conf.json`. Keep the private key safe: without it, existing
installs can no longer be updated. The installers themselves are not
code-signed yet, so Windows SmartScreen and macOS Gatekeeper warn on first
launch.

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
agentdeck secrets list
agentdeck secrets protect claude-code github   # env vars move to the keychain
agentdeck secrets unprotect claude-code github
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

Protecting a local MCP server stores its environment variables in the system
keychain (Credential Manager, macOS Keychain or Secret Service) and rewrites
its command to `agentdeck exec --secret KEY=ID -- <original command>`, which
reads them back when the agent starts the server. The app ships the
`agentdeck` CLI next to its own executable and uses that copy (from an
AppImage, it is copied to `~/.agentdeck/bin` first, since the AppImage mount
goes away when the app quits). If you move or uninstall the app, unprotect your
servers first or they will no longer start. Headers of remote servers are
listed but stay in the config.

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
