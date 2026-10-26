use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use agentdeck_core::rules::{self, Rules};
use agentdeck_core::secrets::{self, Keychain, SecretRef};
use agentdeck_core::skills::{self, Location, Skill};
use agentdeck_core::usage::{self, ReadProgress, Session, UsageReport};
use agentdeck_core::{
    Agent, AgentInfo, Error, ErrorInfo, McpServer, ServerSpec, agent, config_file, mcp, probe,
};
use tauri::ipc::Channel;
use tauri::{Manager, State};

mod watch;

fn home() -> Result<PathBuf, UiError> {
    Ok(agent::home_dir()?)
}

/// What a command sends back when it fails, for the UI to word in the
/// user's language. Boxed, so that results stay small.
#[derive(Debug, serde::Serialize)]
#[serde(transparent)]
struct UiError(Box<ErrorInfo>);

impl From<ErrorInfo> for UiError {
    fn from(info: ErrorInfo) -> Self {
        UiError(Box::new(info))
    }
}

impl From<Error> for UiError {
    fn from(err: Error) -> Self {
        ErrorInfo::from(err).into()
    }
}

/// An error from outside the core, such as the opener or the save dialog,
/// which the UI shows as it is.
fn other(err: impl ToString) -> UiError {
    ErrorInfo::new("other", err.to_string()).into()
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
) -> Result<(u64, T), UiError> {
    let home = home()?;
    let previous = mcp::get(agent, &home, name)?.map(Box::new);
    let output = edit(&home)?;
    let id = undo.push(UndoAction::Mcp {
        agent,
        name: name.to_owned(),
        previous,
    });
    Ok((id, output))
}

#[tauri::command]
fn undo_change(undo: State<UndoStore>, id: u64) -> Result<(), UiError> {
    let action = undo
        .take(id)
        .ok_or_else(|| ErrorInfo::new("undoExpired", "This change can no longer be undone."))?;
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
            let current = rules::read(agent, &home)?.content.unwrap_or_default();
            if current != written {
                return Err(ErrorInfo::new(
                    "rulesChanged",
                    format!(
                        "The {} rules changed since, so they were left as they are.",
                        agent.display_name()
                    ),
                )
                .agent(agent)
                .into());
            }
            rules::write(agent, &home, &previous)
        }
        UndoAction::Protect {
            agent,
            server,
            protect: true,
        } => {
            let launcher = launcher().ok_or_else(launcher_missing)?;
            secrets::protect(&Keychain, &home, agent, &server, &launcher)
        }
        UndoAction::Protect {
            agent,
            server,
            protect: false,
        } => secrets::unprotect(&Keychain, &home, agent, &server),
    }
    .map_err(UiError::from)
}

#[tauri::command]
fn list_agents() -> Result<Vec<AgentInfo>, UiError> {
    Ok(agent::detect(&home()?))
}

/// Opens an agent's MCP config in the default editor, or shows it in the
/// file manager. Only these files: the UI never passes a path.
#[tauri::command]
fn open_config(app: tauri::AppHandle, agent: Agent, reveal: bool) -> Result<(), UiError> {
    use tauri_plugin_opener::OpenerExt;
    let path = agent.mcp_config_path(&home()?);
    if !path.is_file() {
        return Err(not_created(&path));
    }
    let opener = app.opener();
    let opened = if reveal {
        opener.reveal_item_in_dir(&path)
    } else {
        opener.open_path(path.to_string_lossy(), None::<&str>)
    };
    opened.map_err(other)
}

#[derive(serde::Serialize)]
struct McpListing {
    servers: Vec<McpServer>,
    errors: Vec<ErrorInfo>,
}

/// Where an agent's files are, and whether a variable moved them.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentFolder {
    agent: Agent,
    path: String,
    variable: Option<&'static str>,
    /// Its variable is set, and moves the folder.
    moved: bool,
    /// Another folder was chosen in AgentDeck, which the variable may override.
    chosen: bool,
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
fn app_settings() -> Result<AppSettings, UiError> {
    let home = home()?;
    let chosen = agent::chosen_folders(&home)?;
    let folders = Agent::ALL
        .into_iter()
        .map(|agent| {
            let variable = agent.folder_variable();
            AgentFolder {
                agent,
                path: agent.folder(&home).display().to_string(),
                variable,
                moved: agent.variable_folder(&home).is_some(),
                chosen: chosen.contains_key(&agent),
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
fn open_folder(app: tauri::AppHandle, folder: AppFolder) -> Result<(), UiError> {
    use tauri_plugin_opener::OpenerExt;
    let home = home()?;
    let path = match folder {
        AppFolder::Backups => config_file::backups_root(&home),
        AppFolder::Trash => skills::trash_dir(&home),
        AppFolder::Agent(agent) => agent.folder(&home),
        AppFolder::Skill { location, name } => skills::skill_dir(&home, location, &name)?,
    };
    if !path.is_dir() {
        return Err(not_created(&path));
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(other)
}

/// Asks for the folder where `agent` keeps its files, in a folder picker, and
/// uses it from now on. Returns false when the picker is cancelled. Only the
/// picker chooses the path: the UI never passes one.
#[tauri::command]
async fn pick_agent_folder(app: tauri::AppHandle, agent: Agent) -> Result<bool, UiError> {
    use tauri_plugin_dialog::DialogExt;
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_title(agent.display_name())
            .set_directory(agent.folder(&home));
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(picked) = dialog.blocking_pick_folder() else {
            return Ok::<_, UiError>(false);
        };
        let folder = picked.into_path().map_err(other)?;
        agent::choose_folder(&home, agent, Some(&folder))?;
        Ok(true)
    })
    .await
    .map_err(other)?
}

/// Makes AgentDeck use `agent`'s default folder again.
#[tauri::command]
fn reset_agent_folder(agent: Agent) -> Result<(), UiError> {
    Ok(agent::choose_folder(&home()?, agent, None)?)
}

#[tauri::command]
fn empty_skill_trash() -> Result<usize, UiError> {
    skills::empty_trash(&home()?).map_err(UiError::from)
}

#[tauri::command]
fn list_mcp_servers() -> Result<McpListing, UiError> {
    let (servers, errors) = mcp::list_all(&home()?);
    Ok(McpListing {
        servers,
        errors: errors
            .into_iter()
            .map(|(agent, err)| ErrorInfo::from(err).agent(agent))
            .collect(),
    })
}

#[tauri::command]
fn add_mcp_server(
    undo: State<UndoStore>,
    agent: Agent,
    name: String,
    spec: ServerSpec,
) -> Result<u64, UiError> {
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
) -> Result<u64, UiError> {
    undoable_mcp(&undo, agent, &name, |home| {
        mcp::update(agent, home, &name, &edit)
    })
    .map(|(id, ())| id)
}

#[tauri::command]
fn remove_mcp_server(undo: State<UndoStore>, agent: Agent, name: String) -> Result<u64, UiError> {
    undoable_mcp(&undo, agent, &name, |home| mcp::remove(agent, home, &name)).map(|(id, ())| id)
}

/// Turns a server on or off, keeping its settings.
#[tauri::command]
fn set_mcp_enabled(
    undo: State<UndoStore>,
    agent: Agent,
    name: String,
    enabled: bool,
) -> Result<u64, UiError> {
    undoable_mcp(&undo, agent, &name, |home| {
        mcp::set_enabled(agent, home, &name, enabled)
    })
    .map(|(id, ())| id)
}

#[tauri::command]
fn copy_mcp_server(
    undo: State<UndoStore>,
    name: String,
    from: Agent,
    to: Agent,
    overwrite: bool,
) -> Result<CopyResult, UiError> {
    let (undo, lost) = undoable_mcp(&undo, to, &name, |home| {
        mcp::copy(home, &name, from, to, overwrite)
    })?;
    Ok(CopyResult { undo, lost })
}

#[tauri::command]
fn server_versions(agent: Agent, name: String) -> Result<Vec<mcp::ServerVersion>, UiError> {
    mcp::versions(agent, &home()?, &name).map_err(UiError::from)
}

#[tauri::command]
fn restore_server_version(
    undo: State<UndoStore>,
    agent: Agent,
    name: String,
    id: String,
) -> Result<u64, UiError> {
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
fn list_rules() -> Result<Vec<Rules>, UiError> {
    let (all, errors) = rules::read_all(&home()?);
    match errors.into_iter().next() {
        Some((agent, err)) => Err(ErrorInfo::from(err).agent(agent).into()),
        None => Ok(all),
    }
}

#[tauri::command]
fn save_rules(undo: State<UndoStore>, agent: Agent, content: String) -> Result<u64, UiError> {
    let home = home()?;
    let previous = rules::read(agent, &home)?.content.unwrap_or_default();
    rules::write(agent, &home, &content)?;
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
fn list_skills() -> Result<SkillListing, UiError> {
    let home = home()?;
    let (skills, errors) = skills::list(&home);
    Ok(SkillListing {
        skills,
        errors,
        trash: skills::trashed(&home),
    })
}

#[tauri::command]
fn read_skill(location: Location, name: String) -> Result<String, UiError> {
    skills::read(&home()?, location, &name).map_err(UiError::from)
}

#[tauri::command]
fn skill_files(location: Location, name: String) -> Result<Vec<skills::SkillFile>, UiError> {
    skills::files(&home()?, location, &name).map_err(UiError::from)
}

/// Creates a skill from the template and returns its folder.
#[tauri::command]
fn create_skill(location: Location, name: String, description: String) -> Result<String, UiError> {
    skills::create(&home()?, location, &name, &description)
        .map(|path| path.display().to_string())
        .map_err(UiError::from)
}

#[tauri::command]
fn copy_skill(name: String, from: Location, to: Agent) -> Result<(), UiError> {
    skills::copy(&home()?, &name, from, to, false).map_err(UiError::from)
}

/// Replaces the copy of a skill in `to` with the one in `from`; the old copy
/// goes to the trash.
#[tauri::command]
fn replace_skill(name: String, from: Location, to: Location) -> Result<(), UiError> {
    skills::copy_to(&home()?, &name, from, to, true).map_err(UiError::from)
}

#[tauri::command]
fn restore_skill(id: String, overwrite: bool) -> Result<Location, UiError> {
    skills::restore(&home()?, &id, overwrite).map_err(UiError::from)
}

#[tauri::command]
fn remove_skill(location: Location, name: String) -> Result<String, UiError> {
    skills::remove(&home()?, location, &name)
        .map(|trashed| trashed.display().to_string())
        .map_err(UiError::from)
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
    /// The shell profile line that sets the variables protected headers read.
    shell_hook: Option<String>,
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
fn list_secrets() -> Result<SecretListing, UiError> {
    let (secrets, errors) = secrets::inventory(&home()?);
    let launcher = launcher();
    let shell = if cfg!(windows) {
        secrets::Shell::Powershell
    } else {
        secrets::Shell::Sh
    };
    Ok(SecretListing {
        secrets,
        errors,
        shell_hook: launcher
            .as_deref()
            .map(|path| secrets::shell_hook(path, shell)),
        launcher: launcher.map(|path| path.display().to_string()),
        stranded: secrets::stranded(&home()?),
    })
}

fn launcher_missing() -> UiError {
    ErrorInfo::new(
        "launcherMissing",
        "The agentdeck CLI that protected servers start through was not found. Reinstall AgentDeck.",
    )
    .into()
}

/// A file or folder the app was asked to open before anything created it.
fn not_created(path: &std::path::Path) -> UiError {
    ErrorInfo::new(
        "notCreated",
        format!("{} does not exist yet.", path.display()),
    )
    .path(path)
    .into()
}

#[tauri::command]
fn protect_server(undo: State<UndoStore>, agent: Agent, server: String) -> Result<u64, UiError> {
    let launcher = launcher().ok_or_else(launcher_missing)?;
    secrets::protect(&Keychain, &home()?, agent, &server, &launcher)?;
    Ok(undo.push(UndoAction::Protect {
        agent,
        server,
        protect: false,
    }))
}

/// How protecting a server would change its command, without writing it.
#[tauri::command]
fn preview_protect(agent: Agent, server: String) -> Result<secrets::ProtectPreview, UiError> {
    let launcher = launcher().ok_or_else(launcher_missing)?;
    secrets::preview_protect(&Keychain, &home()?, agent, &server, &launcher).map_err(UiError::from)
}

/// Marks a variable name as a secret (`true`), a setting (`false`), or lets
/// AgentDeck judge it again (`null`).
#[tauri::command]
fn mark_secret_name(name: String, secret: Option<bool>) -> Result<(), UiError> {
    secrets::mark_name(&home()?, &name, secret).map_err(UiError::from)
}

/// Points protected servers whose launcher is missing at the current one.
/// Returns how many were repaired.
#[tauri::command]
fn repair_launchers() -> Result<usize, UiError> {
    let launcher = launcher().ok_or_else(launcher_missing)?;
    secrets::repair(&home()?, &launcher)
        .map(|repaired| repaired.len())
        .map_err(UiError::from)
}

#[tauri::command]
fn unprotect_server(undo: State<UndoStore>, agent: Agent, server: String) -> Result<u64, UiError> {
    secrets::unprotect(&Keychain, &home()?, agent, &server)?;
    Ok(undo.push(UndoAction::Protect {
        agent,
        server,
        protect: true,
    }))
}

/// Starts a server to list its tools. It can take a while, as `npx` may
/// download the server first, so it runs off the main thread.
#[tauri::command]
async fn test_mcp_server(agent: Agent, name: String) -> Result<probe::ProbeReport, UiError> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || {
        let spec = mcp::get(agent, &home, &name)?.ok_or(Error::NotFound { agent, name })?;
        // The app does not run in the shell that sets protected headers' variables.
        let spec = secrets::with_vault_variables(&Keychain, spec)?;
        Ok::<_, UiError>(probe::probe(&spec, probe::TIMEOUT))
    })
    .await
    .map_err(other)?
}

/// Parsing months of logs takes a while, so it runs off the main thread.
#[tauri::command]
async fn usage_report(progress: Channel<ReadProgress>) -> Result<UsageReport, UiError> {
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
    .map_err(other)
}

/// Saves sessions as CSV where the user picks in a save dialog. Returns the
/// file's path, or nothing when the dialog is cancelled. Only the dialog
/// chooses the path: the UI never passes one.
#[tauri::command]
async fn export_sessions_csv(
    app: tauri::AppHandle,
    sessions: Vec<Session>,
    file_name: String,
) -> Result<Option<String>, UiError> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_file_name(file_name)
            .add_filter("CSV", &["csv"]);
        // Over the window, so that it stays in front of it.
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(picked) = dialog.blocking_save_file() else {
            return Ok::<_, UiError>(None);
        };
        let path = picked.into_path().map_err(other)?;
        // The byte order mark tells Excel the file is UTF-8, so accents and
        // emoji in titles show as written.
        let csv = format!("\u{feff}{}", usage::sessions_csv(&sessions));
        fs::write(&path, csv).map_err(|source| Error::Io {
            path: path.clone(),
            source,
        })?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(other)?
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
        .plugin(tauri_plugin_dialog::init())
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
            set_mcp_enabled,
            copy_mcp_server,
            edit_mcp_server,
            server_versions,
            test_mcp_server,
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
            export_sessions_csv,
            undo_change,
            app_settings,
            open_folder,
            pick_agent_folder,
            reset_agent_folder,
            empty_skill_trash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
