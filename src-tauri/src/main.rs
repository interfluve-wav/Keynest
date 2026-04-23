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
            keynest_tauri_lib::crypto::pbkdf2_key_derive,
            keynest_tauri_lib::crypto::argon2_key_derive,
            keynest_tauri_lib::crypto::aes_encrypt,
            keynest_tauri_lib::crypto::aes_decrypt,
            keynest_tauri_lib::crypto::generate_salt_cmd,
            keynest_tauri_lib::crypto::generate_uuid,
            // Vault commands
            keynest_tauri_lib::models::vault_list,
            keynest_tauri_lib::models::vault_save,
            keynest_tauri_lib::models::vault_load,
            keynest_tauri_lib::models::vault_delete,
            keynest_tauri_lib::models::vault_check_integrity,
            keynest_tauri_lib::models::vault_export_with_data,
            keynest_tauri_lib::models::vault_import,
            // SSH commands
            keynest_tauri_lib::ssh::ssh_generate_key,
            keynest_tauri_lib::ssh::ssh_get_fingerprint,
            keynest_tauri_lib::ssh::ssh_import_keys,
            keynest_tauri_lib::ssh::ssh_agent_add,
            keynest_tauri_lib::ssh::ssh_agent_list,
            keynest_tauri_lib::ssh::ssh_agent_remove,
            keynest_tauri_lib::ssh::ssh_agent_clear,
            keynest_tauri_lib::ssh::ssh_export_key,
            // PGP commands
            keynest_tauri_lib::pgp::pgp_generate_key,
            keynest_tauri_lib::pgp::pgp_import_key,
            keynest_tauri_lib::pgp::pgp_delete_key,
            keynest_tauri_lib::pgp::pgp_list_keys,
            // Git commands
            keynest_tauri_lib::git::git_get_repo_config,
            keynest_tauri_lib::git::git_is_repo,
            keynest_tauri_lib::git::git_set_ssh_key,
            keynest_tauri_lib::git::git_remove_ssh_key,
            keynest_tauri_lib::git::git_setup_deploy_key,
            // Settings commands
            keynest_tauri_lib::settings::settings_get,
            keynest_tauri_lib::settings::settings_set,
            keynest_tauri_lib::settings::settings_reset,
            // Biometric commands
            #[cfg(target_os = "macos")]
            keynest_tauri_lib::biometric::biometric_available,
            #[cfg(target_os = "macos")]
            keynest_tauri_lib::biometric::biometric_store_key,
            #[cfg(target_os = "macos")]
            keynest_tauri_lib::biometric::biometric_retrieve_key,
            #[cfg(target_os = "macos")]
            keynest_tauri_lib::biometric::biometric_delete_key,
            #[cfg(target_os = "macos")]
            keynest_tauri_lib::biometric::biometric_unlock,
            // Proxy commands
            keynest_tauri_lib::proxy::proxy_start,
            keynest_tauri_lib::proxy::proxy_stop,
            keynest_tauri_lib::proxy::proxy_status,
            keynest_tauri_lib::proxy::proxy_list_credentials,
            keynest_tauri_lib::proxy::proxy_add_credential,
            keynest_tauri_lib::proxy::proxy_delete_credential,
            keynest_tauri_lib::proxy::proxy_list_rules,
            keynest_tauri_lib::proxy::proxy_add_rule,
            keynest_tauri_lib::proxy::proxy_delete_rule,
            keynest_tauri_lib::proxy::proxy_list_bindings,
            keynest_tauri_lib::proxy::proxy_add_binding,
            keynest_tauri_lib::proxy::proxy_delete_binding,
            keynest_tauri_lib::proxy::proxy_audit_log,
            keynest_tauri_lib::proxy::proxy_discover,
            keynest_tauri_lib::proxy::proxy_list_proposals,
            keynest_tauri_lib::proxy::proxy_create_proposal,
            keynest_tauri_lib::proxy::proxy_approve_proposal,
            keynest_tauri_lib::proxy::proxy_deny_proposal,
            keynest_tauri_lib::proxy::proxy_list_agents,
            keynest_tauri_lib::proxy::proxy_rotate_agent_token,
            keynest_tauri_lib::proxy::proxy_revoke_agent,
            keynest_tauri_lib::proxy::proxy_list_invites,
            keynest_tauri_lib::proxy::proxy_create_invite,
            keynest_tauri_lib::proxy::proxy_redeem_invite,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
