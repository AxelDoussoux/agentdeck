# Contributing to AgentDeck

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

- **Found a bug?** Open an issue with your OS, the agent involved and what you
  expected. Never paste real tokens or config values: AgentDeck never needs
  them to debug.
- **Want to code?** Pick an issue labelled
  [good first issue](https://github.com/AxelDoussoux/agentdeck/labels/good%20first%20issue),
  say you are on it in a comment, and open a pull request when ready.
- **Bigger change?** Open an issue first so we can agree on the approach.

## Project layout

| Path | What it is |
| --- | --- |
| `crates/agentdeck-core` | Rust library that reads and writes agent configs. All logic lives here. |
| `crates/agentdeck-cli` | `agentdeck` command-line tool, built on the core. |
| `src-tauri` | Tauri 2 desktop shell exposing the core to the UI. |
| `src` | React + TypeScript frontend (Vite). |

Agent-specific knowledge (config paths and formats, log formats, prices)
lives in `crates/agentdeck-core`, one module per area: `mcp.rs`, `rules.rs`,
`skills.rs`, `secrets.rs`, `usage.rs`, `pricing.rs`. Supporting a new agent
starts in `agent.rs`.

The texts of the app are in `src/locales`: `en.tsx` is the reference, and
`fr.tsx` must have the same keys, which `pnpm build` checks. A new text goes
in both files. A new language is one more file there, listed in
`src/lib/i18n.ts`.

Shared UI pieces (icons, page header, notices, segmented buttons, tabs) are
in `src/components/ui.tsx`; larger ones have their own file next to it. The
styles are in `src/styles`, one file per topic, imported in cascade order
by `src/App.css`. Colors, spacing (`--space-*`) and text sizes (`--text-*`)
come from the variables in `tokens.css`.

## Build from source

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

Set the new version everywhere it is written (`Cargo.toml`, `Cargo.lock`,
`package.json` and `src-tauri/tauri.conf.json`) in a pull request, then tag
`main` once it is merged:

```sh
pnpm bump 0.2.0                              # in the pull request
git tag v0.2.0 && git push origin v0.2.0     # on main, after the merge
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

After each merge to `main`, CI also builds debug installers on every OS, so
packaging problems show up before a release. They are kept for a week as
artifacts of the run.

## Before you open a pull request

CI runs these on Windows, macOS and Linux; run them locally first:

```sh
pnpm build                      # type-checks and builds the frontend
pnpm lint                       # ESLint
pnpm test                       # Vitest, for the helpers in src/lib
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Guidelines:

- Never write an agent config without going through `config_file.rs`: it
  keeps a `.agentdeck.bak` backup and writes atomically.
- Secret values must never reach the frontend or the logs. The UI only ever
  sees key names.
- Add a test for each config format change, with a temporary home folder
  (see the existing tests in `mcp.rs`). Frontend helpers that compute
  something get a `*.test.ts` file next to them.
- Keep pull requests focused on one change.
