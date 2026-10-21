use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{Agent, Error, Result, config_file};

/// How an MCP server is reached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Transport {
    Stdio {
        command: String,
        args: Vec<String>,
    },
    /// Streamable HTTP.
    Http {
        url: String,
    },
    /// Legacy HTTP + Server-Sent Events.
    Sse {
        url: String,
    },
}

/// One MCP server as declared in an agent's configuration.
///
/// Environment and header values are never exposed: they often hold API keys,
/// so only their names are kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub agent: Agent,
    pub name: String,
    pub transport: Transport,
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
}

/// Everything needed to write an MCP server into an agent's config,
/// secrets included. It only travels from the UI to the core, never back.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ServerSpec {
    pub transport: Transport,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

/// The shape shared by the JSON configs of Claude Code, Cursor and Gemini,
/// and by the TOML tables of Codex.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServer {
    #[serde(rename = "type")]
    kind: Option<String>,
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, Value>,
    url: Option<String>,
    http_url: Option<String>,
    #[serde(default)]
    headers: BTreeMap<String, Value>,
    #[serde(default, rename = "http_headers")]
    codex_headers: BTreeMap<String, Value>,
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
    fn into_spec(self, agent: Agent) -> Option<ServerSpec> {
        let transport = if let Some(command) = self.command {
            Transport::Stdio {
                command,
                args: self.args,
            }
        } else if let Some(url) = self.http_url {
            Transport::Http { url }
        } else {
            let url = self.url?;
            // Gemini uses `url` for SSE and `httpUrl` for streamable HTTP.
            let sse = match agent {
                Agent::Gemini => true,
                Agent::ClaudeCode => self.kind.as_deref() == Some("sse"),
                Agent::Codex | Agent::Cursor => false,
            };
            if sse {
                Transport::Sse { url }
            } else {
                Transport::Http { url }
            }
        };

        let mut headers = self.headers;
        headers.extend(self.codex_headers);
        Some(ServerSpec {
            transport,
            env: into_strings(self.env),
            headers: into_strings(headers),
        })
    }
}

fn into_strings(map: BTreeMap<String, Value>) -> BTreeMap<String, String> {
    map.into_iter()
        .map(|(key, value)| match value {
            Value::String(text) => (key, text),
            other => (key, other.to_string()),
        })
        .collect()
}

/// Reads every MCP server of `agent`, secrets included.
pub(crate) fn read_specs(agent: Agent, home: &Path) -> Result<BTreeMap<String, ServerSpec>> {
    let path = agent.mcp_config_path(home);
    let Some(content) = config_file::read_optional(&path)? else {
        return Ok(BTreeMap::new());
    };

    let raw = match agent {
        Agent::Codex => {
            toml::from_str::<CodexConfig>(&content)
                .map_err(|source| Error::Toml {
                    path,
                    source: Box::new(source),
                })?
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
        .filter_map(|(name, server)| Some((name, server.into_spec(agent)?)))
        .collect())
}

/// Reads the user-level MCP servers of `agent`. A missing config file is not
/// an error: the agent is simply not installed.
pub fn list_for_agent(agent: Agent, home: &Path) -> Result<Vec<McpServer>> {
    Ok(read_specs(agent, home)?
        .into_iter()
        .map(|(name, spec)| McpServer {
            agent,
            name,
            transport: spec.transport,
            env_keys: spec.env.into_keys().collect(),
            header_keys: spec.headers.into_keys().collect(),
        })
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

/// Adds an MCP server to `agent`, or replaces it when `overwrite` is set.
/// Every other setting of the config file is kept as is.
pub fn add(
    agent: Agent,
    home: &Path,
    name: &str,
    spec: &ServerSpec,
    overwrite: bool,
) -> Result<()> {
    edit(
        agent,
        home,
        Edit::Upsert {
            name,
            spec,
            overwrite,
        },
    )
}

/// Removes an MCP server from `agent`.
pub fn remove(agent: Agent, home: &Path, name: &str) -> Result<()> {
    edit(agent, home, Edit::Remove { name })
}

/// Copies an MCP server, secrets included, from one agent to another. The
/// secrets never leave the core.
pub fn copy(home: &Path, name: &str, from: Agent, to: Agent, overwrite: bool) -> Result<()> {
    let spec = read_specs(from, home)?
        .remove(name)
        .ok_or_else(|| Error::NotFound {
            agent: from,
            name: name.to_owned(),
        })?;
    add(to, home, name, &spec, overwrite)
}

/// Changes the command, arguments and environment of an existing stdio
/// server, leaving every other setting of its entry untouched.
pub(crate) fn set_launch(
    agent: Agent,
    home: &Path,
    name: &str,
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
) -> Result<()> {
    edit(
        agent,
        home,
        Edit::Launch {
            name,
            command,
            args,
            env,
        },
    )
}

enum Edit<'a> {
    Upsert {
        name: &'a str,
        spec: &'a ServerSpec,
        overwrite: bool,
    },
    Remove {
        name: &'a str,
    },
    /// Changes how an existing stdio server is started, keeping its other settings.
    Launch {
        name: &'a str,
        command: &'a str,
        args: &'a [String],
        env: &'a BTreeMap<String, String>,
    },
}

impl Edit<'_> {
    fn name(&self) -> &str {
        match self {
            Edit::Upsert { name, .. } | Edit::Remove { name } | Edit::Launch { name, .. } => name,
        }
    }

    /// Checks the edit against the current entries, by name.
    fn check(&self, agent: Agent, exists: bool) -> Result<()> {
        let name = self.name().to_owned();
        match self {
            Edit::Upsert {
                overwrite: false, ..
            } if exists => Err(Error::AlreadyExists { agent, name }),
            Edit::Remove { .. } | Edit::Launch { .. } if !exists => {
                Err(Error::NotFound { agent, name })
            }
            _ => Ok(()),
        }
    }
}

fn edit(agent: Agent, home: &Path, edit: Edit) -> Result<()> {
    let path = agent.mcp_config_path(home);
    let content = config_file::read_optional(&path)?.unwrap_or_default();
    let updated = match agent {
        Agent::Codex => edit_toml(&path, &content, &edit)?,
        _ => edit_json(agent, &path, &content, &edit)?,
    };
    config_file::write(&path, &updated)
}

fn edit_json(agent: Agent, path: &Path, content: &str, edit: &Edit) -> Result<String> {
    let mut root: Value = if content.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str(content).map_err(|source| Error::Json {
            path: path.to_path_buf(),
            source,
        })?
    };
    let invalid = |reason| Error::Invalid {
        path: path.to_path_buf(),
        reason,
    };
    let servers = root
        .as_object_mut()
        .ok_or_else(|| invalid("the root is not an object"))?
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| invalid("\"mcpServers\" is not an object"))?;

    edit.check(agent, servers.contains_key(edit.name()))?;
    match edit {
        Edit::Upsert { name, spec, .. } => {
            servers.insert((*name).to_owned(), json_entry(agent, spec));
        }
        Edit::Remove { name } => {
            servers.remove(*name);
        }
        Edit::Launch {
            name,
            command,
            args,
            env,
        } => {
            let entry = servers
                .get_mut(*name)
                .and_then(Value::as_object_mut)
                .ok_or_else(|| invalid("an MCP server entry is not an object"))?;
            entry.insert("command".into(), (*command).into());
            entry.insert("args".into(), args.to_vec().into());
            if env.is_empty() {
                entry.remove("env");
            } else {
                let object = env
                    .iter()
                    .map(|(k, v)| (k.clone(), v.as_str().into()))
                    .collect();
                entry.insert("env".into(), Value::Object(object));
            }
        }
    }

    let mut output = serde_json::to_string_pretty(&root).expect("a JSON value always serializes");
    output.push('\n');
    Ok(output)
}

fn json_entry(agent: Agent, spec: &ServerSpec) -> Value {
    let mut entry = Map::new();
    match &spec.transport {
        Transport::Stdio { command, args } => {
            if agent == Agent::ClaudeCode {
                entry.insert("type".into(), "stdio".into());
            }
            entry.insert("command".into(), command.as_str().into());
            entry.insert("args".into(), args.clone().into());
        }
        Transport::Http { url } | Transport::Sse { url } => {
            let sse = matches!(spec.transport, Transport::Sse { .. });
            let key = match agent {
                Agent::Gemini if !sse => "httpUrl",
                _ => "url",
            };
            if agent == Agent::ClaudeCode {
                entry.insert("type".into(), if sse { "sse" } else { "http" }.into());
            }
            entry.insert(key.into(), url.as_str().into());
        }
    }
    for (key, map) in [("env", &spec.env), ("headers", &spec.headers)] {
        if !map.is_empty() {
            let object = map
                .iter()
                .map(|(k, v)| (k.clone(), v.as_str().into()))
                .collect();
            entry.insert(key.into(), Value::Object(object));
        }
    }
    Value::Object(entry)
}

fn edit_toml(path: &Path, content: &str, edit: &Edit) -> Result<String> {
    let mut doc: toml_edit::DocumentMut = content.parse().map_err(|source| Error::TomlEdit {
        path: path.to_path_buf(),
        source: Box::new(source),
    })?;
    let servers = doc
        .entry("mcp_servers")
        .or_insert_with(|| {
            let mut table = toml_edit::Table::new();
            table.set_implicit(true);
            toml_edit::Item::Table(table)
        })
        .as_table_mut()
        .ok_or_else(|| Error::Invalid {
            path: path.to_path_buf(),
            reason: "\"mcp_servers\" is not a table",
        })?;

    edit.check(Agent::Codex, servers.contains_key(edit.name()))?;
    match edit {
        Edit::Upsert { name, spec, .. } => {
            servers.insert(name, toml_edit::Item::Table(toml_entry(spec)?));
        }
        Edit::Remove { name } => {
            servers.remove(name);
        }
        Edit::Launch {
            name,
            command,
            args,
            env,
        } => {
            let entry = servers
                .get_mut(name)
                .and_then(toml_edit::Item::as_table_like_mut)
                .ok_or_else(|| Error::Invalid {
                    path: path.to_path_buf(),
                    reason: "an MCP server entry is not a table",
                })?;
            entry.insert("command", toml_edit::value(*command));
            entry.insert(
                "args",
                toml_edit::value(args.iter().collect::<toml_edit::Array>()),
            );
            if env.is_empty() {
                entry.remove("env");
            } else {
                let table: toml_edit::InlineTable =
                    env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
                entry.insert("env", toml_edit::value(table));
            }
        }
    }
    Ok(doc.to_string())
}

fn toml_entry(spec: &ServerSpec) -> Result<toml_edit::Table> {
    let mut entry = toml_edit::Table::new();
    let headers_key = match &spec.transport {
        Transport::Stdio { command, args } => {
            entry.insert("command", toml_edit::value(command.as_str()));
            entry.insert(
                "args",
                toml_edit::value(args.iter().collect::<toml_edit::Array>()),
            );
            "headers"
        }
        Transport::Http { url } => {
            entry.insert("url", toml_edit::value(url.as_str()));
            "http_headers"
        }
        Transport::Sse { .. } => {
            return Err(Error::Unsupported {
                agent: Agent::Codex,
                what: "SSE MCP servers",
            });
        }
    };
    for (key, map) in [("env", &spec.env), (headers_key, &spec.headers)] {
        if !map.is_empty() {
            let table: toml_edit::InlineTable =
                map.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
            entry.insert(key, toml_edit::value(table));
        }
    }
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn write(home: &Path, relative: &str, content: &str) {
        let path = home.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn read(home: &Path, relative: &str) -> String {
        fs::read_to_string(home.join(relative)).unwrap()
    }

    fn stdio(command: &str) -> ServerSpec {
        ServerSpec {
            transport: Transport::Stdio {
                command: command.into(),
                args: vec!["-y".into()],
            },
            env: BTreeMap::from([("TOKEN".into(), "secret".into())]),
            headers: BTreeMap::new(),
        }
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
            r#"{"mcpServers": {"linear": {"url": "https://mcp.linear.app/mcp", "headers": {"Authorization": "Bearer x"}}}}"#,
        );
        write(
            home,
            ".gemini/settings.json",
            r#"{"theme": "dark", "mcpServers": {"remote": {"httpUrl": "https://example.com/mcp"}, "legacy": {"url": "https://example.com/sse"}}}"#,
        );

        let (servers, errors) = list_all(home);
        assert!(errors.is_empty());
        assert_eq!(servers.len(), 5);

        let github = &servers[0];
        assert_eq!(github.agent, Agent::ClaudeCode);
        assert_eq!(github.env_keys, vec!["GITHUB_TOKEN"]);
        assert_eq!(servers[2].header_keys, vec!["Authorization"]);
        assert_eq!(
            servers[3].transport,
            Transport::Sse {
                url: "https://example.com/sse".into()
            }
        );
        assert_eq!(
            servers[4].transport,
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

    #[test]
    fn add_keeps_other_settings_and_backs_up() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let original = r#"{"zeta": 1, "alpha": {"nested": true}, "mcpServers": {}}"#;
        write(home, ".claude.json", original);

        add(Agent::ClaudeCode, home, "github", &stdio("npx"), false).unwrap();

        let content = read(home, ".claude.json");
        assert!(content.find("zeta").unwrap() < content.find("alpha").unwrap());
        assert!(content.contains(r#""type": "stdio""#));
        assert_eq!(read(home, ".claude.json.agentdeck.bak"), original);
        assert!(!home.join(".claude.json.agentdeck.tmp").exists());

        let err = add(Agent::ClaudeCode, home, "github", &stdio("npx"), false).unwrap_err();
        assert!(matches!(err, Error::AlreadyExists { .. }));
        add(Agent::ClaudeCode, home, "github", &stdio("bunx"), true).unwrap();
        assert!(read(home, ".claude.json").contains("bunx"));
    }

    #[test]
    fn add_creates_a_missing_config() {
        let home = tempfile::tempdir().unwrap();
        add(Agent::Cursor, home.path(), "fs", &stdio("npx"), false).unwrap();
        assert_eq!(list_for_agent(Agent::Cursor, home.path()).unwrap().len(), 1);
    }

    #[test]
    fn codex_edits_preserve_comments() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        write(
            home,
            ".codex/config.toml",
            "# my settings\nmodel = \"o4\"\n",
        );

        add(Agent::Codex, home, "github", &stdio("npx"), false).unwrap();
        let content = read(home, ".codex/config.toml");
        assert!(content.starts_with("# my settings\nmodel = \"o4\"\n"));
        assert!(content.contains("[mcp_servers.github]"));
        assert!(content.contains(r#"env = { TOKEN = "secret" }"#));

        remove(Agent::Codex, home, "github").unwrap();
        assert!(list_for_agent(Agent::Codex, home).unwrap().is_empty());
        let err = remove(Agent::Codex, home, "github").unwrap_err();
        assert!(matches!(err, Error::NotFound { .. }));
    }

    #[test]
    fn copy_carries_secrets_and_translates_formats() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let sse = ServerSpec {
            transport: Transport::Sse {
                url: "https://example.com/sse".into(),
            },
            env: BTreeMap::new(),
            headers: BTreeMap::from([("Authorization".into(), "Bearer x".into())]),
        };
        add(Agent::ClaudeCode, home, "remote", &sse, false).unwrap();
        add(Agent::ClaudeCode, home, "local", &stdio("npx"), false).unwrap();

        copy(home, "remote", Agent::ClaudeCode, Agent::Gemini, false).unwrap();
        assert_eq!(read_specs(Agent::Gemini, home).unwrap()["remote"], sse);

        copy(home, "local", Agent::ClaudeCode, Agent::Codex, false).unwrap();
        assert_eq!(
            read_specs(Agent::Codex, home).unwrap()["local"],
            stdio("npx")
        );

        let err = copy(home, "remote", Agent::ClaudeCode, Agent::Codex, false).unwrap_err();
        assert!(matches!(err, Error::Unsupported { .. }));
    }
}
