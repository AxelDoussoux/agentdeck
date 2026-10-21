use std::collections::BTreeMap;
use std::process::ExitCode;

use agentdeck_core::{Agent, ServerSpec, Transport, agent, mcp, rules};
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
                    let status = if info.installed { "found" } else { "missing" };
                    println!(
                        "{:<12} {:<8} {}",
                        info.name,
                        status,
                        info.mcp_config_path.display()
                    );
                }
            }
        }
        Command::Mcp { command } => run_mcp(command, &home, cli.json)?,
        Command::Rules { command } => run_rules(command, &home, cli.json)?,
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
        McpCommand::Copy {
            name,
            from,
            to,
            force,
        } => {
            for target in to {
                let target = Agent::from(target);
                mcp::copy(home, &name, from.into(), target, force)?;
                println!("Copied \"{name}\" to {}", target.display_name());
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
