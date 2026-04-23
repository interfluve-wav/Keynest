use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct SshKeygenResult {
    pub public_key: String,
    pub private_key: String,
    pub fingerprint: String,
    pub key_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportedKey {
    pub name: String,
    pub key_type: String,
    pub public_key: String,
    pub private_key: Option<String>,
    pub fingerprint: String,
    pub comment: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentKey {
    pub fingerprint: String,
    pub key_type: String,
    pub comment: String,
    pub key_size: Option<usize>,
}

/// Generate a new SSH keypair using ssh-keygen (runs on blocking thread).
#[tauri::command]
pub async fn ssh_generate_key(
    _name: String,
    key_type: String,
    comment: String,
) -> Result<SshKeygenResult, String> {
    tokio::task::spawn_blocking(move || {
        let tmp_dir = std::env::temp_dir();
        let key_path = tmp_dir.join(format!("ssh_vault_{}", uuid::Uuid::new_v4()));
        let key_path_str = key_path.to_string_lossy().to_string();

        let key_type_arg = match key_type.as_str() {
            "ed25519" => "ed25519",
            "ecdsa" => "ecdsa",
            "rsa" => "rsa",
            _ => "ed25519",
        };

        let output = Command::new("ssh-keygen")
            .args([
                "-t",
                key_type_arg,
                "-f",
                &key_path_str,
                "-N",
                "",
                "-C",
                &comment,
            ])
            .output()
            .map_err(|e| format!("Failed to run ssh-keygen: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let private_key = std::fs::read_to_string(&key_path)
            .map_err(|e| format!("Failed to read private key: {}", e))?;

        let pub_key_path = format!("{}.pub", key_path_str);
        let public_key = std::fs::read_to_string(&pub_key_path)
            .map_err(|e| format!("Failed to read public key: {}", e))?;

        let fingerprint_output = Command::new("ssh-keygen")
            .args(["-lf", &pub_key_path])
            .output()
            .map_err(|e| format!("Failed to get fingerprint: {}", e))?;

        let fingerprint = if fingerprint_output.status.success() {
            String::from_utf8_lossy(&fingerprint_output.stdout)
                .split_whitespace()
                .nth(1)
                .unwrap_or("unknown")
                .to_string()
        } else {
            "unknown".to_string()
        };

        // Clean up temp files
        let _ = std::fs::remove_file(&key_path_str);
        let _ = std::fs::remove_file(&pub_key_path);

        Ok(SshKeygenResult {
            public_key: public_key.trim().to_string(),
            private_key: private_key.trim().to_string(),
            fingerprint,
            key_type: key_type_arg.to_string(),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub fn ssh_get_fingerprint(public_key: String) -> Result<String, String> {
    let tmp_file = std::env::temp_dir().join(format!("ssh_vault_pub_{}", uuid::Uuid::new_v4()));
    std::fs::write(&tmp_file, public_key.as_bytes())
        .map_err(|e| format!("Failed to write temp key: {}", e))?;

    let output = Command::new("ssh-keygen")
        .args(["-lf", &tmp_file.to_string_lossy()])
        .output()
        .map_err(|e| format!("Failed to run ssh-keygen: {}", e))?;

    let _ = std::fs::remove_file(&tmp_file);

    if !output.status.success() {
        return Err("Invalid public key".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.split_whitespace().collect();

    if parts.len() >= 3 {
        Ok(format!("{} {}", parts[1], parts[2]))
    } else {
        Err("Could not parse fingerprint".to_string())
    }
}

/// Scan ~/.ssh/ for existing key pairs and return them as ImportedKey structs.
#[tauri::command]
pub async fn ssh_import_keys() -> Result<Vec<ImportedKey>, String> {
    tokio::task::spawn_blocking(|| {
        let home = dirs_home()?;
        let ssh_dir = home.join(".ssh");

        if !ssh_dir.exists() {
            return Ok(Vec::new());
        }

        let entries =
            std::fs::read_dir(&ssh_dir).map_err(|e| format!("Cannot read ~/.ssh: {}", e))?;

        let mut results: Vec<ImportedKey> = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if name.ends_with(".pub")
                || name.starts_with('.')
                || name == "known_hosts"
                || name == "known_hosts.old"
                || name == "authorized_keys"
                || name == "config"
            {
                continue;
            }

            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            if !content.starts_with("-----BEGIN") {
                continue;
            }

            let key_type = if content.contains("OPENSSH") {
                if content.contains("EC") {
                    "ECDSA".to_string()
                } else if content.contains("RSA") {
                    "RSA".to_string()
                } else {
                    "Ed25519".to_string()
                }
            } else if content.contains("RSA PRIVATE") {
                "RSA".to_string()
            } else if content.contains("EC PRIVATE") {
                "ECDSA".to_string()
            } else {
                "Unknown".to_string()
            };

            let private_key = content.trim().to_string();

            let pub_path = path.with_extension("pub");
            let (public_key, fingerprint, comment) = if pub_path.exists() {
                let pub_content = std::fs::read_to_string(&pub_path).unwrap_or_default();
                let pub_line = pub_content.trim().to_string();
                let parts: Vec<&str> = pub_line.splitn(3, ' ').collect();
                let comment = parts.get(2).unwrap_or(&"").to_string();
                let fp =
                    get_fingerprint_for_pub(&pub_path).unwrap_or_else(|| "unknown".to_string());
                (pub_line, fp, comment)
            } else {
                (String::new(), "unknown".to_string(), String::new())
            };

            if seen_names.insert(name.clone()) {
                results.push(ImportedKey {
                    name,
                    key_type,
                    public_key,
                    private_key: Some(private_key),
                    fingerprint,
                    comment,
                });
            }
        }

        Ok(results)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

fn dirs_home() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "$HOME not set".to_string())
}

fn get_fingerprint_for_pub(pub_path: &Path) -> Option<String> {
    let output = Command::new("ssh-keygen")
        .args(["-lf", &pub_path.to_string_lossy()])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.split_whitespace().nth(1).map(|s| s.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// SSH Agent Integration
// ─────────────────────────────────────────────────────────────────────────────

/// List all keys currently loaded in ssh-agent
#[tauri::command]
pub async fn ssh_agent_list() -> Result<Vec<AgentKey>, String> {
    tokio::task::spawn_blocking(|| {
        let output = Command::new("ssh-add")
            .arg("-l")
            .output()
            .map_err(|e| format!("Failed to run ssh-add: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("The agent has no identities") || output.status.code() == Some(1) {
                return Ok(Vec::new());
            }
            if stderr.contains("Connection refused") || output.status.code() == Some(2) {
                return Ok(Vec::new());
            }
            return Err(format!("ssh-add failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut keys = Vec::new();

        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                let key_size = parts[0].parse::<usize>().ok();
                let fingerprint = parts[1].to_string();
                let type_part = parts.last().unwrap_or(&"");
                let key_type = type_part
                    .trim_start_matches('(')
                    .trim_end_matches(')')
                    .to_string();
                let comment = parts[2..parts.len() - 1].join(" ");

                keys.push(AgentKey {
                    fingerprint,
                    key_type,
                    comment,
                    key_size,
                });
            }
        }

        Ok(keys)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Add a key to ssh-agent
#[tauri::command]
pub async fn ssh_agent_add(
    private_key: String,
    lifetime_seconds: Option<u32>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let tmp_dir = std::env::temp_dir();
        let key_path = tmp_dir.join(format!("ssh_agent_add_{}", uuid::Uuid::new_v4()));

        std::fs::write(&key_path, private_key.as_bytes())
            .map_err(|e| format!("Failed to write temp key: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&key_path)
                .map_err(|e| format!("Failed to read metadata: {}", e))?
                .permissions();
            perms.set_mode(0o600);
            std::fs::set_permissions(&key_path, perms)
                .map_err(|e| format!("Failed to set permissions: {}", e))?;
        }

        let mut cmd = Command::new("ssh-add");
        if let Some(lifetime) = lifetime_seconds {
            cmd.args(["-t", &lifetime.to_string()]);
        }
        cmd.arg(&key_path);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run ssh-add: {}", e))?;

        let _ = std::fs::remove_file(&key_path);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to add key: {}", stderr));
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Remove a key from ssh-agent by fingerprint
#[tauri::command]
pub async fn ssh_agent_remove(fingerprint: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let list_output = Command::new("ssh-add")
            .arg("-l")
            .output()
            .map_err(|e| format!("Failed to list keys: {}", e))?;

        if !list_output.status.success() {
            return Err("Could not list agent keys".to_string());
        }

        let stdout = String::from_utf8_lossy(&list_output.stdout);
        let mut found_file: Option<String> = None;

        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 && parts[1] == fingerprint {
                let comment_parts = &parts[2..parts.len() - 1];
                let comment = comment_parts.join(" ");
                found_file = Some(comment);
                break;
            }
        }

        if found_file.is_none() {
            return Err(format!(
                "Key with fingerprint {} not found in agent",
                fingerprint
            ));
        }

        let output = Command::new("ssh-add")
            .args(["-d", &found_file.unwrap()])
            .output()
            .map_err(|e| format!("Failed to run ssh-add -d: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to remove key: {}", stderr));
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Remove all keys from ssh-agent
#[tauri::command]
pub async fn ssh_agent_clear() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        let output = Command::new("ssh-add")
            .arg("-D")
            .output()
            .map_err(|e| format!("Failed to run ssh-add -D: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to clear agent: {}", stderr));
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ─────────────────────────────────────────────────────────────────────────────
// SSH Key Export
// ─────────────────────────────────────────────────────────────────────────────

/// Export SSH key to filesystem
#[tauri::command]
pub async fn ssh_export_key(
    private_key: String,
    public_key: Option<String>,
    path: String,
    passphrase: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path_buf = PathBuf::from(&path);

        if let Some(parent) = path_buf.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        let key_to_write = if let Some(pass) = passphrase {
            let tmp_path =
                std::env::temp_dir().join(format!("ssh_export_{}", uuid::Uuid::new_v4()));
            std::fs::write(&tmp_path, private_key.as_bytes())
                .map_err(|e| format!("Failed to write temp file: {}", e))?;

            let output = Command::new("ssh-keygen")
                .args(["-p", "-f", &tmp_path.to_string_lossy(), "-N", &pass])
                .output()
                .map_err(|e| format!("Failed to run ssh-keygen: {}", e))?;

            if !output.status.success() {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(format!(
                    "Failed to encrypt key: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            let encrypted = std::fs::read_to_string(&tmp_path)
                .map_err(|e| format!("Failed to read encrypted key: {}", e))?;
            let _ = std::fs::remove_file(&tmp_path);
            encrypted
        } else {
            private_key
        };

        std::fs::write(&path, key_to_write.as_bytes())
            .map_err(|e| format!("Failed to write private key: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&path)
                .map_err(|e| format!("Failed to read metadata: {}", e))?
                .permissions();
            perms.set_mode(0o600);
            std::fs::set_permissions(&path, perms)
                .map_err(|e| format!("Failed to set permissions: {}", e))?;
        }

        if let Some(pub_key) = public_key {
            let pub_path = format!("{}.pub", path);
            std::fs::write(&pub_path, pub_key.as_bytes())
                .map_err(|e| format!("Failed to write public key: {}", e))?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&pub_path)
                    .map_err(|e| format!("Failed to read metadata: {}", e))?
                    .permissions();
                perms.set_mode(0o644);
                std::fs::set_permissions(&pub_path, perms)
                    .map_err(|e| format!("Failed to set permissions: {}", e))?;
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
