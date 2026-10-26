//! Watches agent config files and skill folders, so that a change made
//! outside the app (`claude mcp add` in a terminal, an agent rewriting its
//! config) shows up without a manual refresh.

use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use agentdeck_core::skills::Location;
use agentdeck_core::{Agent, mcp, usage};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event the UI listens to, with the scopes whose files changed.
pub const EVENT: &str = "files-changed";

/// Editors and agents write a file in several steps: changes are reported
/// once the files have been quiet for this long.
const QUIET: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Mcp,
    Rules,
    Skills,
    /// The session logs that costs are read from.
    Usage,
}

/// Starts watching in a background thread. Errors only mean the app falls
/// back to reloading when a page opens, as before.
pub fn start(app: AppHandle, home: PathBuf) {
    std::thread::spawn(move || {
        let _ = run(&app, &home);
    });
}

fn run(app: &AppHandle, home: &Path) -> notify::Result<()> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = RecommendedWatcher::new(tx, notify::Config::default())?;
    let mut watched = HashSet::new();
    watch_targets(&mut watcher, &mut watched, home);
    let mut servers = servers_fingerprint(home);

    while let Ok(first) = rx.recv() {
        let mut paths = Vec::new();
        let mut collect = |event: notify::Result<notify::Event>| {
            if let Ok(event) = event
                && !matches!(event.kind, EventKind::Access(_))
            {
                paths.extend(event.paths);
            }
        };
        collect(first);
        while let Ok(event) = rx.recv_timeout(QUIET) {
            collect(event);
        }

        let mut scopes: HashSet<Scope> = paths
            .iter()
            .filter_map(|path| scope_of(home, path))
            .collect();
        // A folder created since, such as `~/.codex`, is watched from now on.
        // Files may have been written in it before that, so check them all.
        if watch_targets(&mut watcher, &mut watched, home) {
            scopes.extend([Scope::Mcp, Scope::Rules, Scope::Skills, Scope::Usage]);
        }
        // Claude Code rewrites `~/.claude.json` all the time while it runs:
        // only a change to the servers themselves is worth a reload.
        if scopes.contains(&Scope::Mcp) {
            let now = servers_fingerprint(home);
            if now == servers {
                scopes.remove(&Scope::Mcp);
            }
            servers = now;
        }
        if !scopes.is_empty() {
            let _ = app.emit(EVENT, scopes.into_iter().collect::<Vec<_>>());
        }
    }
    Ok(())
}

/// Folders to watch, each the closest one that exists, so that files created
/// later are seen too.
fn targets(home: &Path) -> Vec<(PathBuf, RecursiveMode)> {
    let mut targets = vec![(home.to_path_buf(), RecursiveMode::NonRecursive)];
    for agent in Agent::ALL {
        let files = [Some(agent.mcp_config_path(home)), agent.rules_path(home)];
        for dir in files
            .into_iter()
            .flatten()
            .filter_map(|file| file.parent().map(Path::to_path_buf))
        {
            targets.push((dir, RecursiveMode::NonRecursive));
        }
    }
    for dir in usage::log_dirs(home) {
        targets.push((dir, RecursiveMode::Recursive));
    }
    for location in Location::ALL {
        let dir = location.path(home);
        if dir.is_dir() {
            targets.push((dir, RecursiveMode::Recursive));
        } else if let Some(parent) = dir.parent() {
            targets.push((parent.to_path_buf(), RecursiveMode::NonRecursive));
        }
    }
    targets
}

/// Starts watching the targets not watched yet. Returns whether there were any.
fn watch_targets(
    watcher: &mut RecommendedWatcher,
    watched: &mut HashSet<PathBuf>,
    home: &Path,
) -> bool {
    let mut added = false;
    for (dir, mode) in targets(home) {
        // A skills folder first watched through its parent is watched again,
        // recursively, once it exists.
        let key = match mode {
            RecursiveMode::Recursive => dir.join("**"),
            RecursiveMode::NonRecursive => dir.clone(),
        };
        if dir.is_dir() && !watched.contains(&key) && watcher.watch(&dir, mode).is_ok() {
            watched.insert(key);
            added = true;
        }
    }
    added
}

/// Which part of the app a changed path belongs to, if any.
fn scope_of(home: &Path, path: &Path) -> Option<Scope> {
    // AgentDeck's own temporary files and backups.
    let name = path.file_name()?.to_string_lossy();
    if name.contains(".agentdeck.") {
        return None;
    }
    if Agent::ALL
        .iter()
        .any(|agent| agent.mcp_config_path(home) == path)
    {
        return Some(Scope::Mcp);
    }
    if Agent::ALL
        .iter()
        .any(|agent| agent.rules_path(home).as_deref() == Some(path))
    {
        return Some(Scope::Rules);
    }
    if Location::ALL
        .iter()
        .any(|location| path.starts_with(location.path(home)))
    {
        return Some(Scope::Skills);
    }
    if path.extension().is_some_and(|ext| ext == "jsonl")
        && usage::log_dirs(home)
            .iter()
            .any(|dir| path.starts_with(dir))
    {
        return Some(Scope::Usage);
    }
    None
}

/// Hash of the server listing, which tells whether a server changed. It
/// covers values through their hashes.
fn servers_fingerprint(home: &Path) -> u64 {
    let mut hasher = DefaultHasher::new();
    format!("{:?}", mcp::list_all(home)).hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_logs_are_the_usage_scope() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        std::fs::create_dir_all(home.join(".claude/projects/app")).unwrap();
        let scope = |path: &str| scope_of(home, &home.join(path));
        assert_eq!(scope(".claude/projects/app/a1.jsonl"), Some(Scope::Usage));
        // Only where the logs are, and only logs.
        assert_eq!(scope(".claude/projects/app/notes.md"), None);
        assert_eq!(scope(".codex/history.jsonl"), None);
    }

    #[test]
    fn paths_map_to_scopes() {
        let home = Path::new("/home/me");
        let scope = |path: &str| scope_of(home, &home.join(path));
        assert_eq!(scope(".claude.json"), Some(Scope::Mcp));
        assert_eq!(scope(".codex/config.toml"), Some(Scope::Mcp));
        assert_eq!(scope(".codex/AGENTS.md"), Some(Scope::Rules));
        assert_eq!(scope(".agents/skills/pdf/SKILL.md"), Some(Scope::Skills));
        assert_eq!(scope(".claude.json.agentdeck.tmp"), None);
        assert_eq!(scope(".codex/config.toml.agentdeck.bak"), None);
        assert_eq!(scope(".bash_history"), None);
        assert_eq!(scope(".codex/history.jsonl"), None);
    }
}
