//! Session history and token usage, read from the agents' local logs.
//!
//! - Claude Code writes one JSONL file per session under `~/.claude/projects`.
//! - Codex writes one JSONL "rollout" per session under `~/.codex/sessions`.
//!
//! Cursor and Gemini CLI keep no usable usage logs on disk.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::ops::AddAssign;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Agent, pricing};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    /// Input tokens read without the cache.
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
}

impl Tokens {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write_5m + self.cache_write_1h
    }
}

impl AddAssign for Tokens {
    fn add_assign(&mut self, other: Tokens) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write_5m += other.cache_write_5m;
        self.cache_write_1h += other.cache_write_1h;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub agent: Agent,
    pub id: String,
    /// Working directory the session ran in.
    pub project: Option<String>,
    pub title: Option<String>,
    pub models: Vec<String>,
    /// RFC 3339 timestamps, as written by the agent.
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub tokens: Tokens,
    /// Estimated cost of the tokens whose model has a known price.
    pub cost_usd: f64,
    /// Tokens of models without a known price, left out of `cost_usd`.
    pub unpriced_tokens: u64,
}

/// Usage of one agent on one UTC day.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayUsage {
    /// `YYYY-MM-DD`
    pub date: String,
    pub agent: Agent,
    pub tokens: Tokens,
    pub cost_usd: f64,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    /// Most recent first.
    pub sessions: Vec<Session>,
    /// Oldest first.
    pub daily: Vec<DayUsage>,
    /// Files that could not be read. Malformed lines are skipped silently.
    pub errors: Vec<String>,
}

/// The UTC date `days` days before today, as `YYYY-MM-DD`, to filter
/// [`UsageReport::daily`] by string comparison.
pub fn date_days_ago(days: u32) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let day = (now / 86_400) as i64 - i64::from(days);
    // Howard Hinnant's civil_from_days.
    let z = day + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Reads the usage of every agent with local logs.
pub fn report(home: &Path) -> UsageReport {
    let mut builder = ReportBuilder::default();
    read_claude_code(&home.join(".claude").join("projects"), &mut builder);
    read_codex(&home.join(".codex"), &mut builder);
    builder.finish()
}

#[derive(Default)]
struct ReportBuilder {
    sessions: HashMap<(Agent, String), Session>,
    daily: BTreeMap<(String, Agent), DayUsage>,
    errors: Vec<String>,
}

impl ReportBuilder {
    fn session(&mut self, agent: Agent, id: &str) -> &mut Session {
        self.sessions
            .entry((agent, id.to_owned()))
            .or_insert_with(|| Session {
                agent,
                id: id.to_owned(),
                project: None,
                title: None,
                models: Vec::new(),
                started_at: None,
                ended_at: None,
                tokens: Tokens::default(),
                cost_usd: 0.0,
                unpriced_tokens: 0,
            })
    }

    fn touch(&mut self, agent: Agent, id: &str, timestamp: Option<&str>, project: Option<&str>) {
        let session = self.session(agent, id);
        if session.project.is_none() {
            session.project = project.map(str::to_owned);
        }
        if let Some(timestamp) = timestamp {
            if session
                .started_at
                .as_deref()
                .is_none_or(|start| timestamp < start)
            {
                session.started_at = Some(timestamp.to_owned());
            }
            if session
                .ended_at
                .as_deref()
                .is_none_or(|end| timestamp > end)
            {
                session.ended_at = Some(timestamp.to_owned());
            }
        }
    }

    fn add_usage(&mut self, agent: Agent, id: &str, model: &str, timestamp: &str, tokens: Tokens) {
        let cost = pricing::lookup(model).map(|price| pricing::cost(price, &tokens));

        let session = self.session(agent, id);
        session.tokens += tokens;
        match cost {
            Some(cost) => session.cost_usd += cost,
            None => session.unpriced_tokens += tokens.total(),
        }
        if !session.models.iter().any(|known| known == model) {
            session.models.push(model.to_owned());
        }

        let date = timestamp.get(..10).unwrap_or(timestamp).to_owned();
        let day = self
            .daily
            .entry((date.clone(), agent))
            .or_insert_with(|| DayUsage {
                date,
                agent,
                tokens: Tokens::default(),
                cost_usd: 0.0,
            });
        day.tokens += tokens;
        day.cost_usd += cost.unwrap_or(0.0);
    }

    fn finish(self) -> UsageReport {
        let mut sessions: Vec<Session> = self
            .sessions
            .into_values()
            .filter(|session| session.tokens.total() > 0)
            .collect();
        sessions.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
        UsageReport {
            sessions,
            daily: self.daily.into_values().collect(),
            errors: self.errors,
        }
    }
}

/// Every `.jsonl` file below `dir`, recursively. A missing directory is empty.
fn jsonl_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|ext| ext == "jsonl") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

fn for_each_line(path: &Path, mut handle: impl FnMut(&str)) -> std::io::Result<()> {
    for line in BufReader::new(File::open(path)?)
        .lines()
        .map_while(Result::ok)
    {
        handle(&line);
    }
    Ok(())
}

fn file_error(path: &Path, err: std::io::Error) -> String {
    format!("{}: {err}", path.display())
}

// Claude Code

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    session_id: Option<String>,
    timestamp: Option<String>,
    cwd: Option<String>,
    ai_title: Option<String>,
    #[serde(default)]
    is_meta: bool,
    message: Option<ClaudeMessage>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    id: Option<String>,
    model: Option<String>,
    content: Option<Value>,
    usage: Option<ClaudeUsage>,
}

#[derive(Deserialize)]
struct ClaudeUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    cache_creation: Option<ClaudeCacheCreation>,
}

#[derive(Deserialize)]
struct ClaudeCacheCreation {
    #[serde(default)]
    ephemeral_5m_input_tokens: u64,
    #[serde(default)]
    ephemeral_1h_input_tokens: u64,
}

impl ClaudeUsage {
    fn tokens(&self) -> Tokens {
        // Older logs only have the total, which was always written at the 5-minute rate.
        let (write_5m, write_1h) = match &self.cache_creation {
            Some(split) => (
                split.ephemeral_5m_input_tokens,
                split.ephemeral_1h_input_tokens,
            ),
            None => (self.cache_creation_input_tokens, 0),
        };
        Tokens {
            input: self.input_tokens,
            output: self.output_tokens,
            cache_read: self.cache_read_input_tokens,
            cache_write_5m: write_5m,
            cache_write_1h: write_1h,
        }
    }
}

fn read_claude_code(projects: &Path, builder: &mut ReportBuilder) {
    // One API response is logged once per content block, and a session that
    // moves to another directory is copied there, so count each message once.
    let mut seen = HashSet::new();
    for path in jsonl_files(projects) {
        let read = for_each_line(&path, |line| {
            let Ok(entry) = serde_json::from_str::<ClaudeLine>(line) else {
                return;
            };
            let Some(session_id) = entry.session_id.as_deref() else {
                return;
            };
            let timestamp = entry.timestamp.as_deref();
            match entry.kind.as_deref() {
                Some("ai-title") => {
                    if let Some(title) = entry.ai_title {
                        builder.session(Agent::ClaudeCode, session_id).title = Some(title);
                    }
                }
                Some("user") if !entry.is_meta => {
                    builder.touch(
                        Agent::ClaudeCode,
                        session_id,
                        timestamp,
                        entry.cwd.as_deref(),
                    );
                    let prompt = entry
                        .message
                        .and_then(|message| message.content)
                        .and_then(|content| first_prompt(&content));
                    let session = builder.session(Agent::ClaudeCode, session_id);
                    if session.title.is_none() {
                        session.title = prompt;
                    }
                }
                Some("assistant") => {
                    builder.touch(
                        Agent::ClaudeCode,
                        session_id,
                        timestamp,
                        entry.cwd.as_deref(),
                    );
                    let Some(message) = entry.message else {
                        return;
                    };
                    let (Some(id), Some(model), Some(usage)) =
                        (message.id, message.model, message.usage)
                    else {
                        return;
                    };
                    if model.starts_with('<') || !seen.insert(id) {
                        return;
                    }
                    let timestamp = timestamp.unwrap_or_default();
                    builder.add_usage(
                        Agent::ClaudeCode,
                        session_id,
                        &model,
                        timestamp,
                        usage.tokens(),
                    );
                }
                _ => {}
            }
        });
        if let Err(err) = read {
            builder.errors.push(file_error(&path, err));
        }
    }
}

/// The text the user typed, skipping tool results and command wrappers.
fn first_prompt(content: &Value) -> Option<String> {
    let text = match content {
        Value::String(text) => text.as_str(),
        Value::Array(blocks) => blocks.iter().find_map(|block| {
            (block.get("type")?.as_str()? == "text").then(|| block.get("text")?.as_str())?
        })?,
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() || text.starts_with('<') {
        return None;
    }
    Some(truncate(text, 120))
}

fn truncate(text: &str, max_chars: usize) -> String {
    let line = text.lines().next().unwrap_or_default();
    match line.char_indices().nth(max_chars) {
        Some((index, _)) => format!("{}…", &line[..index]),
        None => line.to_owned(),
    }
}

// Codex

#[derive(Deserialize)]
struct CodexLine {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<Value>,
}

#[derive(Deserialize, Default, Clone, Copy)]
struct CodexUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cached_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

fn read_codex(codex_home: &Path, builder: &mut ReportBuilder) {
    let mut files = jsonl_files(&codex_home.join("sessions"));
    files.extend(jsonl_files(&codex_home.join("archived_sessions")));
    for path in files {
        read_codex_rollout(&path, builder);
    }
}

fn read_codex_rollout(path: &Path, builder: &mut ReportBuilder) {
    let mut session_id: Option<String> = None;
    let mut model = String::from("unknown");
    // Token counts are cumulative and sometimes repeated, so only the growth
    // since the previous count is attributed to the current model.
    let mut previous = CodexUsage::default();

    let read = for_each_line(path, |line| {
        let Ok(entry) = serde_json::from_str::<CodexLine>(line) else {
            return;
        };
        let Some(payload) = entry.payload else {
            return;
        };
        let timestamp = entry.timestamp.as_deref();
        match entry.kind.as_deref() {
            Some("session_meta") => {
                let Some(id) = payload.get("id").and_then(Value::as_str) else {
                    return;
                };
                let cwd = payload.get("cwd").and_then(Value::as_str);
                builder.touch(Agent::Codex, id, timestamp, cwd);
                session_id = Some(id.to_owned());
            }
            Some("turn_context") => {
                if let Some(name) = payload.get("model").and_then(Value::as_str) {
                    model = name.to_owned();
                }
            }
            Some("event_msg") => {
                let Some(id) = session_id.as_deref() else {
                    return;
                };
                builder.touch(Agent::Codex, id, timestamp, None);
                match payload.get("type").and_then(Value::as_str) {
                    Some("user_message") => {
                        let prompt = payload
                            .get("message")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|text| !text.is_empty() && !text.starts_with('<'))
                            .map(|text| truncate(text, 120));
                        let session = builder.session(Agent::Codex, id);
                        if session.title.is_none() {
                            session.title = prompt;
                        }
                    }
                    Some("token_count") => {
                        let Some(total) = payload
                            .pointer("/info/total_token_usage")
                            .and_then(|value| CodexUsage::deserialize(value).ok())
                        else {
                            return;
                        };
                        let delta = |now: u64, before: u64| now.saturating_sub(before);
                        let input = delta(total.input_tokens, previous.input_tokens);
                        let cached = delta(total.cached_input_tokens, previous.cached_input_tokens);
                        let output = delta(total.output_tokens, previous.output_tokens);
                        previous = total;
                        if input + output == 0 {
                            return;
                        }
                        // OpenAI counts cached tokens inside input tokens.
                        let tokens = Tokens {
                            input: input.saturating_sub(cached),
                            output,
                            cache_read: cached,
                            ..Tokens::default()
                        };
                        builder.add_usage(
                            Agent::Codex,
                            id,
                            &model,
                            timestamp.unwrap_or_default(),
                            tokens,
                        );
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    });
    if let Err(err) = read {
        builder.errors.push(file_error(path, err));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, lines: &[&str]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, lines.join("\n")).unwrap();
    }

    #[test]
    fn reads_claude_code_sessions_once_per_message() {
        let home = tempfile::tempdir().unwrap();
        let assistant = r#"{"type":"assistant","sessionId":"s1","timestamp":"2026-10-20T10:00:05Z","cwd":"/work/app","message":{"id":"msg_1","model":"claude-opus-5-5","content":[],"usage":{"input_tokens":1000000,"output_tokens":1000000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}"#;
        let lines = [
            r#"{"type":"user","sessionId":"s1","timestamp":"2026-10-20T10:00:00Z","cwd":"/work/app","message":{"role":"user","content":"Fix the login bug\nwith details"}}"#,
            assistant,
            assistant,
            r#"{"type":"assistant","sessionId":"s1","timestamp":"2026-10-21T09:00:00Z","message":{"id":"msg_2","model":"<synthetic>","content":[],"usage":{"input_tokens":5,"output_tokens":5}}}"#,
        ];
        write(
            &home.path().join(".claude/projects/-work-app/s1.jsonl"),
            &lines,
        );
        // The same session copied into another project directory.
        write(
            &home.path().join(".claude/projects/-work/s1.jsonl"),
            &lines[1..2],
        );

        let report = report(home.path());
        assert_eq!(report.sessions.len(), 1);
        let session = &report.sessions[0];
        assert_eq!(session.title.as_deref(), Some("Fix the login bug"));
        assert_eq!(session.project.as_deref(), Some("/work/app"));
        assert_eq!(session.tokens.input, 1_000_000);
        assert!((session.cost_usd - 24.0).abs() < 1e-9);
        assert_eq!(session.ended_at.as_deref(), Some("2026-10-21T09:00:00Z"));
        assert_eq!(report.daily.len(), 1);
        assert_eq!(report.daily[0].date, "2026-10-20");
    }

    #[test]
    fn reads_codex_rollouts_from_cumulative_counts() {
        let home = tempfile::tempdir().unwrap();
        let count = |input: u64, cached: u64, output: u64| {
            format!(
                r#"{{"timestamp":"2026-10-21T08:00:0{input}Z","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{input}000000,"cached_input_tokens":{cached}000000,"output_tokens":{output}000000}}}}}}}}"#
            )
        };
        let lines = [
            r#"{"timestamp":"2026-10-21T08:00:00Z","type":"session_meta","payload":{"id":"c1","cwd":"/work/api"}}"#.to_owned(),
            r#"{"timestamp":"2026-10-21T08:00:00Z","type":"turn_context","payload":{"model":"gpt-5-codex"}}"#.to_owned(),
            r#"{"timestamp":"2026-10-21T08:00:01Z","type":"event_msg","payload":{"type":"user_message","message":"Add pagination"}}"#.to_owned(),
            count(2, 1, 1),
            count(2, 1, 1),
            r#"{"timestamp":"2026-10-21T08:00:05Z","type":"turn_context","payload":{"model":"gpt-9"}}"#.to_owned(),
            count(3, 1, 1),
        ];
        let lines: Vec<&str> = lines.iter().map(String::as_str).collect();
        write(
            &home
                .path()
                .join(".codex/sessions/2026/10/21/rollout-c1.jsonl"),
            &lines,
        );

        let report = report(home.path());
        let session = &report.sessions[0];
        assert_eq!(session.agent, Agent::Codex);
        assert_eq!(session.title.as_deref(), Some("Add pagination"));
        assert_eq!(session.models, vec!["gpt-5-codex", "gpt-9"]);
        assert_eq!(session.tokens.input, 2_000_000);
        assert_eq!(session.tokens.cache_read, 1_000_000);
        assert_eq!(session.unpriced_tokens, 1_000_000);
        // 1M uncached input, 1M cached, 1M output at gpt-5-codex prices.
        assert!((session.cost_usd - (1.25 + 0.125 + 10.0)).abs() < 1e-9);
    }
}
