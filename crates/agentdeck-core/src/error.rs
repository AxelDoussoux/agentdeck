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
    #[error("no profile named \"{name}\"")]
    ProfileNotFound { name: String },
    #[error("a profile needs a name")]
    ProfileName,
}

pub type Result<T> = std::result::Result<T, Error>;

/// An error as the app sends it to its UI: a code the UI words in the user's
/// language with the values below, and the English message for UIs that do
/// not know the code.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// What the system or a parser said, which stays in English.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub message: String,
}

impl ErrorInfo {
    /// An error with only a code and its English message.
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        ErrorInfo {
            code,
            agent: None,
            name: None,
            path: None,
            detail: None,
            message: message.into(),
        }
    }

    pub fn agent(mut self, agent: Agent) -> Self {
        self.agent = Some(agent.display_name().to_owned());
        self
    }

    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn path(mut self, path: &std::path::Path) -> Self {
        self.path = Some(path.display().to_string());
        self
    }

    pub fn detail(mut self, detail: impl ToString) -> Self {
        self.detail = Some(detail.to_string());
        self
    }
}

impl From<&Error> for ErrorInfo {
    fn from(err: &Error) -> Self {
        let info = |code| ErrorInfo::new(code, err.to_string());
        match err {
            Error::NoHomeDir => info("noHomeDir"),
            Error::Io { path, source } => info("io").path(path).detail(source),
            Error::Json { path, source } => info("json").path(path).detail(source),
            Error::Toml { path, source } => info("toml").path(path).detail(source),
            Error::TomlEdit { path, source } => info("toml").path(path).detail(source),
            Error::Conflict { path } => info("conflict").path(path),
            Error::InvalidServer { path, name, source } => {
                info("invalidServer").path(path).name(name).detail(source)
            }
            Error::MissingValue { key } => info("missingValue").name(key),
            Error::Invalid { path, reason } => info("invalid").path(path).detail(reason),
            Error::NotFound { agent, name } => info("notFound").agent(*agent).name(name),
            Error::AlreadyExists { agent, name } => info("alreadyExists").agent(*agent).name(name),
            Error::NoRulesFile { agent } => info("noRulesFile").agent(*agent),
            Error::Keychain(detail) => info("keychain").detail(detail),
            Error::NoSharedRules { agent } => info("noSharedRules").agent(*agent),
            Error::InvalidSkillName { name } => info("invalidSkillName").name(name),
            Error::NewSkillName { name } => info("newSkillName").name(name),
            Error::SkillNotFound { path } => info("skillNotFound").path(path),
            Error::SkillExists { path } => info("skillExists").path(path),
            Error::Unsupported { agent, what } => info("unsupported").agent(*agent).detail(what),
            Error::ProfileNotFound { name } => info("profileNotFound").name(name),
            Error::ProfileName => info("profileName"),
        }
    }
}

impl From<Error> for ErrorInfo {
    fn from(err: Error) -> Self {
        ErrorInfo::from(&err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_keeps_the_english_message_and_the_values_it_names() {
        let err = Error::NotFound {
            agent: Agent::Codex,
            name: "github".into(),
        };
        let info = ErrorInfo::from(&err);
        assert_eq!(info.code, "notFound");
        assert_eq!(info.agent.as_deref(), Some("Codex"));
        assert_eq!(info.name.as_deref(), Some("github"));
        assert_eq!(info.message, err.to_string());
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["code"], "notFound");
        assert!(json.get("path").is_none());
    }
}
