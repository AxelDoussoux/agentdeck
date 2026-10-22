//! Secrets of MCP servers: finding the ones stored in plain text and moving
//! them to the operating system's keychain.
//!
//! Agents only read their config files, so a protected server is rewritten to
//! start through `agentdeck exec`, which reads the keychain and passes the
//! secrets to the real command as environment variables:
//!
//! ```text
//! agentdeck exec --secret GITHUB_TOKEN=claude-code/github/GITHUB_TOKEN -- npx -y server-github
//! ```

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::mcp::{self, ServerSpec, Transport};
use crate::{Agent, Error, Result};

/// Where secrets are kept once protected.
pub trait Vault {
    fn get(&self, id: &str) -> Result<Option<String>>;
    fn set(&self, id: &str, value: &str) -> Result<()>;
    fn delete(&self, id: &str) -> Result<()>;
}

/// The keychain of the operating system: Credential Manager on Windows,
/// Keychain on macOS, Secret Service on Linux.
pub struct Keychain;

const SERVICE: &str = "agentdeck";

impl Keychain {
    fn entry(id: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, id).map_err(|err| Error::Keychain(err.to_string()))
    }
}

impl Vault for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>> {
        match Self::entry(id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(Error::Keychain(err.to_string())),
        }
    }

    fn set(&self, id: &str, value: &str) -> Result<()> {
        Self::entry(id)?
            .set_password(value)
            .map_err(|err| Error::Keychain(err.to_string()))
    }

    fn delete(&self, id: &str) -> Result<()> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(Error::Keychain(err.to_string())),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SecretKind {
    Env,
    Header,
}

/// One secret of one MCP server. Its value is never part of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRef {
    pub agent: Agent,
    pub server: String,
    pub kind: SecretKind,
    pub key: String,
    /// Keychain id when the secret is protected, `None` when it sits in plain
    /// text in the agent's config file.
    pub vault_id: Option<String>,
    /// How many other plain-text secrets have the same value, a hint that one
    /// key is copied in several places.
    pub same_value_elsewhere: usize,
    /// Whether the name or value looks like a credential, or the name was
    /// marked as one. The others are settings such as `NODE_ENV`, listed but
    /// not counted as secrets.
    pub likely: bool,
    /// Whether `likely` comes from how the user marked the name, rather than
    /// from [`looks_secret`].
    pub marked: bool,
    /// Whether the secret can be moved to the keychain: only environment
    /// variables of local servers that look like credentials can.
    pub protectable: bool,
}

/// Name parts that mark a credential, matched on whole words of the name.
const SECRET_WORDS: &[&str] = &[
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "PASS",
    "KEY",
    "APIKEY",
    "CREDENTIAL",
    "CREDENTIALS",
    "AUTH",
    "AUTHORIZATION",
    "BEARER",
    "COOKIE",
    "PAT",
    "PRIVATE",
    "DSN",
    "SIGNATURE",
];

/// Value prefixes of well-known API keys and tokens.
const SECRET_PREFIXES: &[&str] = &[
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "ghr_",
    "github_pat_",
    "glpat-",
    "sk-",
    "sk_live_",
    "sk_test_",
    "rk_live_",
    "xoxb-",
    "xoxp-",
    "xoxa-",
    "xapp-",
    "AKIA",
    "AIza",
    "lin_api_",
    "ntn_",
    "secret_",
    "Bearer ",
    "Basic ",
    "eyJ",
];

/// Whether an environment variable or header holds a credential, judging by
/// its name (`GITHUB_TOKEN`, `apiKey`, `X-Api-Key`) or its value (`ghp_…`, a
/// URL with a password).
pub fn looks_secret(key: &str, value: &str) -> bool {
    // Split camelCase and snake/kebab case into upper-case words.
    let mut words = vec![String::new()];
    let mut previous_lower = false;
    for c in key.chars() {
        if !c.is_ascii_alphanumeric() {
            words.push(String::new());
            previous_lower = false;
            continue;
        }
        if c.is_ascii_uppercase() && previous_lower {
            words.push(String::new());
        }
        previous_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        words.last_mut().unwrap().push(c.to_ascii_uppercase());
    }
    if words
        .iter()
        .any(|word| SECRET_WORDS.contains(&word.as_str()))
    {
        return true;
    }
    let value = value.trim();
    if SECRET_PREFIXES
        .iter()
        .any(|prefix| value.starts_with(prefix))
    {
        return true;
    }
    // postgres://user:password@host
    value.split_once("://").is_some_and(|(_, rest)| {
        let authority = rest.split('/').next().unwrap_or_default();
        authority
            .rsplit_once('@')
            .is_some_and(|(userinfo, _)| userinfo.contains(':'))
    })
}

/// Variable names the user marked as secrets or as settings, overriding
/// [`looks_secret`] for every server. Kept in `~/.agentdeck/secret-names.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NameMarks {
    #[serde(default)]
    pub secrets: BTreeSet<String>,
    #[serde(default)]
    pub settings: BTreeSet<String>,
}

impl NameMarks {
    /// Whether `key` holds a credential: as marked, or else as it looks.
    pub fn is_secret(&self, key: &str, value: &str) -> bool {
        self.marked(key).unwrap_or_else(|| looks_secret(key, value))
    }

    /// How `key` was marked, if it was.
    pub fn marked(&self, key: &str) -> Option<bool> {
        if self.secrets.contains(key) {
            Some(true)
        } else if self.settings.contains(key) {
            Some(false)
        } else {
            None
        }
    }
}

fn marks_path(home: &Path) -> PathBuf {
    home.join(".agentdeck").join("secret-names.json")
}

/// The names the user marked. A missing file means none.
pub fn name_marks(home: &Path) -> Result<NameMarks> {
    let path = marks_path(home);
    match fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|source| Error::Json { path, source })
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(NameMarks::default()),
        Err(source) => Err(Error::Io { path, source }),
    }
}

/// Marks `key` as a secret (`Some(true)`), as a setting (`Some(false)`), or
/// lets AgentDeck judge it again (`None`). It applies to every server, and
/// to servers protected from then on.
pub fn mark_name(home: &Path, key: &str, secret: Option<bool>) -> Result<()> {
    let mut marks = name_marks(home)?;
    marks.secrets.remove(key);
    marks.settings.remove(key);
    match secret {
        Some(true) => marks.secrets.insert(key.to_owned()),
        Some(false) => marks.settings.insert(key.to_owned()),
        None => false,
    };
    let path = marks_path(home);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|source| Error::Io {
            path: dir.to_path_buf(),
            source,
        })?;
    }
    let content = serde_json::to_string_pretty(&marks).unwrap_or_default();
    fs::write(&path, content).map_err(|source| Error::Io { path, source })
}

/// A server started through `agentdeck exec`.
struct Wrapped {
    /// Environment variable name to keychain id.
    secrets: BTreeMap<String, String>,
    command: String,
    args: Vec<String>,
}

const EXEC: &str = "exec";
const SECRET_FLAG: &str = "--secret";

fn is_launcher(command: &str) -> bool {
    Path::new(command)
        .file_stem()
        .is_some_and(|stem| stem == "agentdeck")
}

/// Recognizes `agentdeck exec --secret KEY=ID ... -- command args...`.
fn unwrap(command: &str, args: &[String]) -> Option<Wrapped> {
    if !is_launcher(command) || args.first().map(String::as_str) != Some(EXEC) {
        return None;
    }
    let mut secrets = BTreeMap::new();
    let mut rest = args[1..].iter();
    loop {
        match rest.next()?.as_str() {
            SECRET_FLAG => {
                let (key, id) = rest.next()?.split_once('=')?;
                secrets.insert(key.to_owned(), id.to_owned());
            }
            "--" => break,
            _ => return None,
        }
    }
    let command = rest.next()?.clone();
    Some(Wrapped {
        secrets,
        command,
        args: rest.cloned().collect(),
    })
}

/// Arguments that make `launcher` start `command` with the given secrets.
pub fn exec_args(
    secrets: &BTreeMap<String, String>,
    command: &str,
    args: &[String],
) -> Vec<String> {
    let mut wrapped = vec![EXEC.to_owned()];
    for (key, id) in secrets {
        wrapped.push(SECRET_FLAG.to_owned());
        wrapped.push(format!("{key}={id}"));
    }
    wrapped.push("--".to_owned());
    wrapped.push(command.to_owned());
    wrapped.extend(args.iter().cloned());
    wrapped
}

fn vault_id(agent: Agent, server: &str, key: &str) -> String {
    let agent = serde_json::to_value(agent)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default();
    format!("{agent}/{server}/{key}")
}

/// Lists the secrets of every agent's MCP servers.
pub fn inventory(home: &Path) -> (Vec<SecretRef>, Vec<String>) {
    let mut secrets = Vec::new();
    let mut errors = Vec::new();
    let marks = name_marks(home).unwrap_or_else(|err| {
        errors.push(err.to_string());
        NameMarks::default()
    });
    let mut values: HashMap<String, usize> = HashMap::new();
    let mut plain_values = Vec::new();

    for agent in Agent::ALL {
        let specs = match mcp::read_specs(agent, home) {
            Ok(specs) => specs,
            Err(err) => {
                errors.push(format!("{}: {err}", agent.display_name()));
                continue;
            }
        };
        for (server, spec) in specs {
            let wrapped = match &spec.transport {
                Transport::Stdio { command, args } => unwrap(command, args),
                _ => None,
            };
            let stdio = matches!(spec.transport, Transport::Stdio { .. });
            for (key, id) in wrapped.map(|w| w.secrets).unwrap_or_default() {
                secrets.push(SecretRef {
                    agent,
                    server: server.clone(),
                    kind: SecretKind::Env,
                    key,
                    vault_id: Some(id),
                    same_value_elsewhere: 0,
                    likely: true,
                    marked: false,
                    protectable: false,
                });
            }
            let plain = spec
                .env
                .into_iter()
                .map(|entry| (SecretKind::Env, entry))
                .chain(
                    spec.headers
                        .into_iter()
                        .map(|entry| (SecretKind::Header, entry)),
                );
            for (kind, (key, value)) in plain {
                let likely = marks.is_secret(&key, &value);
                let marked = marks.marked(&key).is_some();
                *values.entry(value.clone()).or_default() += 1;
                plain_values.push(value);
                secrets.push(SecretRef {
                    agent,
                    server: server.clone(),
                    kind,
                    key,
                    vault_id: None,
                    same_value_elsewhere: 0,
                    likely,
                    marked,
                    protectable: stdio && kind == SecretKind::Env && likely,
                });
            }
        }
    }

    let mut plain_values = plain_values.into_iter();
    for secret in secrets.iter_mut().filter(|s| s.vault_id.is_none()) {
        let value = plain_values.next().unwrap_or_default();
        secret.same_value_elsewhere = values.get(&value).map_or(0, |count| count - 1);
    }
    (secrets, errors)
}

/// Moves the environment variables of a local server that look like
/// credentials, or whose name was marked as one, to the vault and makes the agent start it through
/// `launcher exec`. Its other variables and settings are kept.
pub fn protect(
    vault: &dyn Vault,
    home: &Path,
    agent: Agent,
    server: &str,
    launcher: &Path,
) -> Result<()> {
    let plan = plan_protect(home, agent, server, launcher)?;
    if plan.credentials.is_empty() {
        return Ok(());
    }
    for (key, value) in &plan.credentials {
        vault.set(&vault_id(agent, server, key), value)?;
    }
    let Transport::Stdio { command, args } = &plan.after else {
        unreachable!("protected servers are local");
    };
    mcp::set_launch(agent, home, server, command, args, &plan.settings)
}

/// What protecting a server changes, before anything is written.
struct ProtectPlan {
    before: Transport,
    /// How the agent starts the server once protected.
    after: Transport,
    /// The variables that move to the vault, with their values.
    credentials: BTreeMap<String, String>,
    /// The variables that stay in the config.
    settings: BTreeMap<String, String>,
}

fn plan_protect(home: &Path, agent: Agent, server: &str, launcher: &Path) -> Result<ProtectPlan> {
    let spec = server_spec(agent, home, server)?;
    let Transport::Stdio { command, args } = &spec.transport else {
        return Err(Error::NotStdio {
            agent,
            name: server.to_owned(),
        });
    };
    // Protecting twice adds the new plain-text variables to the existing wrapper.
    let (mut secrets, command, args) = match unwrap(command, args) {
        Some(wrapped) => (wrapped.secrets, wrapped.command, wrapped.args),
        None => (BTreeMap::new(), command.clone(), args.clone()),
    };
    let marks = name_marks(home)?;
    let (credentials, settings): (BTreeMap<_, _>, BTreeMap<_, _>) = spec
        .env
        .into_iter()
        .partition(|(key, value)| marks.is_secret(key, value));
    for key in credentials.keys() {
        secrets.insert(key.clone(), vault_id(agent, server, key));
    }
    let after = Transport::Stdio {
        command: launcher.to_string_lossy().into_owned(),
        args: exec_args(&secrets, &command, &args),
    };
    Ok(ProtectPlan {
        before: spec.transport,
        after,
        credentials,
        settings,
    })
}

/// How protecting a server would change the way its agent starts it, for
/// the user to check first. No secret value is in it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectPreview {
    pub before: Transport,
    pub after: Transport,
    /// The variables that move to the keychain.
    pub moved: Vec<String>,
    /// The variables that stay in the config.
    pub kept: Vec<String>,
}

pub fn preview_protect(
    home: &Path,
    agent: Agent,
    server: &str,
    launcher: &Path,
) -> Result<ProtectPreview> {
    let plan = plan_protect(home, agent, server, launcher)?;
    Ok(ProtectPreview {
        before: plan.before,
        after: plan.after,
        moved: plan.credentials.into_keys().collect(),
        kept: plan.settings.into_keys().collect(),
    })
}

/// Puts the secrets of a protected server back in plain text and removes them
/// from the vault.
pub fn unprotect(vault: &dyn Vault, home: &Path, agent: Agent, server: &str) -> Result<()> {
    let spec = server_spec(agent, home, server)?;
    let wrapped = match &spec.transport {
        Transport::Stdio { command, args } => unwrap(command, args),
        _ => None,
    };
    let Some(wrapped) = wrapped else {
        return Ok(());
    };
    let mut env = spec.env;
    for (key, id) in &wrapped.secrets {
        let value = vault
            .get(id)?
            .ok_or_else(|| Error::Keychain(format!("no secret \"{id}\" in the keychain")))?;
        env.insert(key.clone(), value);
    }
    mcp::set_launch(agent, home, server, &wrapped.command, &wrapped.args, &env)?;
    // A copy of this server in another agent may start through the same
    // keychain entries: deleting them would break it.
    let Some(in_use) = ids_in_use(home) else {
        return Ok(());
    };
    for id in wrapped.secrets.values() {
        if !in_use.contains(id) {
            vault.delete(id)?;
        }
    }
    Ok(())
}

/// Keychain ids that some server of some agent still starts with, or `None`
/// when a config cannot be read and the answer is unknown.
fn ids_in_use(home: &Path) -> Option<HashSet<String>> {
    let mut ids = HashSet::new();
    for agent in Agent::ALL {
        for spec in mcp::read_specs(agent, home).ok()?.into_values() {
            if let Transport::Stdio { command, args } = &spec.transport
                && let Some(wrapped) = unwrap(command, args)
            {
                ids.extend(wrapped.secrets.into_values());
            }
        }
    }
    Some(ids)
}

/// Reads the secrets named in `--secret KEY=ID` flags, for `agentdeck exec`.
pub fn resolve(vault: &dyn Vault, secrets: &[(String, String)]) -> Result<Vec<(String, String)>> {
    secrets
        .iter()
        .map(|(key, id)| {
            let value = vault
                .get(id)?
                .ok_or_else(|| Error::Keychain(format!("no secret \"{id}\" in the keychain")))?;
            Ok((key.clone(), value))
        })
        .collect()
}

/// Finds the `agentdeck` CLI: next to the running executable first, then on
/// the `PATH`. Protected servers need it to start.
pub fn find_launcher() -> Option<std::path::PathBuf> {
    let name = format!("agentdeck{}", std::env::consts::EXE_SUFFIX);
    let beside = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join(&name)));
    let on_path = std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .map(|dir| dir.join(&name))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    beside
        .into_iter()
        .chain(on_path)
        .find(|path| path.is_file())
}

/// A protected server that can no longer start, because the `agentdeck`
/// launcher its agent runs is gone: the app was moved, uninstalled, or run
/// from a disk image that is no longer mounted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stranded {
    pub agent: Agent,
    pub server: String,
    /// The missing launcher, as written in the config.
    pub launcher: String,
}

/// Whether the agent can find `command`: a path must point to a file, and a
/// bare name must be on the `PATH`.
fn launcher_exists(command: &str) -> bool {
    let path = Path::new(command);
    if path.components().count() > 1 {
        return path.is_file();
    }
    crate::agent::on_path(command)
}

/// Lists the protected servers whose launcher is missing. Configs that cannot
/// be read are skipped: [`inventory`] reports them.
pub fn stranded(home: &Path) -> Vec<Stranded> {
    let mut found = Vec::new();
    for agent in Agent::ALL {
        for (server, spec) in mcp::read_specs(agent, home).unwrap_or_default() {
            if let Transport::Stdio { command, args } = &spec.transport
                && unwrap(command, args).is_some()
                && !launcher_exists(command)
            {
                found.push(Stranded {
                    agent,
                    server,
                    launcher: command.clone(),
                });
            }
        }
    }
    found
}

/// Points every stranded server at `launcher`, keeping its keychain ids,
/// command, variables and settings. Returns the servers it repaired.
pub fn repair(home: &Path, launcher: &Path) -> Result<Vec<Stranded>> {
    let stranded = stranded(home);
    let launcher = launcher.to_string_lossy();
    for server in &stranded {
        let spec = server_spec(server.agent, home, &server.server)?;
        if let Transport::Stdio { args, .. } = &spec.transport {
            mcp::set_launch(
                server.agent,
                home,
                &server.server,
                &launcher,
                args,
                &spec.env,
            )?;
        }
    }
    Ok(stranded)
}

fn server_spec(agent: Agent, home: &Path, server: &str) -> Result<ServerSpec> {
    mcp::read_specs(agent, home)?
        .remove(server)
        .ok_or_else(|| Error::NotFound {
            agent,
            name: server.to_owned(),
        })
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::fs;

    use super::*;

    #[derive(Default)]
    struct MemoryVault(RefCell<HashMap<String, String>>);

    impl Vault for MemoryVault {
        fn get(&self, id: &str) -> Result<Option<String>> {
            Ok(self.0.borrow().get(id).cloned())
        }
        fn set(&self, id: &str, value: &str) -> Result<()> {
            self.0.borrow_mut().insert(id.into(), value.into());
            Ok(())
        }
        fn delete(&self, id: &str) -> Result<()> {
            self.0.borrow_mut().remove(id);
            Ok(())
        }
    }

    fn setup() -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        fs::write(
            home.path().join(".claude.json"),
            r#"{"mcpServers": {
                "github": {"type": "stdio", "command": "npx", "args": ["-y", "server-github"], "env": {"GITHUB_TOKEN": "ghp_same"}, "timeout": 30},
                "linear": {"type": "http", "url": "https://mcp.linear.app/mcp", "headers": {"Authorization": "Bearer x"}}
            }}"#,
        )
        .unwrap();
        fs::create_dir_all(home.path().join(".cursor")).unwrap();
        fs::write(
            home.path().join(".cursor/mcp.json"),
            r#"{"mcpServers": {"gh": {"command": "npx", "env": {"TOKEN": "ghp_same"}}}}"#,
        )
        .unwrap();
        home
    }

    #[test]
    fn inventory_flags_plain_text_and_reused_values() {
        let home = setup();
        let (secrets, errors) = inventory(home.path());
        assert!(errors.is_empty());
        assert_eq!(secrets.len(), 3);
        let github = secrets.iter().find(|s| s.key == "GITHUB_TOKEN").unwrap();
        assert!(github.protectable && github.vault_id.is_none());
        assert_eq!(github.same_value_elsewhere, 1);
        let header = secrets
            .iter()
            .find(|s| s.kind == SecretKind::Header)
            .unwrap();
        assert!(!header.protectable);
        assert_eq!(header.same_value_elsewhere, 0);
    }

    #[test]
    fn protect_and_unprotect_round_trip() {
        let home = setup();
        let home = home.path();
        let vault = MemoryVault::default();
        let launcher = Path::new("/usr/local/bin/agentdeck");

        protect(&vault, home, Agent::ClaudeCode, "github", launcher).unwrap();
        let config = fs::read_to_string(home.join(".claude.json")).unwrap();
        assert!(!config.contains("ghp_same"));
        assert!(config.contains(r#""timeout": 30"#));
        assert_eq!(
            vault
                .get("claude-code/github/GITHUB_TOKEN")
                .unwrap()
                .as_deref(),
            Some("ghp_same")
        );

        let (secrets, _) = inventory(home);
        let github = secrets.iter().find(|s| s.key == "GITHUB_TOKEN").unwrap();
        assert_eq!(
            github.vault_id.as_deref(),
            Some("claude-code/github/GITHUB_TOKEN")
        );

        let wrapped = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["github"];
        let Transport::Stdio { command, args } = &wrapped.transport else {
            panic!()
        };
        assert_eq!(command, "/usr/local/bin/agentdeck");
        let ids = [(
            "GITHUB_TOKEN".to_owned(),
            "claude-code/github/GITHUB_TOKEN".to_owned(),
        )];
        assert_eq!(resolve(&vault, &ids).unwrap()[0].1, "ghp_same");
        assert_eq!(
            args[args.len() - 2..],
            ["-y".to_owned(), "server-github".to_owned()]
        );

        unprotect(&vault, home, Agent::ClaudeCode, "github").unwrap();
        let restored = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["github"];
        assert_eq!(restored.env["GITHUB_TOKEN"], "ghp_same");
        assert_eq!(
            restored.transport,
            Transport::Stdio {
                command: "npx".into(),
                args: vec!["-y".into(), "server-github".into()]
            }
        );
        assert!(vault.0.borrow().is_empty());
    }

    #[test]
    fn a_missing_launcher_is_found_and_repaired() {
        let home = setup();
        let home = home.path();
        let vault = MemoryVault::default();
        let gone = home.join("Volumes/AgentDeck/agentdeck");
        protect(&vault, home, Agent::ClaudeCode, "github", &gone).unwrap();
        protect(&vault, home, Agent::Cursor, "gh", &gone).unwrap();
        let before = mcp::read_specs(Agent::ClaudeCode, home).unwrap()["github"].clone();

        let found = stranded(home);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].launcher, gone.to_string_lossy());

        let installed = home.join("bin/agentdeck");
        fs::create_dir_all(installed.parent().unwrap()).unwrap();
        fs::write(&installed, "").unwrap();
        assert_eq!(repair(home, &installed).unwrap().len(), 2);
        assert!(stranded(home).is_empty());

        let after = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["github"];
        let (Transport::Stdio { command, args }, Transport::Stdio { args: old_args, .. }) =
            (&after.transport, &before.transport)
        else {
            panic!()
        };
        assert_eq!(command, &installed.to_string_lossy());
        assert_eq!(args, old_args);
        assert_eq!(after.env, before.env);
        let config = fs::read_to_string(home.join(".claude.json")).unwrap();
        assert!(config.contains(r#""timeout": 30"#));
    }

    #[test]
    fn a_launcher_on_the_path_is_not_stranded() {
        assert!(!launcher_exists("agentdeck-surely-not-installed"));
        assert!(launcher_exists("sh") || cfg!(windows));
    }

    #[test]
    fn recognizes_credentials_by_name_or_value() {
        for (key, value) in [
            ("GITHUB_TOKEN", "x"),
            ("GITHUB_PERSONAL_ACCESS_TOKEN", "x"),
            ("OPENAI_API_KEY", "x"),
            ("apiKey", "x"),
            ("X-Api-Key", "x"),
            ("Authorization", "x"),
            ("DB_PASSWORD", "x"),
            ("NOTION", "ntn_abc"),
            ("GH", "ghp_abc"),
            ("DATABASE_URL", "postgres://me:pw@localhost:5432/db"),
        ] {
            assert!(looks_secret(key, value), "{key}={value}");
        }
        for (key, value) in [
            ("NODE_ENV", "production"),
            ("LOG_LEVEL", "debug"),
            ("KEYBOARD_LAYOUT", "fr"),
            ("MONKEY", "banana"),
            ("PASSTHROUGH", "1"),
            ("DATABASE_URL", "postgres://localhost:5432/db"),
            ("Accept", "application/json"),
            ("HOME_URL", "https://example.com/@user:1"),
        ] {
            assert!(!looks_secret(key, value), "{key}={value}");
        }
    }

    #[test]
    fn settings_stay_in_the_config_when_protecting() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        fs::write(
            home.join(".claude.json"),
            r#"{"mcpServers": {"pg": {"command": "npx", "args": ["server-postgres"], "env": {"DATABASE_URL": "postgres://u:pw@db/app", "NODE_ENV": "production"}}}}"#,
        )
        .unwrap();

        let (secrets, _) = inventory(home);
        let node_env = secrets.iter().find(|s| s.key == "NODE_ENV").unwrap();
        assert!(!node_env.likely && !node_env.protectable);

        let vault = MemoryVault::default();
        protect(
            &vault,
            home,
            Agent::ClaudeCode,
            "pg",
            Path::new("agentdeck"),
        )
        .unwrap();
        let spec = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["pg"];
        assert_eq!(
            spec.env,
            BTreeMap::from([("NODE_ENV".to_owned(), "production".to_owned())])
        );
        assert_eq!(vault.0.borrow().len(), 1);

        unprotect(&vault, home, Agent::ClaudeCode, "pg").unwrap();
        let spec = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["pg"];
        assert_eq!(spec.env.len(), 2);
    }

    #[test]
    fn the_preview_shows_what_protect_writes() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        fs::write(
            home.join(".claude.json"),
            r#"{"mcpServers": {"pg": {"command": "npx", "args": ["server-postgres"], "env": {"DATABASE_URL": "postgres://u:pw@db/app", "NODE_ENV": "production"}}}}"#,
        )
        .unwrap();
        let launcher = Path::new("/opt/agentdeck");
        let preview = preview_protect(home, Agent::ClaudeCode, "pg", launcher).unwrap();
        assert_eq!(preview.moved, ["DATABASE_URL"]);
        assert_eq!(preview.kept, ["NODE_ENV"]);
        assert_eq!(
            preview.after,
            Transport::Stdio {
                command: "/opt/agentdeck".into(),
                args: [
                    "exec",
                    "--secret",
                    "DATABASE_URL=claude-code/pg/DATABASE_URL",
                    "--",
                    "npx",
                    "server-postgres"
                ]
                .map(String::from)
                .to_vec(),
            }
        );
        // Previewing writes nothing.
        let spec = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["pg"];
        assert_eq!(spec.transport, preview.before);

        protect(
            &MemoryVault::default(),
            home,
            Agent::ClaudeCode,
            "pg",
            launcher,
        )
        .unwrap();
        let spec = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["pg"];
        assert_eq!(spec.transport, preview.after);
        // No secret value in what the UI gets.
        let json = serde_json::to_string(&preview).unwrap();
        assert!(!json.contains("pw@db"));
    }

    #[test]
    fn unprotect_keeps_secrets_a_copied_server_still_uses() {
        let home = setup();
        let home = home.path();
        let vault = MemoryVault::default();
        let id = "claude-code/github/GITHUB_TOKEN";

        protect(
            &vault,
            home,
            Agent::ClaudeCode,
            "github",
            Path::new("agentdeck"),
        )
        .unwrap();
        mcp::copy(home, "github", Agent::ClaudeCode, Agent::Codex, false).unwrap();

        unprotect(&vault, home, Agent::ClaudeCode, "github").unwrap();
        assert_eq!(vault.get(id).unwrap().as_deref(), Some("ghp_same"));
        let restored = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["github"];
        assert_eq!(restored.env["GITHUB_TOKEN"], "ghp_same");

        // Once the last copy is restored, the keychain entry goes away.
        unprotect(&vault, home, Agent::Codex, "github").unwrap();
        assert!(vault.get(id).unwrap().is_none());
        let codex = &mcp::read_specs(Agent::Codex, home).unwrap()["github"];
        assert_eq!(codex.env["GITHUB_TOKEN"], "ghp_same");
    }

    #[test]
    fn http_servers_cannot_be_protected() {
        let home = setup();
        let vault = MemoryVault::default();
        let err = protect(
            &vault,
            home.path(),
            Agent::ClaudeCode,
            "linear",
            Path::new("agentdeck"),
        )
        .unwrap_err();
        assert!(matches!(err, Error::NotStdio { .. }));
    }

    #[test]
    fn marked_names_override_how_they_look() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        fs::write(
            home.join(".claude.json"),
            r#"{"mcpServers": {"svc": {"command": "svc", "env": {"SERVICE_ID": "abc123", "AUTH_MODE": "oauth"}}}}"#,
        )
        .unwrap();
        let likely = |key: &str| {
            let (secrets, errors) = inventory(home);
            assert!(errors.is_empty());
            let found = secrets.into_iter().find(|s| s.key == key).unwrap();
            (found.likely, found.marked)
        };
        assert_eq!(likely("SERVICE_ID"), (false, false));
        assert_eq!(likely("AUTH_MODE"), (true, false));

        mark_name(home, "SERVICE_ID", Some(true)).unwrap();
        mark_name(home, "AUTH_MODE", Some(false)).unwrap();
        assert_eq!(likely("SERVICE_ID"), (true, true));
        assert_eq!(likely("AUTH_MODE"), (false, true));

        let vault = MemoryVault::default();
        protect(
            &vault,
            home,
            Agent::ClaudeCode,
            "svc",
            Path::new("agentdeck"),
        )
        .unwrap();
        let spec = &mcp::read_specs(Agent::ClaudeCode, home).unwrap()["svc"];
        assert_eq!(spec.env.keys().collect::<Vec<_>>(), ["AUTH_MODE"]);
        assert_eq!(vault.0.borrow()["claude-code/svc/SERVICE_ID"], "abc123");

        mark_name(home, "AUTH_MODE", None).unwrap();
        assert_eq!(likely("AUTH_MODE"), (true, false));
        assert!(name_marks(home).unwrap().settings.is_empty());
    }
}
