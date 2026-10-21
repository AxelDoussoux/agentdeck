use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Agent, Error, Result};

/// How an MCP server is reached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Transport {
    Stdio { command: String, args: Vec<String> },
    Http { url: String },
}

/// One MCP server as declared in an agent's configuration.
///
/// Environment values are never exposed: they often hold API keys, so only
/// the variable names are kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub agent: Agent,
    pub name: String,
    pub transport: Transport,
    pub env_keys: Vec<String>,
}

/// The shape shared by the JSON configs of Claude Code, Cursor and Gemini,
/// and by the TOML tables of Codex.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServer {
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, serde_json::Value>,
    url: Option<String>,
    http_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JsonConfig {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: BTreeMap<String, RawServer>,
}

#[derive(Debug, Deserialize)]
struct CodexConfig {
    #[serde(default)]
    mcp_servers: BTreeMap<String, RawServer>,
}

impl RawServer {
    fn into_server(self, agent: Agent, name: String) -> Option<McpServer> {
        let transport = match (self.command, self.url.or(self.http_url)) {
            (Some(command), _) => Transport::Stdio {
                command,
                args: self.args,
            },
            (None, Some(url)) => Transport::Http { url },
            (None, None) => return None,
        };
        Some(McpServer {
            agent,
            name,
            transport,
            env_keys: self.env.into_keys().collect(),
        })
    }
}

/// Reads the user-level MCP servers of `agent`. A missing config file is not
/// an error: the agent is simply not installed.
pub fn list_for_agent(agent: Agent, home: &Path) -> Result<Vec<McpServer>> {
    let path = agent.mcp_config_path(home);
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(source) => return Err(Error::Io { path, source }),
    };

    let raw = match agent {
        Agent::Codex => {
            toml::from_str::<CodexConfig>(&content)
                .map_err(|source| Error::Toml { path, source })?
                .mcp_servers
        }
        _ => {
            serde_json::from_str::<JsonConfig>(&content)
                .map_err(|source| Error::Json { path, source })?
                .mcp_servers
        }
    };

    Ok(raw
        .into_iter()
        .filter_map(|(name, server)| server.into_server(agent, name))
        .collect())
}

/// Reads the MCP servers of every supported agent. Agents whose config cannot
/// be parsed are reported in the second list instead of failing the whole call.
pub fn list_all(home: &Path) -> (Vec<McpServer>, Vec<(Agent, Error)>) {
    let mut servers = Vec::new();
    let mut errors = Vec::new();
    for agent in Agent::ALL {
        match list_for_agent(agent, home) {
            Ok(found) => servers.extend(found),
            Err(err) => errors.push((agent, err)),
        }
    }
    (servers, errors)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(home: &Path, relative: &str, content: &str) {
        let path = home.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn reads_every_agent_format() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        write(
            home,
            ".claude.json",
            r#"{"numStartups": 3, "mcpServers": {"github": {"type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": {"GITHUB_TOKEN": "secret"}}}}"#,
        );
        write(
            home,
            ".codex/config.toml",
            "model = \"o4\"\n[mcp_servers.docs]\ncommand = \"uvx\"\nargs = [\"docs-mcp\"]\n",
        );
        write(
            home,
            ".cursor/mcp.json",
            r#"{"mcpServers": {"linear": {"url": "https://mcp.linear.app/sse"}}}"#,
        );
        write(
            home,
            ".gemini/settings.json",
            r#"{"theme": "dark", "mcpServers": {"remote": {"httpUrl": "https://example.com/mcp"}}}"#,
        );

        let (servers, errors) = list_all(home);
        assert!(errors.is_empty());
        assert_eq!(servers.len(), 4);

        let github = &servers[0];
        assert_eq!(github.agent, Agent::ClaudeCode);
        assert_eq!(github.env_keys, vec!["GITHUB_TOKEN"]);
        assert_eq!(
            servers[3].transport,
            Transport::Http {
                url: "https://example.com/mcp".into()
            }
        );
    }

    #[test]
    fn missing_config_is_empty_and_broken_config_is_reported() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".cursor/mcp.json", "{ not json");

        let (servers, errors) = list_all(home.path());
        assert!(servers.is_empty());
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].0, Agent::Cursor);
    }
}
