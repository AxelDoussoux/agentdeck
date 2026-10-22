use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use agentdeck_core::rules::{self, Rules};
use agentdeck_core::secrets::{self, Keychain, SecretRef};
use agentdeck_core::skills::{self, Location, Skill};
use agentdeck_core::usage::{self, ReadProgress, UsageReport};
use agentdeck_core::{Agent, AgentInfo, Error, McpServer, ServerSpec, agent, config_file, mcp};
use tauri::ipc::Channel;
use tauri::{Manager, State};

mod watch;

fn home() -> Result<PathBuf, String> {
    agent::home_dir().map_err(|err| err.to_string())
}

/// How to take back a change made from the app, for the Undo button of its
/// notification. Kept in memory only: secrets never leave the Rust side.
enum UndoAction {
    /// Put back the previous settings of a server, or remove it if it was new.
    Mcp {
        agent: Agent,
        name: String,
        previous: Option<Box<ServerSpec>>,
    },
    /// Put back the previous rules, unless they changed again since.
    Rules {
        agent: Agent,
        previous: String,
        written: String,
    },
    /// Protect (or unprotect) the server again.
    Protect {
        agent: Agent,
        server: String,
        protect: bool,
    },
}

/// How many recent changes can still be undone.
const UNDO_KEPT: u64 = 20;

/// Changes that can still be undone, by id.
#[derive(Default)]
struct UndoStore(Mutex<(u64, HashMap<u64, UndoAction>)>);

impl UndoStore {
    fn push(&self, action: UndoAction) -> u64 {
        let mut store = self.0.lock().unwrap_or_else(|err| err.into_inner());
        store.0 += 1;
        let id = store.0;
        store.1.insert(id, action);
        // Only the last few toasts offer Undo; drop older entries and their secrets.
        store.1.retain(|&kept, _| kept + UNDO_KEPT > id);
        id
    }

    fn take(&self, id: u64) -> Option<UndoAction> {
        let mut store = self.0.lock().unwrap_or_else(|err| err.into_inner());
        store.1.remove(&id)
    }
}

/// Runs an MCP edit of `name` in `agent` and returns the id that undoes it,
/// with what the edit returned.
fn undoable_mcp<T>(
    undo: &UndoStore,
    agent: Agent,
    name: &str,
    edit: impl FnOnce(&std::path::Path) -> agentdeck_core::Result<T>,
) -> Result<(u64, T), String> {
    let home = home()?;
    let previous = mcp::get(agent, &home, name)
        .map_err(|err| err.to_string())?
        .map(Box::new);
    let output = edit(&home).map_err(|err| err.to_string())?;
    let id = undo.push(UndoAction::Mcp {
        agent,
        name: name.to_owned(),
        previous,
    });
    Ok((id, output))
}

#[tauri::command]
fn undo_change(undo: State<UndoStore>, id: u64) -> Result<(), String> {
    let action = undo
        .take(id)
        .ok_or("This change can no longer be undone.")?;
    let home = home()?;
    match action {
        UndoAction::Mcp {
            agent,
            name,
            previous: Some(spec),
        } => mcp::add(agent, &home, &name, &spec, true),
        UndoAction::Mcp {
            agent,
            name,
            previous: None,
        } => match mcp::remove(agent, &home, &name) {
            Err(Error::NotFound { .. }) => Ok(()),
            other => other,
        },
        UndoAction::Rules {
            agent,
            previous,
            written,
        } => {
            let current = rules::read(agent, &home)
                .map_err(|err| err.to_string())?
                .content
                .unwrap_or_default();
            if current != written {
                return Err(format!(
                    "The {} rules changed since, so they were left as they are.",
                    agent.display_name()
                ));
            }
            rules::write(agent, &home, &previous)
        }
        UndoAction::Protect {
            agent,
            server,
            protect: true,
        } => {
            let launcher = launcher().ok_or(LAUNCHER_MISSING)?;
            secrets::protect(&Keychain, &home, agent, &server, &launcher)
        }
        UndoAction::Protect {
            agent,
            server,
            protect: false,
        } => secrets::unprotect(&Keychain, &home, agent, &server),
    }
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn list_agents() -> Result<Vec<AgentInfo>, String> {
    Ok(agent::detect(&home()?))
}

/// Opens an agent's MCP config in the default editor, or shows it in the
/// file manager. Only these files: the UI never passes a path.
#[tauri::command]
fn open_config(app: tauri::AppHandle, agent: Agent, reveal: bool) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = agent.mcp_config_path(&home()?);
    if !path.is_file() {
        return Err(format!("{} does not exist yet.", path.display()));
    }
    let opener = app.opener();
    let opened = if reveal {
        opener.reveal_item_in_dir(&path)
    } else {
        opener.open_path(path.to_string_lossy(), None::<&str>)
    };
    opened.map_err(|err| err.to_string())
}

#[derive(serde::Serialize)]
struct McpListing {
    servers: Vec<McpServer>,
    errors: Vec<String>,
}

/// Where an agent's files are, and whether a variable moved them.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentFolder {
    agent: Agent,
    path: String,
    variable: Option<&'static str>,
    moved: bool,
}

/// What the Settings page shows about AgentDeck's own files.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    folders: Vec<AgentFolder>,
    launcher: Option<String>,
    backups: String,
    backup_count: usize,
    backups_kept: usize,
    trash: String,
    trash_count: usize,
}

#[tauri::command]
fn app_settings() -> Result<AppSettings, String> {
    let home = home()?;
    let folders = Agent::ALL
        .into_iter()
        .map(|agent| {
            let variable = agent.folder_variable();
            AgentFolder {
                agent,
                path: agent.folder(&home).display().to_string(),
                variable,
                moved: variable
                    .and_then(std::env::var_os)
                    .is_some_and(|value| !value.is_empty()),
            }
        })
        .collect();
    Ok(AppSettings {
        folders,
        launcher: launcher().map(|path| path.display().to_string()),
        backups: config_file::backups_root(&home).display().to_string(),
        backup_count: config_file::backup_count(&home),
        backups_kept: config_file::BACKUPS_KEPT,
        trash: skills::trash_dir(&home).display().to_string(),
        trash_count: skills::trashed(&home).len(),
    })
}

/// A folder the Settings page can show in the file manager.
#[derive(serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
enum AppFolder {
    Backups,
    Trash,
    Agent(Agent),
    Skill { location: Location, name: String },
}

#[tauri::command]
fn open_folder(app: tauri::AppHandle, folder: AppFolder) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let home = home()?;
    let path = match folder {
        AppFolder::Backups => config_file::backups_root(&home),
        AppFolder::Trash => skills::trash_dir(&home),
        AppFolder::Agent(agent) => agent.folder(&home),
        AppFolder::Skill { location, name } => {
            skills::skill_dir(&home, location, &name).map_err(|err| err.to_string())?
        }
    };
    if !path.is_dir() {
        return Err(format!("{} does not exist yet.", path.display()));
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn empty_skill_trash() -> Result<usize, String> {
    skills::empty_trash(&home()?).map_err(|err| err.to_string())
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
fn add_mcp_server(
    undo: State<UndoStore>,
    agent: Agent,
    name: String,
    spec: ServerSpec,
) -> Result<u64, String> {
    undoable_mcp(&undo, agent, &name, |home| {
        mcp::add(agent, home, &name, &spec, false)
    })
    .map(|(id, ())| id)
}

#[tauri::command]
fn edit_mcp_server(
    undo: State<UndoStore>,
    agent: Agent,
    name: String,
    edit: mcp::ServerEdit,
) -> Result<u64, String> {
    undoable_mcp(&undo, agent, &name, |home| {
        mcp::update(agent, home, &name, &edit)
    })
    .map(|(id, ())| id)
}

#[tauri::command]
fn remove_mcp_server(undo: State<UndoStore>, agent: Agent, name: String) -> Result<u64, String> {
    undoable_mcp(&undo, agent, &name, |home| mcp::remove(agent, home, &name)).map(|(id, ())| id)
}

#[tauri::command]
fn copy_mcp_server(
    undo: State<UndoStore>,
    name: String,
    from: Agent,
    to: Agent,
    overwrite: bool,
) -> Result<CopyResult, String> {
    let (undo, lost) = undoable_mcp(&undo, to, &name, |home| {
        mcp::copy(home, &name, from, to, overwrite)
    })?;
    Ok(CopyResult { undo, lost })
}

#[tauri::command]
fn server_versions(agent: Agent, name: String) -> Result<Vec<mcp::ServerVersion>, String> {
    mcp::versions(agent, &home()?, &name).map_err(|err| err.to_string())
}

#[tauri::command]
fn restore_server_version(
    undo: State<UndoStore>,
    agent: Agent,
    name: String,
    id: String,
) -> Result<u64, String> {
    undoable_mcp(&undo, agent, &name, |home| {
        mcp::restore_version(agent, home, &name, &id)
    })
    .map(|(id, ())| id)
}

/// What `copy_mcp_server` did: the id that undoes it, and the settings the
/// target agent could not take.
#[derive(serde::Serialize)]
struct CopyResult {
    undo: u64,
    lost: Vec<String>,
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
fn save_rules(undo: State<UndoStore>, agent: Agent, content: String) -> Result<u64, String> {
    let home = home()?;
    let previous = rules::read(agent, &home)
        .map_err(|err| err.to_string())?
        .content
        .unwrap_or_default();
    rules::write(agent, &home, &content).map_err(|err| err.to_string())?;
    Ok(undo.push(UndoAction::Rules {
        agent,
        previous,
        written: content,
    }))
}

#[derive(serde::Serialize)]
struct SkillListing {
    skills: Vec<Skill>,
    errors: Vec<String>,
    trash: Vec<skills::TrashedSkill>,
}

#[tauri::command]
fn list_skills() -> Result<SkillListing, String> {
    let home = home()?;
    let (skills, errors) = skills::list(&home);
    Ok(SkillListing {
        skills,
        errors,
        trash: skills::trashed(&home),
    })
}

#[tauri::command]
fn read_skill(location: Location, name: String) -> Result<String, String> {
    skills::read(&home()?, location, &name).map_err(|err| err.to_string())
}

#[tauri::command]
fn skill_files(location: Location, name: String) -> Result<Vec<skills::SkillFile>, String> {
    skills::files(&home()?, location, &name).map_err(|err| err.to_string())
}

/// Creates a skill from the template and returns its folder.
#[tauri::command]
fn create_skill(location: Location, name: String, description: String) -> Result<String, String> {
    skills::create(&home()?, location, &name, &description)
        .map(|path| path.display().to_string())
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn copy_skill(name: String, from: Location, to: Agent) -> Result<(), String> {
    skills::copy(&home()?, &name, from, to, false).map_err(|err| err.to_string())
}

/// Replaces the copy of a skill in `to` with the one in `from`; the old copy
/// goes to the trash.
#[tauri::command]
fn replace_skill(name: String, from: Location, to: Location) -> Result<(), String> {
    skills::copy_to(&home()?, &name, from, to, true).map_err(|err| err.to_string())
}

#[tauri::command]
fn restore_skill(id: String, overwrite: bool) -> Result<Location, String> {
    skills::restore(&home()?, &id, overwrite).map_err(|err| err.to_string())
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
    /// Protected servers whose launcher is missing, so they no longer start.
    stranded: Vec<secrets::Stranded>,
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
        stranded: secrets::stranded(&home()?),
    })
}

const LAUNCHER_MISSING: &str =
    "The agentdeck CLI that protected servers start through was not found. Reinstall AgentDeck.";

#[tauri::command]
fn protect_server(undo: State<UndoStore>, agent: Agent, server: String) -> Result<u64, String> {
    let launcher = launcher().ok_or(LAUNCHER_MISSING)?;
    secrets::protect(&Keychain, &home()?, agent, &server, &launcher)
        .map_err(|err| err.to_string())?;
    Ok(undo.push(UndoAction::Protect {
        agent,
        server,
        protect: false,
    }))
}

/// How protecting a server would change its command, without writing it.
#[tauri::command]
fn preview_protect(agent: Agent, server: String) -> Result<secrets::ProtectPreview, String> {
    let launcher = launcher().ok_or(LAUNCHER_MISSING)?;
    secrets::preview_protect(&home()?, agent, &server, &launcher).map_err(|err| err.to_string())
}

/// Marks a variable name as a secret (`true`), a setting (`false`), or lets
/// AgentDeck judge it again (`null`).
#[tauri::command]
fn mark_secret_name(name: String, secret: Option<bool>) -> Result<(), String> {
    secrets::mark_name(&home()?, &name, secret).map_err(|err| err.to_string())
}

/// Points protected servers whose launcher is missing at the current one.
/// Returns how many were repaired.
#[tauri::command]
fn repair_launchers() -> Result<usize, String> {
    let launcher = launcher().ok_or(LAUNCHER_MISSING)?;
    secrets::repair(&home()?, &launcher)
        .map(|repaired| repaired.len())
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn unprotect_server(undo: State<UndoStore>, agent: Agent, server: String) -> Result<u64, String> {
    secrets::unprotect(&Keychain, &home()?, agent, &server).map_err(|err| err.to_string())?;
    Ok(undo.push(UndoAction::Protect {
        agent,
        server,
        protect: true,
    }))
}

/// Parsing months of logs takes a while, so it runs off the main thread.
#[tauri::command]
async fn usage_report(progress: Channel<ReadProgress>) -> Result<UsageReport, String> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || {
        // Thousands of cached files are read in a blink: only say how far
        // the reading is a few times a second.
        let mut last: Option<Instant> = None;
        usage::report_with_progress(&home, |step| {
            let due = last.is_none_or(|at| at.elapsed() >= Duration::from_millis(100));
            if due || step.done == step.total {
                last = Some(Instant::now());
                let _ = progress.send(step);
            }
        })
    })
    .await
    .map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Two instances would edit the same config files: a second launch
        // brings the open window to the front instead. Must come first.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(UndoStore::default())
        .setup(|app| {
            if let Ok(home) = agent::home_dir() {
                watch::start(app.handle().clone(), home);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_agents,
            open_config,
            list_mcp_servers,
            add_mcp_server,
            remove_mcp_server,
            copy_mcp_server,
            edit_mcp_server,
            server_versions,
            restore_server_version,
            list_rules,
            save_rules,
            list_skills,
            read_skill,
            skill_files,
            create_skill,
            copy_skill,
            remove_skill,
            replace_skill,
            restore_skill,
            list_secrets,
            protect_server,
            preview_protect,
            unprotect_server,
            repair_launchers,
            mark_secret_name,
            usage_report,
            undo_change,
            app_settings,
            open_folder,
            empty_skill_trash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
