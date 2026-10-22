//! Starting an MCP server to check that it works, and listing its tools.
//!
//! The probe speaks just enough of the Model Context Protocol: `initialize`,
//! the `initialized` notification and `tools/list`, over stdio, Streamable
//! HTTP or the legacy SSE transport. What it reports never holds a secret
//! value of the server: they are masked in its output and errors.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};

use crate::mcp::{ServerSpec, Transport};

/// How long a test may take: `npx` and `uvx` may download the server first.
pub const TIMEOUT: Duration = Duration::from_secs(60);

/// The protocol version the probe asks for. Servers answer with the one they use.
const PROTOCOL_VERSION: &str = "2025-06-18";
/// The longest server output kept for the report.
const LOG_LIMIT: usize = 16 * 1024;
/// At most this many pages of tools are read.
const TOOL_PAGES: usize = 20;

#[derive(Debug, Clone, Serialize)]
pub struct ProbeTool {
    pub name: String,
    pub description: Option<String>,
}

/// What starting a server showed.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeReport {
    /// The server answered `initialize` and, if it has tools, `tools/list`.
    pub ok: bool,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub protocol_version: Option<String>,
    pub tools: Vec<ProbeTool>,
    /// The server says it has no tools, only prompts or resources.
    pub no_tools: bool,
    /// What went wrong, in a sentence.
    pub error: Option<String>,
    /// The server asks to sign in, which each agent does on its own.
    pub needs_sign_in: bool,
    /// The end of what a local server wrote to stderr.
    pub log: String,
    pub elapsed_ms: u64,
}

/// A failure, and whether it is the server asking to sign in.
struct Failure {
    message: String,
    sign_in: bool,
}

impl<T: std::fmt::Display> From<T> for Failure {
    fn from(message: T) -> Self {
        Failure {
            message: message.to_string(),
            sign_in: false,
        }
    }
}

type Outcome<T> = std::result::Result<T, Failure>;

/// Starts the server of `spec`, asks for its tools and stops it, all within
/// `timeout`. Local servers start in `cwd` when the spec has none.
pub fn probe(spec: &ServerSpec, timeout: Duration) -> ProbeReport {
    let started = Instant::now();
    let deadline = started + timeout;
    let env: BTreeMap<String, String> = spec
        .env
        .iter()
        .map(|(key, value)| (key.clone(), expand(value)))
        .collect();
    let headers: BTreeMap<String, String> = spec
        .headers
        .iter()
        .map(|(key, value)| (key.clone(), expand(value)))
        .collect();

    let log = Arc::new(Mutex::new(String::new()));
    let result = match &spec.transport {
        Transport::Stdio { command, args } => {
            Local::start(command, args, &env, spec.options.cwd.as_deref(), &log).and_then(
                |mut session| {
                    let result = handshake(&mut session, deadline);
                    session.stop();
                    result
                },
            )
        }
        Transport::Http { url } => {
            let mut session = Http::new(url, &headers, deadline);
            let result = handshake(&mut session, deadline);
            session.close();
            result
        }
        Transport::Sse { url } => Sse::connect(url, &headers, deadline)
            .and_then(|mut session| handshake(&mut session, deadline)),
    };

    // Masks every secret value, longest first so none is left in part.
    let mut secrets: Vec<&String> = env
        .values()
        .chain(headers.values())
        .chain(spec.env.values())
        .chain(spec.headers.values())
        .filter(|value| value.len() >= 4)
        .collect();
    secrets.sort_by_key(|value| std::cmp::Reverse(value.len()));
    let mask = |text: &str| {
        secrets.iter().fold(text.to_owned(), |text, secret| {
            text.replace(secret.as_str(), "•••")
        })
    };

    let mut report = match result {
        Ok(report) => report,
        Err(failure) => ProbeReport {
            error: Some(failure.message),
            needs_sign_in: failure.sign_in,
            ..ProbeReport::default()
        },
    };
    report.error = report.error.as_deref().map(mask);
    report.log = mask(
        log.lock()
            .map(|log| log.trim_end().to_owned())
            .unwrap_or_default()
            .as_str(),
    );
    report.elapsed_ms = started.elapsed().as_millis() as u64;
    report
}

/// Replaces `${VAR}`, `${env:VAR}` and `${VAR:-default}` with the variables
/// of this process, as agents do before starting a server.
fn expand(value: &str) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        let Some(len) = rest[start..].find('}') else {
            break;
        };
        out.push_str(&rest[..start]);
        let inner = &rest[start + 2..start + len];
        let inner = inner.strip_prefix("env:").unwrap_or(inner);
        let (name, default) = match inner.split_once(":-") {
            Some((name, default)) => (name, Some(default)),
            None => (inner, None),
        };
        match (std::env::var(name), default) {
            (Ok(found), _) if !found.is_empty() => out.push_str(&found),
            (_, Some(default)) => out.push_str(default),
            (Ok(found), None) => out.push_str(&found),
            (Err(_), None) => out.push_str(&rest[start..start + len + 1]),
        }
        rest = &rest[start + len + 1..];
    }
    out.push_str(rest);
    out
}

/// A connection that can send JSON-RPC messages and wait for answers.
trait Session {
    /// Sends a request and returns its result.
    fn request(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        deadline: Instant,
    ) -> Outcome<Value>;
    fn notify(&mut self, method: &str, deadline: Instant) -> Outcome<()>;
    /// Called once the server answered `initialize`.
    fn initialized(&mut self, _protocol_version: &str) {}
}

fn handshake(session: &mut dyn Session, deadline: Instant) -> Outcome<ProbeReport> {
    let init = session.request(
        1,
        "initialize",
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "AgentDeck", "version": env!("CARGO_PKG_VERSION") },
        }),
        deadline,
    )?;
    let text = |value: &Value| value.as_str().map(str::to_owned);
    let protocol_version = text(&init["protocolVersion"]);
    session.initialized(protocol_version.as_deref().unwrap_or(PROTOCOL_VERSION));
    session.notify("notifications/initialized", deadline)?;

    let mut report = ProbeReport {
        server_name: text(&init["serverInfo"]["name"]),
        server_version: text(&init["serverInfo"]["version"]),
        protocol_version,
        ..ProbeReport::default()
    };
    if init["capabilities"].get("tools").is_none() {
        report.no_tools = true;
        report.ok = true;
        return Ok(report);
    }
    let mut cursor: Option<String> = None;
    for page in 0..TOOL_PAGES {
        let params = match &cursor {
            Some(cursor) => json!({ "cursor": cursor }),
            None => json!({}),
        };
        let result = session.request(2 + page as u64, "tools/list", params, deadline)?;
        for tool in result["tools"].as_array().into_iter().flatten() {
            if let Some(name) = text(&tool["name"]) {
                report.tools.push(ProbeTool {
                    name,
                    description: text(&tool["description"]).map(|d| d.trim().to_owned()),
                });
            }
        }
        cursor = text(&result["nextCursor"]).filter(|next| !next.is_empty());
        if cursor.is_none() {
            break;
        }
    }
    report.ok = true;
    Ok(report)
}

/// The answer to request `id` in `message`, if it is one. Other messages are
/// notifications or requests from the server, which the probe ignores.
fn answer(message: &Value, id: u64) -> Option<Outcome<Value>> {
    if message.get("method").is_some() || message["id"].as_u64() != Some(id) {
        return None;
    }
    Some(match message.get("error") {
        Some(error) => Err(Failure::from(format!(
            "The server answered with an error: {}",
            error["message"].as_str().unwrap_or("no message")
        ))),
        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
    })
}

fn left(deadline: Instant) -> Duration {
    deadline.saturating_duration_since(Instant::now())
}

fn timed_out() -> Failure {
    Failure::from("The server did not answer in time.")
}

// ---------- stdio ----------

/// A local server process, talking JSON-RPC one message per line.
struct Local {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<String>,
}

impl Local {
    fn start(
        command: &str,
        args: &[String],
        env: &BTreeMap<String, String>,
        cwd: Option<&str>,
        log: &Arc<Mutex<String>>,
    ) -> Outcome<Local> {
        let path = search_path();
        let program = resolve_program(command, &path);
        let mut process = Command::new(&program);
        process
            .args(args)
            .envs(env)
            .env("PATH", &path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = cwd.filter(|cwd| std::path::Path::new(cwd).is_dir()) {
            process.current_dir(cwd);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: no console flashes up for the server.
            process.creation_flags(0x0800_0000);
        }
        let mut child = process.spawn().map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                Failure::from(format!(
                    "{command} was not found. Is it installed, and on the PATH?"
                ))
            } else {
                Failure::from(format!("Could not start {command}: {err}"))
            }
        })?;

        let (sender, lines) = mpsc::channel();
        let stdout = child.stdout.take().expect("piped stdout");
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        let stderr = child.stderr.take().expect("piped stderr");
        let log = Arc::clone(log);
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = [0u8; 4096];
            while let Ok(read) = reader.read(&mut buffer) {
                if read == 0 {
                    break;
                }
                if let Ok(mut log) = log.lock() {
                    log.push_str(&String::from_utf8_lossy(&buffer[..read]));
                    if log.len() > LOG_LIMIT {
                        let mut cut = log.len() - LOG_LIMIT;
                        while !log.is_char_boundary(cut) {
                            cut += 1;
                        }
                        log.replace_range(..cut, "…");
                    }
                }
            }
        });
        Ok(Local {
            stdin: child.stdin.take(),
            child,
            lines,
        })
    }

    fn send(&mut self, message: &Value) -> Outcome<()> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| Failure::from("The server closed its input."))?;
        writeln!(stdin, "{message}")
            .and_then(|_| stdin.flush())
            .map_err(|_| self.ended())
    }

    /// Why the server stopped answering.
    fn ended(&mut self) -> Failure {
        // Gives the process a moment to exit, so its status is known.
        let until = Instant::now() + Duration::from_millis(500);
        while Instant::now() < until {
            if let Ok(Some(status)) = self.child.try_wait() {
                return Failure::from(match status.code() {
                    Some(code) => {
                        format!("The server stopped before answering (exit code {code}).")
                    }
                    None => "The server stopped before answering.".to_owned(),
                });
            }
            thread::sleep(Duration::from_millis(25));
        }
        Failure::from("The server closed its output before answering.")
    }

    /// Closes the server's input, which tells it to exit, and kills it if it
    /// is still running a moment later.
    fn stop(mut self) {
        drop(self.stdin.take());
        let until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < until {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Session for Local {
    fn request(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        deadline: Instant,
    ) -> Outcome<Value> {
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        loop {
            let line = match self.lines.recv_timeout(left(deadline)) {
                Ok(line) => line,
                Err(RecvTimeoutError::Timeout) => return Err(timed_out()),
                Err(RecvTimeoutError::Disconnected) => return Err(self.ended()),
            };
            // Servers may log on stdout too; anything that is not JSON is skipped.
            let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if let Some(answer) = answer(&message, id) {
                return answer;
            }
            self.reply_to_server(&message)?;
        }
    }

    fn notify(&mut self, method: &str, _deadline: Instant) -> Outcome<()> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method }))
    }
}

impl Local {
    /// Answers requests the server makes, such as `ping` or `roots/list`, so
    /// that it does not wait for them.
    fn reply_to_server(&mut self, message: &Value) -> Outcome<()> {
        let (Some(id), Some(method)) = (message.get("id"), message["method"].as_str()) else {
            return Ok(());
        };
        let reply = match method {
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "roots/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "roots": [] } }),
            _ => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "Not supported by AgentDeck's test" },
            }),
        };
        self.send(&reply)
    }
}

/// The PATH to start servers with. Apps opened from the Finder or a desktop
/// launcher get a short PATH, so the login shell's is added, then the usual
/// install folders of Node, Python and Homebrew tools.
fn search_path() -> std::ffi::OsString {
    use std::sync::OnceLock;
    static PATH: OnceLock<std::ffi::OsString> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect())
            .unwrap_or_default();
        let mut add = |dir: std::path::PathBuf| {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        };
        if cfg!(unix) {
            for dir in login_shell_path() {
                add(dir);
            }
            if let Some(home) = dirs::home_dir() {
                for dir in [
                    ".local/bin",
                    ".cargo/bin",
                    ".bun/bin",
                    ".volta/bin",
                    ".deno/bin",
                ] {
                    add(home.join(dir));
                }
            }
            for dir in ["/opt/homebrew/bin", "/usr/local/bin"] {
                add(dir.into());
            }
        }
        std::env::join_paths(dirs).unwrap_or_default()
    })
    .clone()
}

/// The PATH of the user's login shell, which sets up nvm, pyenv and the like.
fn login_shell_path() -> Vec<std::path::PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let Ok(mut child) = Command::new(shell)
        .args(["-l", "-c", "printf '%s' \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Vec::new();
    };
    // A shell that hangs on a prompt or a slow profile is not waited for.
    let until = Instant::now() + Duration::from_secs(3);
    while Instant::now() < until {
        match child.try_wait() {
            Ok(Some(_)) => {
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    let _ = stdout.read_to_string(&mut out);
                }
                return std::env::split_paths(out.trim()).collect();
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Vec::new()
}

/// On Windows, finds `npx.cmd` and friends: `Command` only adds `.exe`.
fn resolve_program(name: &str, path: &std::ffi::OsStr) -> std::path::PathBuf {
    let program = std::path::Path::new(name);
    if !cfg!(windows) || program.extension().is_some() || program.components().count() > 1 {
        return program.to_path_buf();
    }
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".into());
    std::env::split_paths(path)
        .flat_map(|dir| {
            extensions
                .split(';')
                .filter(|ext| !ext.is_empty())
                .map(move |ext| dir.join(format!("{name}{}", ext.to_lowercase())))
        })
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| program.to_path_buf())
}

// ---------- HTTP ----------

fn http_agent(deadline: Instant) -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig};
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        // The system's certificates, so that company proxies are trusted too.
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .timeout_global(Some(left(deadline).max(Duration::from_millis(1))))
        .user_agent(concat!("AgentDeck/", env!("CARGO_PKG_VERSION")))
        .build()
        .new_agent()
}

/// Why an HTTP status ends the probe.
fn status_failure(status: u16, has_auth: bool, body: &str) -> Failure {
    let detail = body.trim();
    let detail = if detail.is_empty() || detail.len() > 300 {
        String::new()
    } else {
        format!(" {detail}")
    };
    match status {
        401 | 403 if !has_auth => Failure {
            message: format!(
                "The server asks to sign in (HTTP {status}). Each agent signs in on its own the first time it uses it."
            ),
            sign_in: true,
        },
        401 | 403 => Failure {
            message: format!("The server refused the credentials (HTTP {status}).{detail}"),
            sign_in: true,
        },
        404 => Failure::from(format!("Nothing answers at this URL (HTTP 404).{detail}")),
        _ => Failure::from(format!("The server answered HTTP {status}.{detail}")),
    }
}

fn request_failure(err: ureq::Error) -> Failure {
    match err {
        ureq::Error::Timeout(_) => timed_out(),
        ureq::Error::Io(io) if io.kind() == std::io::ErrorKind::TimedOut => timed_out(),
        other => Failure::from(format!("Could not reach the server: {other}")),
    }
}

/// Streamable HTTP: each message is a POST, answered with JSON or an SSE stream.
struct Http {
    url: String,
    headers: BTreeMap<String, String>,
    agent: ureq::Agent,
    session_id: Option<String>,
    protocol_version: Option<String>,
}

impl Http {
    fn new(url: &str, headers: &BTreeMap<String, String>, deadline: Instant) -> Http {
        Http {
            url: url.to_owned(),
            headers: headers.clone(),
            agent: http_agent(deadline),
            session_id: None,
            protocol_version: None,
        }
    }

    fn has_auth(&self) -> bool {
        self.headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("authorization"))
    }

    fn post(&mut self, message: &Value) -> Outcome<ureq::http::Response<ureq::Body>> {
        let mut request = self
            .agent
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream");
        for (key, value) in &self.headers {
            request = request.header(key, value);
        }
        if let Some(id) = &self.session_id {
            request = request.header("Mcp-Session-Id", id);
        }
        if let Some(version) = &self.protocol_version {
            request = request.header("MCP-Protocol-Version", version);
        }
        let response = request.send(message.to_string()).map_err(request_failure)?;
        if let Some(id) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|id| id.to_str().ok())
        {
            self.session_id = Some(id.to_owned());
        }
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let has_auth = self.has_auth();
            let body = response.into_body().read_to_string().unwrap_or_default();
            return Err(status_failure(status, has_auth, &body));
        }
        Ok(response)
    }

    /// Ends the session on the server, as the protocol asks clients to.
    fn close(self) {
        if let Some(id) = &self.session_id {
            let mut request = self.agent.delete(&self.url).header("Mcp-Session-Id", id);
            for (key, value) in &self.headers {
                request = request.header(key, value);
            }
            let _ = request.call();
        }
    }
}

impl Session for Http {
    fn request(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        deadline: Instant,
    ) -> Outcome<Value> {
        let response =
            self.post(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        let is_stream = response
            .headers()
            .get("content-type")
            .and_then(|kind| kind.to_str().ok())
            .is_some_and(|kind| kind.starts_with("text/event-stream"));
        let body = response.into_body().into_reader();
        if is_stream {
            let mut events = SseReader::new(body);
            while let Some((_, data)) =
                events.next_event().map_err(|_| timed_or_closed(deadline))?
            {
                if let Ok(message) = serde_json::from_str::<Value>(&data)
                    && let Some(answer) = answer(&message, id)
                {
                    return answer;
                }
            }
            return Err(Failure::from(
                "The server closed the stream before answering.",
            ));
        }
        let mut text = String::new();
        BufReader::new(body)
            .read_to_string(&mut text)
            .map_err(|_| timed_or_closed(deadline))?;
        let message: Value = serde_json::from_str(&text)
            .map_err(|_| Failure::from("The server answered something that is not MCP."))?;
        // A batch answer is an array of messages.
        let messages = match message {
            Value::Array(items) => items,
            single => vec![single],
        };
        messages
            .iter()
            .find_map(|message| answer(message, id))
            .unwrap_or_else(|| Err(Failure::from("The server did not answer the request.")))
    }

    fn notify(&mut self, method: &str, _deadline: Instant) -> Outcome<()> {
        self.post(&json!({ "jsonrpc": "2.0", "method": method }))?;
        Ok(())
    }

    fn initialized(&mut self, protocol_version: &str) {
        self.protocol_version = Some(protocol_version.to_owned());
    }
}

fn timed_or_closed(deadline: Instant) -> Failure {
    if left(deadline).is_zero() {
        timed_out()
    } else {
        Failure::from("The connection to the server was cut.")
    }
}

/// Reads Server-Sent Events: `event:` and `data:` lines, ended by a blank line.
struct SseReader<R: Read> {
    reader: BufReader<R>,
}

impl<R: Read> SseReader<R> {
    fn new(reader: R) -> Self {
        SseReader {
            reader: BufReader::new(reader),
        }
    }

    /// The next event's name (`message` by default) and data, or `None` at the end.
    fn next_event(&mut self) -> std::io::Result<Option<(String, String)>> {
        let mut event = String::from("message");
        let mut data: Vec<String> = Vec::new();
        let mut line = String::new();
        loop {
            line.clear();
            if self.reader.read_line(&mut line)? == 0 {
                return Ok((!data.is_empty()).then(|| (event, data.join("\n"))));
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !data.is_empty() {
                    return Ok(Some((event, data.join("\n"))));
                }
                continue;
            }
            let (field, value) = line.split_once(':').unwrap_or((line, ""));
            let value = value.strip_prefix(' ').unwrap_or(value);
            match field {
                "event" => event = value.to_owned(),
                "data" => data.push(value.to_owned()),
                _ => {}
            }
        }
    }
}

// ---------- legacy SSE ----------

/// The legacy transport: a GET stream for answers and an endpoint for POSTs.
struct Sse {
    endpoint: String,
    headers: BTreeMap<String, String>,
    agent: ureq::Agent,
    events: Receiver<(String, String)>,
}

impl Sse {
    fn connect(url: &str, headers: &BTreeMap<String, String>, deadline: Instant) -> Outcome<Sse> {
        let agent = http_agent(deadline);
        let mut request = agent.get(url).header("Accept", "text/event-stream");
        for (key, value) in headers {
            request = request.header(key, value);
        }
        let response = request.call().map_err(request_failure)?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let has_auth = headers
                .keys()
                .any(|key| key.eq_ignore_ascii_case("authorization"));
            let body = response.into_body().read_to_string().unwrap_or_default();
            return Err(status_failure(status, has_auth, &body));
        }
        let (sender, events) = mpsc::channel();
        let body = response.into_body().into_reader();
        thread::spawn(move || {
            let mut reader = SseReader::new(body);
            while let Ok(Some(event)) = reader.next_event() {
                if sender.send(event).is_err() {
                    break;
                }
            }
        });
        let endpoint = loop {
            match events.recv_timeout(left(deadline)) {
                Ok((name, data)) if name == "endpoint" => break join_url(url, data.trim()),
                Ok(_) => continue,
                Err(RecvTimeoutError::Timeout) => return Err(timed_out()),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(Failure::from(
                        "The server closed the stream without giving its endpoint.",
                    ));
                }
            }
        };
        Ok(Sse {
            endpoint,
            headers: headers.clone(),
            agent,
            events,
        })
    }

    fn post(&self, message: &Value) -> Outcome<()> {
        let mut request = self
            .agent
            .post(&self.endpoint)
            .header("Content-Type", "application/json");
        for (key, value) in &self.headers {
            request = request.header(key, value);
        }
        let response = request.send(message.to_string()).map_err(request_failure)?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            let has_auth = self
                .headers
                .keys()
                .any(|key| key.eq_ignore_ascii_case("authorization"));
            let body = response.into_body().read_to_string().unwrap_or_default();
            return Err(status_failure(status, has_auth, &body));
        }
        Ok(())
    }
}

impl Session for Sse {
    fn request(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        deadline: Instant,
    ) -> Outcome<Value> {
        self.post(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        loop {
            match self.events.recv_timeout(left(deadline)) {
                Ok((_, data)) => {
                    if let Ok(message) = serde_json::from_str::<Value>(&data)
                        && let Some(answer) = answer(&message, id)
                    {
                        return answer;
                    }
                }
                Err(RecvTimeoutError::Timeout) => return Err(timed_out()),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(Failure::from(
                        "The server closed the stream before answering.",
                    ));
                }
            }
        }
    }

    fn notify(&mut self, method: &str, _deadline: Instant) -> Outcome<()> {
        self.post(&json!({ "jsonrpc": "2.0", "method": method }))
    }
}

/// Resolves the endpoint an SSE server gives, which may be relative.
fn join_url(base: &str, target: &str) -> String {
    if target.starts_with("http://") || target.starts_with("https://") {
        return target.to_owned();
    }
    let origin_end = base
        .find("://")
        .map(|scheme| {
            base[scheme + 3..]
                .find('/')
                .map_or(base.len(), |path| scheme + 3 + path)
        })
        .unwrap_or(base.len());
    if target.starts_with('/') {
        return format!("{}{target}", &base[..origin_end]);
    }
    let dir_end = base[origin_end..]
        .rfind('/')
        .map_or(base.len(), |slash| origin_end + slash + 1);
    let dir = &base[..dir_end];
    if dir.ends_with('/') {
        format!("{dir}{target}")
    } else {
        format!("{dir}/{target}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::ServerOptions;

    fn stdio(script: &str, env: &[(&str, &str)]) -> ServerSpec {
        ServerSpec {
            transport: Transport::Stdio {
                command: "sh".into(),
                args: vec!["-c".into(), script.into()],
            },
            env: env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            headers: BTreeMap::new(),
            options: ServerOptions::default(),
        }
    }

    #[test]
    fn expands_variables_like_agents_do() {
        // SAFETY: tests that read this variable only run in this process.
        unsafe { std::env::set_var("AGENTDECK_PROBE_TEST", "value") };
        assert_eq!(expand("Bearer ${AGENTDECK_PROBE_TEST}"), "Bearer value");
        assert_eq!(expand("${env:AGENTDECK_PROBE_TEST}!"), "value!");
        assert_eq!(expand("${AGENTDECK_PROBE_MISSING:-fallback}"), "fallback");
        assert_eq!(
            expand("${AGENTDECK_PROBE_MISSING}"),
            "${AGENTDECK_PROBE_MISSING}"
        );
        assert_eq!(expand("plain $HOME"), "plain $HOME");
    }

    #[test]
    fn joins_sse_endpoints() {
        assert_eq!(
            join_url("https://a.dev/sse", "/messages?s=1"),
            "https://a.dev/messages?s=1"
        );
        assert_eq!(
            join_url("https://a.dev/x/sse", "messages"),
            "https://a.dev/x/messages"
        );
        assert_eq!(
            join_url("https://a.dev", "messages"),
            "https://a.dev/messages"
        );
        assert_eq!(
            join_url("https://a.dev/sse", "https://b.dev/m"),
            "https://b.dev/m"
        );
    }

    #[test]
    fn reads_sse_events() {
        let stream = "event: endpoint\ndata: /m\n\n: comment\ndata: {\"a\":\ndata: 1}\n\n";
        let mut reader = SseReader::new(stream.as_bytes());
        assert_eq!(
            reader.next_event().unwrap(),
            Some(("endpoint".into(), "/m".into()))
        );
        assert_eq!(
            reader.next_event().unwrap(),
            Some(("message".into(), "{\"a\":\n1}".into()))
        );
        assert_eq!(reader.next_event().unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn lists_the_tools_of_a_local_server() {
        // A tiny server: answers initialize, ignores the notification, then
        // lists tools over two pages after a ping it expects an answer to.
        let script = r#"
read init
echo 'not json, a log line'
echo '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"demo","version":"1.2"}}}'
read note
read page1
echo '{"jsonrpc":"2.0","id":99,"method":"ping"}'
read pong
echo '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search","description":" Finds things "}],"nextCursor":"p2"}}'
read page2
echo '{"jsonrpc":"2.0","id":3,"result":{"tools":[{"name":"fetch"}]}}'
echo "token is $API_KEY" >&2
read end
"#;
        let report = probe(
            &stdio(script, &[("API_KEY", "sk-secret-123")]),
            Duration::from_secs(10),
        );
        assert!(report.ok, "{report:?}");
        assert_eq!(report.server_name.as_deref(), Some("demo"));
        assert_eq!(report.server_version.as_deref(), Some("1.2"));
        let names: Vec<_> = report.tools.iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(names, ["search", "fetch"]);
        assert_eq!(report.tools[0].description.as_deref(), Some("Finds things"));
        assert!(!report.log.contains("sk-secret-123"), "{}", report.log);
    }

    #[cfg(unix)]
    #[test]
    fn reports_a_server_that_exits() {
        let report = probe(
            &stdio(
                "echo \"bad key $API_KEY\" >&2; exit 3",
                &[("API_KEY", "sk-secret-123")],
            ),
            Duration::from_secs(10),
        );
        assert!(!report.ok);
        assert!(
            report.error.as_deref().unwrap().contains("exit code 3"),
            "{report:?}"
        );
        assert_eq!(report.log, "bad key •••");
    }

    #[test]
    fn reports_a_missing_command() {
        let mut spec = stdio("", &[]);
        spec.transport = Transport::Stdio {
            command: "agentdeck-no-such-command".into(),
            args: vec![],
        };
        let report = probe(&spec, Duration::from_secs(5));
        assert!(
            report.error.as_deref().unwrap().contains("was not found"),
            "{report:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn gives_up_on_a_silent_server() {
        let started = Instant::now();
        let report = probe(&stdio("sleep 30", &[]), Duration::from_millis(500));
        assert_eq!(
            report.error.as_deref(),
            Some("The server did not answer in time.")
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
