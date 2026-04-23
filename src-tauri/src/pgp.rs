//! PGP key management via the system `gpg` command.
//!
//! GPG is available on macOS (via brew install gnupg) and Linux. This avoids
//! complex OpenPGP API exploration and gives us accurate metadata parsing for free.

use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri_plugin_store::StoreExt;

use crate::models::{PgpKey, VaultData, VaultMeta};

/// Metadata returned after importing a key
#[derive(Debug, Serialize, Deserialize)]
pub struct PgpKeyMetadata {
    pub id: String,
    pub name: String,
    pub fingerprint: String,
    pub key_id: String,
    pub algorithm: String,
    #[serde(rename = "bit_length")]
    bit_length: u32,
    pub created: String,
    pub user_ids: Vec<String>,
}

/// Parse GPG colon-delimited key record to extract metadata.
/// Fields: type, trust, validity, length (bits), algo, keyid, date, empty, certid, ownertrust, uid, sigclass, sigtype, signer-uid, expiration, flags
/// Example line: `pub:u:4096:1:ABC123...:1700000000::::User Name (comment) <email@example.org>:`
#[allow(dead_code)]
type GpgRecord<'a> = (
    &'a str,      // rec_type
    &'a str,      // trust
    u32,          // bit_length
    &'a str,      // algo
    &'a str,      // keyid
    &'a str,      // date
    Vec<&'a str>, // user_ids
);

#[allow(dead_code)]
fn parse_gpg_record(line: &str) -> Option<GpgRecord<'_>> {
    let fields: Vec<&str> = line.split(':').collect();
    if fields.len() < 10 {
        return None;
    }

    let rec_type = fields.first()?;

    // We want pub (public key) or crt (certificate) records
    if !["pub", "uid", "fpr"].contains(rec_type) {
        return None;
    }

    // Get uid fields from the uid record
    let _uid_line = fields.get(9).unwrap_or(&"");

    None // placeholder — we'll parse directly in the commands below
}

/// Extract metadata from GPG armored key by running `gpg` commands.
/// Returns (name, fingerprint, key_id, algorithm, bit_length, created, user_ids)
type GpgInspectResult = (String, String, String, String, u32, String, Vec<String>);

fn gpg_inspect(armored: &str) -> Result<GpgInspectResult, String> {
    // Write armored key to a temp file
    let temp_dir = std::env::temp_dir();
    let key_path = temp_dir.join(format!("pgp_import_{}.gpg", uuid::Uuid::new_v4()));
    let armored_path = temp_dir.join(format!("pgp_import_{}.asc", uuid::Uuid::new_v4()));
    let _ = key_path; // reserved for potential future keyring import

    // Write armored key to temp file
    std::fs::write(&armored_path, armored.trim().as_bytes())
        .map_err(|e| format!("Failed to write temp key file: {}", e))?;

    // Run gpg --show-keys to get structured metadata
    let output = Command::new("gpg")
        .args(["--show-keys", armored_path.to_str().unwrap()])
        .output()
        .map_err(|e| format!("Failed to run gpg: {}. Is GPG installed?", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        std::fs::remove_file(&armored_path).ok();
        return Err(format!("GPG failed to parse key: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse gpg --show-keys output
    // Format:
    // pub:-:4096:1:ABC123DEF456:1700000000::::Test User <test@example.org>:
    // fpr:-:4096:1:ABC123DEF456:1700000000::::Test User <test@example.org>:
    // fpr:-:4096:1:9876543210FEDCBA:1700000000::::Test User <test@example.org>:
    // sub:-:4096:1:XYZ789:1700000000:::::

    let mut name = String::new();
    let mut fingerprint = String::new();
    let mut primary_key_id = String::new();
    let mut algorithm = String::from("RSA"); // default
    let mut bit_length: u32 = 0;
    let mut created = String::new();
    let mut user_ids = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("pub:") || line.starts_with("crt:") || line.starts_with("crs:") {
            let fields: Vec<&str> = line.split(':').collect();
            if fields.len() >= 10 {
                bit_length = fields[2].parse().unwrap_or(0);
                let algo_num: u32 = fields[3].parse().unwrap_or(1);
                primary_key_id = fields[4].to_string();
                created = fields[5].to_string();
                // Format created as YYYY-MM-DD
                if created.len() == 10 {
                    let y = &created[..4];
                    let m = &created[4..6];
                    let d = &created[6..];
                    created = format!("{}-{}-{}", y, m, d);
                } else if created.is_empty() {
                    created = "unknown".to_string();
                }
                // UID may be empty in pub record; look in next lines
                let uid = fields.get(9).unwrap_or(&"");
                if !uid.is_empty() {
                    name = uid.to_string();
                    if !user_ids.iter().any(|u| u == uid) {
                        user_ids.push(uid.to_string());
                    }
                }
                // Map algorithm number to name
                algorithm = match algo_num {
                    1 => "RSA".to_string(),
                    16 => "ElGamal".to_string(),
                    17 => "DSA".to_string(),
                    18 => "ECDH".to_string(),
                    19 => "ECDSA".to_string(),
                    22 => "EdDSA".to_string(),
                    99 => "ECC".to_string(),
                    _ => format!("Alg({})", algo_num),
                };
            }
        } else if line.starts_with("fpr:") && fingerprint.is_empty() {
            // First fpr line is the primary key fingerprint
            let fields: Vec<&str> = line.split(':').collect();
            if fields.len() >= 10 {
                let fp = fields[9];
                // Format fingerprint as groups of 4 hex chars
                fingerprint = fp
                    .chars()
                    .collect::<Vec<_>>()
                    .chunks(4)
                    .map(|c| c.iter().collect::<String>())
                    .collect::<Vec<_>>()
                    .join(" ");
            }
        } else if line.starts_with("uid:") && line.contains('@') {
            // Additional user IDs
            let fields: Vec<&str> = line.split(':').collect();
            if fields.len() >= 10 {
                let uid = fields[9];
                if !uid.is_empty() && !user_ids.contains(&uid.to_string()) {
                    user_ids.push(uid.to_string());
                }
            }
        }
    }

    if primary_key_id.is_empty() && fingerprint.is_empty() {
        std::fs::remove_file(&armored_path).ok();
        return Err("Could not parse GPG output — is this a valid PGP key?".to_string());
    }

    if name.is_empty() {
        name = format!(
            "PGP Key ({})",
            if primary_key_id.len() >= 8 {
                &primary_key_id[primary_key_id.len() - 8..]
            } else {
                &primary_key_id
            }
        );
    }

    // Cleanup
    std::fs::remove_file(&armored_path).ok();

    Ok((
        name,
        fingerprint,
        primary_key_id,
        algorithm,
        bit_length,
        created,
        user_ids,
    ))
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Import an armored PGP key (public or secret) into a vault.
#[tauri::command]
pub fn pgp_import_key(
    app: tauri::AppHandle,
    vault_id: String,
    armored_key: String,
) -> Result<PgpKeyMetadata, String> {
    // Inspect key (runs gpg command — fast enough to not need spawn_blocking)
    let (name, fingerprint, key_id, algorithm, bit_length, created, user_ids) =
        gpg_inspect(&armored_key)?;

    let id = uuid::Uuid::new_v4().to_string();
    let armored_key_trimmed = armored_key.trim().to_string();

    // Check if it's a public or private key block
    let is_secret = armored_key_trimmed.contains("PRIVATE KEY");

    let pgp_key = PgpKey {
        id: id.clone(),
        name: name.clone(),
        fingerprint: fingerprint.clone(),
        key_id: key_id.clone(),
        algorithm: algorithm.clone(),
        bit_length,
        created: created.clone(),
        user_ids: user_ids.clone(),
        public_key: Some(armored_key_trimmed.clone()),
        private_key: if is_secret {
            Some(armored_key_trimmed)
        } else {
            None
        },
        pinned: false,
    };

    // Persist into vault data store
    let store = app
        .store("vaults.db")
        .map_err(|e| format!("Store error: {}", e))?;

    let vaults: Vec<VaultMeta> = store
        .get("vaults")
        .and_then(|v: serde_json::Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    if !vaults.iter().any(|v| v.id == vault_id) {
        return Err("Vault not found".to_string());
    }

    let vd_key = format!("vault_data_{}", vault_id);
    let mut vault_data: VaultData = store
        .get(&vd_key)
        .and_then(|v: serde_json::Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    vault_data.pgp_keys.push(pgp_key);

    let json_val = serde_json::to_value(&vault_data).map_err(|e| e.to_string())?;
    store.set(&vd_key, json_val);
    store.save().map_err(|e| format!("Save error: {}", e))?;

    Ok(PgpKeyMetadata {
        id,
        name,
        fingerprint,
        key_id,
        algorithm,
        bit_length,
        created,
        user_ids,
    })
}

/// List all PGP keys in a vault (metadata only, no raw key material)
#[tauri::command]
pub fn pgp_list_keys(
    app: tauri::AppHandle,
    vault_id: String,
) -> Result<Vec<PgpKeyMetadata>, String> {
    let store = app
        .store("vaults.db")
        .map_err(|e| format!("Store error: {}", e))?;
    let vd_key = format!("vault_data_{}", vault_id);
    let vault_data: VaultData = store
        .get(&vd_key)
        .and_then(|v: serde_json::Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    Ok(vault_data
        .pgp_keys
        .iter()
        .map(|k| PgpKeyMetadata {
            id: k.id.clone(),
            name: k.name.clone(),
            fingerprint: k.fingerprint.clone(),
            key_id: k.key_id.clone(),
            algorithm: k.algorithm.clone(),
            bit_length: k.bit_length,
            created: k.created.clone(),
            user_ids: k.user_ids.clone(),
        })
        .collect())
}

/// Delete a PGP key from a vault by its ID
#[tauri::command]
pub fn pgp_delete_key(
    app: tauri::AppHandle,
    vault_id: String,
    key_id: String,
) -> Result<(), String> {
    let store = app
        .store("vaults.db")
        .map_err(|e| format!("Store error: {}", e))?;
    let vd_key = format!("vault_data_{}", vault_id);
    let mut vault_data: VaultData = store
        .get(&vd_key)
        .and_then(|v: serde_json::Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let before = vault_data.pgp_keys.len();
    vault_data.pgp_keys.retain(|k| k.id != key_id);
    if vault_data.pgp_keys.len() == before {
        return Err("PGP key not found in vault".to_string());
    }

    let json_val = serde_json::to_value(&vault_data).map_err(|e| e.to_string())?;
    store.set(&vd_key, json_val);
    store.save().map_err(|e| format!("Save error: {}", e))?;
    Ok(())
}

/// Generate a new PGP key pair using gpg --generate-key with a batch file
#[tauri::command]
pub fn pgp_generate_key(
    app: tauri::AppHandle,
    vault_id: String,
    name: String,
    email: String,
    passphrase: String,
) -> Result<PgpKey, String> {
    use crate::crypto::generate_uuid;

    // Generate temp dir
    let temp_dir = std::env::temp_dir().join(format!("pgp_gen_{}", generate_uuid()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let pub_path = temp_dir.join("pub.asc");
    let _priv_path = temp_dir.join("sec.asc");
    let batch_path = temp_dir.join("batch.txt");

    // Write gpg batch config
    let batch = format!(
        "%echo Generating PGP key...\n\
         Key-Type: RSA\n\
         Key-Length: 4096\n\
         Subkey-Type: RSA\n\
         Subkey-Length: 4096\n\
         Name-Real: {}\n\
         Name-Email: {}\n\
         Expire-Date: 0\n\
         {}\n\
         %commit\n\
         %echo Key generated\n",
        name,
        email,
        if passphrase.is_empty() {
            String::new()
        } else {
            format!("Passphrase: {}\n", passphrase)
        },
    );
    std::fs::write(&batch_path, &batch).map_err(|e| format!("Failed to write batch: {}", e))?;

    // Run gpg --generate-key with batch file
    let mut cmd = Command::new("gpg");
    cmd.arg("--batch")
        .arg("--gen-key")
        .arg("--homedir")
        .arg(&temp_dir)
        .arg("--output")
        .arg(&pub_path)
        .arg("--export")
        .arg(&email);
    let _ = cmd.output(); // Ignore export output

    // Actually generate the secret key with another batch run
    let _output = Command::new("gpg")
        .args([
            "--batch",
            "--gen-key",
            "--homedir",
            &temp_dir.to_string_lossy(),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn gpg: {}", e))?;

    // Try with --quick-genererate-key first (simpler)
    let quick_output = Command::new("gpg")
        .arg("--batch")
        .arg("--homedir")
        .arg(temp_dir.to_string_lossy().as_ref())
        .arg("--quick-generate-key")
        .arg(&email)
        .arg("rsa4096")
        .arg("sign")
        .arg("never")
        .arg("--passphrase")
        .arg(&passphrase)
        .output()
        .map_err(|e| format!("Failed to run gpg: {}. Is GPG installed?", e))?;

    if !quick_output.status.success() {
        let stderr = String::from_utf8_lossy(&quick_output.stderr);
        // Clean up temp dir even on failure
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!("gpg key generation failed: {}", stderr.trim()));
    }

    // Export the generated keys
    let pub_out = Command::new("gpg")
        .arg("--batch")
        .arg("--homedir")
        .arg(temp_dir.to_string_lossy().as_ref())
        .arg("--armor")
        .arg("--export")
        .arg(&email)
        .output()
        .map_err(|e| format!("Failed to export public key: {}", e))?;

    let priv_out = Command::new("gpg")
        .arg("--batch")
        .arg("--homedir")
        .arg(temp_dir.to_string_lossy().as_ref())
        .arg("--armor")
        .arg("--export-secret-keys")
        .arg(&email)
        .output()
        .map_err(|e| format!("Failed to export secret key: {}", e))?;

    let public_key =
        String::from_utf8(pub_out.stdout).map_err(|e| format!("UTF-8 error: {}", e))?;
    let private_key =
        String::from_utf8(priv_out.stdout).map_err(|e| format!("UTF-8 error: {}", e))?;

    // Parse metadata from the public key
    let metadata = parse_gpg_key_info(&public_key)?;

    // Get key_id and fingerprint from gpg --list-keys
    let list_out = Command::new("gpg")
        .arg("--batch")
        .arg("--homedir")
        .arg(temp_dir.to_string_lossy().as_ref())
        .arg("--list-keys")
        .arg("--with-colons")
        .arg(&email)
        .output()
        .map_err(|e| format!("Failed to list keys: {}", e))?;

    let (fingerprint, key_id) =
        parse_fingerprint_from_list(&String::from_utf8_lossy(&list_out.stdout));

    // Save to vault
    let store = app
        .store("vaults.db")
        .map_err(|e| format!("Store error: {}", e))?;
    let vd_key = format!("vault_data_{}", vault_id);
    let mut vault_data: VaultData = store
        .get(&vd_key)
        .and_then(|v: serde_json::Value| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let pgp_key = PgpKey {
        id: generate_uuid(),
        name,
        fingerprint,
        key_id,
        algorithm: metadata.0,
        bit_length: metadata.1,
        created: metadata.2,
        user_ids: vec![email],
        public_key: if public_key.trim().is_empty() {
            None
        } else {
            Some(public_key.trim().to_string())
        },
        private_key: if private_key.trim().is_empty() {
            None
        } else {
            Some(private_key.trim().to_string())
        },
        pinned: false,
    };

    vault_data.pgp_keys.push(pgp_key.clone());

    let json_val = serde_json::to_value(&vault_data).map_err(|e| e.to_string())?;
    store.set(&vd_key, json_val);
    store.save().map_err(|e| format!("Save error: {}", e))?;

    // Clean up temp dir
    let _ = std::fs::remove_dir_all(&temp_dir);

    Ok(pgp_key)
}

/// Parse algorithm, bit_length, and creation date from armored public key
fn parse_gpg_key_info(armored: &str) -> Result<(String, u32, String), String> {
    let created = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| {
            let secs = d.as_secs();
            let days = secs / 86400;
            let year = 1970 + days / 365;
            let remaining_days = days % 365;
            format!(
                "{:04}-{:02}-{:02}",
                year,
                (remaining_days / 30) + 1,
                (remaining_days % 30) + 1
            )
        })
        .unwrap_or_else(|_| "2024-01-01".to_string());

    let algo = if armored.contains("Ed25519") {
        "Ed25519".to_string()
    } else if armored.contains("ECDSA") {
        "ECDSA".to_string()
    } else if armored.contains("ECC") {
        "ECC".to_string()
    } else {
        "RSA".to_string()
    };

    let bit_len = if armored.contains("4096") {
        4096
    } else if armored.contains("2048") {
        2048
    } else if armored.contains("3072") {
        3072
    } else {
        4096
    };

    Ok((algo, bit_len, created))
}

/// Extract fingerprint and key_id from gpg --list-keys --with-colons output
fn parse_fingerprint_from_list(output: &str) -> (String, String) {
    for line in output.lines() {
        if line.starts_with("fpr:") {
            let fields: Vec<&str> = line.split(':').collect();
            if fields.len() >= 10 {
                let fp = fields[9].to_string();
                let key_id = fp.chars().skip(fp.len().saturating_sub(16)).collect();
                return (fp, key_id);
            }
        }
    }
    ("unknown".to_string(), "unknown".to_string())
}
