//! Global rules: the instructions file each agent loads into every session.

use std::path::Path;

use serde::Serialize;

use crate::{Agent, Error, Result, config_file};

/// The global rules of one agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    pub agent: Agent,
    /// `None` when the file does not exist yet.
    pub content: Option<String>,
}

fn rules_path(agent: Agent, home: &Path) -> Result<std::path::PathBuf> {
    agent.rules_path(home).ok_or(Error::NoRulesFile { agent })
}

pub fn read(agent: Agent, home: &Path) -> Result<Rules> {
    let content = config_file::read_optional(&rules_path(agent, home)?)?;
    Ok(Rules { agent, content })
}

/// Reads the rules of every agent that keeps them in a file.
pub fn read_all(home: &Path) -> (Vec<Rules>, Vec<(Agent, Error)>) {
    let mut rules = Vec::new();
    let mut errors = Vec::new();
    for agent in Agent::ALL {
        if agent.rules_path(home).is_none() {
            continue;
        }
        match read(agent, home) {
            Ok(found) => rules.push(found),
            Err(err) => errors.push((agent, err)),
        }
    }
    (rules, errors)
}

/// Replaces the rules of `agent`, keeping the previous file as a backup.
pub fn write(agent: Agent, home: &Path, content: &str) -> Result<()> {
    config_file::write(home, &rules_path(agent, home)?, content)
}

/// Copies the rules of `from` over those of `to`.
pub fn copy(home: &Path, from: Agent, to: Agent) -> Result<()> {
    let content = read(from, home)?.content.unwrap_or_default();
    write(to, home, &content)
}

/// Opens the shared base: the part of the rules that is the same for every
/// agent. HTML comments, so agents and Markdown viewers ignore the markers.
pub const SHARED_START: &str = "<!-- agentdeck:shared -->";
/// Closes the shared base.
pub const SHARED_END: &str = "<!-- /agentdeck:shared -->";

/// Where the shared base sits in `content`: the byte ranges of the whole
/// block, markers included, and of the text between the markers.
fn shared_block(content: &str) -> Option<(std::ops::Range<usize>, std::ops::Range<usize>)> {
    let start = content.find(SHARED_START)?;
    let inner_start = start + SHARED_START.len();
    let end = inner_start + content[inner_start..].find(SHARED_END)?;
    Some((start..end + SHARED_END.len(), inner_start..end))
}

/// The shared base of `content`, between its markers, without the line
/// breaks that frame it. `None` when the rules have no shared base.
pub fn shared_part(content: &str) -> Option<&str> {
    let (_, inner) = shared_block(content)?;
    Some(trim_frame(&content[inner]))
}

/// Drops one line break after the start marker and one before the end marker.
fn trim_frame(text: &str) -> &str {
    let text = text
        .strip_prefix("\r\n")
        .or_else(|| text.strip_prefix('\n'))
        .unwrap_or(text);
    text.strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text)
}

/// `content` with its shared base replaced by `shared`, or with the shared
/// base added on top when it has none. The rest is kept as it is.
pub fn with_shared(content: &str, shared: &str) -> String {
    let block = format!("{SHARED_START}\n{shared}\n{SHARED_END}");
    match shared_block(content) {
        Some((whole, _)) => format!(
            "{}{block}{}",
            &content[..whole.start],
            &content[whole.end..]
        ),
        None if content.trim().is_empty() => format!("{block}\n"),
        None => format!("{block}\n\n{content}"),
    }
}

/// Puts the shared base of `from` into the rules of `to`, keeping the rest
/// of them. Fails when `from` has no shared base.
pub fn copy_shared(home: &Path, from: Agent, to: Agent) -> Result<()> {
    let source = read(from, home)?.content.unwrap_or_default();
    let shared = shared_part(&source).ok_or(Error::NoSharedRules { agent: from })?;
    let target = read(to, home)?.content.unwrap_or_default();
    write(to, home, &with_shared(&target, shared))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn write_read_and_copy() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();

        assert_eq!(read(Agent::Codex, home).unwrap().content, None);
        write(Agent::ClaudeCode, home, "# Rules\nUse pnpm.\n").unwrap();
        copy(home, Agent::ClaudeCode, Agent::Gemini).unwrap();

        let gemini = read(Agent::Gemini, home).unwrap();
        assert_eq!(gemini.content.as_deref(), Some("# Rules\nUse pnpm.\n"));
        assert!(home.join(".gemini/GEMINI.md").exists());

        write(Agent::Gemini, home, "changed").unwrap();
        let backup = fs::read_to_string(home.join(".gemini/GEMINI.md.agentdeck.bak")).unwrap();
        assert_eq!(backup, "# Rules\nUse pnpm.\n");

        let (all, errors) = read_all(home);
        assert!(errors.is_empty());
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn the_shared_base_is_replaced_and_the_rest_kept() {
        let claude = "# Rules\n<!-- agentdeck:shared -->\nUse pnpm.\nWrite tests.\n<!-- /agentdeck:shared -->\n\nClaude only.\n";
        assert_eq!(shared_part(claude), Some("Use pnpm.\nWrite tests."));
        assert_eq!(shared_part("no markers"), None);
        assert_eq!(shared_part("<!-- agentdeck:shared -->\nunclosed"), None);

        // Replaced in place, around the agent's own rules.
        let codex =
            "Intro.\n<!-- agentdeck:shared -->\nOld.\n<!-- /agentdeck:shared -->\nCodex only.\n";
        assert_eq!(
            with_shared(codex, "Use pnpm.\nWrite tests."),
            "Intro.\n<!-- agentdeck:shared -->\nUse pnpm.\nWrite tests.\n<!-- /agentdeck:shared -->\nCodex only.\n"
        );
        // Added on top of rules without a base, and alone in empty ones.
        assert_eq!(
            with_shared("Gemini only.\n", "Base."),
            "<!-- agentdeck:shared -->\nBase.\n<!-- /agentdeck:shared -->\n\nGemini only.\n"
        );
        assert_eq!(
            with_shared("", "Base."),
            "<!-- agentdeck:shared -->\nBase.\n<!-- /agentdeck:shared -->\n"
        );
        // Syncing twice changes nothing more.
        let once = with_shared("Gemini only.\n", "Base.");
        assert_eq!(with_shared(&once, "Base."), once);
    }

    #[test]
    fn copy_shared_keeps_each_agents_own_rules() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        write(
            Agent::ClaudeCode,
            home,
            "<!-- agentdeck:shared -->\nUse pnpm.\n<!-- /agentdeck:shared -->\nClaude only.\n",
        )
        .unwrap();
        write(Agent::Codex, home, "Codex only.\n").unwrap();
        copy_shared(home, Agent::ClaudeCode, Agent::Codex).unwrap();
        let codex = read(Agent::Codex, home).unwrap().content.unwrap();
        assert_eq!(
            codex,
            "<!-- agentdeck:shared -->\nUse pnpm.\n<!-- /agentdeck:shared -->\n\nCodex only.\n"
        );
        let err = copy_shared(home, Agent::Gemini, Agent::Codex).unwrap_err();
        assert!(matches!(err, Error::NoSharedRules { .. }));
    }

    #[test]
    fn cursor_has_no_rules_file() {
        let home = tempfile::tempdir().unwrap();
        let err = write(Agent::Cursor, home.path(), "x").unwrap_err();
        assert!(matches!(err, Error::NoRulesFile { .. }));
    }
}
