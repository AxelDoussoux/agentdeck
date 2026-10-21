use agentdeck_core::rules::{self, Rules};
use agentdeck_core::skills::{self, Location, Skill};
use agentdeck_core::usage::{self, UsageReport};
use agentdeck_core::{Agent, AgentInfo, McpServer, ServerSpec, agent, mcp};

fn home() -> Result<std::path::PathBuf, String> {
    agent::home_dir().map_err(|err| err.to_string())
}

#[tauri::command]
fn list_agents() -> Result<Vec<AgentInfo>, String> {
    Ok(agent::detect(&home()?))
}

#[derive(serde::Serialize)]
struct McpListing {
    servers: Vec<McpServer>,
    errors: Vec<String>,
}

#[tauri::command]
fn list_mcp_servers() -> Result<McpListing, String> {
    let (servers, errors) = mcp::list_all(&home()?);
    Ok(McpListing {
        servers,
        errors: errors
            .into_iter()
            .map(|(agent, err)| format!("{}: {err}", agent.display_name()))
            .collect(),
    })
}

#[tauri::command]
fn add_mcp_server(agent: Agent, name: String, spec: ServerSpec) -> Result<(), String> {
    mcp::add(agent, &home()?, &name, &spec, false).map_err(|err| err.to_string())
}

#[tauri::command]
fn remove_mcp_server(agent: Agent, name: String) -> Result<(), String> {
    mcp::remove(agent, &home()?, &name).map_err(|err| err.to_string())
}

#[tauri::command]
fn copy_mcp_server(name: String, from: Agent, to: Agent) -> Result<(), String> {
    mcp::copy(&home()?, &name, from, to, false).map_err(|err| err.to_string())
}

#[tauri::command]
fn list_rules() -> Result<Vec<Rules>, String> {
    let (all, errors) = rules::read_all(&home()?);
    match errors.into_iter().next() {
        Some((agent, err)) => Err(format!("{}: {err}", agent.display_name())),
        None => Ok(all),
    }
}

#[tauri::command]
fn save_rules(agent: Agent, content: String) -> Result<(), String> {
    rules::write(agent, &home()?, &content).map_err(|err| err.to_string())
}

#[derive(serde::Serialize)]
struct SkillListing {
    skills: Vec<Skill>,
    errors: Vec<String>,
}

#[tauri::command]
fn list_skills() -> Result<SkillListing, String> {
    let (skills, errors) = skills::list(&home()?);
    Ok(SkillListing { skills, errors })
}

#[tauri::command]
fn read_skill(location: Location, name: String) -> Result<String, String> {
    skills::read(&home()?, location, &name).map_err(|err| err.to_string())
}

#[tauri::command]
fn copy_skill(name: String, from: Location, to: Agent) -> Result<(), String> {
    skills::copy(&home()?, &name, from, to, false).map_err(|err| err.to_string())
}

#[tauri::command]
fn remove_skill(location: Location, name: String) -> Result<String, String> {
    skills::remove(&home()?, location, &name)
        .map(|trashed| trashed.display().to_string())
        .map_err(|err| err.to_string())
}

/// Parsing months of logs takes a while, so it runs off the main thread.
#[tauri::command]
async fn usage_report() -> Result<UsageReport, String> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || usage::report(&home))
        .await
        .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_agents,
            list_mcp_servers,
            add_mcp_server,
            remove_mcp_server,
            copy_mcp_server,
            list_rules,
            save_rules,
            list_skills,
            read_skill,
            copy_skill,
            remove_skill,
            usage_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
