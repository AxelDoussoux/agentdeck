//! The icon in the system tray (the menu bar on macOS): what needs
//! attention, this month's cost and the profiles, without opening the window.
//!
//! The frontend writes the menu's text, in the app's language, and does what
//! its items ask: the tray only reports which one was picked.

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

const ID: &str = "main";
/// Menu item ids for a profile start with this, followed by its name.
const PROFILE: &str = "profile:";

/// What the menu shows, already in the app's language.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub tooltip: String,
    /// What needs attention, such as "2 things to look at".
    pub health: Option<String>,
    /// This month's estimated cost.
    pub cost: Option<String>,
    pub profiles_title: String,
    pub profiles: Vec<String>,
    pub active: Option<String>,
    pub open: String,
    pub quit: String,
}

/// Shows the main window, and brings it to the front.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Adds the icon, with a menu in English until the frontend sends its own.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let summary = Summary {
        tooltip: "AgentDeck".into(),
        open: "Open AgentDeck".into(),
        quit: "Quit".into(),
        ..Summary::default()
    };
    let mut tray = TrayIconBuilder::with_id(ID)
        .tooltip(&summary.tooltip)
        .menu(&menu(app, &summary)?)
        .on_menu_event(|app, event| picked(app, event.id().as_ref()));
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Replaces the menu with what `summary` says.
pub fn update(app: &AppHandle, summary: &Summary) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(ID) else {
        return Ok(());
    };
    tray.set_menu(Some(menu(app, summary)?))?;
    tray.set_tooltip(Some(&summary.tooltip))?;
    Ok(())
}

fn menu(app: &AppHandle, summary: &Summary) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();
    if let Some(health) = &summary.health {
        items.push(Box::new(item("health", health)?));
    }
    if let Some(cost) = &summary.cost {
        items.push(Box::new(item("cost", cost)?));
    }
    if !summary.profiles.is_empty() {
        let profiles = Submenu::new(app, &summary.profiles_title, true)?;
        for name in &summary.profiles {
            let active = summary.active.as_deref() == Some(name.as_str());
            profiles.append(&CheckMenuItem::with_id(
                app,
                format!("{PROFILE}{name}"),
                name,
                true,
                active,
                None::<&str>,
            )?)?;
        }
        items.push(Box::new(profiles));
    }
    if !items.is_empty() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }
    items.push(Box::new(item("open", &summary.open)?));
    items.push(Box::new(item("quit", &summary.quit)?));
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// What the frontend is told when an item is picked.
fn picked(app: &AppHandle, id: &str) {
    match id {
        "open" => show(app),
        "health" => {
            show(app);
            let _ = app.emit("tray-open", "overview");
        }
        "cost" => {
            show(app);
            let _ = app.emit("tray-open", "history");
        }
        // The frontend asks about unsaved changes first.
        "quit" => {
            let _ = app.emit("tray-quit", ());
        }
        _ => {
            if let Some(name) = id.strip_prefix(PROFILE) {
                let _ = app.emit("tray-profile", name);
            }
        }
    }
}
