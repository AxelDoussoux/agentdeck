use std::fs;
use std::path::PathBuf;

use agentdeck_core::rules::{self, Rules};
use agentdeck_core::secrets::{self, Keychain, SecretRef};
use agentdeck_core::skills::{self, Location, Skill};
use agentdeck_core::usage::{self, UsageReport};
use agentdeck_core::{Agent, AgentInfo, McpServer, ServerSpec, agent, mcp};

fn home() -> Result<PathBuf, String> {
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretListing {
    secrets: Vec<SecretRef>,
    errors: Vec<String>,
    /// The `agentdeck` CLI that protected servers start through, if installed.
    launcher: Option<String>,
}

/// The `agentdeck` CLI that protected servers start through, normally the one
/// bundled next to the app. An AppImage runs from a mount that disappears when
/// the app quits, so there the CLI is first copied to `~/.agentdeck/bin`.
fn launcher() -> Option<PathBuf> {
    let found = secrets::find_launcher()?;
    let in_appimage = std::env::var_os("APPDIR")
        .is_some_and(|dir| std::env::var_os("APPIMAGE").is_some() && found.starts_with(dir));
    if !in_appimage {
        return Some(found);
    }
    let stable = home().ok()?.join(".agentdeck/bin/agentdeck");
    let bytes = fs::read(&found).ok()?;
    if fs::read(&stable).ok().as_ref() != Some(&bytes) {
        // Renaming over the old copy works even while an agent runs it.
        let tmp = stable.with_extension("tmp");
        fs::create_dir_all(stable.parent()?).ok()?;
        fs::copy(&found, &tmp).ok()?;
        fs::rename(&tmp, &stable).ok()?;
    }
    Some(stable)
}

#[tauri::command]
fn list_secrets() -> Result<SecretListing, String> {
    let (secrets, errors) = secrets::inventory(&home()?);
    Ok(SecretListing {
        secrets,
        errors,
        launcher: launcher().map(|path| path.display().to_string()),
    })
}

#[tauri::command]
fn protect_server(agent: Agent, server: String) -> Result<(), String> {
    let launcher = launcher().ok_or(
        "The agentdeck CLI that protected servers start through was not found. Reinstall AgentDeck.",
    )?;
    secrets::protect(&Keychain, &home()?, agent, &server, &launcher).map_err(|err| err.to_string())
}

#[tauri::command]
fn unprotect_server(agent: Agent, server: String) -> Result<(), String> {
    secrets::unprotect(&Keychain, &home()?, agent, &server).map_err(|err| err.to_string())
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
            list_secrets,
            protect_server,
            unprotect_server,
            usage_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
