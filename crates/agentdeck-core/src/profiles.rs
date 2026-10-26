//! Named sets of MCP servers. Using a profile turns its servers on and every
//! other server off, on every agent that has them.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::mcp::{self, McpServer};
use crate::{Agent, Error, Result, config_file};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    /// The servers that are on, by name.
    pub servers: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    profiles: Vec<Profile>,
}

/// The saved profiles, and the one the servers match now, if any.
#[derive(Debug, Clone, Serialize)]
pub struct Listing {
    pub profiles: Vec<Profile>,
    pub active: Option<String>,
}

/// One server turned on or off for an agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Switch {
    pub agent: Agent,
    pub server: String,
    pub enabled: bool,
}

fn store_path(home: &Path) -> PathBuf {
    home.join(".agentdeck").join("profiles.json")
}

fn read_store(home: &Path) -> Result<Store> {
    let path = store_path(home);
    match config_file::read_optional(&path)? {
        Some(content) if !content.trim().is_empty() => {
            serde_json::from_str(&content).map_err(|source| Error::Json { path, source })
        }
        _ => Ok(Store::default()),
    }
}

fn write_store(home: &Path, store: &Store) -> Result<()> {
    let mut content = serde_json::to_string_pretty(store).expect("profiles always serialize");
    content.push('\n');
    config_file::write(home, &store_path(home), &content)
}

/// Every server of every agent, failing when a config cannot be read: a
/// profile must not be used on half the servers.
fn all_servers(home: &Path) -> Result<Vec<McpServer>> {
    let (servers, errors) = mcp::list_all(home);
    match errors.into_iter().next() {
        Some((_, err)) => Err(err),
        None => Ok(servers),
    }
}

/// Names of the servers that are on for at least one agent.
pub fn servers_on(home: &Path) -> Result<Vec<String>> {
    let names: BTreeSet<String> = all_servers(home)?
        .into_iter()
        .filter(|server| !server.options.disabled)
        .map(|server| server.name)
        .collect();
    Ok(names.into_iter().collect())
}

pub fn list(home: &Path) -> Result<Listing> {
    let profiles = read_store(home)?.profiles;
    let servers = all_servers(home)?;
    let active = profiles
        .iter()
        .find(|profile| !servers.is_empty() && switches(profile, &servers).is_empty())
        .map(|profile| profile.name.clone());
    Ok(Listing { profiles, active })
}

/// Saves `servers` as the profile `name`, replacing a profile of that name.
pub fn save(home: &Path, name: &str, servers: &[String]) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::ProfileName);
    }
    let mut store = read_store(home)?;
    let mut servers = servers.to_vec();
    servers.sort();
    servers.dedup();
    let profile = Profile {
        name: name.to_owned(),
        servers,
    };
    match store.profiles.iter_mut().find(|p| p.name == name) {
        Some(existing) => *existing = profile,
        None => store.profiles.push(profile),
    }
    write_store(home, &store)
}

pub fn delete(home: &Path, name: &str) -> Result<()> {
    let mut store = read_store(home)?;
    let before = store.profiles.len();
    store.profiles.retain(|p| p.name != name);
    if store.profiles.len() == before {
        return Err(not_found(name));
    }
    write_store(home, &store)
}

fn not_found(name: &str) -> Error {
    Error::ProfileNotFound {
        name: name.to_owned(),
    }
}

/// What using `profile` changes: its servers on, every other one off.
fn switches(profile: &Profile, servers: &[McpServer]) -> Vec<Switch> {
    servers
        .iter()
        .filter_map(|server| {
            let enabled = profile.servers.contains(&server.name);
            (server.options.disabled == enabled).then(|| Switch {
                agent: server.agent,
                server: server.name.clone(),
                enabled,
            })
        })
        .collect()
}

/// Turns the servers of the profile `name` on and every other one off.
/// Returns what changed, for [`revert`].
pub fn apply(home: &Path, name: &str) -> Result<Vec<Switch>> {
    let store = read_store(home)?;
    let profile = store
        .profiles
        .iter()
        .find(|p| p.name == name)
        .ok_or_else(|| not_found(name))?;
    let planned = switches(profile, &all_servers(home)?);
    switch(home, &planned)?;
    Ok(planned)
}

/// Undoes what [`apply`] returned.
pub fn revert(home: &Path, changes: &[Switch]) -> Result<()> {
    let back: Vec<Switch> = changes
        .iter()
        .map(|change| Switch {
            enabled: !change.enabled,
            ..change.clone()
        })
        .collect();
    switch(home, &back)
}

/// Makes every switch, or none: on a failure, the ones made are put back.
fn switch(home: &Path, switches: &[Switch]) -> Result<()> {
    for (done, change) in switches.iter().enumerate() {
        if let Err(err) = mcp::set_enabled(change.agent, home, &change.server, change.enabled) {
            for made in switches[..done].iter().rev() {
                let _ = mcp::set_enabled(made.agent, home, &made.server, !made.enabled);
            }
            return Err(err);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::mcp::{ServerOptions, ServerSpec, Transport};

    fn add(home: &Path, agent: Agent, name: &str) {
        let spec = ServerSpec {
            transport: Transport::Stdio {
                command: "npx".into(),
                args: vec![name.into()],
            },
            env: BTreeMap::new(),
            headers: BTreeMap::new(),
            options: ServerOptions::default(),
        };
        mcp::add(agent, home, name, &spec, false).unwrap();
    }

    fn on(home: &Path) -> Vec<(Agent, String)> {
        mcp::list_all(home)
            .0
            .into_iter()
            .filter(|s| !s.options.disabled)
            .map(|s| (s.agent, s.name))
            .collect()
    }

    #[test]
    fn using_a_profile_turns_the_others_off_and_reverts() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        for agent in [Agent::ClaudeCode, Agent::Codex, Agent::Gemini] {
            add(home, agent, "github");
            add(home, agent, "jira");
        }
        add(home, Agent::Cursor, "notes");
        save(
            home,
            "Personal",
            &["github".into(), "notes".into(), "gone".into()],
        )
        .unwrap();
        save(home, "Work", &["jira".into(), "github".into()]).unwrap();
        assert_eq!(list(home).unwrap().active, None);

        let changes = apply(home, "Work").unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(
            changes[0],
            Switch {
                agent: Agent::Cursor,
                server: "notes".into(),
                enabled: false,
            }
        );
        assert_eq!(list(home).unwrap().active.as_deref(), Some("Work"));

        let before = on(home);
        let changes = apply(home, "Personal").unwrap();
        assert_eq!(changes.len(), 4);
        assert_eq!(
            on(home),
            [
                (Agent::ClaudeCode, "github".into()),
                (Agent::Codex, "github".into()),
                (Agent::Cursor, "notes".into()),
                (Agent::Gemini, "github".into()),
            ]
        );
        assert_eq!(list(home).unwrap().active.as_deref(), Some("Personal"));

        revert(home, &changes).unwrap();
        assert_eq!(on(home), before);
        assert_eq!(servers_on(home).unwrap(), ["github", "jira"]);
    }

    #[test]
    fn profiles_are_saved_replaced_and_deleted() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        assert!(matches!(save(home, "  ", &[]), Err(Error::ProfileName)));
        save(home, "Work", &["b".into(), "a".into(), "a".into()]).unwrap();
        save(home, " Work ", &["c".into()]).unwrap();
        let profiles = list(home).unwrap().profiles;
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].servers, ["c"]);
        delete(home, "Work").unwrap();
        assert!(matches!(
            delete(home, "Work"),
            Err(Error::ProfileNotFound { .. })
        ));
        assert!(matches!(
            apply(home, "Work"),
            Err(Error::ProfileNotFound { .. })
        ));
    }
}
