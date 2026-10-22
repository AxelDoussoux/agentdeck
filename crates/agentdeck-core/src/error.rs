use std::path::PathBuf;

use crate::Agent;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("cannot determine the home directory")]
    NoHomeDir,
    #[error("cannot access {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("invalid JSON in {path}: {source}")]
    Json {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("invalid TOML in {path}: {source}")]
    Toml {
        path: PathBuf,
        source: Box<toml::de::Error>,
    },
    #[error("invalid TOML in {path}: {source}")]
    TomlEdit {
        path: PathBuf,
        source: Box<toml_edit::TomlError>,
    },
    #[error(
        "{path} kept changing while AgentDeck was writing it. Close the agent that uses it and try again"
    )]
    Conflict { path: PathBuf },
    #[error("invalid MCP server \"{name}\" in {path}: {source}")]
    InvalidServer {
        path: PathBuf,
        name: String,
        source: serde_json::Error,
    },
    #[error("{key} has no value: type one, or remove it")]
    MissingValue { key: String },
    #[error("unexpected structure in {path}: {reason}")]
    Invalid { path: PathBuf, reason: &'static str },
    #[error("{} has no MCP server named \"{name}\"", agent.display_name())]
    NotFound { agent: Agent, name: String },
    #[error("{} already has an MCP server named \"{name}\"", agent.display_name())]
    AlreadyExists { agent: Agent, name: String },
    #[error("{} keeps its global rules in its own settings, not in a file", agent.display_name())]
    NoRulesFile { agent: Agent },
    #[error("system keychain: {0}")]
    Keychain(String),
    #[error("{} \"{name}\" is not a local command, so its secrets cannot be moved to the keychain", agent.display_name())]
    NotStdio { agent: Agent, name: String },
    #[error("the {} rules have no shared base: put it between {} and {}", agent.display_name(), crate::rules::SHARED_START, crate::rules::SHARED_END)]
    NoSharedRules { agent: Agent },
    #[error("\"{name}\" is not a valid skill name")]
    InvalidSkillName { name: String },
    #[error(
        "\"{name}\" cannot name a new skill: use lowercase letters, digits and single hyphens, at most 64 characters"
    )]
    NewSkillName { name: String },
    #[error("no skill at {path}")]
    SkillNotFound { path: PathBuf },
    #[error("a skill already exists at {path}")]
    SkillExists { path: PathBuf },
    #[error("{} does not support {what}", agent.display_name())]
    Unsupported { agent: Agent, what: &'static str },
}

pub type Result<T> = std::result::Result<T, Error>;
