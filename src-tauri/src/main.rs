#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri_plugin_global_shortcut::ShortcutState;

                let handle = app.handle().clone();

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(["Cmd+Shift+K"])
                        .unwrap()
                        .with_handler(move |_app, _shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                let _ = handle.emit("global-shortcut", ());
                            }
                        })
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Crypto commands
            ssh_vault_tauri_lib::crypto::pbkdf2_key_derive,
            ssh_vault_tauri_lib::crypto::argon2_key_derive,
            ssh_vault_tauri_lib::crypto::aes_encrypt,
            ssh_vault_tauri_lib::crypto::aes_decrypt,
            ssh_vault_tauri_lib::crypto::generate_salt_cmd,
            ssh_vault_tauri_lib::crypto::generate_uuid,
            // Vault commands
            ssh_vault_tauri_lib::models::vault_list,
            ssh_vault_tauri_lib::models::vault_save,
            ssh_vault_tauri_lib::models::vault_load,
            ssh_vault_tauri_lib::models::vault_delete,
            ssh_vault_tauri_lib::models::vault_check_integrity,
            ssh_vault_tauri_lib::models::vault_export_with_data,
            ssh_vault_tauri_lib::models::vault_import,
            // SSH commands
            ssh_vault_tauri_lib::ssh::ssh_generate_key,
            ssh_vault_tauri_lib::ssh::ssh_get_fingerprint,
            ssh_vault_tauri_lib::ssh::ssh_import_keys,
            ssh_vault_tauri_lib::ssh::ssh_agent_add,
            ssh_vault_tauri_lib::ssh::ssh_agent_list,
            ssh_vault_tauri_lib::ssh::ssh_agent_remove,
            ssh_vault_tauri_lib::ssh::ssh_agent_clear,
            ssh_vault_tauri_lib::ssh::ssh_export_key,
            // PGP commands
            ssh_vault_tauri_lib::pgp::pgp_generate_key,
            ssh_vault_tauri_lib::pgp::pgp_import_key,
            ssh_vault_tauri_lib::pgp::pgp_delete_key,
            ssh_vault_tauri_lib::pgp::pgp_list_keys,
            // Git commands
            ssh_vault_tauri_lib::git::git_get_repo_config,
            ssh_vault_tauri_lib::git::git_is_repo,
            ssh_vault_tauri_lib::git::git_set_ssh_key,
            ssh_vault_tauri_lib::git::git_remove_ssh_key,
            ssh_vault_tauri_lib::git::git_setup_deploy_key,
            // Settings commands
            ssh_vault_tauri_lib::settings::settings_get,
            ssh_vault_tauri_lib::settings::settings_set,
            ssh_vault_tauri_lib::settings::settings_reset,
            // Biometric commands
            #[cfg(target_os = "macos")]
            ssh_vault_tauri_lib::biometric::biometric_available,
            #[cfg(target_os = "macos")]
            ssh_vault_tauri_lib::biometric::biometric_store_key,
            #[cfg(target_os = "macos")]
            ssh_vault_tauri_lib::biometric::biometric_retrieve_key,
            #[cfg(target_os = "macos")]
            ssh_vault_tauri_lib::biometric::biometric_delete_key,
            #[cfg(target_os = "macos")]
            ssh_vault_tauri_lib::biometric::biometric_unlock,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
