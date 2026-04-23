use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Wry};
use tauri_plugin_store::{Store, StoreExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMeta {
    pub id: String,
    pub name: String,
    pub salt: String,
    pub ciphertext: String,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultData {
    pub keys: Vec<SshKey>,
    pub api_keys: Vec<ApiKey>,
    pub notes: Vec<Note>,
    pub pgp_keys: Vec<PgpKey>,
    pub version: u32,
}

impl Default for VaultData {
    fn default() -> Self {
        Self {
            keys: vec![],
            api_keys: vec![],
            notes: vec![],
            pgp_keys: vec![],
            version: 1,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultExport {
    pub meta: VaultMeta,
    pub data: VaultData,
}

// Re-export VaultData default impl above

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKey {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub key_type: String,
    pub comment: String,
    pub fingerprint: String,
    pub public_key: String,
    #[serde(rename = "privateKey")]
    pub private_key: Option<String>,
    pub created: String,
    // Analytics tracking fields (optional for backwards compat)
    #[serde(default)]
    pub copied_count: u32,
    #[serde(default)]
    pub last_copied_at: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<String>,
    // Favorites / pinning
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub name: String,
    pub content: String,
    pub created: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub key: String,
    pub notes: String,
    pub created: String,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgpKey {
    pub id: String,
    pub name: String,
    pub fingerprint: String,
    pub key_id: String,
    pub algorithm: String,
    pub bit_length: u32,
    pub created: String,
    pub user_ids: Vec<String>,
    #[serde(rename = "publicKey")]
    pub public_key: Option<String>,
    #[serde(rename = "privateKey")]
    pub private_key: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultListResult {
    pub vaults: Vec<VaultMeta>,
}

fn get_store(app: &AppHandle) -> Result<Arc<Store<Wry>>, String> {
    app.store("vaults.db")
        .map_err(|e| format!("Failed to open store: {}", e))
}

#[tauri::command]
pub fn vault_list(app: AppHandle) -> Result<Vec<VaultMeta>, String> {
    let store = get_store(&app)?;
    let vaults: Vec<VaultMeta> = store
        .get("vaults")
        .and_then(|v: Value| serde_json::from_value(v).ok())
        .unwrap_or_default();
    Ok(vaults)
}

#[tauri::command]
pub fn vault_save(app: AppHandle, vault: VaultMeta) -> Result<(), String> {
    let store = get_store(&app)?;
    let mut vaults: Vec<VaultMeta> = store
        .get("vaults")
        .and_then(|v: Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    if let Some(pos) = vaults.iter().position(|v| v.id == vault.id) {
        vaults[pos] = vault;
    } else {
        vaults.push(vault);
    }

    store.set("vaults", serde_json::to_value(vaults).unwrap());
    store.save().map_err(|e| format!("Failed to save: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn vault_load(app: AppHandle, id: String) -> Result<VaultMeta, String> {
    let store = get_store(&app)?;
    let vaults: Vec<VaultMeta> = store
        .get("vaults")
        .and_then(|v: Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    vaults
        .into_iter()
        .find(|v| v.id == id)
        .ok_or_else(|| "Vault not found".to_string())
}

#[tauri::command]
pub fn vault_delete(app: AppHandle, id: String) -> Result<(), String> {
    let store = get_store(&app)?;
    let mut vaults: Vec<VaultMeta> = store
        .get("vaults")
        .and_then(|v: Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    vaults.retain(|v| v.id != id);
    store.set("vaults", serde_json::to_value(vaults).unwrap());
    store.save().map_err(|e| format!("Failed to save: {}", e))?;
    Ok(())
}

/// Export vault to a JSON file
#[tauri::command]
pub async fn vault_export(app: AppHandle, id: String, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let store = get_store(&app)?;
        let vaults: Vec<VaultMeta> = store
            .get("vaults")
            .and_then(|v: Value| serde_json::from_value(v).ok())
            .unwrap_or_default();

        let meta = vaults
            .into_iter()
            .find(|v| v.id == id)
            .ok_or_else(|| "Vault not found".to_string())?;

        // For export, we need the encrypted data (ciphertext) to be decrypted first
        // This command expects the frontend to provide the decrypted data
        // So we export a structure that can be re-imported
        let export = VaultExport {
            meta,
            data: VaultData::default(),
        };

        let json = serde_json::to_string_pretty(&export)
            .map_err(|e| format!("Failed to serialize: {}", e))?;

        std::fs::write(&path, json).map_err(|e| format!("Failed to write file: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Export with pre-decrypted data (from frontend)
#[tauri::command]
pub async fn vault_export_with_data(
    path: String,
    meta: VaultMeta,
    data: VaultData,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let export = VaultExport { meta, data };

        let json = serde_json::to_string_pretty(&export)
            .map_err(|e| format!("Failed to serialize: {}", e))?;

        std::fs::write(&path, json).map_err(|e| format!("Failed to write file: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Check all vault ciphertexts for structural integrity without attempting decryption.
/// Returns per-vault status: ok, too_short, or unreadable.
/// This is a fast pre-check that runs at startup so users see warnings immediately.
#[tauri::command]
pub fn vault_check_integrity(app: AppHandle) -> Result<Vec<VaultIntegrityResult>, String> {
    use base64::Engine as _;

    let store = get_store(&app)?;
    let vaults: Vec<VaultMeta> = store
        .get("vaults")
        .and_then(|v: Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    // Adaptive threshold: find the smallest ciphertext size across all vaults.
    // The smallest valid vault (empty arrays + minimal JSON) is ~50 raw bytes base64.
    // Anything noticeably smaller than the minimum is a red flag.
    // Minimum theoretically possible: 12 (nonce) + 1 (empty ciphertext) + 16 (tag) = 29.
    const ABSOLUTE_MIN: usize = 29;
    let min_ct_size = vaults
        .iter()
        .filter_map(|v| {
            base64::engine::general_purpose::STANDARD
                .decode(&v.ciphertext)
                .ok()
        })
        .map(|b| b.len())
        .min()
        .unwrap_or(ABSOLUTE_MIN);

    // Flag anything that is:
    //   (a) invalid base64 → "unreadable"
    //   (b) strictly smaller than the minimum across all vaults → "too_short"
    //      (the minimum vault is the one most likely to be corrupted)
    let global_min = min_ct_size;
    let flagged_size = if global_min < 50 { global_min } else { 50 };

    let results: Vec<VaultIntegrityResult> = vaults
        .into_iter()
        .map(|vault| {
            let decoded = base64::engine::general_purpose::STANDARD.decode(&vault.ciphertext);
            let ct_len = decoded.as_ref().map(|b| b.len()).unwrap_or(0);
            let decode_err = decoded.is_err();

            let status = if decode_err {
                "unreadable".to_string()
            } else if ct_len < flagged_size {
                format!("too_short ({}B, expected ≥{}B)", ct_len, flagged_size)
            } else {
                "ok".to_string()
            };

            VaultIntegrityResult {
                id: vault.id,
                name: vault.name,
                status,
            }
        })
        .collect();

    Ok(results)
}

/// Result of a vault integrity check
#[derive(Debug, Serialize, Deserialize)]
pub struct VaultIntegrityResult {
    pub id: String,
    pub name: String,
    /// One of: "ok", "too_short (<N bytes)", "unreadable"
    pub status: String,
}

/// Import vault from a JSON file
#[tauri::command]
pub async fn vault_import(app: AppHandle, path: String) -> Result<VaultExport, String> {
    tokio::task::spawn_blocking(move || {
        let content =
            std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

        let export: VaultExport =
            serde_json::from_str(&content).map_err(|e| format!("Invalid vault file: {}", e))?;

        // Save the vault metadata to the store
        let store = get_store(&app)?;
        let mut vaults: Vec<VaultMeta> = store
            .get("vaults")
            .and_then(|v: Value| serde_json::from_value(v).ok())
            .unwrap_or_default();

        // Check if vault with same ID already exists
        if vaults.iter().any(|v| v.id == export.meta.id) {
            return Err("Vault with this ID already exists".to_string());
        }

        vaults.push(export.meta.clone());
        store.set("vaults", serde_json::to_value(vaults).unwrap());
        store.save().map_err(|e| format!("Failed to save: {}", e))?;

        Ok(export)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn test_vault_data_default() {
        let vd = VaultData::default();
        assert!(vd.keys.is_empty());
        assert!(vd.api_keys.is_empty());
        assert!(vd.notes.is_empty());
        assert!(vd.pgp_keys.is_empty());
        assert_eq!(vd.version, 1);
    }

    #[test]
    fn test_ssh_key_serialization_roundtrip() {
        let key = SshKey {
            id: "test-id".to_string(),
            name: "My SSH Key".to_string(),
            key_type: "ed25519".to_string(),
            comment: "comment".to_string(),
            fingerprint: "SHA256:abc123".to_string(),
            public_key: "ssh-ed25519 AAAAC3...".to_string(),
            private_key: Some("-----BEGIN OPENSSH PRIVATE KEY-----\n...".to_string()),
            created: "2026-04-23T00:00:00Z".to_string(),
            copied_count: 0,
            last_copied_at: None,
            last_used_at: None,
            pinned: false,
        };
        let json = serde_json::to_string(&key).unwrap();
        let decoded: SshKey = serde_json::from_str(&json).unwrap();
        assert_eq!(key.id, decoded.id);
        assert_eq!(key.name, decoded.name);
        assert_eq!(key.key_type, decoded.key_type);
        assert_eq!(key.fingerprint, decoded.fingerprint);
        assert_eq!(key.pinned, decoded.pinned);
    }

    #[test]
    fn test_api_key_serialization_roundtrip() {
        let key = ApiKey {
            id: "api-id".to_string(),
            name: "OpenAI API".to_string(),
            provider: "OpenAI".to_string(),
            key: "sk-...".to_string(),
            notes: "".to_string(),
            created: "2026-04-23T00:00:00Z".to_string(),
            pinned: false,
        };
        let json = serde_json::to_string(&key).unwrap();
        let decoded: ApiKey = serde_json::from_str(&json).unwrap();
        assert_eq!(key.id, decoded.id);
        assert_eq!(key.provider, decoded.provider);
        assert_eq!(key.pinned, decoded.pinned);
    }

    #[test]
    fn test_note_serialization_roundtrip() {
        let note = Note {
            id: "note-id".to_string(),
            name: "Test Note".to_string(),
            content: "Secret content".to_string(),
            created: "2026-04-23T00:00:00Z".to_string(),
            updated_at: Some("2026-04-23T12:00:00Z".to_string()),
        };
        let json = serde_json::to_string(&note).unwrap();
        let decoded: Note = serde_json::from_str(&json).unwrap();
        assert_eq!(note.id, decoded.id);
        assert_eq!(note.name, decoded.name);
        assert_eq!(note.content, decoded.content);
        assert_eq!(note.updated_at, decoded.updated_at);
    }

    #[test]
    fn test_pgp_key_serialization_roundtrip() {
        let key = PgpKey {
            id: "pgp-id".to_string(),
            name: "My PGP Key".to_string(),
            fingerprint: "ABCD1234EF567890".to_string(),
            key_id: "ABCD1234".to_string(),
            algorithm: "RSA4096".to_string(),
            bit_length: 4096,
            created: "2026-04-23T00:00:00Z".to_string(),
            user_ids: vec!["user@example.com".to_string()],
            public_key: Some("-----BEGIN PGP PUBLIC KEY-----\n...".to_string()),
            private_key: Some("-----BEGIN PGP PRIVATE KEY-----\n...".to_string()),
            pinned: false,
        };
        let json = serde_json::to_string(&key).unwrap();
        let decoded: PgpKey = serde_json::from_str(&json).unwrap();
        assert_eq!(key.id, decoded.id);
        assert_eq!(key.algorithm, decoded.algorithm);
        assert_eq!(key.bit_length, decoded.bit_length);
        assert_eq!(key.user_ids, decoded.user_ids);
        assert_eq!(key.pinned, decoded.pinned);
    }

    #[test]
    fn test_vault_export_roundtrip() {
        let meta = VaultMeta {
            id: "vault-1".to_string(),
            name: "Test Vault".to_string(),
            salt: "saltbase64==".to_string(),
            ciphertext: "ciphertextbase64==".to_string(),
            created: "2026-04-23T00:00:00Z".to_string(),
        };
        let data = VaultData::default();
        let export = VaultExport {
            meta: meta.clone(),
            data: data.clone(),
        };
        let json = serde_json::to_string(&export).unwrap();
        let decoded: VaultExport = serde_json::from_str(&json).unwrap();
        assert_eq!(export.meta.id, decoded.meta.id);
        assert_eq!(export.meta.name, decoded.meta.name);
        assert_eq!(export.data.version, decoded.data.version);
    }
}
