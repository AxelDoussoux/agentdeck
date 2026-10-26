//! What needs attention across the agents' configs: the checklist of the
//! app's overview and of `agentdeck doctor`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::Serialize;

use crate::mcp::{self, McpServer, Transport};
use crate::{Agent, ErrorInfo, agent, rules, secrets};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Danger,
    Warn,
    Info,
}

/// One thing that needs attention. Values of secrets are never part of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Finding {
    /// A config file that cannot be read, so its servers or rules are missing.
    #[serde(rename_all = "camelCase")]
    Unreadable { agent: Agent, error: ErrorInfo },
    /// Protected servers that cannot start: their `agentdeck` launcher is gone.
    LauncherMissing { servers: Vec<ServerRef> },
    /// Credentials in clear text in agent configs.
    #[serde(rename_all = "camelCase")]
    PlainSecrets { count: usize, servers: Vec<String> },
    /// Servers whose copies run something else, or with other variables or
    /// settings, than their first copy.
    Differ { servers: Vec<String> },
    /// Servers some installed agent does not have.
    Partial { servers: Vec<String> },
    /// Agents whose rules are not the same as the others'.
    RulesDiffer { agents: Vec<Agent> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ServerRef {
    pub agent: Agent,
    pub server: String,
}

impl Finding {
    pub fn severity(&self) -> Severity {
        match self {
            Finding::Unreadable { .. }
            | Finding::LauncherMissing { .. }
            | Finding::PlainSecrets { .. } => Severity::Danger,
            Finding::Differ { .. } => Severity::Warn,
            Finding::Partial { .. } | Finding::RulesDiffer { .. } => Severity::Info,
        }
    }
}

/// Runs every check, most severe findings first. Nothing is written.
pub fn check(home: &Path) -> Vec<Finding> {
    let mut findings = Vec::new();

    let (servers, errors) = mcp::list_all(home);
    let (all_rules, rule_errors) = rules::read_all(home);
    for (agent, err) in errors.iter().chain(&rule_errors) {
        findings.push(Finding::Unreadable {
            agent: *agent,
            error: ErrorInfo::from(err).agent(*agent),
        });
    }

    let stranded = secrets::stranded(home);
    if !stranded.is_empty() {
        findings.push(Finding::LauncherMissing {
            servers: stranded
                .into_iter()
                .map(|s| ServerRef {
                    agent: s.agent,
                    server: s.server,
                })
                .collect(),
        });
    }

    let (inventory, _) = secrets::inventory(home);
    let plain: Vec<_> = inventory
        .iter()
        .filter(|s| s.likely && s.vault_id.is_none() && s.env_var.is_none())
        .collect();
    if !plain.is_empty() {
        findings.push(Finding::PlainSecrets {
            count: plain.len(),
            servers: unique(plain.iter().map(|s| s.server.clone())),
        });
    }

    let differ = drifting(&servers);
    if !differ.is_empty() {
        findings.push(Finding::Differ { servers: differ });
    }

    let installed: Vec<Agent> = agent::detect(home)
        .into_iter()
        .filter(|info| info.installed)
        .map(|info| info.agent)
        .collect();
    let partial: Vec<String> = unique(servers.iter().map(|s| s.name.clone()))
        .into_iter()
        .filter(|name| {
            installed
                .iter()
                .any(|agent| !servers.iter().any(|s| &s.name == name && s.agent == *agent))
        })
        .collect();
    if !partial.is_empty() {
        findings.push(Finding::Partial { servers: partial });
    }

    let written: Vec<_> = all_rules
        .iter()
        .filter_map(|r| Some((r.agent, r.content.as_deref()?.trim())))
        .filter(|(_, content)| !content.is_empty())
        .collect();
    if written
        .iter()
        .map(|(_, c)| c)
        .collect::<BTreeSet<_>>()
        .len()
        > 1
    {
        findings.push(Finding::RulesDiffer {
            agents: written.into_iter().map(|(agent, _)| agent).collect(),
        });
    }

    findings.sort_by_key(Finding::severity);
    findings
}

/// The items in first-seen order, each once.
fn unique(items: impl Iterator<Item = String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    items.filter(|item| seen.insert(item.clone())).collect()
}

/// What a server really runs, and a hash of each variable by name. A server
/// started through `agentdeck exec` runs the command after `--`, and its
/// secrets are in the keychain: their hash is `None`, as the value is not in
/// the config.
fn launch(server: &McpServer) -> (Vec<String>, BTreeMap<String, Option<String>>) {
    let mut values: BTreeMap<String, Option<String>> = server
        .env_hashes
        .iter()
        .chain(&server.header_hashes)
        .map(|(key, hash)| (key.clone(), Some(hash.clone())))
        .collect();
    let target = match &server.transport {
        Transport::Http { url } => vec!["http".into(), url.clone()],
        Transport::Sse { url } => vec!["sse".into(), url.clone()],
        Transport::Stdio { command, args } => match secrets::unwrap(command, args) {
            Some(wrapped) => {
                for key in wrapped.secrets.keys() {
                    values.insert(key.clone(), None);
                }
                std::iter::once(wrapped.command)
                    .chain(wrapped.args)
                    .collect()
            }
            None => std::iter::once(command.clone())
                .chain(args.iter().cloned())
                .collect(),
        },
    };
    (target, values)
}

/// Agents that have the settings of [`mcp::ServerOptions`] besides
/// `disabled`.
const WITH_OPTIONS: [Agent; 2] = [Agent::Codex, Agent::Gemini];

/// Whether `copy` runs something else than `source`, or with other
/// variables or settings. Values in the keychain are not compared, nor
/// settings one of the two agents does not have: the same comparison as
/// `differences` in `src/lib/servers.ts`, which also says what differs.
pub fn differs(copy: &McpServer, source: &McpServer) -> bool {
    let (target, values) = launch(copy);
    let (source_target, source_values) = launch(source);
    if target != source_target {
        return true;
    }
    let keys: BTreeSet<_> = values.keys().chain(source_values.keys()).collect();
    for key in keys {
        match (values.get(key.as_str()), source_values.get(key.as_str())) {
            (Some(Some(mine)), Some(Some(theirs))) if mine != theirs => return true,
            (None, _) | (_, None) => return true,
            _ => {}
        }
    }
    if WITH_OPTIONS.contains(&copy.agent) && WITH_OPTIONS.contains(&source.agent) {
        let (a, b) = (&copy.options, &source.options);
        let blocked = |tools: &Option<Vec<String>>| tools.clone().unwrap_or_default();
        if a.cwd != b.cwd
            || a.timeout_ms != b.timeout_ms
            || a.include_tools != b.include_tools
            || blocked(&a.exclude_tools) != blocked(&b.exclude_tools)
        {
            return true;
        }
    }
    false
}

/// Names of the servers whose copies differ from the first one listed.
pub fn drifting(servers: &[McpServer]) -> Vec<String> {
    let mut copies: Vec<(&str, Vec<&McpServer>)> = Vec::new();
    for server in servers {
        match copies.iter_mut().find(|(name, _)| *name == server.name) {
            Some((_, list)) => list.push(server),
            None => copies.push((&server.name, vec![server])),
        }
    }
    copies
        .into_iter()
        .filter(|(_, list)| list[1..].iter().any(|copy| differs(copy, list[0])))
        .map(|(name, _)| name.to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::mcp::{ServerOptions, ServerSpec};

    fn spec(command: &str, token: &str) -> ServerSpec {
        ServerSpec {
            transport: Transport::Stdio {
                command: command.into(),
                args: vec!["-y".into(), "server".into()],
            },
            env: BTreeMap::from([("API_TOKEN".into(), token.into())]),
            headers: BTreeMap::new(),
            options: ServerOptions::default(),
        }
    }

    #[test]
    fn copies_differ_by_command_or_value_not_by_order() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        mcp::add(Agent::ClaudeCode, home, "same", &spec("npx", "a"), false).unwrap();
        mcp::add(Agent::Codex, home, "same", &spec("npx", "a"), false).unwrap();
        mcp::add(Agent::ClaudeCode, home, "value", &spec("npx", "a"), false).unwrap();
        mcp::add(Agent::Codex, home, "value", &spec("npx", "b"), false).unwrap();
        mcp::add(Agent::ClaudeCode, home, "command", &spec("npx", "a"), false).unwrap();
        mcp::add(Agent::Gemini, home, "command", &spec("bunx", "a"), false).unwrap();

        let (servers, errors) = mcp::list_all(home);
        assert!(errors.is_empty());
        let mut found = drifting(&servers);
        found.sort();
        assert_eq!(found, ["command", "value"]);
    }

    #[test]
    fn settings_only_count_between_agents_that_have_them() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let mut slow = spec("npx", "a");
        slow.options.timeout_ms = Some(60_000);
        mcp::add(Agent::ClaudeCode, home, "s", &spec("npx", "a"), false).unwrap();
        mcp::add(Agent::Codex, home, "s", &slow, false).unwrap();
        let (servers, _) = mcp::list_all(home);
        assert!(drifting(&servers).is_empty());

        // Copies are compared with the first one listed, here Codex's.
        mcp::add(Agent::Codex, home, "t", &slow, false).unwrap();
        mcp::add(Agent::Gemini, home, "t", &spec("npx", "a"), false).unwrap();
        let (servers, _) = mcp::list_all(home);
        assert_eq!(drifting(&servers), ["t"]);
    }

    #[test]
    fn check_finds_plain_secrets_and_missing_copies() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        fs::create_dir_all(home.join(".codex")).unwrap();
        mcp::add(
            Agent::ClaudeCode,
            home,
            "github",
            &spec("npx", "ghp_x"),
            false,
        )
        .unwrap();

        let findings = check(home);
        assert!(findings.contains(&Finding::PlainSecrets {
            count: 1,
            servers: vec!["github".into()],
        }));
        assert!(findings.contains(&Finding::Partial {
            servers: vec!["github".into()],
        }));
        let severities: Vec<_> = findings.iter().map(Finding::severity).collect();
        assert!(severities.is_sorted());
        let json = serde_json::to_string(&findings[0]).unwrap();
        assert!(json.contains("\"kind\":\"plainSecrets\"") && !json.contains("ghp_x"));
    }

    #[test]
    fn an_unreadable_config_is_a_finding() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        fs::create_dir_all(home.join(".codex")).unwrap();
        fs::write(home.join(".codex/config.toml"), "not = [toml").unwrap();
        assert!(check(home).iter().any(|finding| matches!(
            finding,
            Finding::Unreadable {
                agent: Agent::Codex,
                ..
            }
        )));
    }
}
