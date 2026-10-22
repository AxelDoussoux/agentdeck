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
            skills.push(Skill {
                name: entry.file_name().to_string_lossy().into_owned(),
                description: frontmatter_field(&content, "description"),
                location,
                path,
                readers: location.readers().to_vec(),
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

/// Copies a skill folder with all its files so that `to` loads it.
pub fn copy(home: &Path, name: &str, from: Location, to: Agent, overwrite: bool) -> Result<()> {
    let source = skill_dir(home, from, name)?;
    if !source.join("SKILL.md").is_file() {
        return Err(Error::SkillNotFound { path: source });
    }
    let target = skill_dir(home, Location::for_agent(to), name)?;
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

/// Rejects names that would escape the skills folder.
fn skill_dir(home: &Path, location: Location, name: &str) -> Result<PathBuf> {
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

fn move_to_trash(home: &Path, dir: &Path) -> Result<PathBuf> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Keep the agent folder name so a restore knows where the skill came from.
    let origin = dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .unwrap_or_default();
    let trash = home
        .join(".agentdeck")
        .join("trash")
        .join(stamp.to_string())
        .join(origin);
    fs::create_dir_all(&trash).map_err(|source| io_error(&trash, source))?;
    let destination = trash.join(dir.file_name().unwrap_or_default());
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
    fn rejects_names_outside_the_skills_folder() {
        let home = tempfile::tempdir().unwrap();
        for name in ["", "..", "../x", "a/b", "a\\b"] {
            let err = remove(home.path(), Location::Cursor, name).unwrap_err();
            assert!(matches!(err, Error::InvalidSkillName { .. }), "{name}");
        }
    }
}
