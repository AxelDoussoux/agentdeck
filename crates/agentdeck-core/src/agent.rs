use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
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

    /// The variable that moves the agent's folder elsewhere, if any.
    pub fn folder_variable(self) -> Option<&'static str> {
        match self {
            Agent::ClaudeCode => Some("CLAUDE_CONFIG_DIR"),
            Agent::Codex => Some("CODEX_HOME"),
            Agent::Cursor | Agent::Gemini => None,
        }
    }

    /// The folder set by [`Agent::folder_variable`], when it is set.
    pub fn variable_folder(self, home: &Path) -> Option<PathBuf> {
        if cfg!(test) {
            return None;
        }
        let value = std::env::var_os(self.folder_variable()?)?;
        folder_from(&value, home)
    }

    /// Where the agent's folder was moved: by its variable, which is what
    /// the agent itself reads, or else by a folder chosen in AgentDeck.
    fn moved_folder(self, home: &Path) -> Option<PathBuf> {
        self.variable_folder(home)
            .or_else(|| chosen_folders(home).ok()?.remove(&self))
    }

    /// The agent's own folder: `~/.claude`, `~/.codex`, `~/.cursor` or
    /// `~/.gemini`, unless `CLAUDE_CONFIG_DIR` or `CODEX_HOME` moves it, or
    /// another folder was chosen with [`choose_folder`].
    pub fn folder(self, home: &Path) -> PathBuf {
        self.moved_folder(home)
            .unwrap_or_else(|| self.default_folder(home))
    }

    /// The folder the agent uses when nothing moves it.
    fn default_folder(self, home: &Path) -> PathBuf {
        home.join(match self {
            Agent::ClaudeCode => ".claude",
            Agent::Codex => ".codex",
            Agent::Cursor => ".cursor",
            Agent::Gemini => ".gemini",
        })
    }

    /// User-level file holding this agent's MCP servers.
    pub fn mcp_config_path(self, home: &Path) -> PathBuf {
        match self {
            // `~/.claude.json` sits next to `~/.claude`, but inside the
            // folder `CLAUDE_CONFIG_DIR` names.
            Agent::ClaudeCode => self
                .moved_folder(home)
                .unwrap_or_else(|| home.to_path_buf())
                .join(".claude.json"),
            Agent::Codex => self.folder(home).join("config.toml"),
            Agent::Cursor => self.folder(home).join("mcp.json"),
            Agent::Gemini => self.folder(home).join("settings.json"),
        }
    }

    /// User-level instructions file loaded into every session. Cursor stores
    /// its user rules in its settings database instead.
    pub fn rules_path(self, home: &Path) -> Option<PathBuf> {
        let file = match self {
            Agent::ClaudeCode => "CLAUDE.md",
            Agent::Codex => "AGENTS.md",
            Agent::Cursor => return None,
            Agent::Gemini => "GEMINI.md",
        };
        Some(self.folder(home).join(file))
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
                self.folder(home).join("local/claude"),
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
                || self.folder(home).is_dir()
                || self.install_paths(home).iter().any(|path| path.exists())
                || self.commands().iter().any(|command| on_path(command)),
            has_config,
            mcp_config_path,
            rules_path: self.rules_path(home),
        }
    }
}

/// A folder variable's value: `~` stands for `home`, and a relative path is
/// taken from `home`. Empty means unset.
fn folder_from(value: &std::ffi::OsStr, home: &Path) -> Option<PathBuf> {
    let value = Path::new(value);
    if value.as_os_str().is_empty() {
        return None;
    }
    Some(match value.strip_prefix("~") {
        Ok(rest) => home.join(rest),
        Err(_) => home.join(value),
    })
}

fn chosen_folders_path(home: &Path) -> PathBuf {
    home.join(".agentdeck").join("folders.json")
}

/// The folders chosen for agents that do not keep their files in the
/// default place, kept in `~/.agentdeck/folders.json`. An app opened from
/// the macOS Finder does not see `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, so
/// this is also how it finds a folder those variables move.
pub fn chosen_folders(home: &Path) -> Result<BTreeMap<Agent, PathBuf>> {
    let path = chosen_folders_path(home);
    match fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|source| Error::Json { path, source })
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(source) => Err(Error::Io { path, source }),
    }
}

/// Makes AgentDeck read and write `agent`'s files in `folder`, which must
/// exist, or in its default folder again with `None` or that folder. `~`
/// stands for `home`. Its variable, when set, still comes first.
pub fn choose_folder(home: &Path, agent: Agent, folder: Option<&Path>) -> Result<()> {
    let mut chosen = chosen_folders(home)?;
    match folder.and_then(|folder| folder_from(folder.as_os_str(), home)) {
        Some(folder) => {
            let meta = fs::metadata(&folder).map_err(|source| Error::Io {
                path: folder.clone(),
                source,
            })?;
            if !meta.is_dir() {
                return Err(Error::Invalid {
                    path: folder,
                    reason: "it is not a folder",
                });
            }
            // Not kept as a move: Claude Code's `.claude.json` sits next to
            // its default folder, but inside a moved one.
            if folder == agent.default_folder(home) {
                chosen.remove(&agent);
            } else {
                chosen.insert(agent, folder);
            }
        }
        None => {
            chosen.remove(&agent);
        }
    }
    let path = chosen_folders_path(home);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|source| Error::Io {
            path: dir.to_path_buf(),
            source,
        })?;
    }
    let content = serde_json::to_string_pretty(&chosen).unwrap_or_default();
    fs::write(&path, content).map_err(|source| Error::Io { path, source })
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

    #[test]
    fn a_chosen_folder_moves_every_file_of_the_agent() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let elsewhere = home.join("work/claude");
        fs::create_dir_all(&elsewhere).unwrap();

        choose_folder(home, Agent::ClaudeCode, Some(Path::new("~/work/claude"))).unwrap();
        assert_eq!(Agent::ClaudeCode.folder(home), elsewhere);
        // Like with CLAUDE_CONFIG_DIR, `.claude.json` moves into the folder.
        assert_eq!(
            Agent::ClaudeCode.mcp_config_path(home),
            elsewhere.join(".claude.json")
        );
        assert_eq!(
            Agent::ClaudeCode.rules_path(home),
            Some(elsewhere.join("CLAUDE.md"))
        );
        assert_eq!(Agent::Codex.folder(home), home.join(".codex"));

        choose_folder(home, Agent::ClaudeCode, None).unwrap();
        assert_eq!(Agent::ClaudeCode.folder(home), home.join(".claude"));
        assert!(chosen_folders(home).unwrap().is_empty());
    }

    #[test]
    fn choosing_the_default_folder_is_no_move() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        fs::create_dir_all(home.join(".claude")).unwrap();
        choose_folder(home, Agent::ClaudeCode, Some(&home.join(".claude"))).unwrap();
        assert!(chosen_folders(home).unwrap().is_empty());
        assert_eq!(
            Agent::ClaudeCode.mcp_config_path(home),
            home.join(".claude.json")
        );
    }

    #[test]
    fn only_an_existing_folder_can_be_chosen() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let missing = choose_folder(home, Agent::Codex, Some(&home.join("nowhere")));
        assert!(matches!(missing, Err(Error::Io { .. })));
        fs::write(home.join("file"), "").unwrap();
        let file = choose_folder(home, Agent::Codex, Some(&home.join("file")));
        assert!(matches!(file, Err(Error::Invalid { .. })));
        assert!(chosen_folders(home).unwrap().is_empty());
    }

    #[test]
    fn folder_variables_resolve_from_home() {
        let home = Path::new("/home/me");
        let folder = |value: &str| folder_from(std::ffi::OsStr::new(value), home);
        assert_eq!(folder(""), None);
        assert_eq!(folder("~/work/.codex"), Some(home.join("work/.codex")));
        assert_eq!(folder("/srv/claude"), Some(PathBuf::from("/srv/claude")));
        assert_eq!(folder("conf/claude"), Some(home.join("conf/claude")));
    }
}
