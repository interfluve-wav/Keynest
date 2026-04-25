#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;
use tauri::RunEvent;

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
            keychest_tauri_lib::crypto::pbkdf2_key_derive,
            keychest_tauri_lib::crypto::pbkdf2_key_derive_with_iterations,
            keychest_tauri_lib::crypto::argon2_key_derive,
            keychest_tauri_lib::crypto::aes_encrypt,
            keychest_tauri_lib::crypto::aes_decrypt,
            keychest_tauri_lib::crypto::generate_salt_cmd,
            keychest_tauri_lib::crypto::generate_data_key_cmd,
            keychest_tauri_lib::crypto::wrap_data_key_cmd,
            keychest_tauri_lib::crypto::unwrap_data_key_cmd,
            keychest_tauri_lib::crypto::generate_uuid,
            // Vault commands
            keychest_tauri_lib::models::vault_list,
            keychest_tauri_lib::models::vault_save,
            keychest_tauri_lib::models::vault_load,
            keychest_tauri_lib::models::vault_delete,
            keychest_tauri_lib::models::vault_check_integrity,
            keychest_tauri_lib::models::vault_change_password,
            keychest_tauri_lib::models::vault_export_with_data,
            keychest_tauri_lib::models::vault_import,
            // SSH commands
            keychest_tauri_lib::ssh::ssh_generate_key,
            keychest_tauri_lib::ssh::ssh_get_fingerprint,
            keychest_tauri_lib::ssh::ssh_import_keys,
            keychest_tauri_lib::ssh::ssh_agent_add,
            keychest_tauri_lib::ssh::ssh_agent_list,
            keychest_tauri_lib::ssh::ssh_agent_remove,
            keychest_tauri_lib::ssh::ssh_agent_clear,
            keychest_tauri_lib::ssh::ssh_export_key,
            // PGP commands
            keychest_tauri_lib::pgp::pgp_generate_key,
            keychest_tauri_lib::pgp::pgp_import_key,
            keychest_tauri_lib::pgp::pgp_delete_key,
            keychest_tauri_lib::pgp::pgp_list_keys,
            // Git commands
            keychest_tauri_lib::git::git_get_repo_config,
            keychest_tauri_lib::git::git_is_repo,
            keychest_tauri_lib::git::git_set_ssh_key,
            keychest_tauri_lib::git::git_remove_ssh_key,
            keychest_tauri_lib::git::git_setup_deploy_key,
            // Settings commands
            keychest_tauri_lib::settings::settings_get,
            keychest_tauri_lib::settings::settings_set,
            keychest_tauri_lib::settings::settings_reset,
            // Biometric commands
            #[cfg(target_os = "macos")]
            keychest_tauri_lib::biometric::biometric_available,
            #[cfg(target_os = "macos")]
            keychest_tauri_lib::biometric::biometric_store_key,
            #[cfg(target_os = "macos")]
            keychest_tauri_lib::biometric::biometric_retrieve_key,
            #[cfg(target_os = "macos")]
            keychest_tauri_lib::biometric::biometric_delete_key,
            #[cfg(target_os = "macos")]
            keychest_tauri_lib::biometric::biometric_unlock,
            // Proxy commands
            keychest_tauri_lib::proxy::proxy_start,
            keychest_tauri_lib::proxy::proxy_stop,
            keychest_tauri_lib::proxy::proxy_status,
            keychest_tauri_lib::proxy::proxy_force_reset,
            keychest_tauri_lib::proxy::proxy_diagnostics,
            keychest_tauri_lib::proxy::proxy_list_credentials,
            keychest_tauri_lib::proxy::proxy_add_credential,
            keychest_tauri_lib::proxy::proxy_delete_credential,
            keychest_tauri_lib::proxy::proxy_list_rules,
            keychest_tauri_lib::proxy::proxy_add_rule,
            keychest_tauri_lib::proxy::proxy_delete_rule,
            keychest_tauri_lib::proxy::proxy_list_bindings,
            keychest_tauri_lib::proxy::proxy_add_binding,
            keychest_tauri_lib::proxy::proxy_delete_binding,
            keychest_tauri_lib::proxy::proxy_audit_log,
            keychest_tauri_lib::proxy::proxy_discover,
            keychest_tauri_lib::proxy::proxy_list_proposals,
            keychest_tauri_lib::proxy::proxy_create_proposal,
            keychest_tauri_lib::proxy::proxy_approve_proposal,
            keychest_tauri_lib::proxy::proxy_deny_proposal,
            keychest_tauri_lib::proxy::proxy_list_agents,
            keychest_tauri_lib::proxy::proxy_rotate_agent_token,
            keychest_tauri_lib::proxy::proxy_revoke_agent,
            keychest_tauri_lib::proxy::proxy_list_invites,
            keychest_tauri_lib::proxy::proxy_create_invite,
            keychest_tauri_lib::proxy::proxy_redeem_invite,
            keychest_tauri_lib::proxy::proxy_rule_test,
            keychest_tauri_lib::proxy::proxy_list_policy_templates,
            keychest_tauri_lib::proxy::proxy_apply_policy_template,
            keychest_tauri_lib::proxy::proxy_detect_tools,
            keychest_tauri_lib::proxy::proxy_write_tool_launcher,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            RunEvent::Exit | RunEvent::ExitRequested { .. } => {
                let _ = keychest_tauri_lib::proxy::proxy_force_cleanup_ports(8080, 8081);
            }
            _ => {}
        });
}
