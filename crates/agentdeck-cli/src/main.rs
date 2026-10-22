use std::collections::BTreeMap;
use std::process::ExitCode;

use agentdeck_core::secrets::{self, Keychain};
use agentdeck_core::skills::{self, Location};
use agentdeck_core::{Agent, ServerSpec, Transport, agent, mcp, probe, rules, usage};
use clap::{Parser, Subcommand, ValueEnum};

#[derive(Parser)]
#[command(
    name = "agentdeck",
    version,
    about = "Control center for AI coding agents"
)]
struct Cli {
    /// Print JSON instead of a table
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List supported agents and whether they are installed
    Agents,
    /// Manage MCP servers
    Mcp {
        #[command(subcommand)]
        command: McpCommand,
    },
    /// Manage the global rules file of each agent
    Rules {
        #[command(subcommand)]
        command: RulesCommand,
    },
    /// Manage Agent Skills
    Skills {
        #[command(subcommand)]
        command: SkillsCommand,
    },
    /// Find plain-text secrets and move them to the system keychain
    Secrets {
        #[command(subcommand)]
        command: SecretsCommand,
    },
    /// Start a command with secrets read from the system keychain
    ///
    /// Protected MCP servers are started this way by their agent.
    Exec {
        /// Environment variable to set, as KEY=KEYCHAIN_ID
        #[arg(long = "secret", value_parser = parse_pair)]
        secrets: Vec<(String, String)>,
        /// The command to run and its arguments
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
    /// Show token usage and estimated costs from local session logs
    Usage {
        /// Only count the last N days (UTC)
        #[arg(long, default_value_t = 30)]
        days: u32,
        /// Number of sessions to list
        #[arg(long, default_value_t = 10)]
        sessions: usize,
    },
}

#[derive(Subcommand)]
enum SecretsCommand {
    /// List the secrets of every MCP server
    List,
    /// Move the environment variables of a local MCP server to the keychain
    Protect { agent: AgentArg, server: String },
    /// Put the secrets of a protected MCP server back in its config file
    Unprotect { agent: AgentArg, server: String },
    /// Point protected servers whose launcher is missing at this executable
    Repair,
    /// Say whether a variable name holds a secret, for every server
    Mark {
        /// Variable name, such as SERVICE_ID
        name: String,
        #[arg(value_enum)]
        r#as: MarkArg,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum MarkArg {
    /// Moved to the keychain when its server is protected
    Secret,
    /// Stays in the config
    Setting,
    /// Judged by its name and value again
    Auto,
}

#[derive(Subcommand)]
enum SkillsCommand {
    /// List skills and the agents that load them
    List,
    /// Print the SKILL.md of a skill
    Show {
        name: String,
        #[arg(long, value_enum, default_value = "claude-code")]
        from: LocationArg,
    },
    /// Create a skill from a template
    New {
        name: String,
        #[arg(long, value_enum, default_value = "shared")]
        to: LocationArg,
        /// What the skill does and when to use it
        #[arg(long, default_value = "")]
        description: String,
    },
    /// Copy a skill folder so that other agents load it
    Copy {
        name: String,
        #[arg(long, value_enum)]
        from: LocationArg,
        #[arg(long, required = true, num_args = 1..)]
        to: Vec<AgentArg>,
        /// Replace the skill where it already exists (the old copy goes to the trash)
        #[arg(long)]
        force: bool,
    },
    /// Move a skill folder to ~/.agentdeck/trash
    Remove {
        name: String,
        #[arg(long, value_enum)]
        from: LocationArg,
    },
    /// List the skills in ~/.agentdeck/trash, most recent first
    Trash,
    /// Put a skill from the trash back where it was removed from
    Restore {
        /// The id shown by `skills trash`
        id: String,
        /// Replace the skill there now (it goes to the trash in turn)
        #[arg(long)]
        force: bool,
    },
}

/// A skills folder: an agent's own, or `shared` for ~/.agents/skills.
#[derive(Clone, Copy, ValueEnum)]
enum LocationArg {
    ClaudeCode,
    Shared,
    Codex,
    Gemini,
    Cursor,
}

impl From<LocationArg> for Location {
    fn from(arg: LocationArg) -> Location {
        match arg {
            LocationArg::ClaudeCode => Location::ClaudeCode,
            LocationArg::Shared => Location::Shared,
            LocationArg::Codex => Location::Codex,
            LocationArg::Gemini => Location::Gemini,
            LocationArg::Cursor => Location::Cursor,
        }
    }
}

#[derive(Subcommand)]
enum RulesCommand {
    /// List where each agent keeps its global rules
    List,
    /// Print the global rules of an agent
    Show { agent: AgentArg },
    /// Replace the rules of other agents with those of one agent
    Copy {
        #[arg(long)]
        from: AgentArg,
        #[arg(long, required = true, num_args = 1..)]
        to: Vec<AgentArg>,
    },
}

#[derive(Subcommand)]
enum McpCommand {
    /// List the MCP servers of every agent
    List,
    /// Add an MCP server to an agent
    ///
    /// Examples:
    ///   agentdeck mcp add claude-code github -e GITHUB_TOKEN=ghp_x -- npx -y @modelcontextprotocol/server-github
    ///   agentdeck mcp add cursor linear --url https://mcp.linear.app/mcp
    Add {
        agent: AgentArg,
        name: String,
        /// URL of a remote server, instead of a command
        #[arg(long, conflicts_with = "command")]
        url: Option<String>,
        /// Use the legacy SSE transport for --url
        #[arg(long, requires = "url")]
        sse: bool,
        /// Environment variable, as KEY=VALUE
        #[arg(short, long = "env", value_parser = parse_pair)]
        env: Vec<(String, String)>,
        /// HTTP header, as KEY=VALUE
        #[arg(long = "header", value_parser = parse_pair)]
        headers: Vec<(String, String)>,
        /// Replace the server if it already exists
        #[arg(long)]
        force: bool,
        /// Command and arguments of a local server, after `--`
        #[arg(last = true, required_unless_present = "url")]
        command: Vec<String>,
    },
    /// Remove an MCP server from an agent
    Remove { agent: AgentArg, name: String },
    /// Start an MCP server and list its tools, to check that it works
    Test { agent: AgentArg, name: String },
    /// Copy an MCP server, secrets included, from one agent to others
    Copy {
        name: String,
        #[arg(long)]
        from: AgentArg,
        #[arg(long, required = true, num_args = 1..)]
        to: Vec<AgentArg>,
        /// Replace the server where it already exists
        #[arg(long)]
        force: bool,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum AgentArg {
    ClaudeCode,
    Codex,
    Cursor,
    Gemini,
}

impl From<AgentArg> for Agent {
    fn from(arg: AgentArg) -> Agent {
        match arg {
            AgentArg::ClaudeCode => Agent::ClaudeCode,
            AgentArg::Codex => Agent::Codex,
            AgentArg::Cursor => Agent::Cursor,
            AgentArg::Gemini => Agent::Gemini,
        }
    }
}

fn parse_pair(text: &str) -> Result<(String, String), String> {
    text.split_once('=')
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .ok_or_else(|| format!("expected KEY=VALUE, got \"{text}\""))
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    if let Command::Exec { secrets, command } = cli.command {
        return exec(&secrets, &command);
    }
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> agentdeck_core::Result<()> {
    let home = agent::home_dir()?;
    match cli.command {
        Command::Agents => {
            let agents = agent::detect(&home);
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&agents).unwrap());
            } else {
                for info in agents {
                    let status = match (info.installed, info.has_config) {
                        (_, true) => "found",
                        (true, false) => "no config",
                        (false, false) => "missing",
                    };
                    println!(
                        "{:<12} {:<9} {}",
                        info.name,
                        status,
                        info.mcp_config_path.display()
                    );
                }
            }
        }
        Command::Mcp { command } => run_mcp(command, &home, cli.json)?,
        Command::Rules { command } => run_rules(command, &home, cli.json)?,
        Command::Skills { command } => run_skills(command, &home, cli.json)?,
        Command::Secrets { command } => run_secrets(command, &home, cli.json)?,
        Command::Exec { .. } => unreachable!("handled in main"),
        Command::Usage { days, sessions } => run_usage(&home, days, sessions, cli.json),
    }
    Ok(())
}

fn run_mcp(command: McpCommand, home: &std::path::Path, json: bool) -> agentdeck_core::Result<()> {
    match command {
        McpCommand::List => {
            let (servers, errors) = mcp::list_all(home);
            if json {
                println!("{}", serde_json::to_string_pretty(&servers).unwrap());
            } else {
                for server in &servers {
                    let target = match &server.transport {
                        Transport::Stdio { command, args } => {
                            format!("{command} {}", args.join(" "))
                        }
                        Transport::Http { url } => url.clone(),
                        Transport::Sse { url } => format!("{url} (sse)"),
                    };
                    println!(
                        "{:<12} {:<20} {}",
                        server.agent.display_name(),
                        server.name,
                        target.trim_end()
                    );
                }
            }
            for (agent, err) in &errors {
                eprintln!("warning: {}: {err}", agent.display_name());
            }
        }
        McpCommand::Add {
            agent,
            name,
            url,
            sse,
            env,
            headers,
            force,
            command,
        } => {
            let transport = match url {
                Some(url) if sse => Transport::Sse { url },
                Some(url) => Transport::Http { url },
                None => {
                    let mut parts = command.into_iter();
                    Transport::Stdio {
                        command: parts.next().unwrap_or_default(),
                        args: parts.collect(),
                    }
                }
            };
            let spec = ServerSpec {
                transport,
                env: BTreeMap::from_iter(env),
                headers: BTreeMap::from_iter(headers),
                options: mcp::ServerOptions::default(),
            };
            let agent = Agent::from(agent);
            mcp::add(agent, home, &name, &spec, force)?;
            println!("Added \"{name}\" to {}", agent.display_name());
        }
        McpCommand::Remove { agent, name } => {
            let agent = Agent::from(agent);
            mcp::remove(agent, home, &name)?;
            println!("Removed \"{name}\" from {}", agent.display_name());
        }
        McpCommand::Test { agent, name } => {
            let agent = Agent::from(agent);
            let spec = mcp::get(agent, home, &name)?.ok_or(agentdeck_core::Error::NotFound {
                agent,
                name: name.clone(),
            })?;
            let report = probe::probe(&spec, probe::TIMEOUT);
            if json {
                println!("{}", serde_json::to_string_pretty(&report).unwrap());
            } else if report.ok {
                let server = [
                    report.server_name.as_deref(),
                    report.server_version.as_deref(),
                ]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
                println!(
                    "\"{name}\" works ({server}, {:.1} s): {} tool(s)",
                    report.elapsed_ms as f64 / 1000.0,
                    report.tools.len()
                );
                for tool in &report.tools {
                    let first_line = tool.description.as_deref().and_then(|d| d.lines().next());
                    println!("  {:<32} {}", tool.name, first_line.unwrap_or(""));
                }
            } else {
                eprintln!(
                    "\"{name}\" failed: {}",
                    report.error.as_deref().unwrap_or("unknown error")
                );
                if !report.log.is_empty() {
                    eprintln!("\nServer output:\n{}", report.log);
                }
            }
            if !report.ok {
                std::process::exit(1);
            }
        }
        McpCommand::Copy {
            name,
            from,
            to,
            force,
        } => {
            for target in to {
                let target = Agent::from(target);
                let lost = mcp::copy(home, &name, from.into(), target, force)?;
                println!("Copied \"{name}\" to {}", target.display_name());
                if !lost.is_empty() {
                    println!("  Not carried over: {}", lost.join(", "));
                }
            }
        }
    }
    Ok(())
}

fn run_rules(
    command: RulesCommand,
    home: &std::path::Path,
    json: bool,
) -> agentdeck_core::Result<()> {
    match command {
        RulesCommand::List => {
            let (all, errors) = rules::read_all(home);
            if json {
                println!("{}", serde_json::to_string_pretty(&all).unwrap());
            } else {
                for agent in Agent::ALL {
                    let location = match agent.rules_path(home) {
                        Some(path) => path.display().to_string(),
                        None => "(stored in the app settings)".into(),
                    };
                    let lines = all
                        .iter()
                        .find(|found| found.agent == agent)
                        .and_then(|found| found.content.as_ref())
                        .map(|content| format!("{} lines", content.lines().count()))
                        .unwrap_or_else(|| "-".into());
                    println!("{:<12} {:<10} {location}", agent.display_name(), lines);
                }
            }
            for (agent, err) in &errors {
                eprintln!("warning: {}: {err}", agent.display_name());
            }
        }
        RulesCommand::Show { agent } => {
            let found = rules::read(agent.into(), home)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&found).unwrap());
            } else {
                print!("{}", found.content.unwrap_or_default());
            }
        }
        RulesCommand::Copy { from, to } => {
            for target in to {
                let target = Agent::from(target);
                rules::copy(home, from.into(), target)?;
                println!("Copied rules to {}", target.display_name());
            }
        }
    }
    Ok(())
}

fn run_usage(home: &std::path::Path, days: u32, limit: usize, json: bool) {
    let report = usage::report(home);
    let since = usage::date_days_ago(days);
    if json {
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
        return;
    }

    println!("Last {days} days (estimated at API list prices):");
    for agent in Agent::ALL {
        let days: Vec<_> = report
            .daily
            .iter()
            .filter(|day| day.agent == agent && day.date >= since)
            .collect();
        if days.is_empty() {
            continue;
        }
        let cost: f64 = days.iter().map(|day| day.cost_usd).sum();
        let tokens: u64 = days.iter().map(|day| day.tokens.total()).sum();
        println!(
            "  {:<12} ${cost:>9.2}  {:>8} tokens",
            agent.display_name(),
            format_tokens(tokens)
        );
    }

    println!("\nRecent sessions:");
    for session in report.sessions.iter().take(limit) {
        println!(
            "  {}  {:<12} ${:>8.2}  {:>8}  {}",
            session
                .ended_at
                .as_deref()
                .and_then(|t| t.get(..10))
                .unwrap_or("?"),
            session.agent.display_name(),
            session.cost_usd,
            format_tokens(session.tokens.total()),
            session.title.as_deref().unwrap_or("(untitled)")
        );
    }
    for error in &report.errors {
        eprintln!("warning: {error}");
    }
}

fn format_tokens(count: u64) -> String {
    match count {
        0..1_000 => count.to_string(),
        1_000..1_000_000 => format!("{:.1}k", count as f64 / 1e3),
        _ => format!("{:.1}M", count as f64 / 1e6),
    }
}

fn run_skills(
    command: SkillsCommand,
    home: &std::path::Path,
    json: bool,
) -> agentdeck_core::Result<()> {
    match command {
        SkillsCommand::List => {
            let (all, errors) = skills::list(home);
            if json {
                println!("{}", serde_json::to_string_pretty(&all).unwrap());
            } else {
                for skill in &all {
                    let readers: Vec<_> = skill.readers.iter().map(|a| a.display_name()).collect();
                    println!(
                        "{:<24} {:<40} {}",
                        skill.name,
                        skill.path.display(),
                        readers.join(", ")
                    );
                }
            }
            for error in &errors {
                eprintln!("warning: {error}");
            }
        }
        SkillsCommand::Show { name, from } => print!("{}", skills::read(home, from.into(), &name)?),
        SkillsCommand::New {
            name,
            to,
            description,
        } => {
            let path = skills::create(home, to.into(), &name, &description)?;
            println!("Created {}", path.display());
        }
        SkillsCommand::Copy {
            name,
            from,
            to,
            force,
        } => {
            for target in to {
                let target = Agent::from(target);
                skills::copy(home, &name, from.into(), target, force)?;
                println!("Copied \"{name}\" for {}", target.display_name());
            }
        }
        SkillsCommand::Remove { name, from } => {
            let trashed = skills::remove(home, from.into(), &name)?;
            println!("Moved \"{name}\" to {}", trashed.display());
        }
        SkillsCommand::Trash => {
            let all = skills::trashed(home);
            if json {
                println!("{}", serde_json::to_string_pretty(&all).unwrap());
            } else {
                for skill in &all {
                    println!("{:<40} {}", skill.id, skill.location.path(home).display());
                }
            }
        }
        SkillsCommand::Restore { id, force } => {
            let location = skills::restore(home, &id, force)?;
            println!("Restored {id} to {}", location.path(home).display());
        }
    }
    Ok(())
}

fn run_secrets(
    command: SecretsCommand,
    home: &std::path::Path,
    json: bool,
) -> agentdeck_core::Result<()> {
    match command {
        SecretsCommand::List => {
            let (all, errors) = secrets::inventory(home);
            if json {
                println!("{}", serde_json::to_string_pretty(&all).unwrap());
            } else {
                for secret in &all {
                    let status = match (&secret.vault_id, secret.same_value_elsewhere) {
                        (Some(_), _) => "keychain".to_owned(),
                        (None, _) if !secret.likely => "setting, not a secret".to_owned(),
                        (None, 0) => "plain text".to_owned(),
                        (None, n) => format!("plain text, same value in {n} other place(s)"),
                    };
                    println!(
                        "{:<12} {:<20} {:<24} {status}",
                        secret.agent.display_name(),
                        secret.server,
                        secret.key
                    );
                }
            }
            for error in &errors {
                eprintln!("warning: {error}");
            }
        }
        SecretsCommand::Protect { agent, server } => {
            let launcher = current_exe()?;
            let agent = Agent::from(agent);
            secrets::protect(&Keychain, home, agent, &server, &launcher)?;
            println!(
                "Moved the secrets of \"{server}\" ({}) to the keychain",
                agent.display_name()
            );
        }
        SecretsCommand::Unprotect { agent, server } => {
            let agent = Agent::from(agent);
            secrets::unprotect(&Keychain, home, agent, &server)?;
            println!(
                "Put the secrets of \"{server}\" ({}) back in its config",
                agent.display_name()
            );
        }
        SecretsCommand::Mark { name, r#as } => {
            let secret = match r#as {
                MarkArg::Secret => Some(true),
                MarkArg::Setting => Some(false),
                MarkArg::Auto => None,
            };
            secrets::mark_name(home, &name, secret)?;
            println!(
                "{name} is now {}",
                match secret {
                    Some(true) => "treated as a secret",
                    Some(false) => "treated as a setting",
                    None => "judged by its name and value",
                }
            );
        }
        SecretsCommand::Repair => {
            let repaired = secrets::repair(home, &current_exe()?)?;
            if repaired.is_empty() {
                println!("Every protected server has its launcher");
            }
            for server in &repaired {
                println!(
                    "Repaired \"{}\" ({}), which started through {}",
                    server.server,
                    server.agent.display_name(),
                    server.launcher
                );
            }
        }
    }
    Ok(())
}

fn current_exe() -> agentdeck_core::Result<std::path::PathBuf> {
    std::env::current_exe().map_err(|source| agentdeck_core::Error::Io {
        path: "agentdeck".into(),
        source,
    })
}

/// Runs `command` with secrets from the keychain, passing stdio through so
/// it can serve MCP, and exits with its status.
fn exec(secrets: &[(String, String)], command: &[String]) -> ExitCode {
    let env = match secrets::resolve(&Keychain, secrets) {
        Ok(env) => env,
        Err(err) => {
            eprintln!("agentdeck exec: {err}");
            return ExitCode::FAILURE;
        }
    };
    let program = resolve_program(&command[0]);
    match std::process::Command::new(&program)
        .args(&command[1..])
        .envs(env)
        .status()
    {
        Ok(status) => ExitCode::from(status.code().unwrap_or(1).clamp(0, 255) as u8),
        Err(err) => {
            eprintln!("agentdeck exec: cannot start {}: {err}", command[0]);
            ExitCode::FAILURE
        }
    }
}

/// On Windows, finds `npx.cmd` and friends: `Command` only adds `.exe`.
fn resolve_program(name: &str) -> std::path::PathBuf {
    let path = std::path::Path::new(name);
    if !cfg!(windows) || path.extension().is_some() || path.components().count() > 1 {
        return path.to_path_buf();
    }
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".into());
    let dirs = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&dirs)
        .flat_map(|dir| {
            extensions
                .split(';')
                .filter(|ext| !ext.is_empty())
                .map(move |ext| dir.join(format!("{name}{}", ext.to_lowercase())))
        })
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| path.to_path_buf())
}
