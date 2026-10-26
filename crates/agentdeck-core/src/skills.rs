//! Agent Skills: folders holding a `SKILL.md` and its resources.
//!
//! Each agent reads its own user-level folder, and Codex, Gemini CLI and
//! Cursor also share `~/.agents/skills`. Cursor additionally reads the
//! Claude Code and Codex folders.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::{Agent, Error, Result};

/// A user-level folder that agents load skills from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Location {
    ClaudeCode,
    /// `~/.agents/skills`, the cross-agent folder of the Agent Skills standard.
    Shared,
    /// `~/.codex/skills`, read by older Codex versions and by Cursor.
    Codex,
    Gemini,
    Cursor,
}

impl Location {
    /// The default name of the location's agent folder, which identifies the
    /// location in the trash even when a variable moves the folder.
    fn folder(self) -> &'static str {
        match self {
            Location::ClaudeCode => ".claude",
            Location::Shared => ".agents",
            Location::Codex => ".codex",
            Location::Gemini => ".gemini",
            Location::Cursor => ".cursor",
        }
    }

    pub const ALL: [Location; 5] = [
        Location::ClaudeCode,
        Location::Shared,
        Location::Codex,
        Location::Gemini,
        Location::Cursor,
    ];

    pub fn path(self, home: &Path) -> PathBuf {
        let dir = match self {
            Location::ClaudeCode => Agent::ClaudeCode.folder(home),
            Location::Shared => home.join(".agents"),
            Location::Codex => Agent::Codex.folder(home),
            Location::Gemini => Agent::Gemini.folder(home),
            Location::Cursor => Agent::Cursor.folder(home),
        };
        dir.join("skills")
    }

    /// Agents that load the skills of this folder.
    pub fn readers(self) -> &'static [Agent] {
        match self {
            Location::ClaudeCode => &[Agent::ClaudeCode, Agent::Cursor],
            Location::Shared => &[Agent::Codex, Agent::Gemini, Agent::Cursor],
            Location::Codex => &[Agent::Codex, Agent::Cursor],
            Location::Gemini => &[Agent::Gemini],
            Location::Cursor => &[Agent::Cursor],
        }
    }

    /// Where AgentDeck installs a skill for `agent`.
    pub fn for_agent(agent: Agent) -> Location {
        match agent {
            Agent::ClaudeCode => Location::ClaudeCode,
            Agent::Codex => Location::Shared,
            Agent::Gemini => Location::Gemini,
            Agent::Cursor => Location::Cursor,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// Folder name, which identifies the skill.
    pub name: String,
    pub description: Option<String>,
    pub location: Location,
    pub path: PathBuf,
    pub readers: Vec<Agent>,
    /// Latest modification of any file in the folder, in milliseconds since
    /// the epoch: the newest copy is the one last edited.
    pub modified_ms: u64,
    /// Hash of every file's path and content: copies with the same hash are
    /// identical.
    pub hash: String,
}

/// A skill folder in `~/.agentdeck/trash`, removed or replaced from the app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedSkill {
    /// Path inside the trash, `<time>/<agent folder>/<name>`, which
    /// [`restore`] takes.
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Where it was removed from, and where a restore puts it back.
    pub location: Location,
    pub removed_ms: u64,
}

/// Lists the skills of every location. Unreadable folders are reported in
/// the second list.
pub fn list(home: &Path) -> (Vec<Skill>, Vec<String>) {
    let mut skills = Vec::new();
    let mut errors = Vec::new();
    for location in Location::ALL {
        let dir = location.path(home);
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                errors.push(format!("{}: {err}", dir.display()));
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(content) = fs::read_to_string(path.join("SKILL.md")) else {
                continue;
            };
            let (modified_ms, hash) = fingerprint(&path);
            skills.push(Skill {
                name: entry.file_name().to_string_lossy().into_owned(),
                description: frontmatter_field(&content, "description"),
                location,
                path,
                readers: location.readers().to_vec(),
                modified_ms,
                hash: format!("{hash:016x}"),
            });
        }
    }
    skills.sort_by(|a, b| (&a.name, a.location).cmp(&(&b.name, b.location)));
    (skills, errors)
}

/// Returns the content of a skill's `SKILL.md`.
pub fn read(home: &Path, location: Location, name: &str) -> Result<String> {
    let path = skill_dir(home, location, name)?.join("SKILL.md");
    fs::read_to_string(&path).map_err(|_| Error::SkillNotFound { path })
}

/// One file of a skill folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFile {
    /// Path inside the skill folder, with `/` between folders.
    pub path: String,
    pub size: u64,
}

/// At most this many files are listed, for skills that bundle a whole project.
const FILES_LISTED: usize = 500;

/// The files of a skill folder, sorted by path.
pub fn files(home: &Path, location: Location, name: &str) -> Result<Vec<SkillFile>> {
    fn walk(dir: &Path, prefix: &str, found: &mut Vec<SkillFile>) -> Result<()> {
        let entries = fs::read_dir(dir).map_err(|source| io_error(dir, source))?;
        for entry in entries.flatten() {
            if found.len() >= FILES_LISTED {
                break;
            }
            let path = format!("{prefix}{}", entry.file_name().to_string_lossy());
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => walk(&entry.path(), &format!("{path}/"), found)?,
                Ok(_) => found.push(SkillFile {
                    path,
                    size: entry.metadata().map_or(0, |metadata| metadata.len()),
                }),
                Err(_) => {}
            }
        }
        Ok(())
    }
    let dir = skill_dir(home, location, name)?;
    if !dir.is_dir() {
        return Err(Error::SkillNotFound { path: dir });
    }
    let mut found = Vec::new();
    walk(&dir, "", &mut found)?;
    found.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(found)
}

/// Creates a skill with a `SKILL.md` to fill in, and returns its folder.
/// The name follows the Agent Skills standard: lower-case letters, digits and
/// single hyphens, at most 64 characters.
pub fn create(home: &Path, location: Location, name: &str, description: &str) -> Result<PathBuf> {
    let valid = !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if !valid {
        return Err(Error::NewSkillName {
            name: name.to_owned(),
        });
    }
    let dir = skill_dir(home, location, name)?;
    if dir.exists() {
        return Err(Error::SkillExists { path: dir });
    }
    let description = description.split_whitespace().collect::<Vec<_>>().join(" ");
    let title = name
        .split('-')
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_ascii_uppercase().to_string() + chars.as_str()
            })
        })
        .collect::<Vec<_>>()
        .join(" ");
    let content = format!(
        "---\nname: {name}\ndescription: {}\n---\n\n# {title}\n\n\
         ## When to use\n\n\
         Say when the agent should load this skill.\n\n\
         ## Instructions\n\n\
         1. The first step.\n\
         2. The next one.\n",
        serde_json::to_string(&description).unwrap_or_default()
    );
    fs::create_dir_all(&dir).map_err(|source| io_error(&dir, source))?;
    let file = dir.join("SKILL.md");
    fs::write(&file, content).map_err(|source| io_error(&file, source))?;
    Ok(dir)
}

/// Copies a skill folder with all its files so that `to` loads it.
pub fn copy(home: &Path, name: &str, from: Location, to: Agent, overwrite: bool) -> Result<()> {
    copy_to(home, name, from, Location::for_agent(to), overwrite)
}

/// Copies a skill folder to another location. With `overwrite`, the copy
/// already there moves to the trash first.
pub fn copy_to(
    home: &Path,
    name: &str,
    from: Location,
    to: Location,
    overwrite: bool,
) -> Result<()> {
    let source = skill_dir(home, from, name)?;
    if !source.join("SKILL.md").is_file() {
        return Err(Error::SkillNotFound { path: source });
    }
    let target = skill_dir(home, to, name)?;
    if target == source {
        return Ok(());
    }
    if target.exists() {
        if !overwrite {
            return Err(Error::SkillExists { path: target });
        }
        move_to_trash(home, &target)?;
    }
    copy_dir(&source, &target)
}

/// Moves a skill folder to `~/.agentdeck/trash` rather than deleting it, and
/// returns where it went.
pub fn remove(home: &Path, location: Location, name: &str) -> Result<PathBuf> {
    let dir = skill_dir(home, location, name)?;
    if !dir.exists() {
        return Err(Error::SkillNotFound { path: dir });
    }
    move_to_trash(home, &dir)
}

/// Where removed and replaced skills go: `~/.agentdeck/trash`.
pub fn trash_dir(home: &Path) -> PathBuf {
    home.join(".agentdeck").join("trash")
}

/// Deletes the trash for good. Returns how many skills it held.
pub fn empty_trash(home: &Path) -> Result<usize> {
    let count = trashed(home).len();
    let dir = trash_dir(home);
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(count),
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(source) => Err(io_error(&dir, source)),
    }
}

/// Skills in the trash, most recently removed first.
pub fn trashed(home: &Path) -> Vec<TrashedSkill> {
    let mut found = Vec::new();
    let Ok(stamps) = fs::read_dir(trash_dir(home)) else {
        return found;
    };
    for stamp in stamps.flatten() {
        let Ok(removed_ms) = stamp.file_name().to_string_lossy().parse::<u64>() else {
            continue;
        };
        for location in Location::ALL {
            let Ok(skills) = fs::read_dir(stamp.path().join(location.folder())) else {
                continue;
            };
            for skill in skills.flatten() {
                let Ok(content) = fs::read_to_string(skill.path().join("SKILL.md")) else {
                    continue;
                };
                let name = skill.file_name().to_string_lossy().into_owned();
                found.push(TrashedSkill {
                    id: format!("{removed_ms}/{}/{name}", location.folder()),
                    description: frontmatter_field(&content, "description"),
                    name,
                    location,
                    removed_ms,
                });
            }
        }
    }
    found.sort_by(|a, b| (b.removed_ms, &a.name).cmp(&(a.removed_ms, &b.name)));
    found
}

/// Puts a skill from [`trashed`] back where it was removed from. With
/// `overwrite`, a skill of the same name there moves to the trash first.
pub fn restore(home: &Path, id: &str, overwrite: bool) -> Result<Location> {
    let invalid = || Error::InvalidSkillName {
        name: id.to_owned(),
    };
    let mut parts = id.split('/');
    let (Some(stamp), Some(folder), Some(name), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(invalid());
    };
    if stamp.is_empty() || !stamp.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(invalid());
    }
    let location = Location::ALL
        .into_iter()
        .find(|location| location.folder() == folder)
        .ok_or_else(invalid)?;
    let target = skill_dir(home, location, name)?;
    let source = trash_dir(home).join(stamp).join(folder).join(name);
    if !source.join("SKILL.md").is_file() {
        return Err(Error::SkillNotFound { path: source });
    }
    if target.exists() {
        if !overwrite {
            return Err(Error::SkillExists { path: target });
        }
        move_to_trash(home, &target)?;
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }
    if fs::rename(&source, &target).is_err() {
        copy_dir(&source, &target)?;
        fs::remove_dir_all(&source).map_err(|err| io_error(&source, err))?;
    }
    // Leave no empty folders behind; ones that still hold something stay.
    if let Some(folder) = source.parent() {
        let _ = fs::remove_dir(folder);
        if let Some(stamp) = folder.parent() {
            let _ = fs::remove_dir(stamp);
        }
    }
    Ok(location)
}

/// Latest modification time and content hash of every file below `dir`.
fn fingerprint(dir: &Path) -> (u64, u64) {
    // FNV-1a over each file's relative path and content, in sorted order.
    fn feed(hash: u64, bytes: &[u8]) -> u64 {
        bytes.iter().fold(hash, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
        })
    }
    let mut files = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(current) = pending.pop() {
        for entry in fs::read_dir(&current).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                files.push(path);
            }
        }
    }
    files.sort();
    let mut hash = 0xcbf2_9ce4_8422_2325;
    let mut modified = 0;
    for file in files {
        let relative = file.strip_prefix(dir).unwrap_or(&file);
        hash = feed(
            hash,
            relative.to_string_lossy().replace('\\', "/").as_bytes(),
        );
        hash = feed(hash, &fs::read(&file).unwrap_or_default());
        let time = fs::metadata(&file)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |time| time.as_millis() as u64);
        modified = modified.max(time);
    }
    (modified, hash)
}

/// Rejects names that would escape the skills folder.
pub fn skill_dir(home: &Path, location: Location, name: &str) -> Result<PathBuf> {
    let valid = !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':'])
        && !name.contains('\0');
    if !valid {
        return Err(Error::InvalidSkillName {
            name: name.to_owned(),
        });
    }
    Ok(location.path(home).join(name))
}

pub(crate) fn move_to_trash(home: &Path, dir: &Path) -> Result<PathBuf> {
    let mut stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Keep the agent folder name so a restore knows where the skill came from.
    let origin = dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .unwrap_or_default();
    let name = dir.file_name().unwrap_or_default();
    // A skill trashed twice in the same millisecond gets the next one.
    while trash_dir(home)
        .join(stamp.to_string())
        .join(origin)
        .join(name)
        .exists()
    {
        stamp += 1;
    }
    let trash = trash_dir(home).join(stamp.to_string()).join(origin);
    fs::create_dir_all(&trash).map_err(|source| io_error(&trash, source))?;
    let destination = trash.join(name);
    if fs::rename(dir, &destination).is_err() {
        // Renaming fails across drives: copy, then delete.
        copy_dir(dir, &destination)?;
        fs::remove_dir_all(dir).map_err(|source| io_error(dir, source))?;
    }
    Ok(destination)
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to).map_err(|source| io_error(to, source))?;
    let entries = fs::read_dir(from).map_err(|source| io_error(from, source))?;
    for entry in entries {
        let entry = entry.map_err(|source| io_error(from, source))?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            copy_dir(&source, &target)?;
        } else {
            fs::copy(&source, &target).map_err(|err| io_error(&source, err))?;
        }
    }
    Ok(())
}

fn io_error(path: &Path, source: std::io::Error) -> Error {
    Error::Io {
        path: path.to_path_buf(),
        source,
    }
}

/// Reads a single-line field of the YAML frontmatter.
fn frontmatter_field(content: &str, key: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    lines
        .take_while(|line| line.trim() != "---")
        .find_map(|line| {
            let value = line.strip_prefix(key)?.trim_start().strip_prefix(':')?;
            let value = value.trim().trim_matches(['"', '\'']);
            (!value.is_empty() && value != ">" && value != "|").then(|| value.to_owned())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_skill(home: &Path, location: Location, name: &str) {
        let dir = location.path(home).join(name);
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: \"Does {name} things\"\n---\n# {name}\n"),
        )
        .unwrap();
        fs::write(dir.join("scripts/run.sh"), "echo hi").unwrap();
    }

    #[test]
    fn lists_skills_with_their_readers() {
        let home = tempfile::tempdir().unwrap();
        make_skill(home.path(), Location::ClaudeCode, "pdf");
        make_skill(home.path(), Location::Shared, "deploy");
        fs::create_dir_all(Location::Gemini.path(home.path()).join("not-a-skill")).unwrap();

        let (skills, errors) = list(home.path());
        assert!(errors.is_empty());
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].name, "deploy");
        assert_eq!(
            skills[0].readers,
            [Agent::Codex, Agent::Gemini, Agent::Cursor]
        );
        assert_eq!(skills[1].description.as_deref(), Some("Does pdf things"));
    }

    #[test]
    fn copy_brings_every_file_and_remove_goes_to_trash() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        make_skill(home, Location::ClaudeCode, "pdf");

        copy(home, "pdf", Location::ClaudeCode, Agent::Codex, false).unwrap();
        let copied = Location::Shared.path(home).join("pdf");
        assert!(copied.join("scripts/run.sh").is_file());
        assert!(
            read(home, Location::Shared, "pdf")
                .unwrap()
                .contains("# pdf")
        );

        let err = copy(home, "pdf", Location::ClaudeCode, Agent::Codex, false).unwrap_err();
        assert!(matches!(err, Error::SkillExists { .. }));

        let trashed = remove(home, Location::Shared, "pdf").unwrap();
        assert!(!copied.exists());
        assert!(trashed.join("SKILL.md").is_file());
        assert!(trashed.starts_with(home.join(".agentdeck/trash")));
    }

    #[test]
    fn emptying_the_trash_deletes_removed_skills() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        assert_eq!(empty_trash(home).unwrap(), 0);
        make_skill(home, Location::ClaudeCode, "pdf");
        make_skill(home, Location::Shared, "pdf");
        remove(home, Location::ClaudeCode, "pdf").unwrap();
        remove(home, Location::Shared, "pdf").unwrap();
        assert_eq!(empty_trash(home).unwrap(), 2);
        assert!(trashed(home).is_empty());
        assert!(!trash_dir(home).exists());
    }

    #[test]
    fn copies_are_compared_replaced_and_restored_from_the_trash() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        make_skill(home, Location::ClaudeCode, "pdf");
        copy(home, "pdf", Location::ClaudeCode, Agent::Codex, false).unwrap();
        let hashes = |home: &Path| -> Vec<String> {
            list(home).0.into_iter().map(|skill| skill.hash).collect()
        };
        let same = hashes(home);
        assert_eq!(same[0], same[1]);

        let edited = Location::Shared.path(home).join("pdf/scripts/run.sh");
        fs::write(&edited, "echo changed").unwrap();
        let differ = hashes(home);
        assert_ne!(differ[0], differ[1]);

        // Use the Codex copy for Claude Code too: the old one goes to the trash.
        copy_to(home, "pdf", Location::Shared, Location::ClaudeCode, true).unwrap();
        let replaced = Location::ClaudeCode.path(home).join("pdf/scripts/run.sh");
        assert_eq!(fs::read_to_string(&replaced).unwrap(), "echo changed");
        let trash = trashed(home);
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].location, Location::ClaudeCode);
        assert_eq!(trash[0].description.as_deref(), Some("Does pdf things"));

        // Restoring over the current copy needs `overwrite`, and swaps them.
        let err = restore(home, &trash[0].id, false).unwrap_err();
        assert!(matches!(err, Error::SkillExists { .. }));
        restore(home, &trash[0].id, true).unwrap();
        assert_eq!(fs::read_to_string(&replaced).unwrap(), "echo hi");
        let trash = trashed(home);
        assert_eq!(trash.len(), 1);
        restore(home, &trash[0].id, true).unwrap();
        assert_eq!(fs::read_to_string(&replaced).unwrap(), "echo changed");

        for id in [
            "../x/pdf",
            "1/.ssh/pdf",
            "1/.claude/..",
            "1/.claude/pdf/x",
            "x/.claude/pdf",
        ] {
            assert!(restore(home, id, true).is_err(), "{id}");
        }
    }

    #[test]
    fn rejects_names_outside_the_skills_folder() {
        let home = tempfile::tempdir().unwrap();
        for name in ["", "..", "../x", "a/b", "a\\b"] {
            let err = remove(home.path(), Location::Cursor, name).unwrap_err();
            assert!(matches!(err, Error::InvalidSkillName { .. }), "{name}");
        }
    }

    #[test]
    fn a_new_skill_starts_from_a_template() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let dir = create(
            home,
            Location::Shared,
            "pdf-tools",
            "Split and merge PDF files: fast.",
        )
        .unwrap();
        assert_eq!(dir, home.join(".agents/skills/pdf-tools"));
        let content = read(home, Location::Shared, "pdf-tools").unwrap();
        assert!(content.starts_with("---\nname: pdf-tools\n"));
        assert!(content.contains("# Pdf Tools"));
        assert_eq!(
            frontmatter_field(&content, "description").as_deref(),
            Some("Split and merge PDF files: fast.")
        );

        let (skills, _) = list(home);
        assert_eq!(skills[0].name, "pdf-tools");
        assert_eq!(
            files(home, Location::Shared, "pdf-tools").unwrap(),
            [SkillFile {
                path: "SKILL.md".into(),
                size: content.len() as u64
            }]
        );

        let err = create(home, Location::Shared, "pdf-tools", "Again").unwrap_err();
        assert!(matches!(err, Error::SkillExists { .. }));
        for bad in ["PDF", "pdf tools", "-pdf", "pdf--tools", "../pdf", ""] {
            assert!(create(home, Location::Shared, bad, "x").is_err(), "{bad}");
        }
    }

    #[test]
    fn files_lists_nested_resources() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        make_skill(home, Location::ClaudeCode, "pdf");
        fs::write(home.join(".claude/skills/pdf/scripts/split.py"), "print()").unwrap();
        let paths: Vec<_> = files(home, Location::ClaudeCode, "pdf")
            .unwrap()
            .into_iter()
            .map(|file| file.path)
            .collect();
        assert_eq!(paths, ["SKILL.md", "scripts/run.sh", "scripts/split.py"]);
    }
}
