//! Global rules: the instructions file each agent loads into every session.

use std::path::Path;

use serde::Serialize;

use crate::{Agent, Error, Result, config_file};

/// The global rules of one agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    pub agent: Agent,
    /// `None` when the file does not exist yet.
    pub content: Option<String>,
}

fn rules_path(agent: Agent, home: &Path) -> Result<std::path::PathBuf> {
    agent.rules_path(home).ok_or(Error::NoRulesFile { agent })
}

pub fn read(agent: Agent, home: &Path) -> Result<Rules> {
    let content = config_file::read_optional(&rules_path(agent, home)?)?;
    Ok(Rules { agent, content })
}

/// Reads the rules of every agent that keeps them in a file.
pub fn read_all(home: &Path) -> (Vec<Rules>, Vec<(Agent, Error)>) {
    let mut rules = Vec::new();
    let mut errors = Vec::new();
    for agent in Agent::ALL {
        if agent.rules_path(home).is_none() {
            continue;
        }
        match read(agent, home) {
            Ok(found) => rules.push(found),
            Err(err) => errors.push((agent, err)),
        }
    }
    (rules, errors)
}

/// Replaces the rules of `agent`, keeping the previous file as a backup.
pub fn write(agent: Agent, home: &Path, content: &str) -> Result<()> {
    config_file::write(&rules_path(agent, home)?, content)
}

/// Copies the rules of `from` over those of `to`.
pub fn copy(home: &Path, from: Agent, to: Agent) -> Result<()> {
    let content = read(from, home)?.content.unwrap_or_default();
    write(to, home, &content)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn write_read_and_copy() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();

        assert_eq!(read(Agent::Codex, home).unwrap().content, None);
        write(Agent::ClaudeCode, home, "# Rules\nUse pnpm.\n").unwrap();
        copy(home, Agent::ClaudeCode, Agent::Gemini).unwrap();

        let gemini = read(Agent::Gemini, home).unwrap();
        assert_eq!(gemini.content.as_deref(), Some("# Rules\nUse pnpm.\n"));
        assert!(home.join(".gemini/GEMINI.md").exists());

        write(Agent::Gemini, home, "changed").unwrap();
        let backup = fs::read_to_string(home.join(".gemini/GEMINI.md.agentdeck.bak")).unwrap();
        assert_eq!(backup, "# Rules\nUse pnpm.\n");

        let (all, errors) = read_all(home);
        assert!(errors.is_empty());
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn cursor_has_no_rules_file() {
        let home = tempfile::tempdir().unwrap();
        let err = write(Agent::Cursor, home.path(), "x").unwrap_err();
        assert!(matches!(err, Error::NoRulesFile { .. }));
    }
}
