# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SSH Vault Tauri** is a native macOS application for securely managing SSH keys, API credentials, and PGP keys with Touch ID biometric authentication. It's a Tauri 2.0 app with a React + TypeScript frontend and Rust backend.

**Tech Stack:**
- Frontend: React 18, TypeScript, Vite 6, Tailwind CSS, Zustand (state), Lucide React (icons)
- Backend: Rust (edition 2021), Tauri 2.2, aes-gcm, pbkdf2, argon2 (password hashing)
- Platform: macOS only (uses Touch ID via LocalAuthentication)

**Security Model:**
- AES-256-GCM encryption with PBKDF2 (legacy) or Argon2id (new vaults)
- Local-only storage in `~/Library/Application Support/com.sshvault.desktop/`
- Touch ID via macOS Keychain for passwordless unlock
- Vault files stored in `~/.ssh-vault/{vault_id}.json` (encrypted)

## Common Development Commands

### Frontend
```bash
npm install              # Install dependencies
npm run dev              # Start Vite dev server at http://localhost:1420
npm run build            # TypeScript check + Vite production build to ./dist
npm run preview          # Preview production build locally
```

### Backend (Rust/Tauri)
```bash
cd src-tauri
cargo check              # Quick compile check (no linking)
cargo build              # Debug build to target/debug/
cargo build --release    # Optimized release build to target/release/
cargo test               # Run Rust unit tests
cargo clippy             # Lint Rust code
cargo fmt                # Format Rust code
```

### Full App Development
```bash
npm run tauri dev        # Start dev mode (frontend + Tauri app)
npm run tauri build      # Build the Tauri app bundle
```

**Note:** `npm run build` runs TypeScript compiler first, then Vite. The Tauri dev command (`npm run tauri dev`) is the primary workflow — it starts the Vite dev server and launches the native app with hot-reload.

## Code Architecture

### Frontend (`src/`)

**Entry point:** `src/main.tsx` — renders `<App />` into `#root`

**State management:** `src/lib/store.ts` — single Zustand store (`useVaultStore`) holding:
- `currentVault`, `vaultData`, `encryptionKey`, `isUnlocked`
- `settings` (from backend), `agentKeys` (ssh-agent state)
- Auto-lock timer via `lastActivity` + `autoLockMinutes`
- CRUD for Notes, analytics tracking for SSH keys (copy count, last used)

**API layer:** `src/lib/api.ts` — all Tauri `invoke()` calls, grouped by domain:
- Vault management (list/save/load/delete/check integrity/export/import)
- Crypto (argon2/pbkdf2 key derivation, aes encrypt/decrypt, salt/uuid generation)
- SSH (generate/import/export keys, ssh-agent integration, fingerprint)
- PGP (generate/import/delete/list keys via system `gpg`)
- Git (set SSH key per repo, deploy keys)
- Settings (get/set/reset)
- Biometric (Touch ID availability, store/retrieve/delete key, unlock)

**Agent Chest proxy (Go binary + Rust bridge):**
- `proxy.rs` — spawns Go binary, bridges management API via reqwest; 13 Tauri commands
- `agent-chest-proxy/` — standalone Go HTTP/HTTPS credential proxy with management API

**Components (`src/components/`):**
- `App.tsx` — main router (vault list → unlock → dashboard)
- `VaultList.tsx` — vault selection/create entry screen
- `CreateVault.tsx` — new vault creation flow (password + key derivation)
- `UnlockVault.tsx` — password or Touch ID unlock (tries Argon2id first, falls back to PBKDF2)
- `VaultDashboard.tsx` — main UI with tabs: SSH Keys, API Keys, Notes, PGP Keys, Proxy
- `Settings.tsx` — auto-lock, theme, Touch ID clear, vault export/import
- `QuickPicker.tsx` — global hotkey overlay
- `ProxyManager.tsx` — Agent Chest proxy management (credentials, rules, bindings, audit) (`Cmd+Shift+K`) for fast key search/copy

**Styling:** Tailwind CSS via `tailwind.config.js`; dark theme default.

### Backend (`src-tauri/src/`)

**Entry point:** `src-tauri/src/main.rs` — Tauri app setup with plugins (clipboard, dialog, os, store, global-shortcut) and `invoke_handler` mapping all commands.

**Module structure:**
- `lib.rs` — module declarations and re-exports for all Tauri commands
- `crypto.rs` — `aes_encrypt`/`aes_decrypt` (AES-256-GCM), `derive_key_argon2`/`derive_key_pbkdf2`, `generate_salt`, `generate_uuid`, `SecretKey` wrapper with `ZeroizeOnDrop`
- `models.rs` — vault serialization: `VaultMeta` (id/name/salt/ciphertext/created), `VaultData` (keys/api_keys/notes/pgp_keys), `vault_list`/`save`/`load`/`delete`, `vault_check_integrity` (detect corrupted ciphertexts), `vault_export_with_data`/`vault_import`
- `ssh.rs` — SSH key operations: `ssh_generate_key` (calls `ssh-keygen`), `ssh_import_keys` (scans `~/.ssh`), `ssh_agent_add`/`list`/`remove`/`clear` (wraps `ssh-add`/`ssh-agent`), `ssh_export_key`, `ssh_get_fingerprint`
- `pgp.rs` — PGP key management via system `gpg` CLI with temp homedir; `pgp_generate_key` (RSA/Ed25519), `pgp_import_key` (armored key blocks), `pgp_list_keys`, `pgp_delete_key`
- `git.rs` — Git integration: `git_is_repo`, `git_get_repo_config`, `git_set_ssh_key` (writes to `.git/config`), `git_remove_ssh_key`, `git_setup_deploy_key` (generates deploy key and configures repo)
- `settings.rs` — `settings_get`/`set`/`reset` using Tauri's `store` plugin (persisted in app storage)
- `biometric.rs` — Touch ID via `objc2-local-authentication`; stores encryption key in Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, `biometric_available`, `biometric_store_key`, `biometric_retrieve_key`, `biometric_unlock` (full flow)
- `proxy.rs` — Agent Chest proxy management; spawns Go binary, bridges management API via reqwest; 14 Tauri commands for credentials, rules, bindings, audit, discover

**Data flow (unlock):**
1. Frontend reads vault metadata (salt + ciphertext) via `vault_load`
2. Derives key with Argon2id (`argon2_key_derive`) — PBKDF2 fallback if Argon2 fails
3. Decrypts ciphertext via `aes_decrypt` → `VaultData`
4. For Touch ID: `biometric_retrieve_key` gets stored key from Keychain (no password needed)

**Vault storage format:** Single JSON file per vault (e.g., `~/.ssh-vault/{uuid}.json`) containing serialized `VaultMeta`. The encrypted `VaultData` is the `ciphertext` field (base64-encoded AES-GCM).

### Agent Chest Proxy (`agent-chest-proxy/`)

Standalone Go binary that the Rust backend spawns as a child process. Provides:
- HTTP/HTTPS proxy on `:8080` with credential injection (Bearer, API key header, Basic auth, passthrough)
- Management API on `:8081` with REST endpoints for credentials, rules, bindings, audit, discover, explicit proxy
- Firewall-like access rules (allow/deny by host pattern, path pattern, method)
- Multi-vault RBAC bindings to scope agent blast radius
- Audit trail with file persistence and subscriber model
- HTTPS CONNECT upgrade to forward-proxy when credentials match
- Network guard (SSRF prevention): blocks private IPs, loopback, cloud metadata endpoints (169.254.169.254)
- DNS rebinding protection: resolves hostname, validates IP, then connects directly
- `/v1/discover` endpoint: returns available services and credential keys for agents
- `/proxy/{host}/{path}` explicit proxy endpoint for clients that can't use HTTPS_PROXY

**Build:** `cd agent-chest-proxy && go build -o ../src-tauri/ ./cmd/agent-chest-proxy/`
**Binary location:** `src-tauri/agent-chest-proxy` (Rust looks for this path)

## Testing

### Rust unit tests
Run with `cargo test` (located at bottom of source files using `#[cfg(test)]` modules):
- `crypto.rs` — 8 tests covering encrypt/decrypt roundtrips, wrong-key failure, tamper detection, salt uniqueness, minimum ciphertext size
- Other modules may have inline tests

### Vault integrity diagnostic
```bash
python3 scripts/vault-diagnostic.py       # Check all vaults for corruption
python3 scripts/vault-diagnostic.py --fix # Auto-delete corrupted vaults (with backup)
```
This checks base64 validity and minimum ciphertext size (28 bytes = 12-nonce + 0-ct + 16-tag). Corrupted vaults from earlier app versions can't be decrypted.

## Configuration Files

- `tauri.conf.json` — app metadata, window size (900×650, min 700×500), dev server port 1420, capabilities
- `vite.config.ts` — React plugin, port 1420, sourcemaps enabled in `TAURI_DEBUG` mode
- `tsconfig.json` — strict TypeScript (ES2020 target, noUnusedLocals/Parameters enabled)
- `tailwind.config.js` — Tailwind setup
- `postcss.config.js` — PostCSS for Tailwind
- `src-tauri/Cargo.toml` — Rust dependencies and release profile (LTO, strip, opt-level=3)

## Important Patterns

### Error handling (Rust)
Uses `thiserror` for `#[derive(Error)]` types. Most Tauri commands return `Result<T, Error>` which serialize to frontend as thrown exceptions. Frontend should `try/catch` all `invoke()` calls.

### State updates (Frontend)
Zustand store mutations always call `set()` with spread operator to preserve immutability. `lastActivity` is updated on every user-facing mutation to support auto-lock.

### Key derivation strategy
New vaults: **Argon2id** (m=64 MiB, t=3, p=4) via `argon2` crate with `zeroize` feature. Legacy vaults: **PBKDF2** with 100k iterations. UnlockVault.tsx tries Argon2id first, catches error → retries PBKDF2.

### Touch ID key storage
Biometric key is stored in macOS Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` — requires device unlock + fingerprint. Key persists across app restarts; clearing requires `biometric_delete_key`.

### Global hotkey
Registered in `main.rs` via `tauri_plugin_global_shortcut` with `Cmd+Shift+K`. Emits `"global-shortcut"` event; frontend `QuickPicker.tsx` listens and shows overlay. macOS-only.

## Useful Scripts

- `scripts/vault-diagnostic.py` — integrity check for vault ciphertext corruption (see README.md for expected ciphertext sizes)

## Platform Notes

- **macOS only** — `biometric.rs` uses `#[cfg(target_os = "macos")]` guards. Windows/Linux builds won't compile biometric commands.
- **Touch ID requirement:** macOS 10.15+; user must have Touch ID configured in System Settings
- **Vault storage path:** `~/Library/Application Support/com.sshvault.desktop/vaults.db` (JSON: `{ "vaults": [...] }`)
- **App identifier:** `com.sshvault.desktop` (used for Keychain and app storage)

## Git Workflow

No special conventions. Standard feature-branch workflow. Commit messages should be descriptive. Run `cargo fmt` before committing Rust changes; frontend uses Prettier via Vite (implicit).

## When Modifying...

### Crypto (`crypto.rs`)
- Never weaken parameters (AES-256-GCM, Argon2id memory=64MiB)
- Keep `SecretKey` zeroized on drop (`ZeroizeOnDrop` derive)
- Add unit tests for any new crypto functions

### Vault format (`models.rs`)
- `VaultData` changes are backward-incompatible — old vaults must still unlock
- `vault_check_integrity` should catch any malformed ciphertexts
- Store dates as ISO 8601 strings (`new Date().toISOString()`)

### Frontend components
- Use Tailwind utility classes (no CSS modules)
- Icons from `lucide-react`
- All Tauri calls go through `src/lib/api.ts` — don't `invoke()` directly in components

### Touch ID (`biometric.rs`)
- Always check `biometric_available()` first
- Handle `null` returns from `biometric_retrieve_key` (key not in Keychain)
- Use `biometric_unlock` for full unlock flow (shows system prompt, returns decryption key)

### SSH (`ssh.rs`)
- Wraps system `ssh-keygen`, `ssh-add`, `ssh-agent`. Don't reimplement SSH protocol.
- Import scans `~/.ssh/*` — only OpenSSH format keys (`-----BEGIN OPENSSH PRIVATE KEY-----` or legacy PEM)

## Troubleshooting

**Dev server already running on port 1420:**
```bash
lsof -ti:1420 | xargs kill  # or use Activity Monitor
```

**Tauri build fails:**
```bash
cd src-tauri && cargo clean
npm run build
```

**Vault won't unlock:**
- Run `python3 scripts/vault-diagnostic.py` to check integrity
- Check `~/Library/Application Support/com.sshvault.desktop/` for `vaults.db`
- Ensure `~/.ssh-vault/` directory exists and is writable

**Touch ID not working:**
- Verify macOS System Settings → Touch ID is configured
- First unlock must use password to store biometric key
- Check Keychain Access for items with "SSH Vault" service

## References

- Tauri 2.0 docs: https://v2.tauri.app/
- Rust aes-gcm crate: https://crates.io/crates/aes-gcm
- argon2 crate: https://crates.io/crates/argon2
- LocalAuthentication (objc2): https://crates.io/crates/objc2-local-authentication
