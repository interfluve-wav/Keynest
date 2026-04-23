use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoConfig {
    pub path: String,
    pub remote_url: Option<String>,
    pub ssh_key_path: Option<String>,
    pub has_ssh_config: bool,
}

/// Check if a directory is a git repository
#[tauri::command]
pub async fn git_is_repo(path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let git_dir = PathBuf::from(&path).join(".git");
        Ok(git_dir.exists())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Get git repository configuration
#[tauri::command]
pub async fn git_get_repo_config(path: String) -> Result<RepoConfig, String> {
    tokio::task::spawn_blocking(move || {
        let path_buf = PathBuf::from(&path);

        if !path_buf.join(".git").exists() {
            return Err("Not a git repository".to_string());
        }

        // Get remote URL
        let url_output = Command::new("git")
            .args(["-C", &path, "remote", "get-url", "origin"])
            .output()
            .ok();

        let remote_url = url_output.and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        });

        // Check for core.sshCommand config
        let ssh_output = Command::new("git")
            .args(["-C", &path, "config", "--local", "core.sshCommand"])
            .output()
            .ok();

        let ssh_key_path_val = ssh_output.and_then(|o| {
            if o.status.success() {
                let cmd = String::from_utf8_lossy(&o.stdout);
                cmd.split_whitespace()
                    .skip_while(|s| *s != "-i")
                    .nth(1)
                    .map(|s| s.to_string())
            } else {
                None
            }
        });

        Ok(RepoConfig {
            path,
            remote_url,
            ssh_key_path: ssh_key_path_val.clone(),
            has_ssh_config: ssh_key_path_val.is_some(),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Set SSH key for a specific git repository
/// Creates a wrapper script that uses the specified key
#[tauri::command]
pub async fn git_set_ssh_key(repo_path: String, key_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Set core.sshCommand to use specific key
        let ssh_cmd = format!("ssh -i '{}' -o IdentitiesOnly=yes", key_path);

        let output = Command::new("git")
            .args([
                "-C",
                &repo_path,
                "config",
                "--local",
                "core.sshCommand",
                &ssh_cmd,
            ])
            .output()
            .map_err(|e| format!("Failed to run git config: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git config failed: {}", stderr));
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Remove SSH key configuration from a git repository
#[tauri::command]
pub async fn git_remove_ssh_key(repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let output = Command::new("git")
            .args([
                "-C",
                &repo_path,
                "config",
                "--local",
                "--unset",
                "core.sshCommand",
            ])
            .output()
            .map_err(|e| format!("Failed to run git config: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // It's ok if the config doesn't exist (error code 5)
            if output.status.code() != Some(5) {
                return Err(format!("git config failed: {}", stderr));
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Export SSH key and configure git to use it
/// This combines export + git config in one atomic operation
#[tauri::command]
pub async fn git_setup_deploy_key(
    repo_path: String,
    private_key: String,
    key_name: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        // Create .ssh directory in repo if it doesn't exist
        let ssh_dir = PathBuf::from(&repo_path)
            .join(".git")
            .join("ssh-vault-keys");
        std::fs::create_dir_all(&ssh_dir)
            .map_err(|e| format!("Failed to create key directory: {}", e))?;

        // Save key
        let key_path = ssh_dir.join(&key_name);
        std::fs::write(&key_path, private_key.as_bytes())
            .map_err(|e| format!("Failed to write key: {}", e))?;

        // Set permissions
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

        // Configure git to use this key
        let key_path_str = key_path.to_string_lossy().to_string();
        let ssh_cmd = format!("ssh -i '{}' -o IdentitiesOnly=yes", key_path_str);

        let output = Command::new("git")
            .args([
                "-C",
                &repo_path,
                "config",
                "--local",
                "core.sshCommand",
                &ssh_cmd,
            ])
            .output()
            .map_err(|e| format!("Failed to run git config: {}", e))?;

        if !output.status.success() {
            let _ = std::fs::remove_file(&key_path);
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git config failed: {}", stderr));
        }

        Ok(key_path_str)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
