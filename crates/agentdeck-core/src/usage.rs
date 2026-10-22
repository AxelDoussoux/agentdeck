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

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Usage of one agent during one UTC hour, so that a viewer can group it by
/// day in its own time zone.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourUsage {
    /// `YYYY-MM-DDTHH`, in UTC like the agents' log timestamps.
    pub hour: String,
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
    /// Oldest first.
    pub hourly: Vec<HourUsage>,
    /// Files that could not be read. Malformed lines are skipped silently.
    pub errors: Vec<String>,
}

/// Sessions as CSV, one row each, for a spreadsheet.
///
/// Fields are quoted when they hold a comma, a quote or a line break, as
/// RFC 4180 says. A title or project starting with `=`, `+`, `-` or `@` gets
/// a leading `'`, so that a spreadsheet shows it instead of running it as a
/// formula: titles are the first prompt of a session, which anyone can write.
pub fn sessions_csv(sessions: &[Session]) -> String {
    let mut csv = String::from(
        "ended_at,agent,session_id,title,project,models,input_tokens,output_tokens,\
         cache_read_tokens,cache_write_5m_tokens,cache_write_1h_tokens,total_tokens,\
         cost_usd,unpriced_tokens\r\n",
    );
    for session in sessions {
        let t = &session.tokens;
        let fields = [
            field(session.ended_at.as_deref().unwrap_or("")),
            field(session.agent.display_name()),
            field(&session.id),
            text_field(session.title.as_deref().unwrap_or("")),
            text_field(session.project.as_deref().unwrap_or("")),
            field(&session.models.join("; ")),
            t.input.to_string(),
            t.output.to_string(),
            t.cache_read.to_string(),
            t.cache_write_5m.to_string(),
            t.cache_write_1h.to_string(),
            t.total().to_string(),
            format!("{:.4}", session.cost_usd),
            session.unpriced_tokens.to_string(),
        ];
        csv.push_str(&fields.join(","));
        csv.push_str("\r\n");
    }
    csv
}

/// A CSV field, quoted when it needs to be.
fn field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// A field of free text, which a spreadsheet must not read as a formula.
fn text_field(value: &str) -> String {
    if value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        field(&format!("'{value}"))
    } else {
        field(value)
    }
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
///
/// Logs grow to gigabytes, so what each file says is cached in
/// `~/.agentdeck/cache/usage.json` and a file is only parsed again when its
/// size or modification time changes. Costs are computed on each read, so a
/// price change applies to old sessions too.
pub fn report(home: &Path) -> UsageReport {
    report_with_progress(home, |_| {})
}

/// How far [`report_with_progress`] is through the log files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadProgress {
    /// Files read so far, from the cache or parsed again. Equals `total`
    /// once every file is read.
    pub done: usize,
    pub total: usize,
}

/// [`report`], calling `on_progress` after each log file.
pub fn report_with_progress(home: &Path, mut on_progress: impl FnMut(ReadProgress)) -> UsageReport {
    let cache_path = home.join(".agentdeck").join("cache").join("usage.json");
    let mut cache = Cache::load(&cache_path);
    let mut kept = Cache::default();
    let mut builder = ReportBuilder::default();

    let codex = Agent::Codex.folder(home);
    let mut codex_files = jsonl_files(&codex.join("sessions"));
    codex_files.extend(jsonl_files(&codex.join("archived_sessions")));
    let sources = [
        (
            Agent::ClaudeCode,
            jsonl_files(&Agent::ClaudeCode.folder(home).join("projects")),
        ),
        (Agent::Codex, codex_files),
    ];
    let total = sources.iter().map(|(_, files)| files.len()).sum();
    let mut done = 0;
    for (agent, files) in sources {
        for path in files {
            on_progress(ReadProgress { done, total });
            done += 1;
            let key = path.to_string_lossy().into_owned();
            let stamp = stamp(&path);
            let log = match cache.files.remove(&key) {
                Some(log) if stamp == Some((log.size, log.modified_ms)) => log,
                _ => {
                    let parsed = match agent {
                        Agent::Codex => parse_codex_rollout(&path),
                        _ => parse_claude_code(&path),
                    };
                    match (parsed, stamp) {
                        (Ok(mut log), Some((size, modified_ms))) => {
                            (log.size, log.modified_ms) = (size, modified_ms);
                            kept.changed = true;
                            log
                        }
                        (Ok(log), None) => log,
                        (Err(err), _) => {
                            builder.errors.push(file_error(&path, err));
                            continue;
                        }
                    }
                }
            };
            builder.replay(agent, &log);
            kept.files.insert(key, log);
        }
    }
    on_progress(ReadProgress { done, total });
    // Files that are gone leave the cache too.
    if kept.changed || !cache.files.is_empty() {
        kept.save(&cache_path);
    }
    builder.finish()
}

/// Bump when the parsers change, so that cached files are read again.
const CACHE_VERSION: u32 = 1;

#[derive(Default, Serialize, Deserialize)]
struct Cache {
    version: u32,
    /// By path of the log file.
    files: BTreeMap<String, FileLog>,
    #[serde(skip)]
    changed: bool,
}

impl Cache {
    /// The cache, or an empty one when it is missing, unreadable or from
    /// another version.
    fn load(path: &Path) -> Cache {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Cache>(&bytes).ok())
            .filter(|cache| cache.version == CACHE_VERSION)
            .unwrap_or_default()
    }

    /// Saves the cache atomically. A cache that cannot be written only means
    /// the logs are parsed again next time.
    fn save(mut self, path: &Path) {
        self.version = CACHE_VERSION;
        let Some(dir) = path.parent() else {
            return;
        };
        let tmp = path.with_extension("json.tmp");
        let written = fs::create_dir_all(dir)
            .and_then(|()| private(dir))
            .and_then(|()| fs::write(&tmp, serde_json::to_vec(&self).unwrap_or_default()))
            .and_then(|()| fs::rename(&tmp, path));
        if written.is_err() {
            let _ = fs::remove_file(&tmp);
        }
    }
}

/// The cache holds prompts and project paths: only the user may read it.
fn private(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

/// Size and modification time of a file, in milliseconds.
fn stamp(path: &Path) -> Option<(u64, u64)> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some((metadata.len(), modified.as_millis() as u64))
}

/// What one log file says, on its own, so that it can be cached and combined
/// with the other files later.
#[derive(Default, Serialize, Deserialize)]
struct FileLog {
    size: u64,
    modified_ms: u64,
    sessions: Vec<FileSession>,
    models: Vec<String>,
    /// Token usage of each API response, in the order of the file.
    usage: Vec<FileUsage>,
}

#[derive(Default, Serialize, Deserialize)]
struct FileSession {
    id: String,
    /// The first working directory the file gives.
    project: Option<String>,
    started_at: Option<String>,
    ended_at: Option<String>,
    /// Title the agent generated; the last one wins over any prompt.
    ai_title: Option<String>,
    /// First prompt of the file, the title when the agent set none.
    prompt: Option<String>,
}

/// Session and model (indexes in the file's lists), a hash of the message id
/// to count a response copied into several files once (0 when there is
/// none), the `YYYY-MM-DDTHH` hour, and the tokens.
#[derive(Serialize, Deserialize)]
struct FileUsage(usize, usize, u64, String, [u64; 5]);

impl FileLog {
    fn session(&mut self, id: &str) -> usize {
        match self.sessions.iter().position(|session| session.id == id) {
            Some(index) => index,
            None => {
                self.sessions.push(FileSession {
                    id: id.to_owned(),
                    ..FileSession::default()
                });
                self.sessions.len() - 1
            }
        }
    }

    fn touch(&mut self, id: &str, timestamp: Option<&str>, project: Option<&str>) -> usize {
        let index = self.session(id);
        let session = &mut self.sessions[index];
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
        index
    }

    fn prompt(&mut self, session: usize, prompt: Option<String>) {
        let session = &mut self.sessions[session];
        if session.prompt.is_none() {
            session.prompt = prompt;
        }
    }

    fn add_usage(
        &mut self,
        session: usize,
        message: u64,
        model: &str,
        timestamp: &str,
        tokens: Tokens,
    ) {
        let model = match self.models.iter().position(|known| known == model) {
            Some(index) => index,
            None => {
                self.models.push(model.to_owned());
                self.models.len() - 1
            }
        };
        let hour = timestamp.get(..13).unwrap_or(timestamp).to_owned();
        let Tokens {
            input,
            output,
            cache_read,
            cache_write_5m,
            cache_write_1h,
        } = tokens;
        self.usage.push(FileUsage(
            session,
            model,
            message,
            hour,
            [input, output, cache_read, cache_write_5m, cache_write_1h],
        ));
    }
}

/// FNV-1a: a hash that stays the same across runs and Rust versions, since
/// it is stored in the cache.
fn stable_hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[derive(Default)]
struct ReportBuilder {
    sessions: HashMap<(Agent, String), Session>,
    daily: BTreeMap<(String, Agent), DayUsage>,
    hourly: BTreeMap<(String, Agent), HourUsage>,
    errors: Vec<String>,
    /// Hashes of the responses already counted.
    seen: HashSet<u64>,
}

impl ReportBuilder {
    /// Adds what a file says, in the order the files are read.
    fn replay(&mut self, agent: Agent, log: &FileLog) {
        for found in &log.sessions {
            self.touch(
                agent,
                &found.id,
                found.started_at.as_deref(),
                found.project.as_deref(),
            );
            self.touch(agent, &found.id, found.ended_at.as_deref(), None);
            let session = self.session(agent, &found.id);
            if let Some(title) = &found.ai_title {
                session.title = Some(title.clone());
            } else if session.title.is_none() {
                session.title = found.prompt.clone();
            }
        }
        for FileUsage(session, model, message, hour, tokens) in &log.usage {
            if *message != 0 && !self.seen.insert(*message) {
                continue;
            }
            let [input, output, cache_read, cache_write_5m, cache_write_1h] = *tokens;
            let tokens = Tokens {
                input,
                output,
                cache_read,
                cache_write_5m,
                cache_write_1h,
            };
            let (Some(found), Some(model)) = (log.sessions.get(*session), log.models.get(*model))
            else {
                continue;
            };
            self.add_usage(agent, &found.id, model, hour, tokens);
        }
    }

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

        // Claude Code and Codex both log timestamps in UTC (`…Z`).
        let hour = timestamp.get(..13).unwrap_or(timestamp).to_owned();
        let slot = self
            .hourly
            .entry((hour.clone(), agent))
            .or_insert_with(|| HourUsage {
                hour,
                agent,
                tokens: Tokens::default(),
                cost_usd: 0.0,
            });
        slot.tokens += tokens;
        slot.cost_usd += cost.unwrap_or(0.0);
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
            hourly: self.hourly.into_values().collect(),
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

fn parse_claude_code(path: &Path) -> std::io::Result<FileLog> {
    let mut log = FileLog::default();
    // One API response is logged once per content block. A session that
    // moves to another directory is copied there, which the hash catches
    // when the files are combined.
    let mut seen = HashSet::new();
    for_each_line(path, |line| {
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
                    let session = log.session(session_id);
                    log.sessions[session].ai_title = Some(title);
                }
            }
            Some("user") if !entry.is_meta => {
                let session = log.touch(session_id, timestamp, entry.cwd.as_deref());
                let prompt = entry
                    .message
                    .and_then(|message| message.content)
                    .and_then(|content| first_prompt(&content));
                log.prompt(session, prompt);
            }
            Some("assistant") => {
                let session = log.touch(session_id, timestamp, entry.cwd.as_deref());
                let Some(message) = entry.message else {
                    return;
                };
                let (Some(id), Some(model), Some(usage)) =
                    (message.id, message.model, message.usage)
                else {
                    return;
                };
                if model.starts_with('<') || !seen.insert(id.clone()) {
                    return;
                }
                log.add_usage(
                    session,
                    stable_hash(&id).max(1),
                    &model,
                    timestamp.unwrap_or_default(),
                    usage.tokens(),
                );
            }
            _ => {}
        }
    })?;
    Ok(log)
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

fn parse_codex_rollout(path: &Path) -> std::io::Result<FileLog> {
    let mut log = FileLog::default();
    let mut session: Option<usize> = None;
    let mut model = String::from("unknown");
    // Token counts are cumulative and sometimes repeated, so only the growth
    // since the previous count is attributed to the current model.
    let mut previous = CodexUsage::default();

    for_each_line(path, |line| {
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
                session = Some(log.touch(id, timestamp, cwd));
            }
            Some("turn_context") => {
                if let Some(name) = payload.get("model").and_then(Value::as_str) {
                    model = name.to_owned();
                }
            }
            Some("event_msg") => {
                let Some(session) = session else {
                    return;
                };
                let id = log.sessions[session].id.clone();
                log.touch(&id, timestamp, None);
                match payload.get("type").and_then(Value::as_str) {
                    Some("user_message") => {
                        let prompt = payload
                            .get("message")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|text| !text.is_empty() && !text.starts_with('<'))
                            .map(|text| truncate(text, 120));
                        log.prompt(session, prompt);
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
                        log.add_usage(session, 0, &model, timestamp.unwrap_or_default(), tokens);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    })?;
    Ok(log)
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
        assert_eq!(report.hourly.len(), 1);
        assert_eq!(report.hourly[0].hour, "2026-10-20T10");
        assert!((report.hourly[0].cost_usd - 24.0).abs() < 1e-9);
    }

    #[test]
    fn parsed_files_are_cached_until_they_change() {
        let home = tempfile::tempdir().unwrap();
        let log = home.path().join(".claude/projects/-work/s1.jsonl");
        let line = |id: &str| {
            format!(
                r#"{{"type":"assistant","sessionId":"s1","timestamp":"2026-10-20T10:00:05Z","message":{{"id":"{id}","model":"claude-opus-5-5","usage":{{"input_tokens":10,"output_tokens":10}}}}}}"#
            )
        };
        write(&log, &[&line("msg_1")]);
        assert_eq!(report(home.path()).sessions[0].tokens.input, 10);
        let cache = home.path().join(".agentdeck/cache/usage.json");
        assert!(cache.is_file());

        // Same size and time: the cached reading is used, not the file.
        let modified = fs::metadata(&log).unwrap().modified().unwrap();
        let garbage = "x".repeat(fs::metadata(&log).unwrap().len() as usize);
        fs::write(&log, garbage).unwrap();
        File::options()
            .write(true)
            .open(&log)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        assert_eq!(report(home.path()).sessions[0].tokens.input, 10);

        // A file that grows is read again.
        write(&log, &[&line("msg_1"), &line("msg_2")]);
        assert_eq!(report(home.path()).sessions[0].tokens.input, 20);

        // A file that is gone leaves the report and the cache.
        fs::remove_file(&log).unwrap();
        assert!(report(home.path()).sessions.is_empty());
        assert!(!fs::read_to_string(&cache).unwrap().contains("s1.jsonl"));
    }

    #[test]
    fn csv_quotes_fields_and_defuses_formulas() {
        let session = Session {
            agent: Agent::ClaudeCode,
            id: "s1".into(),
            project: Some("/work/a,b".into()),
            title: Some("=HYPERLINK(\"x\")".into()),
            models: vec!["opus".into(), "haiku".into()],
            started_at: None,
            ended_at: Some("2026-10-20T10:00:00Z".into()),
            tokens: Tokens {
                input: 1,
                output: 2,
                cache_read: 3,
                cache_write_5m: 4,
                cache_write_1h: 5,
            },
            cost_usd: 0.5,
            unpriced_tokens: 0,
        };
        let csv = sessions_csv(&[session]);
        let rows: Vec<_> = csv.split("\r\n").collect();
        assert!(rows[0].starts_with("ended_at,agent,session_id,title,"));
        assert_eq!(
            rows[1],
            r#"2026-10-20T10:00:00Z,Claude Code,s1,"'=HYPERLINK(""x"")","/work/a,b",opus; haiku,1,2,3,4,5,15,0.5000,0"#
        );
        assert_eq!(rows[2], "");
    }

    #[test]
    fn progress_counts_every_log_file() {
        let home = tempfile::tempdir().unwrap();
        let line = r#"{"type":"assistant","sessionId":"s1","timestamp":"2026-10-20T10:00:05Z","message":{"id":"m","model":"claude-opus-5-5","usage":{"input_tokens":1,"output_tokens":1}}}"#;
        write(&home.path().join(".claude/projects/-a/s1.jsonl"), &[line]);
        write(&home.path().join(".claude/projects/-b/s2.jsonl"), &[line]);
        let mut seen = Vec::new();
        report_with_progress(home.path(), |progress| {
            seen.push((progress.done, progress.total))
        });
        assert_eq!(seen, [(0, 2), (1, 2), (2, 2)]);
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
