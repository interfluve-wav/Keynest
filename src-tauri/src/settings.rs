use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub auto_lock_minutes: u32,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_key_type")]
    pub default_ssh_key_type: String,
    #[serde(default)]
    pub ssh_agent_lifetime: Option<u32>,
    #[serde(default)]
    pub clipboard_clear_seconds: Option<u32>,
    #[serde(default = "default_true")]
    pub confirm_deletions: bool,
    #[serde(default = "default_true")]
    pub biometric_unlock: bool,
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_key_type() -> String {
    "ed25519".to_string()
}

fn default_true() -> bool {
    true
}

const SETTINGS_KEY: &str = "app_settings";

#[tauri::command]
pub fn settings_get(app: AppHandle) -> Result<Settings, String> {
    match app.store("settings.db") {
        Ok(store) => match store.get(SETTINGS_KEY) {
            Some(value) => serde_json::from_value(value)
                .map_err(|e| format!("Failed to parse settings: {}", e)),
            None => Ok(Settings::default()),
        },
        Err(_) => Ok(Settings::default()),
    }
}

#[tauri::command]
pub fn settings_set(app: AppHandle, settings: Settings) -> Result<(), String> {
    let store = app
        .store("settings.db")
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let value = serde_json::to_value(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    store.set(SETTINGS_KEY, value);
    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn settings_reset(app: AppHandle) -> Result<Settings, String> {
    let settings = Settings::default();
    settings_set(app, settings.clone())?;
    Ok(settings)
}
