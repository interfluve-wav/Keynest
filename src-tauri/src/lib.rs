#[cfg(target_os = "macos")]
pub mod biometric;
pub mod crypto;
pub mod git;
pub mod models;
pub mod pgp;
pub mod proxy;
pub mod settings;
pub mod ssh;

#[cfg(target_os = "macos")]
pub use biometric::{
    biometric_available, biometric_delete_key, biometric_retrieve_key, biometric_store_key,
    biometric_unlock,
};
pub use crypto::{
    aes_decrypt, aes_encrypt, argon2_key_derive, generate_salt_cmd, generate_uuid,
    pbkdf2_key_derive,
};
pub use git::{
    git_get_repo_config, git_is_repo, git_remove_ssh_key, git_set_ssh_key, git_setup_deploy_key,
};
pub use models::{
    vault_check_integrity, vault_delete, vault_export_with_data, vault_import, vault_list,
    vault_load, vault_save, ApiKey, Note, SshKey, VaultData, VaultIntegrityResult, VaultMeta,
};
pub use pgp::{pgp_delete_key, pgp_generate_key, pgp_import_key, pgp_list_keys};
pub use proxy::{
    proxy_add_binding, proxy_add_credential, proxy_add_rule, proxy_audit_log, proxy_delete_binding,
    proxy_delete_credential, proxy_delete_rule, proxy_discover, proxy_list_bindings, proxy_list_credentials,
    proxy_list_rules, proxy_start, proxy_status, proxy_stop, ProxyCredential, ProxyRule,
    ProxyBinding, AuditEntry, ProxyStatus, DiscoverService, DiscoverResponse,
};
pub use settings::{settings_get, settings_reset, settings_set, Settings};
pub use ssh::{
    ssh_agent_add, ssh_agent_clear, ssh_agent_list, ssh_agent_remove, ssh_export_key,
    ssh_generate_key, ssh_get_fingerprint, ssh_import_keys,
};
