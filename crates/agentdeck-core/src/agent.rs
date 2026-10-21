use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// An AI coding agent whose configuration AgentDeck can manage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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
    pub installed: bool,
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

    pub fn info(self, home: &Path) -> AgentInfo {
        let mcp_config_path = self.mcp_config_path(home);
        AgentInfo {
            agent: self,
            name: self.display_name(),
            installed: mcp_config_path.exists(),
            mcp_config_path,
        }
    }
}

pub fn home_dir() -> Result<PathBuf> {
    dirs::home_dir().ok_or(Error::NoHomeDir)
}

/// Lists every supported agent and whether its config exists under `home`.
pub fn detect(home: &Path) -> Vec<AgentInfo> {
    Agent::ALL.iter().map(|agent| agent.info(home)).collect()
}
