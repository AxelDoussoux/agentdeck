//! Moving a whole setup to another computer: one file with the MCP servers
//! of every agent, the rules, the skills, the chosen agent folders and the
//! profiles. Secret values never go in it: the servers name the secrets they
//! need, and an import asks for them.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};

use crate::mcp::{self, ServerOptions, ServerSpec, Transport};
use crate::skills::{self, Location};
use crate::{Agent, Error, Result, agent, profiles, rules, secrets};

/// Version of the file format, written in its `agentdeck` field.
pub const FORMAT: u32 = 1;

/// At most this much of a skill's files is exported, so a skill that bundles
/// a whole project does not swell the file.
const SKILL_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    /// The format version, [`FORMAT`].
    pub agentdeck: u32,
    #[serde(default)]
    pub servers: Vec<ExportedServer>,
    #[serde(default)]
    pub rules: Vec<ExportedRules>,
    #[serde(default)]
    pub skills: Vec<ExportedSkill>,
    /// Folders chosen for agents that keep their files elsewhere.
    #[serde(default)]
    pub folders: BTreeMap<Agent, String>,
    #[serde(default)]
    pub profiles: Vec<profiles::Profile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedServer {
    pub agent: Agent,
    pub name: String,
    /// What the server runs: a protected server's real command, not the
    /// `agentdeck exec` launcher.
    pub transport: Transport,
    /// Variables and headers that are not secrets, with their values.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// Names of the variables and headers whose value was left out.
    #[serde(default)]
    pub secret_env: Vec<String>,
    #[serde(default)]
    pub secret_headers: Vec<String>,
    #[serde(default)]
    pub options: ServerOptions,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportedRules {
    pub agent: Agent,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportedSkill {
    pub location: Location,
    pub name: String,
    pub files: Vec<ExportedFile>,
}

/// A file of a skill: its text, or its bytes in base64 when it is not text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportedFile {
    /// Path inside the skill folder, with `/` between folders.
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base64: Option<String>,
}

/// Everything AgentDeck manages, without secret values. Configs that cannot
/// be read fail the export, rather than leave their servers out unnoticed.
pub fn export(home: &Path) -> Result<Export> {
    let marks = secrets::name_marks(home)?;
    let mut servers = Vec::new();
    for agent in Agent::ALL {
        for (name, spec) in mcp::read_specs(agent, home)? {
            servers.push(export_server(agent, name, spec, &marks));
        }
    }

    let (all_rules, errors) = rules::read_all(home);
    if let Some((_, err)) = errors.into_iter().next() {
        return Err(err);
    }
    let rules = all_rules
        .into_iter()
        .filter_map(|r| {
            let content = r.content.filter(|c| !c.trim().is_empty())?;
            Some(ExportedRules {
                agent: r.agent,
                content,
            })
        })
        .collect();

    let mut skills = Vec::new();
    for skill in skills::list(home).0 {
        skills.push(ExportedSkill {
            files: read_files(&skill.path)?,
            location: skill.location,
            name: skill.name,
        });
    }

    let folders = agent::chosen_folders(home)?
        .into_iter()
        .map(|(agent, path)| (agent, path.display().to_string()))
        .collect();

    Ok(Export {
        agentdeck: FORMAT,
        servers,
        rules,
        skills,
        folders,
        profiles: profiles::list(home)
            .map(|listing| listing.profiles)
            .unwrap_or_default(),
    })
}

fn export_server(
    agent: Agent,
    name: String,
    spec: ServerSpec,
    marks: &secrets::NameMarks,
) -> ExportedServer {
    let mut secret_env = Vec::new();
    let transport = match &spec.transport {
        Transport::Stdio { command, args } => match secrets::unwrap(command, args) {
            Some(wrapped) => {
                secret_env.extend(wrapped.secrets.into_keys());
                Transport::Stdio {
                    command: wrapped.command,
                    args: wrapped.args,
                }
            }
            None => spec.transport.clone(),
        },
        other => other.clone(),
    };
    // A value read from a variable, `${NAME}`, is not the secret itself.
    let is_secret = |key: &str, value: &str| {
        marks.is_secret(key, value) && mcp::env_references(value).is_empty()
    };
    let split = |map: BTreeMap<String, String>, withheld: &mut Vec<String>| {
        map.into_iter()
            .filter(|(key, value)| {
                let secret = is_secret(key, value);
                if secret {
                    withheld.push(key.clone());
                }
                !secret
            })
            .collect()
    };
    let env = split(spec.env, &mut secret_env);
    let mut secret_headers = Vec::new();
    let headers = split(spec.headers, &mut secret_headers);
    secret_env.sort();
    ExportedServer {
        agent,
        name,
        transport,
        env,
        headers,
        secret_env,
        secret_headers,
        options: ServerOptions {
            extra: None,
            ..spec.options
        },
    }
}

/// The files of a skill folder, up to [`SKILL_BYTES`] in all.
fn read_files(dir: &Path) -> Result<Vec<ExportedFile>> {
    fn walk(
        dir: &Path,
        prefix: &str,
        budget: &mut u64,
        found: &mut Vec<ExportedFile>,
    ) -> Result<()> {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .map_err(|source| io_error(dir, source))?
            .flatten()
            .collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = format!("{prefix}{}", entry.file_name().to_string_lossy());
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                walk(&entry.path(), &format!("{path}/"), budget, found)?;
            } else if kind.is_file() {
                let bytes =
                    fs::read(entry.path()).map_err(|source| io_error(&entry.path(), source))?;
                let Some(left) = budget.checked_sub(bytes.len() as u64) else {
                    continue;
                };
                *budget = left;
                found.push(match String::from_utf8(bytes) {
                    Ok(text) => ExportedFile {
                        path,
                        text: Some(text),
                        base64: None,
                    },
                    Err(err) => ExportedFile {
                        path,
                        text: None,
                        base64: Some(BASE64.encode(err.into_bytes())),
                    },
                });
            }
        }
        Ok(())
    }
    let mut found = Vec::new();
    let mut budget = SKILL_BYTES;
    walk(dir, "", &mut budget, &mut found)?;
    Ok(found)
}

/// Reads an export file, checking it is one this version understands.
pub fn parse(content: &str, path: &Path) -> Result<Export> {
    let export: Export = serde_json::from_str(content).map_err(|source| Error::Json {
        path: path.to_path_buf(),
        source,
    })?;
    if export.agentdeck == 0 || export.agentdeck > FORMAT {
        return Err(Error::Invalid {
            path: path.to_path_buf(),
            reason: "it is not an AgentDeck export, or one from a newer version",
        });
    }
    Ok(export)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    Server,
    Rules,
    Skill,
    Folder,
    Profile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Change {
    /// Not here yet: added.
    Add,
    /// Here and different: replaced only when the import replaces.
    Replace,
    /// Already the same here.
    Same,
    /// Cannot be imported here, such as a folder that does not exist.
    Skip,
}

/// One thing an import adds or replaces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub kind: ItemKind,
    pub agent: Option<Agent>,
    pub location: Option<Location>,
    pub name: String,
    pub change: Change,
}

/// A secret value an import needs, asked once for a server and a name
/// whatever the agents that have the server.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NeededSecret {
    pub server: String,
    pub key: String,
    pub header: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub items: Vec<PlanItem>,
    pub secrets: Vec<NeededSecret>,
}

/// What importing `export` would change, without changing anything.
pub fn plan(home: &Path, export: &Export) -> Result<Plan> {
    let marks = secrets::name_marks(home)?;
    let mut items = Vec::new();
    let mut needed = Vec::new();
    for server in &export.servers {
        let current = mcp::get(server.agent, home, &server.name)?;
        let change = match current {
            None => Change::Add,
            Some(current) if same_server(&current, server, &marks) => Change::Same,
            Some(_) => Change::Replace,
        };
        if change != Change::Same {
            for (keys, header) in [(&server.secret_env, false), (&server.secret_headers, true)] {
                for key in keys {
                    needed.push(NeededSecret {
                        server: server.name.clone(),
                        key: key.clone(),
                        header,
                    });
                }
            }
        }
        items.push(PlanItem {
            kind: ItemKind::Server,
            agent: Some(server.agent),
            location: None,
            name: server.name.clone(),
            change,
        });
    }
    for exported in &export.rules {
        let current = rules::read(exported.agent, home)
            .ok()
            .and_then(|r| r.content);
        items.push(PlanItem {
            kind: ItemKind::Rules,
            agent: Some(exported.agent),
            location: None,
            name: exported.agent.display_name().to_owned(),
            change: match current {
                None => Change::Add,
                Some(c) if c.trim() == exported.content.trim() => Change::Same,
                Some(c) if c.trim().is_empty() => Change::Add,
                Some(_) => Change::Replace,
            },
        });
    }
    for skill in &export.skills {
        let dir = skills::skill_dir(home, skill.location, &skill.name)?;
        let change = if !dir.exists() {
            Change::Add
        } else if read_files(&dir).is_ok_and(|files| files == skill.files) {
            Change::Same
        } else {
            Change::Replace
        };
        items.push(PlanItem {
            kind: ItemKind::Skill,
            agent: None,
            location: Some(skill.location),
            name: skill.name.clone(),
            change,
        });
    }
    let chosen = agent::chosen_folders(home)?;
    for (agent, folder) in &export.folders {
        let path = PathBuf::from(folder);
        items.push(PlanItem {
            kind: ItemKind::Folder,
            agent: Some(*agent),
            location: None,
            name: folder.clone(),
            change: match chosen.get(agent) {
                _ if !path.is_dir() => Change::Skip,
                Some(current) if *current == path => Change::Same,
                Some(_) => Change::Replace,
                None => Change::Add,
            },
        });
    }
    let current_profiles = profiles::list(home).map(|l| l.profiles).unwrap_or_default();
    for profile in &export.profiles {
        items.push(PlanItem {
            kind: ItemKind::Profile,
            agent: None,
            location: None,
            name: profile.name.clone(),
            change: match current_profiles.iter().find(|p| p.name == profile.name) {
                None => Change::Add,
                Some(p) if p.servers == profile.servers => Change::Same,
                Some(_) => Change::Replace,
            },
        });
    }
    needed.sort();
    needed.dedup();
    Ok(Plan {
        items,
        secrets: needed,
    })
}

/// Whether `current` already runs what `server` describes. Secret values
/// cannot be compared, so only their names are.
fn same_server(current: &ServerSpec, server: &ExportedServer, marks: &secrets::NameMarks) -> bool {
    let here = export_server(server.agent, server.name.clone(), current.clone(), marks);
    here.transport == server.transport
        && here.options == server.options
        && keys_and_values(&here.env, &here.secret_env)
            == keys_and_values(&server.env, &server.secret_env)
        && keys_and_values(&here.headers, &here.secret_headers)
            == keys_and_values(&server.headers, &server.secret_headers)
}

/// The names of a server's variables, with the values that are not secret.
fn keys_and_values(
    plain: &BTreeMap<String, String>,
    secret: &[String],
) -> BTreeMap<String, Option<String>> {
    plain
        .iter()
        .map(|(key, value)| (key.clone(), Some(value.clone())))
        .chain(secret.iter().map(|key| (key.clone(), None)))
        .collect()
}

/// A secret value given for an import.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GivenSecret {
    pub server: String,
    pub key: String,
    pub value: String,
}

/// What an import did, with what it replaced so it can be undone. Holds
/// secret values: it stays in the core and the app's process.
#[derive(Debug, Default)]
pub struct Imported {
    /// Each server written, with its settings before, `None` when it was new.
    pub servers: Vec<(Agent, String, Option<ServerSpec>)>,
    /// Each rules file written: its content before, and the one written.
    pub rules: Vec<(Agent, String, String)>,
    /// What was imported, skipped or left out, to report.
    pub summary: Summary,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub imported: usize,
    /// Items left as they are: the same, kept, or impossible here.
    pub skipped: usize,
    /// Secrets no value was given for: their servers were written without them.
    pub missing_secrets: Vec<NeededSecret>,
}

/// Imports `export`. Items already here and different are replaced only with
/// `replace`: a replaced skill moves to the trash first, and configs keep
/// their usual backups.
pub fn import(
    home: &Path,
    export: &Export,
    given: &[GivenSecret],
    replace: bool,
) -> Result<Imported> {
    let planned = plan(home, export)?;
    let wanted = |kind: ItemKind, agent: Option<Agent>, location: Option<Location>, name: &str| {
        planned
            .items
            .iter()
            .find(|i| {
                i.kind == kind && i.agent == agent && i.location == location && i.name == name
            })
            .is_some_and(|i| i.change == Change::Add || (replace && i.change == Change::Replace))
    };
    let value = |server: &str, key: &str| {
        given
            .iter()
            .find(|g| g.server == server && g.key == key && !g.value.is_empty())
            .map(|g| g.value.clone())
    };
    let mut done = Imported::default();
    let total = planned.items.len();

    for server in &export.servers {
        if !wanted(ItemKind::Server, Some(server.agent), None, &server.name) {
            continue;
        }
        let mut spec = ServerSpec {
            transport: server.transport.clone(),
            env: server.env.clone(),
            headers: server.headers.clone(),
            options: server.options.clone(),
        };
        for (keys, map, header) in [
            (&server.secret_env, &mut spec.env, false),
            (&server.secret_headers, &mut spec.headers, true),
        ] {
            for key in keys {
                match value(&server.name, key) {
                    Some(value) => {
                        map.insert(key.clone(), value);
                    }
                    None => done.summary.missing_secrets.push(NeededSecret {
                        server: server.name.clone(),
                        key: key.clone(),
                        header,
                    }),
                }
            }
        }
        let previous = mcp::get(server.agent, home, &server.name)?;
        mcp::add(server.agent, home, &server.name, &spec, true)?;
        done.servers
            .push((server.agent, server.name.clone(), previous));
    }

    for exported in &export.rules {
        let name = exported.agent.display_name();
        if !wanted(ItemKind::Rules, Some(exported.agent), None, name) {
            continue;
        }
        let previous = rules::read(exported.agent, home)?
            .content
            .unwrap_or_default();
        rules::write(exported.agent, home, &exported.content)?;
        done.rules
            .push((exported.agent, previous, exported.content.clone()));
    }

    let mut written = 0;
    for skill in &export.skills {
        if !wanted(ItemKind::Skill, None, Some(skill.location), &skill.name) {
            continue;
        }
        write_skill(home, skill)?;
        written += 1;
    }

    for (agent, folder) in &export.folders {
        if wanted(ItemKind::Folder, Some(*agent), None, folder) {
            agent::choose_folder(home, *agent, Some(Path::new(folder)))?;
            written += 1;
        }
    }

    for profile in &export.profiles {
        if wanted(ItemKind::Profile, None, None, &profile.name) {
            profiles::save(home, &profile.name, &profile.servers)?;
            written += 1;
        }
    }

    done.summary.missing_secrets.sort();
    done.summary.missing_secrets.dedup();
    done.summary.imported = done.servers.len() + done.rules.len() + written;
    done.summary.skipped = total - done.summary.imported;
    Ok(done)
}

/// Writes a skill folder, moving the one there to the trash first.
fn write_skill(home: &Path, skill: &ExportedSkill) -> Result<()> {
    let dir = skills::skill_dir(home, skill.location, &skill.name)?;
    // Check every path before touching anything: none may leave the folder.
    let mut files = Vec::new();
    for file in &skill.files {
        let relative = Path::new(&file.path);
        let inside = !file.path.is_empty()
            && relative
                .components()
                .all(|part| matches!(part, Component::Normal(_)));
        if !inside {
            return Err(Error::Invalid {
                path: dir.join(&file.path),
                reason: "a skill file must stay inside its folder",
            });
        }
        let bytes = match (&file.text, &file.base64) {
            (Some(text), _) => text.clone().into_bytes(),
            (None, Some(encoded)) => BASE64.decode(encoded).map_err(|_| Error::Invalid {
                path: dir.join(&file.path),
                reason: "a skill file is not valid base64",
            })?,
            (None, None) => Vec::new(),
        };
        files.push((dir.join(relative), bytes));
    }
    if dir.exists() {
        skills::move_to_trash(home, &dir)?;
    }
    for (path, bytes) in files {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
        }
        fs::write(&path, bytes).map_err(|source| io_error(&path, source))?;
    }
    Ok(())
}

fn io_error(path: &Path, source: std::io::Error) -> Error {
    Error::Io {
        path: path.to_path_buf(),
        source,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(home: &Path, relative: &str, content: &str) {
        let path = home.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    /// A home with a plain server, a protected one, rules, a skill with a
    /// binary file, and a profile.
    fn source() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        write(
            home,
            ".claude.json",
            r#"{"mcpServers": {
                "github": {"command": "npx", "args": ["gh"], "env": {"GITHUB_TOKEN": "old-token-value", "LOG_LEVEL": "debug"}},
                "db": {"command": "/opt/agentdeck", "args": ["exec", "--secret", "PG_PASSWORD=mcp/db/PG_PASSWORD", "--", "uvx", "pg"]},
                "linear": {"type": "http", "url": "https://mcp.linear.app/mcp", "headers": {"Authorization": "Bearer ${LINEAR_TOKEN}"}}
            }}"#,
        );
        write(home, ".claude/CLAUDE.md", "Be brief.\n");
        write(
            home,
            ".claude/skills/notes/SKILL.md",
            "---\nname: notes\n---\nTake notes.\n",
        );
        fs::write(
            home.join(".claude/skills/notes/logo.png"),
            [0x89, b'P', 0xff, 0],
        )
        .unwrap();
        profiles::save(home, "Work", &["github".into()]).unwrap();
        dir
    }

    #[test]
    fn exports_leave_secret_values_out() {
        let dir = source();
        let export = export(dir.path()).unwrap();
        let json = serde_json::to_string(&export).unwrap();
        assert!(!json.contains("old-token-value"));

        let server = |name: &str| export.servers.iter().find(|s| s.name == name).unwrap();
        let github = server("github");
        assert_eq!(github.secret_env, ["GITHUB_TOKEN"]);
        assert_eq!(github.env["LOG_LEVEL"], "debug");
        let db = server("db");
        assert_eq!(
            db.transport,
            Transport::Stdio {
                command: "uvx".into(),
                args: vec!["pg".into()],
            }
        );
        assert_eq!(db.secret_env, ["PG_PASSWORD"]);
        // A header that reads a variable keeps its reference.
        assert_eq!(
            server("linear").headers["Authorization"],
            "Bearer ${LINEAR_TOKEN}"
        );
        assert!(server("linear").secret_headers.is_empty());

        let skill = &export.skills[0];
        assert_eq!(skill.files.len(), 2);
        assert!(skill.files[0].text.is_some() && skill.files[1].base64.is_some());
        assert_eq!(export.rules[0].content, "Be brief.\n");
        assert_eq!(export.profiles[0].name, "Work");
    }

    #[test]
    fn imports_on_another_computer_and_asks_for_secrets() {
        let from = source();
        let export = export(from.path()).unwrap();
        let to = tempfile::tempdir().unwrap();
        let home = to.path();

        let planned = plan(home, &export).unwrap();
        assert!(planned.items.iter().all(|i| i.change == Change::Add));
        assert_eq!(
            planned
                .secrets
                .iter()
                .map(|s| s.key.as_str())
                .collect::<Vec<_>>(),
            ["PG_PASSWORD", "GITHUB_TOKEN"]
        );

        let given = [GivenSecret {
            server: "github".into(),
            key: "GITHUB_TOKEN".into(),
            value: "new-token-value".into(),
        }];
        let done = import(home, &export, &given, false).unwrap();
        assert_eq!(done.summary.imported, planned.items.len());
        assert_eq!(done.summary.missing_secrets.len(), 1);
        assert!(
            done.servers
                .iter()
                .all(|(_, _, previous)| previous.is_none())
        );

        let github = mcp::get(Agent::ClaudeCode, home, "github")
            .unwrap()
            .unwrap();
        assert_eq!(github.env["GITHUB_TOKEN"], "new-token-value");
        let db = mcp::get(Agent::ClaudeCode, home, "db").unwrap().unwrap();
        assert!(db.env.is_empty());
        assert_eq!(
            rules::read(Agent::ClaudeCode, home)
                .unwrap()
                .content
                .unwrap(),
            "Be brief.\n"
        );
        let logo = fs::read(home.join(".claude/skills/notes/logo.png")).unwrap();
        assert_eq!(logo, [0x89, b'P', 0xff, 0]);
        assert_eq!(profiles::list(home).unwrap().profiles.len(), 1);

        // Imported again, all but the server missing its secret is the same.
        let again = plan(home, &export).unwrap();
        let changed: Vec<_> = again
            .items
            .iter()
            .filter(|i| i.change != Change::Same)
            .collect();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].name, "db");
    }

    #[test]
    fn replacing_is_a_choice_and_keeps_what_it_replaced() {
        let from = source();
        let export = export(from.path()).unwrap();
        let to = tempfile::tempdir().unwrap();
        let home = to.path();
        write(home, ".claude/CLAUDE.md", "Mine.\n");
        write(home, ".claude/skills/notes/SKILL.md", "mine");

        let done = import(home, &export, &[], false).unwrap();
        assert!(done.rules.is_empty());
        assert_eq!(
            rules::read(Agent::ClaudeCode, home)
                .unwrap()
                .content
                .unwrap(),
            "Mine.\n"
        );
        assert_eq!(done.summary.skipped, 2);

        let done = import(home, &export, &[], true).unwrap();
        assert_eq!(
            done.rules,
            [(Agent::ClaudeCode, "Mine.\n".into(), "Be brief.\n".into())]
        );
        assert!(
            fs::read_to_string(home.join(".claude/skills/notes/SKILL.md"))
                .unwrap()
                .contains("Take notes")
        );
        assert_eq!(skills::trashed(home).len(), 1);
    }

    #[test]
    fn skill_files_cannot_leave_their_folder() {
        let home = tempfile::tempdir().unwrap();
        let skill = ExportedSkill {
            location: Location::ClaudeCode,
            name: "evil".into(),
            files: vec![ExportedFile {
                path: "../../.bashrc".into(),
                text: Some("x".into()),
                base64: None,
            }],
        };
        assert!(matches!(
            write_skill(home.path(), &skill),
            Err(Error::Invalid { .. })
        ));
        assert!(!home.path().join(".bashrc").exists());

        let content = r#"{"agentdeck": 99}"#;
        assert!(parse(content, Path::new("x.json")).is_err());
        assert!(parse(r#"{"agentdeck": 1}"#, Path::new("x.json")).is_ok());
    }
}
