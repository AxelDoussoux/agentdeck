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

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use serde::Serialize;

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
    /// Whether the secret can be moved to the keychain: only environment
    /// variables of local servers can.
    pub protectable: bool,
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
                *values.entry(value.clone()).or_default() += 1;
                plain_values.push(value);
                secrets.push(SecretRef {
                    agent,
                    server: server.clone(),
                    kind,
                    key,
                    vault_id: None,
                    same_value_elsewhere: 0,
                    protectable: stdio && kind == SecretKind::Env,
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

/// Moves the environment variables of a local server to the vault and makes
/// the agent start it through `launcher exec`. Its other settings are kept.
pub fn protect(
    vault: &dyn Vault,
    home: &Path,
    agent: Agent,
    server: &str,
    launcher: &Path,
) -> Result<()> {
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
    if spec.env.is_empty() {
        return Ok(());
    }
    for (key, value) in &spec.env {
        let id = vault_id(agent, server, key);
        vault.set(&id, value)?;
        secrets.insert(key.clone(), id);
    }
    let launcher = launcher.to_string_lossy();
    let args = exec_args(&secrets, &command, &args);
    mcp::set_launch(agent, home, server, &launcher, &args, &BTreeMap::new())
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
    for id in wrapped.secrets.values() {
        vault.delete(id)?;
    }
    Ok(())
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
}
