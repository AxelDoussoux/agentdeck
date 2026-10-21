use std::process::ExitCode;

use agentdeck_core::{Transport, agent, mcp};
use clap::{Parser, Subcommand};

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
}

#[derive(Subcommand)]
enum McpCommand {
    /// List the MCP servers of every agent
    List,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let home = match agent::home_dir() {
        Ok(home) => home,
        Err(err) => {
            eprintln!("error: {err}");
            return ExitCode::FAILURE;
        }
    };

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
        Command::Mcp {
            command: McpCommand::List,
        } => {
            let (servers, errors) = mcp::list_all(&home);
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&servers).unwrap());
            } else {
                for server in &servers {
                    let target = match &server.transport {
                        Transport::Stdio { command, args } => {
                            format!("{command} {}", args.join(" "))
                        }
                        Transport::Http { url } => url.clone(),
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
    }
    ExitCode::SUCCESS
}
