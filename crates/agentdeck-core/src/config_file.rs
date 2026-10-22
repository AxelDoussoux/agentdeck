//! Safe reading and writing of agent configuration files.

use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{Error, Result};

/// Timestamped backups kept per file in `~/.agentdeck/backups`.
pub const BACKUPS_KEPT: usize = 20;

/// How many times an edit is replayed when the file changes under it.
const ATTEMPTS: usize = 3;

/// Reads a config file, returning `None` when it does not exist.
pub(crate) fn read_optional(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
        Err(source) => Err(io_error(path, source)),
    }
}

/// Path of the backup kept next to `path` before AgentDeck overwrites it.
pub fn backup_path(path: &Path) -> PathBuf {
    with_suffix(path, ".agentdeck.bak")
}

/// Folder holding every timestamped backup: `~/.agentdeck/backups`.
pub fn backups_root(home: &Path) -> PathBuf {
    home.join(".agentdeck").join("backups")
}

/// How many timestamped backups there are, of all files.
pub fn backup_count(home: &Path) -> usize {
    fn count(dir: &Path) -> usize {
        fs::read_dir(dir).map_or(0, |entries| {
            entries
                .flatten()
                .map(|entry| match entry.file_type() {
                    Ok(kind) if kind.is_dir() => count(&entry.path()),
                    Ok(_) => 1,
                    Err(_) => 0,
                })
                .sum()
        })
    }
    count(&backups_root(home))
}

/// Folder holding the timestamped backups of `path`, which mirrors where
/// `path` sits under `home`: `~/.agentdeck/backups/.codex/config.toml/`.
pub fn backups_dir(home: &Path, path: &Path) -> PathBuf {
    let relative = path.strip_prefix(home).unwrap_or(path);
    let mut dir = backups_root(home);
    for component in relative.components() {
        if let Component::Normal(part) = component {
            dir.push(part);
        }
    }
    dir
}

/// Timestamped backups of `path`, most recent first.
pub fn list_backups(home: &Path, path: &Path) -> Result<Vec<PathBuf>> {
    let dir = backups_dir(home, path);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(source) => return Err(io_error(&dir, source)),
    };
    let mut backups: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect();
    // Names start with a zero-padded timestamp, so they sort by age.
    backups.sort();
    backups.reverse();
    Ok(backups)
}

/// Puts a backup from [`list_backups`] back in place. The current content is
/// backed up first, so a restore can itself be undone.
pub fn restore_backup(home: &Path, path: &Path, backup: &Path) -> Result<()> {
    if backup.parent() != Some(backups_dir(home, path).as_path()) {
        return Err(Error::Invalid {
            path: backup.to_path_buf(),
            reason: "not a backup of this file",
        });
    }
    let content = fs::read_to_string(backup).map_err(|source| io_error(backup, source))?;
    write(home, path, &content)
}

/// Replaces the content of `path` with `content`, backing up the previous
/// version. Does nothing when the content is already the same.
pub(crate) fn write(home: &Path, path: &Path, content: &str) -> Result<()> {
    let previous = read_optional(path)?;
    if previous.as_deref() == Some(content) {
        return Ok(());
    }
    replace(home, path, previous.as_deref(), content)
}

/// Applies `edit` to the current content of `path` (empty when the file does
/// not exist) and writes the result.
///
/// Agents such as Claude Code rewrite their config while they run. The file
/// is only replaced if it still holds the content the edit started from;
/// otherwise the edit is replayed on the new content, so neither change is
/// lost.
pub(crate) fn update(
    home: &Path,
    path: &Path,
    mut edit: impl FnMut(&str) -> Result<String>,
) -> Result<()> {
    for _ in 0..ATTEMPTS {
        let previous = read_optional(path)?;
        let updated = edit(previous.as_deref().unwrap_or_default())?;
        if previous.as_deref() == Some(updated.as_str()) {
            return Ok(());
        }
        if read_optional(path)? == previous {
            return replace(home, path, previous.as_deref(), &updated);
        }
    }
    Err(Error::Conflict {
        path: path.to_path_buf(),
    })
}

/// Writes `content` atomically, after saving `previous` next to the file and
/// in the timestamped backups. A crash mid-write never leaves a truncated
/// config behind.
fn replace(home: &Path, path: &Path, previous: Option<&str>, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }
    if let Some(previous) = previous {
        let backup = backup_path(path);
        write_private(&backup, previous, path)?;
        keep_backup(home, path, previous)?;
    }
    let tmp = with_suffix(path, ".agentdeck.tmp");
    write_private(&tmp, content, path)?;
    fs::rename(&tmp, path).map_err(|source| io_error(path, source))
}

/// Writes `file` with the permissions of `like` when it exists: configs hold
/// secrets, and a rewrite must not make a private file world-readable.
fn write_private(file: &Path, content: &str, like: &Path) -> Result<()> {
    fs::write(file, content).map_err(|source| io_error(file, source))?;
    if let Ok(metadata) = fs::metadata(like) {
        fs::set_permissions(file, metadata.permissions())
            .map_err(|source| io_error(file, source))?;
    }
    Ok(())
}

fn keep_backup(home: &Path, path: &Path, previous: &str) -> Result<()> {
    let dir = backups_dir(home, path);
    fs::create_dir_all(&dir).map_err(|source| io_error(&dir, source))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let root = backups_root(home);
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .map_err(|source| io_error(&root, source))?;
    }

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let mut backup = dir.join(format!("{millis:015}-{name}"));
    let mut n = 1;
    while backup.exists() {
        backup = dir.join(format!("{millis:015}.{n:03}-{name}"));
        n += 1;
    }
    write_private(&backup, previous, path)?;

    for old in list_backups(home, path)?.into_iter().skip(BACKUPS_KEPT) {
        fs::remove_file(&old).map_err(|source| io_error(&old, source))?;
    }
    Ok(())
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = OsString::from(path.file_name().unwrap_or_default());
    name.push(suffix);
    path.with_file_name(name)
}

fn io_error(path: &Path, source: std::io::Error) -> Error {
    Error::Io {
        path: path.to_path_buf(),
        source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_write_keeps_a_timestamped_backup() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let path = home.join(".codex/config.toml");

        write(home, &path, "one").unwrap();
        assert!(list_backups(home, &path).unwrap().is_empty());
        write(home, &path, "two").unwrap();
        write(home, &path, "three").unwrap();
        // Writing the same content again changes nothing.
        write(home, &path, "three").unwrap();

        let backups = list_backups(home, &path).unwrap();
        assert_eq!(backups.len(), 2);
        assert_eq!(fs::read_to_string(&backups[0]).unwrap(), "two");
        assert_eq!(fs::read_to_string(&backups[1]).unwrap(), "one");
        assert!(backups[0].starts_with(home.join(".agentdeck/backups/.codex/config.toml")));
        assert_eq!(fs::read_to_string(backup_path(&path)).unwrap(), "two");
    }

    #[test]
    fn old_backups_are_pruned() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let path = home.join(".claude.json");
        for i in 0..=BACKUPS_KEPT + 5 {
            write(home, &path, &i.to_string()).unwrap();
        }
        let backups = list_backups(home, &path).unwrap();
        assert_eq!(backups.len(), BACKUPS_KEPT);
        let newest = (BACKUPS_KEPT + 4).to_string();
        assert_eq!(fs::read_to_string(&backups[0]).unwrap(), newest);
    }

    #[test]
    fn restore_brings_back_a_backup_and_backs_up_the_current_content() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let path = home.join(".gemini/GEMINI.md");
        write(home, &path, "original").unwrap();
        write(home, &path, "changed").unwrap();

        let backup = list_backups(home, &path).unwrap().remove(0);
        restore_backup(home, &path, &backup).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(list_backups(home, &path).unwrap().len(), 2);

        let elsewhere = home.join("other.txt");
        fs::write(&elsewhere, "x").unwrap();
        assert!(restore_backup(home, &path, &elsewhere).is_err());
    }

    #[test]
    fn an_edit_is_replayed_when_the_file_changes_under_it() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let path = home.join(".claude.json");
        fs::write(&path, "a").unwrap();

        // The agent rewrites the file while AgentDeck computes its edit.
        let mut calls = 0;
        update(home, &path, |content| {
            calls += 1;
            if calls == 1 {
                fs::write(&path, "a+agent").unwrap();
            }
            Ok(format!("{content}+deck"))
        })
        .unwrap();
        assert_eq!(calls, 2);
        assert_eq!(fs::read_to_string(&path).unwrap(), "a+agent+deck");
        let backups = list_backups(home, &path).unwrap();
        assert_eq!(fs::read_to_string(&backups[0]).unwrap(), "a+agent");
    }

    #[test]
    fn a_file_that_keeps_changing_is_left_alone() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let path = home.join(".claude.json");
        fs::write(&path, "0").unwrap();

        let mut n = 0;
        let err = update(home, &path, |content| {
            n += 1;
            fs::write(&path, n.to_string()).unwrap();
            Ok(format!("{content}+deck"))
        })
        .unwrap_err();
        assert!(matches!(err, Error::Conflict { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), n.to_string());
    }

    #[cfg(unix)]
    #[test]
    fn rewrites_keep_the_file_private() {
        use std::os::unix::fs::PermissionsExt;

        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let path = home.join(".claude.json");
        fs::write(&path, "{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();

        write(home, &path, "{\"a\": 1}").unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(&backup_path(&path)), 0o600);
        assert_eq!(mode(&list_backups(home, &path).unwrap()[0]), 0o600);
        assert_eq!(mode(&home.join(".agentdeck/backups")), 0o700);
    }
}
