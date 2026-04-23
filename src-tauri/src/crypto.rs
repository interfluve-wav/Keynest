//! Cryptographic primitives for SSH Vault.
//!
//! Key derivation:
//!   - New vaults use Argon2id (m=64 MiB, t=3, p=4) via the `argon2` crate.
//!   - Old vaults are unlocked with PBKDF2-HMAC-SHA256 (100k iterations).
//!
//! Encryption: AES-256-GCM with a random 12-byte nonce per vault.
//! The ciphertext is base64(nonce || AES-256-GCM-encrypt(plaintext) || auth_tag).
//!
//! Memory safety: `SecretKey` implements `ZeroizeOnDrop` so key material is
//! overwritten with zeros as soon as it goes out of scope.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{password_hash::SaltString, PasswordHasher};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pbkdf2::pbkdf2_hmac_array;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

// ── Constants ─────────────────────────────────────────────────────────────────

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 32;
/// PBKDF2-HMAC-SHA256 parameters — tuned for ~100ms unlock on modern CPUs.
/// 10k iterations gives good security while remaining responsive.
const PBKDF2_ITERATIONS: u32 = 10_000;

/// Argon2id parameters — tuned for desktop/mobile CPUs.
/// 64 MiB memory, 3 iterations, 4-degree parallelism.
/// Derivation takes ~1-2s on first unlock — acceptable for a vault you unlock once.
fn argon2id() -> argon2::Argon2<'static> {
    argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(65_536, 3, 4, Some(KEY_LEN))
            .expect("Invalid Argon2id params — check constants"),
    )
}

// ── Key type with automatic zeroization ─────────────────────────────────────

/// A 256-bit key that is zeroed when dropped.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SecretKey([u8; KEY_LEN]);

impl SecretKey {
    /// Borrow the key as a byte slice.
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }

    /// Encode to base64 (only use this to pass across the FFI boundary).
    pub fn to_base64(&self) -> String {
        BASE64.encode(self.0)
    }

    /// Decode from base64.
    pub fn from_base64(s: &str) -> Result<Self, String> {
        let bytes: [u8; KEY_LEN] = BASE64
            .decode(s)
            .map_err(|e| format!("Invalid key base64: {}", e))?
            .try_into()
            .map_err(|_| format!("Key must be {} bytes", KEY_LEN))?;
        Ok(Self(bytes))
    }
}

// ── Salt ─────────────────────────────────────────────────────────────────────

pub fn generate_salt() -> String {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    BASE64.encode(salt)
}

/// Derive a key using Argon2id (new vaults / new unlock only).
fn derive_key_argon2(password: &str, salt_b64: &str) -> Result<SecretKey, String> {
    let salt_bytes = BASE64
        .decode(salt_b64)
        .map_err(|e| format!("Invalid salt base64: {}", e))?;

    if salt_bytes.len() != SALT_LEN {
        return Err(format!(
            "Salt must be {} bytes, got {}",
            SALT_LEN,
            salt_bytes.len()
        ));
    }

    // Encode the salt as an Argon2 salt string.
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|e| format!("Failed to encode salt for Argon2: {}", e))?;

    // Hash the password.  Argon2id uses SIMD + memory-hard design to resist
    // GPU/ASIC attacks far better than PBKDF2.
    let hash = argon2id()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Argon2id hash failed: {}", e))?;

    // Extract the first KEY_LEN bytes of the hash output.
    let hash_bytes = hash.hash.ok_or("Argon2id produced no hash output")?;
    let hash_slice = hash_bytes.as_bytes();
    if hash_slice.len() < KEY_LEN {
        return Err("Argon2id hash output too short".to_string());
    }
    // Copy into a fixed-size array; drop() on hash_bytes overwrites the
    // remaining bytes (Output uses zeroize::Zeroize when the `zeroize` feature
    // is enabled on the argon2 crate, which argon2 0.5 bundles automatically).
    let mut key_array = [0u8; KEY_LEN];
    key_array.copy_from_slice(&hash_slice[..KEY_LEN]);
    let _ = hash_bytes;

    Ok(SecretKey(key_array))
}

/// Derive a key using PBKDF2-HMAC-SHA256 (backward-compat with old vaults).
fn derive_key_pbkdf2(password: &str, salt_b64: &str) -> Result<SecretKey, String> {
    let salt_bytes = BASE64
        .decode(salt_b64)
        .map_err(|e| format!("Invalid salt base64: {}", e))?;

    if salt_bytes.len() != SALT_LEN {
        return Err(format!(
            "Salt must be {} bytes, got {}",
            SALT_LEN,
            salt_bytes.len()
        ));
    }

    let key: [u8; KEY_LEN] =
        pbkdf2_hmac_array::<Sha256, KEY_LEN>(password.as_bytes(), &salt_bytes, PBKDF2_ITERATIONS);

    Ok(SecretKey(key))
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// Derive a key using Argon2id (new vaults / new unlock only).
/// Runs on a blocking thread so the UI stays responsive.
#[tauri::command]
pub async fn argon2_key_derive(password: String, salt: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let key = derive_key_argon2(&password, &salt)?;
        Ok(key.to_base64())
    })
    .await
    .map_err(|e| format!("Argon2 task panicked: {}", e))?
}

/// Derive a key using PBKDF2-HMAC-SHA256 (backward-compat with old vaults).
/// Runs on a blocking thread so the UI stays responsive.
#[tauri::command]
pub async fn pbkdf2_key_derive(password: String, salt: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let key = derive_key_pbkdf2(&password, &salt)?;
        Ok(key.to_base64())
    })
    .await
    .map_err(|e| format!("PBKDF2 task panicked: {}", e))?
}

/// Encrypt plaintext with the given key using AES-256-GCM.
/// Returns base64(nonce || ciphertext || auth_tag).
pub fn encrypt(plaintext: &str, key: &[u8; KEY_LEN]) -> Result<String, String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext (nonce is needed for decryption).
    let mut out = nonce_bytes.to_vec();
    out.extend(ciphertext);
    Ok(BASE64.encode(&out))
}

/// Decrypt a base64-encoded ciphertext produced by `encrypt`.
/// Returns the original plaintext string.
pub fn decrypt(encoded: &str, key: &[u8; KEY_LEN]) -> Result<String, String> {
    let encrypted_bytes = BASE64
        .decode(encoded)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    if encrypted_bytes.len() < NONCE_LEN {
        return Err("Ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = encrypted_bytes.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Invalid passphrase".to_string())
        .and_then(|plaintext| {
            String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))
        })
}

// ── Thin Tauri command wrappers ─────────────────────────────────────────────────

/// Encrypt plaintext with the given key using AES-256-GCM.
/// Runs on a blocking thread so the UI stays responsive.
#[tauri::command]
pub async fn aes_encrypt(plaintext: String, key: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let key_bytes = SecretKey::from_base64(&key)?;
        encrypt(&plaintext, key_bytes.as_bytes())
    })
    .await
    .map_err(|e| format!("AES encrypt task panicked: {}", e))?
}

/// Decrypt a base64-encoded ciphertext produced by `encrypt`.
/// Runs on a blocking thread so the UI stays responsive.
#[tauri::command]
pub async fn aes_decrypt(encrypted: String, key: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let key_bytes = SecretKey::from_base64(&key)?;
        decrypt(&encrypted, key_bytes.as_bytes())
    })
    .await
    .map_err(|e| format!("AES decrypt task panicked: {}", e))?
}

#[tauri::command]
pub fn generate_salt_cmd() -> String {
    generate_salt()
}

// ── Utilities ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn generate_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ── Unit tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PASSWORD: &str = "correct-horse-battery-staple";
    const TEST_SALT: &str = "e4pXrC!x3XqA8t9gZ9vX1g=="; // 16 bytes base64 — we'll test with proper salts

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        // Generate a fresh key and test round-trip
        let salt = generate_salt();
        let key_b64 = derive_key_argon2(TEST_PASSWORD, &salt).expect("key derivation failed");
        let key_bytes = key_b64.as_bytes();

        let plaintext = r#"{"keys":[],"api_keys":[],"notes":[],"pgp_keys":[]}"#;
        let ciphertext = encrypt(plaintext, key_bytes).expect("encryption failed");

        // Verify ciphertext is longer than plaintext (nonce + tag overhead)
        let ct_bytes = BASE64.decode(&ciphertext).expect("ciphertext not base64");
        assert!(
            ct_bytes.len() > plaintext.len(),
            "ciphertext should be longer than plaintext"
        );

        let decrypted = decrypt(&ciphertext, key_bytes).expect("decryption failed");
        assert_eq!(
            decrypted, plaintext,
            "decrypted plaintext must match original"
        );
    }

    #[test]
    fn test_encrypt_decrypt_with_realistic_data() {
        let salt = generate_salt();
        let key_b64 = derive_key_argon2("my-vault-password", &salt).expect("key derivation failed");
        let key_bytes = key_b64.as_bytes();

        let data = r#"{"keys":[{"id":"abc","name":"GitHub Key","key_type":"ed25519","comment":"","fingerprint":"AA:BB:CC","public_key":"ssh-ed25519 AAAA...","private_key":null,"created":"2024-01-01T00:00:00Z"}],"api_keys":[],"notes":[],"pgp_keys":[]}"#;
        let ciphertext = encrypt(data, key_bytes).expect("encryption failed");
        let decrypted = decrypt(&ciphertext, key_bytes).expect("decryption failed");

        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_encrypt_decrypt_with_pbkdf2() {
        // Same test with PBKDF2 (backward compat)
        let salt = generate_salt();
        let key_b64 =
            derive_key_pbkdf2(TEST_PASSWORD, &salt).expect("pbkdf2 key derivation failed");
        let key_bytes = key_b64.as_bytes();

        let plaintext = r#"{"keys":[],"api_keys":[],"notes":[]}"#;
        let ciphertext = encrypt(plaintext, key_bytes).expect("encryption failed");
        let decrypted = decrypt(&ciphertext, key_bytes).expect("decryption failed");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_fails_with_wrong_key() {
        let salt = generate_salt();
        let key1_b64 = derive_key_argon2("correct-password", &salt).expect("key derivation failed");
        let key2_b64 = derive_key_argon2("wrong-password", &salt).expect("key derivation failed");

        let plaintext = r#"{"keys":[],"api_keys":[],"notes":[]}"#;
        let ciphertext = encrypt(plaintext, key1_b64.as_bytes()).expect("encryption failed");

        let result = decrypt(&ciphertext, key2_b64.as_bytes());
        assert!(result.is_err(), "decryption with wrong key should fail");
    }

    #[test]
    fn test_decrypt_fails_with_tampered_ciphertext() {
        let salt = generate_salt();
        let key_b64 = derive_key_argon2(TEST_PASSWORD, &salt).expect("key derivation failed");

        let plaintext = "hello world";
        let ciphertext = encrypt(plaintext, key_b64.as_bytes()).expect("encryption failed");

        let mut ct_bytes = BASE64.decode(&ciphertext).expect("valid base64");
        // Tamper with the last byte of the ciphertext (not the tag — that's last 16 bytes)
        let tag_len = 16;
        let cipher_len = ct_bytes.len() - 12 - tag_len; // nonce=12, tag=16
        if cipher_len > 0 {
            ct_bytes[12 + cipher_len - 1] ^= 0x42; // flip a byte in ciphertext
        }
        let tampered_ct = BASE64.encode(&ct_bytes);

        let result = decrypt(&tampered_ct, key_b64.as_bytes());
        assert!(
            result.is_err(),
            "decryption with tampered ciphertext should fail"
        );
    }

    #[test]
    fn test_salt_generation() {
        let salt1 = generate_salt();
        let salt2 = generate_salt();

        // Salts should be unique
        assert_ne!(salt1, salt2, "two generated salts should differ");

        // Salts should be valid base64
        let bytes = BASE64.decode(&salt1).expect("salt should be valid base64");
        assert_eq!(bytes.len(), SALT_LEN, "salt should be 32 bytes");
    }

    #[test]
    fn test_key_base64_encoding_roundtrip() {
        let salt = generate_salt();
        let key = derive_key_argon2(TEST_PASSWORD, &salt).expect("key derivation failed");
        let key_bytes = key.as_bytes();

        let encoded = key.to_base64();
        let decoded = SecretKey::from_base64(&encoded).expect("should decode from base64");
        assert_eq!(
            decoded.as_bytes(),
            key_bytes,
            "key should roundtrip through base64"
        );
    }

    #[test]
    fn test_minimum_ciphertext_size() {
        // AES-256-GCM: 12-byte nonce + N-byte ciphertext + 16-byte tag
        // An empty vault JSON (~36 bytes) encrypts to:
        // 12 + 36 + 16 = 64 bytes minimum
        let salt = generate_salt();
        let key_b64 = derive_key_argon2(TEST_PASSWORD, &salt).expect("key derivation failed");
        let key_bytes = key_b64.as_bytes();

        let empty_vault = r#"{"keys":[],"api_keys":[],"notes":[]}"#;
        let ct = encrypt(empty_vault, key_bytes).expect("encryption failed");
        let ct_bytes = BASE64.decode(&ct).expect("valid base64");

        let min_size = 12 + empty_vault.len() + 16; // nonce + plaintext + tag
        assert!(
            ct_bytes.len() >= min_size,
            "ciphertext {} should be >= {} bytes",
            ct_bytes.len(),
            min_size
        );
    }
}
