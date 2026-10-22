use std::collections::BTreeMap;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::path::Path;
use std::sync::OnceLock;

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
/// so only their names are kept, with a hash of each value to tell whether two
/// servers use the same one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub agent: Agent,
    pub name: String,
    pub transport: Transport,
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
    /// [`value_hash`] of each environment variable, by name.
    pub env_hashes: BTreeMap<String, String>,
    /// [`value_hash`] of each header, by name.
    pub header_hashes: BTreeMap<String, String>,
    pub options: ServerOptions,
}

/// A hash of `value` keyed at random for this process. Equal values get equal
/// hashes, but a hash says nothing about the value, and means nothing outside
/// the process that computed it.
pub fn value_hash(value: &str) -> String {
    static KEY: OnceLock<RandomState> = OnceLock::new();
    format!("{:016x}", KEY.get_or_init(RandomState::new).hash_one(value))
}

fn hashes(map: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    map.iter()
        .map(|(key, value)| (key.clone(), value_hash(value)))
        .collect()
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
    #[serde(default)]
    pub options: ServerOptions,
}

/// Settings of a server beyond how it is reached and its variables. Not every
/// agent has them: see [`untranslated`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOptions {
    /// Working directory of a local server. Codex and Gemini CLI.
    pub cwd: Option<String>,
    /// How long a tool call may take, in milliseconds. Codex and Gemini CLI.
    pub timeout_ms: Option<u64>,
    /// The server is turned off. Only Codex can turn a server off.
    #[serde(default)]
    pub disabled: bool,
    /// The only tools the agent may use. Codex and Gemini CLI.
    pub include_tools: Option<Vec<String>>,
    /// Tools the agent must not use. Codex and Gemini CLI.
    pub exclude_tools: Option<Vec<String>>,
    /// The other settings of the entry, which AgentDeck does not translate,
    /// with the agent they come from: they are only written back to it.
    #[serde(skip)]
    pub extra: Option<(Agent, Map<String, Value>)>,
}

/// The keys of a server entry that AgentDeck reads and writes for `agent`.
/// Every other key is an extra setting, kept as is.
fn known_keys(agent: Agent) -> &'static [&'static str] {
    match agent {
        Agent::ClaudeCode | Agent::Cursor => &["type", "command", "args", "env", "url", "headers"],
        Agent::Gemini => &[
            "command",
            "args",
            "env",
            "url",
            "httpUrl",
            "headers",
            "cwd",
            "timeout",
            "includeTools",
            "excludeTools",
        ],
        Agent::Codex => &[
            "command",
            "args",
            "env",
            "url",
            "http_headers",
            "headers",
            "cwd",
            "tool_timeout_sec",
            "enabled",
            "enabled_tools",
            "disabled_tools",
        ],
    }
}

/// The settings of `spec` that `agent` cannot take, for telling the user what
/// a copy leaves behind.
pub fn untranslated(spec: &ServerSpec, agent: Agent) -> Vec<String> {
    let options = &spec.options;
    let full = matches!(agent, Agent::Codex | Agent::Gemini);
    let mut lost = Vec::new();
    if !full && options.cwd.is_some() {
        lost.push("working directory".to_owned());
    }
    if !full && options.timeout_ms.is_some() {
        lost.push("timeout".to_owned());
    }
    if !full && (options.include_tools.is_some() || options.exclude_tools.is_some()) {
        lost.push("allowed tools".to_owned());
    }
    if options.disabled && agent != Agent::Codex {
        lost.push("turned off (the copy is on)".to_owned());
    }
    if let Some((from, extra)) = &options.extra
        && *from != agent
    {
        lost.extend(extra.keys().cloned());
    }
    lost
}

/// The shape shared by the JSON configs of Claude Code, Cursor and Gemini,
/// and by the TOML tables of Codex, once reduced to the [`known_keys`] of the
/// agent.
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
    cwd: Option<String>,
    /// Gemini, in milliseconds.
    timeout: Option<u64>,
    /// Codex, in seconds.
    #[serde(rename = "tool_timeout_sec")]
    tool_timeout_sec: Option<f64>,
    /// Codex.
    enabled: Option<bool>,
    /// Gemini.
    include_tools: Option<Vec<String>>,
    /// Gemini.
    exclude_tools: Option<Vec<String>>,
    #[serde(rename = "enabled_tools")]
    enabled_tools: Option<Vec<String>>,
    #[serde(rename = "disabled_tools")]
    disabled_tools: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct JsonConfig {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: BTreeMap<String, Map<String, Value>>,
}

#[derive(Debug, Deserialize)]
struct CodexConfig {
    #[serde(default)]
    mcp_servers: BTreeMap<String, toml::Table>,
}

impl RawServer {
    fn into_spec(self, agent: Agent, extra: Map<String, Value>) -> Option<ServerSpec> {
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
        let options = ServerOptions {
            cwd: self.cwd,
            timeout_ms: self
                .timeout
                .or_else(|| Some((self.tool_timeout_sec? * 1000.0).round() as u64)),
            disabled: self.enabled == Some(false),
            include_tools: self.include_tools.or(self.enabled_tools),
            exclude_tools: self.exclude_tools.or(self.disabled_tools),
            extra: (!extra.is_empty()).then_some((agent, extra)),
        };
        Some(ServerSpec {
            transport,
            env: into_strings(self.env),
            headers: into_strings(headers),
            options,
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

    let entries: BTreeMap<String, Map<String, Value>> = match agent {
        Agent::Codex => toml::from_str::<CodexConfig>(&content)
            .map_err(|source| Error::Toml {
                path: path.clone(),
                source: Box::new(source),
            })?
            .mcp_servers
            .into_iter()
            .map(|(name, table)| {
                let entry = serde_json::to_value(table)
                    .ok()
                    .and_then(|value| value.as_object().cloned())
                    .unwrap_or_default();
                (name, entry)
            })
            .collect(),
        _ => {
            serde_json::from_str::<JsonConfig>(&content)
                .map_err(|source| Error::Json {
                    path: path.clone(),
                    source,
                })?
                .mcp_servers
        }
    };

    let mut specs = BTreeMap::new();
    for (name, entry) in entries {
        let (known, extra): (Map<String, Value>, Map<String, Value>) = entry
            .into_iter()
            .partition(|(key, _)| known_keys(agent).contains(&key.as_str()));
        let raw: RawServer = serde_json::from_value(Value::Object(known)).map_err(|source| {
            Error::InvalidServer {
                path: path.clone(),
                name: name.clone(),
                source,
            }
        })?;
        if let Some(spec) = raw.into_spec(agent, extra) {
            specs.insert(name, spec);
        }
    }
    Ok(specs)
}

/// The full settings of one server, secrets included, or `None` when the agent
/// has no server by that name. Never send it to the UI.
pub fn get(agent: Agent, home: &Path, name: &str) -> Result<Option<ServerSpec>> {
    Ok(read_specs(agent, home)?.remove(name))
}

/// Reads the user-level MCP servers of `agent`. A missing config file is not
/// an error: the agent is simply not installed.
pub fn list_for_agent(agent: Agent, home: &Path) -> Result<Vec<McpServer>> {
    Ok(read_specs(agent, home)?
        .into_iter()
        .map(|(name, spec)| McpServer {
            agent,
            name,
            env_hashes: hashes(&spec.env),
            header_hashes: hashes(&spec.headers),
            options: ServerOptions {
                extra: None,
                ..spec.options
            },
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
/// secrets never leave the core. Returns the settings `to` could not take
/// (see [`untranslated`]).
pub fn copy(
    home: &Path,
    name: &str,
    from: Agent,
    to: Agent,
    overwrite: bool,
) -> Result<Vec<String>> {
    let spec = read_specs(from, home)?
        .remove(name)
        .ok_or_else(|| Error::NotFound {
            agent: from,
            name: name.to_owned(),
        })?;
    add(to, home, name, &spec, overwrite)?;
    Ok(untranslated(&spec, to))
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
    config_file::update(home, &path, |content| match agent {
        Agent::Codex => edit_toml(&path, content, &edit),
        _ => edit_json(agent, &path, content, &edit),
    })
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
            let Value::Object(fresh) = json_entry(agent, spec) else {
                unreachable!("an entry is an object")
            };
            // Replacing an entry keeps the settings AgentDeck does not manage.
            match servers.get_mut(*name).and_then(Value::as_object_mut) {
                Some(entry) => {
                    entry.retain(|key, _| !known_keys(agent).contains(&key.as_str()));
                    entry.extend(fresh);
                }
                None => {
                    servers.insert((*name).to_owned(), Value::Object(fresh));
                }
            }
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
    let options = &spec.options;
    if agent == Agent::Gemini {
        if let Some(cwd) = &options.cwd {
            entry.insert("cwd".into(), cwd.as_str().into());
        }
        if let Some(timeout) = options.timeout_ms {
            entry.insert("timeout".into(), timeout.into());
        }
        if let Some(tools) = &options.include_tools {
            entry.insert("includeTools".into(), tools.clone().into());
        }
        if let Some(tools) = &options.exclude_tools {
            entry.insert("excludeTools".into(), tools.clone().into());
        }
    }
    if let Some((from, extra)) = &options.extra
        && *from == agent
    {
        entry.extend(extra.clone());
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
            let fresh = toml_entry(spec)?;
            // Replacing an entry keeps its place and the settings AgentDeck
            // does not manage.
            match servers
                .get_mut(name)
                .and_then(toml_edit::Item::as_table_like_mut)
            {
                Some(entry) => {
                    for key in known_keys(Agent::Codex) {
                        entry.remove(key);
                    }
                    for (key, item) in fresh.iter() {
                        entry.insert(key, item.clone());
                    }
                }
                None => {
                    servers.insert(name, toml_edit::Item::Table(fresh));
                }
            }
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
    let options = &spec.options;
    if let Some(cwd) = &options.cwd {
        entry.insert("cwd", toml_edit::value(cwd.as_str()));
    }
    if let Some(timeout) = options.timeout_ms {
        let seconds = if timeout % 1000 == 0 {
            toml_edit::Value::from((timeout / 1000) as i64)
        } else {
            toml_edit::Value::from(timeout as f64 / 1000.0)
        };
        entry.insert("tool_timeout_sec", toml_edit::Item::Value(seconds));
    }
    if options.disabled {
        entry.insert("enabled", toml_edit::value(false));
    }
    for (key, tools) in [
        ("enabled_tools", &options.include_tools),
        ("disabled_tools", &options.exclude_tools),
    ] {
        if let Some(tools) = tools {
            entry.insert(
                key,
                toml_edit::value(tools.iter().collect::<toml_edit::Array>()),
            );
        }
    }
    if let Some((Agent::Codex, extra)) = &options.extra {
        for (key, value) in extra {
            if let Some(value) = toml_value(value) {
                entry.insert(key, toml_edit::Item::Value(value));
            }
        }
    }
    Ok(entry)
}

/// The TOML form of a setting read from Codex's config, to write it back.
fn toml_value(value: &Value) -> Option<toml_edit::Value> {
    Some(match value {
        Value::Null => return None,
        Value::Bool(flag) => (*flag).into(),
        Value::Number(number) => match number.as_i64() {
            Some(integer) => integer.into(),
            None => number.as_f64()?.into(),
        },
        Value::String(text) => text.as_str().into(),
        Value::Array(items) => {
            toml_edit::Value::Array(items.iter().filter_map(toml_value).collect())
        }
        Value::Object(map) => toml_edit::Value::InlineTable(
            map.iter()
                .filter_map(|(key, value)| Some((key.as_str(), toml_value(value)?)))
                .collect(),
        ),
    })
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
            options: ServerOptions::default(),
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
    fn listing_tells_equal_values_apart_without_showing_them() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        write(
            home,
            ".cursor/mcp.json",
            r#"{"mcpServers": {
                "a": {"command": "x", "env": {"TOKEN": "ghp_same", "MODE": "1"}},
                "b": {"command": "x", "env": {"TOKEN": "ghp_same", "MODE": "2"}}
            }}"#,
        );
        let servers = list_for_agent(Agent::Cursor, home).unwrap();
        let (a, b) = (&servers[0].env_hashes, &servers[1].env_hashes);
        assert_eq!(a["TOKEN"], b["TOKEN"]);
        assert_ne!(a["MODE"], b["MODE"]);
        let json = serde_json::to_string(&servers).unwrap();
        assert!(!json.contains("ghp_same"));
    }

    const CODEX_DOCS: &str = "[mcp_servers.docs]
command = \"uvx\"
args = [\"docs-mcp\"]
cwd = \"/work\"
tool_timeout_sec = 30
enabled = false
enabled_tools = [\"search\"]
startup_timeout_sec = 20

[mcp_servers.after]
command = \"x\"
";

    #[test]
    fn copy_translates_advanced_settings_and_reports_the_rest() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        write(home, ".codex/config.toml", CODEX_DOCS);

        let lost = copy(home, "docs", Agent::Codex, Agent::Gemini, false).unwrap();
        assert_eq!(lost, ["turned off (the copy is on)", "startup_timeout_sec"]);
        let gemini = &read_specs(Agent::Gemini, home).unwrap()["docs"].options;
        assert_eq!(gemini.cwd.as_deref(), Some("/work"));
        assert_eq!(gemini.timeout_ms, Some(30_000));
        assert_eq!(gemini.include_tools, Some(vec!["search".to_owned()]));
        assert!(read(home, ".gemini/settings.json").contains(r#""timeout": 30000"#));

        let lost = copy(home, "docs", Agent::Codex, Agent::ClaudeCode, false).unwrap();
        assert_eq!(
            lost,
            [
                "working directory",
                "timeout",
                "allowed tools",
                "turned off (the copy is on)",
                "startup_timeout_sec"
            ]
        );

        // And back: Gemini's settings become Codex's.
        let lost = copy(home, "docs", Agent::Gemini, Agent::Codex, true).unwrap();
        assert!(lost.is_empty());
        let codex = read(home, ".codex/config.toml");
        assert!(codex.contains("tool_timeout_sec = 30\n"));
        assert!(codex.contains("enabled_tools = [\"search\"]"));
    }

    #[test]
    fn replacing_an_entry_keeps_what_agentdeck_does_not_manage() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        write(home, ".codex/config.toml", CODEX_DOCS);
        write(
            home,
            ".gemini/settings.json",
            r#"{"mcpServers": {"docs": {"command": "old", "timeout": 5, "trust": true}}}"#,
        );

        add(Agent::Codex, home, "docs", &stdio("npx"), true).unwrap();
        let codex = read(home, ".codex/config.toml");
        assert!(codex.contains("startup_timeout_sec = 20"));
        assert!(!codex.contains("cwd"));
        assert!(
            codex.find("command = \"npx\"").unwrap() < codex.find("[mcp_servers.after]").unwrap()
        );

        add(Agent::Gemini, home, "docs", &stdio("npx"), true).unwrap();
        let gemini = read(home, ".gemini/settings.json");
        assert!(gemini.contains(r#""trust": true"#));
        assert!(!gemini.contains("timeout"));
    }

    #[test]
    fn a_removed_server_comes_back_whole() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        write(home, ".codex/config.toml", CODEX_DOCS);
        let before = get(Agent::Codex, home, "docs").unwrap().unwrap();
        assert!(before.options.disabled);

        remove(Agent::Codex, home, "docs").unwrap();
        add(Agent::Codex, home, "docs", &before, false).unwrap();
        assert_eq!(get(Agent::Codex, home, "docs").unwrap().unwrap(), before);
    }

    #[test]
    fn a_badly_typed_server_is_reported() {
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            ".gemini/settings.json",
            r#"{"mcpServers": {"x": {"command": "a", "args": "not a list"}}}"#,
        );
        let err = list_for_agent(Agent::Gemini, home.path()).unwrap_err();
        assert!(matches!(err, Error::InvalidServer { ref name, .. } if name == "x"));
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
            options: ServerOptions::default(),
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
