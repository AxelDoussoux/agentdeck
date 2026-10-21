use agentdeck_core::{AgentInfo, McpServer, agent, mcp};

#[tauri::command]
fn list_agents() -> Result<Vec<AgentInfo>, String> {
    let home = agent::home_dir().map_err(|err| err.to_string())?;
    Ok(agent::detect(&home))
}

#[derive(serde::Serialize)]
struct McpListing {
    servers: Vec<McpServer>,
    errors: Vec<String>,
}

#[tauri::command]
fn list_mcp_servers() -> Result<McpListing, String> {
    let home = agent::home_dir().map_err(|err| err.to_string())?;
    let (servers, errors) = mcp::list_all(&home);
    Ok(McpListing {
        servers,
        errors: errors
            .into_iter()
            .map(|(agent, err)| format!("{}: {err}", agent.display_name()))
            .collect(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![list_agents, list_mcp_servers])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
