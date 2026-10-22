use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// An AI coding agent whose configuration AgentDeck can manage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Agent {
    ClaudeCode,
    Codex,
    Cursor,
    Gemini,
}

/// What AgentDeck knows about an agent on this machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub agent: Agent,
    pub name: &'static str,
    pub mcp_config_path: PathBuf,
    /// `None` when the agent keeps its global rules outside of a file.
    pub rules_path: Option<PathBuf>,
    /// The agent is on this computer: its config, its folder, its command or
    /// its app was found.
    pub installed: bool,
    /// Its MCP config file exists. An installed agent may not have one yet.
    pub has_config: bool,
}

impl Agent {
    pub const ALL: [Agent; 4] = [
        Agent::ClaudeCode,
        Agent::Codex,
        Agent::Cursor,
        Agent::Gemini,
    ];

    pub fn display_name(self) -> &'static str {
        match self {
            Agent::ClaudeCode => "Claude Code",
            Agent::Codex => "Codex",
            Agent::Cursor => "Cursor",
            Agent::Gemini => "Gemini CLI",
        }
    }

    /// User-level file holding this agent's MCP servers, relative to `home`.
    pub fn mcp_config_path(self, home: &Path) -> PathBuf {
        match self {
            Agent::ClaudeCode => home.join(".claude.json"),
            Agent::Codex => home.join(".codex").join("config.toml"),
            Agent::Cursor => home.join(".cursor").join("mcp.json"),
            Agent::Gemini => home.join(".gemini").join("settings.json"),
        }
    }

    /// User-level instructions file loaded into every session, relative to
    /// `home`. Cursor stores its user rules in its settings database instead.
    pub fn rules_path(self, home: &Path) -> Option<PathBuf> {
        match self {
            Agent::ClaudeCode => Some(home.join(".claude").join("CLAUDE.md")),
            Agent::Codex => Some(home.join(".codex").join("AGENTS.md")),
            Agent::Cursor => None,
            Agent::Gemini => Some(home.join(".gemini").join("GEMINI.md")),
        }
    }

    /// The folder the agent creates in `home` on first run.
    fn home_folder(self, home: &Path) -> PathBuf {
        match self {
            Agent::ClaudeCode => home.join(".claude"),
            Agent::Codex => home.join(".codex"),
            Agent::Cursor => home.join(".cursor"),
            Agent::Gemini => home.join(".gemini"),
        }
    }

    /// Commands that start the agent.
    fn commands(self) -> &'static [&'static str] {
        match self {
            Agent::ClaudeCode => &["claude"],
            Agent::Codex => &["codex"],
            Agent::Cursor => &["cursor", "cursor-agent"],
            Agent::Gemini => &["gemini"],
        }
    }

    /// Install locations outside the PATH, which apps opened from the Finder
    /// or the Start menu often do not get in full.
    fn install_paths(self, home: &Path) -> Vec<PathBuf> {
        match self {
            Agent::ClaudeCode => vec![
                home.join(".local/bin/claude"),
                home.join(".claude/local/claude"),
            ],
            Agent::Cursor => vec![
                PathBuf::from("/Applications/Cursor.app"),
                home.join("Applications/Cursor.app"),
                home.join("AppData/Local/Programs/cursor/Cursor.exe"),
                home.join(".local/bin/cursor-agent"),
            ],
            Agent::Codex | Agent::Gemini => Vec::new(),
        }
    }

    pub fn info(self, home: &Path) -> AgentInfo {
        let mcp_config_path = self.mcp_config_path(home);
        let has_config = mcp_config_path.is_file();
        AgentInfo {
            agent: self,
            name: self.display_name(),
            installed: has_config
                || self.home_folder(home).is_dir()
                || self.install_paths(home).iter().any(|path| path.exists())
                || self.commands().iter().any(|command| on_path(command)),
            has_config,
            mcp_config_path,
            rules_path: self.rules_path(home),
        }
    }
}

/// Whether `command` names an executable in one of the PATH folders.
pub(crate) fn on_path(command: &str) -> bool {
    let with_suffix = format!("{command}{}", std::env::consts::EXE_SUFFIX);
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths)
            .any(|dir| dir.join(command).is_file() || dir.join(&with_suffix).is_file())
    })
}

pub fn home_dir() -> Result<PathBuf> {
    dirs::home_dir().ok_or(Error::NoHomeDir)
}

/// Lists every supported agent and whether it is installed under `home`.
pub fn detect(home: &Path) -> Vec<AgentInfo> {
    Agent::ALL.iter().map(|agent| agent.info(home)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn an_agent_without_a_config_can_still_be_installed() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        fs::create_dir_all(home.join(".gemini")).unwrap();
        fs::create_dir_all(home.join(".codex")).unwrap();
        fs::write(home.join(".codex/config.toml"), "").unwrap();

        let gemini = Agent::Gemini.info(home);
        assert!(gemini.installed && !gemini.has_config);
        let codex = Agent::Codex.info(home);
        assert!(codex.installed && codex.has_config);
        assert!(!Agent::Cursor.info(home).has_config);
    }
}
