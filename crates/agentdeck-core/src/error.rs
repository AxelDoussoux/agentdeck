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
    #[error("unexpected structure in {path}: {reason}")]
    Invalid { path: PathBuf, reason: &'static str },
    #[error("{} has no MCP server named \"{name}\"", agent.display_name())]
    NotFound { agent: Agent, name: String },
    #[error("{} already has an MCP server named \"{name}\"", agent.display_name())]
    AlreadyExists { agent: Agent, name: String },
    #[error("{} does not support {what}", agent.display_name())]
    Unsupported { agent: Agent, what: &'static str },
}

pub type Result<T> = std::result::Result<T, Error>;
