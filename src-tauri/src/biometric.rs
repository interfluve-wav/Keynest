// biometric.rs - Touch ID biometric authentication with Keychain storage
// Uses the native macOS `security` CLI for reliable keychain access during dev builds.
use serde::{Deserialize, Serialize};

/// Biometric authentication status response
#[derive(Debug, Serialize, Deserialize)]
pub struct BiometricStatus {
    pub available: bool,
    pub enrolled: bool,
}

/// Returns the path to the biometric marker file for a vault.
fn biometric_marker_path(vault_id: &str) -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".ssh")
        .join(format!(".ssh-vault-{}.biometric", vault_id))
}

/// Returns the path to the user's login keychain.
fn login_keychain_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Library/Keychains/login.keychain-db")
}

// ── Keychain helpers via `security` CLI ──────────────────────────────────────

/// Store a secret in the macOS login Keychain under service "SSH Vault".
fn keychain_store(service: &str, account: &str, secret: &str) -> Result<(), String> {
    keychain_store_inner(service, account, secret, 0)
}

fn keychain_store_inner(
    service: &str,
    account: &str,
    secret: &str,
    attempt: u8,
) -> Result<(), String> {
    if attempt > 2 {
        return Err("Failed to store keychain item after multiple attempts".into());
    }

    let keychain = login_keychain_path();
    let output = std::process::Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            account,
            "-s",
            service,
            "-w",
            secret,
            // keychain path is a bare positional argument at the end
            keychain.to_str().unwrap_or("login.keychain-db"),
        ])
        .output()
        .map_err(|e| format!("Failed to run security add-generic-password: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If item already exists, delete and retry
        if stderr.contains("already exists") && attempt == 0 {
            let _ = keychain_delete(service, account);
            return keychain_store_inner(service, account, secret, attempt + 1);
        }
        return Err(format!(
            "security add-generic-password failed: {}",
            stderr.trim()
        ));
    }
    Ok(())
}

/// Retrieve a secret from the macOS login Keychain.
fn keychain_retrieve(service: &str, account: &str) -> Result<Option<String>, String> {
    let keychain = login_keychain_path();
    let output = std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            account,
            "-s",
            service,
            "-w",
            keychain.to_str().unwrap_or("login.keychain-db"),
        ])
        .output()
        .map_err(|e| format!("Failed to run security find-generic-password: {}", e))?;

    if !output.status.success() {
        // "The specified item could not be found in the keychain." — treat as missing
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("could not be found") || stderr.contains("No entry") {
            return Ok(None);
        }
        return Err(format!(
            "security find-generic-password failed: {}",
            stderr.trim()
        ));
    }

    let secret = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if secret.is_empty() {
        return Ok(None);
    }
    Ok(Some(secret))
}

/// Delete a secret from the macOS login Keychain.
fn keychain_delete(service: &str, account: &str) -> Result<(), String> {
    let keychain = login_keychain_path();
    let output = std::process::Command::new("security")
        .args([
            "delete-generic-password",
            "-a",
            account,
            "-s",
            service,
            keychain.to_str().unwrap_or("login.keychain-db"),
        ])
        .output()
        .map_err(|e| format!("Failed to run security delete-generic-password: {}", e))?;

    // 0 = deleted, 44 = "item not found" — both are fine
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("item could not be found") {
            return Err(format!(
                "security delete-generic-password failed: {}",
                stderr.trim()
            ));
        }
    }
    Ok(())
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Store vault key in macOS Keychain with biometric protection.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn biometric_store_key(vault_id: String, key: String) -> Result<(), String> {
    // Store the encryption key in the login keychain
    keychain_store("SSH Vault", &vault_id, &key)?;

    // Create marker file so unlock can detect "setup complete" without prompting Touch ID
    let marker_path = biometric_marker_path(&vault_id);
    std::fs::write(&marker_path, "1")
        .map_err(|e| format!("Failed to create marker file: {}", e))?;

    Ok(())
}

/// Retrieve vault key from macOS Keychain using biometric authentication.
/// Returns None if no key is stored; returns the key if stored (biometric unlock
/// handles the Touch ID prompt separately via LAContext).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn biometric_retrieve_key(vault_id: String) -> Result<Option<String>, String> {
    keychain_retrieve("SSH Vault", &vault_id)
}

/// Delete stored key and marker from Keychain and filesystem.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn biometric_delete_key(vault_id: String) -> Result<(), String> {
    keychain_delete("SSH Vault", &vault_id)?;

    // Also remove the marker file
    let marker_path = biometric_marker_path(&vault_id);
    let _ = std::fs::remove_file(&marker_path);

    Ok(())
}

/// Check if biometric authentication is available on this device.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn biometric_available() -> Result<bool, String> {
    use objc2_local_authentication::{LAContext, LAPolicy};

    let context = unsafe { LAContext::new() };

    match unsafe {
        context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
    } {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Authenticate user with Touch ID and then retrieve the stored key.
/// Uses the keychain as the source of truth — if a key is stored, Touch ID
/// is prompted; if not, falls back to password unlock silently.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn biometric_unlock(vault_id: String, reason: String) -> Result<Option<String>, String> {
    // Keychain is the source of truth. Check if a key exists before prompting
    // Touch ID so we don't bother the user when biometric was never set up.
    let stored_key = match keychain_retrieve("SSH Vault", &vault_id)? {
        Some(key) => key,
        None => return Ok(None), // No key stored — fall back to password
    };

    // Key exists — prompt Touch ID to verify the user's identity.
    use block2::StackBlock;
    use objc2::runtime::Bool as ObjcBool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc;

    let context = unsafe { LAContext::new() };

    if unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
            .is_err()
    } {
        return Err("Biometry not available".into());
    }

    let ns_reason = NSString::from_str(&reason);
    let (tx, rx) = mpsc::channel();

    let block = StackBlock::new(move |success: ObjcBool, _error: *mut NSError| {
        let _ = tx.send(success.as_bool());
    });

    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &ns_reason,
            &block,
        );
    }

    match rx.recv_timeout(std::time::Duration::from_secs(60)) {
        Ok(true) => Ok(Some(stored_key)),
        Ok(false) => Err("Biometric authentication failed".into()),
        Err(_) => Err("Biometric authentication timed out".into()),
    }
}

// ── Non-macOS stubs ───────────────────────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn biometric_available() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn biometric_store_key(_vault_id: String, _key: String) -> Result<(), String> {
    Err("Biometric storage not available".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn biometric_retrieve_key(_vault_id: String) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn biometric_delete_key(_vault_id: String) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn biometric_unlock(_vault_id: String, _reason: String) -> Result<Option<String>, String> {
    Err("Biometric unlock not available".into())
}
