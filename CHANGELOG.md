# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Agent Chest — HTTP Credential Proxy for AI Agents

- **Proxy server** (`agent-chest-proxy`) — standalone Go binary that acts as an HTTPS_PROXY for AI agents, brokering credentials at the proxy layer so agents never touch raw API keys
  - HTTP forward proxy with credential injection (Bearer, API key header, Basic auth)
  - HTTPS CONNECT proxy with automatic upgrade to forward-proxy when credentials match, ensuring auth headers are injected into TLS connections
  - Firewall-like access rules: allow/deny by host pattern, path pattern, and HTTP method
  - Multi-vault RBAC: bind credentials and rules to specific vault IDs to scope agent blast radius
  - Full audit trail: every request logged with timestamp, agent ID, vault ID, method, target, action, status code, credential ID, matched rule, source IP, user agent, and duration
  - Management API on separate port (default 8081) with REST endpoints for credentials, rules, bindings, and audit queries
  - Configurable via CLI flags (`--proxy-port`, `--mgmt-port`, `--config`, `--audit-log`)
  - JSON config file support for declarative credential/rule/binding setup
  - Single Go binary, zero runtime dependencies
- **Compatibility auth upgrade** for proxy data-plane requests:
  - Accepts standard `Proxy-Authorization: Bearer <token>` and `Proxy-Authorization: Basic <base64(user:token)>`
  - Derives `agent_id` and `vault_id` server-side from token-only auth (no required custom headers)
  - Preserves legacy `X-Vault-ID` + `X-Agent-ID` + `X-Agent-Token` header flow as fallback
- **Strict No File Write mode** (default ON):
  - New app setting `strict_no_file_write_mode` to block launcher script/env generation by default
  - Backend-enforced guard in `proxy_write_tool_launcher` so file writes are denied even if called directly
  - Proxy UI now reflects strict mode and disables launcher file generation with clear messaging

- **Rust backend integration** (`src-tauri/src/proxy.rs`)
  - `proxy_start` — spawns the Go proxy binary as a child process
  - `proxy_stop` — terminates the proxy process
  - `proxy_status` — checks if proxy is running via management API
  - `proxy_list_credentials` / `proxy_add_credential` / `proxy_delete_credential` — CRUD for stored API credentials
  - `proxy_list_rules` / `proxy_add_rule` / `proxy_delete_rule` — CRUD for firewall-like access rules
  - `proxy_list_bindings` / `proxy_add_binding` / `proxy_delete_binding` — CRUD for RBAC bindings
  - `proxy_audit_log` — query the audit trail with pagination

- **Frontend integration**
  - New `ProxyManager` component (`src/components/ProxyManager.tsx`) — full UI for:
    - Starting/stopping the proxy with status indicator
    - Credentials tab: add/view/delete API credentials (Bearer, API key header, Basic auth)
    - Rules tab: add/view/delete allow/deny access rules with host/path/method matching
    - RBAC tab: bind vaults to credentials + rules for scoped blast radius
    - Audit tab: real-time request log showing method, target, action, status, rule match
  - New "Proxy" tab in `VaultDashboard` (Cmd+4 shortcut)
  - Proxy state in Zustand store (`useVaultStore`): proxy status, credentials, rules, bindings, audit log
  - Proxy types in `src/lib/types.ts`: `ProxyCredential`, `ProxyRule`, `ProxyBinding`, `AuditEntry`, `ProxyStatus`
  - Proxy API functions in `src/lib/api.ts`: all 13 Tauri command wrappers

#### Security Hardening

- **Argon2id KDF** for new vaults (memory=64 MiB, iterations=3, parallelism=4) — replaces PBKDF2 for new vault creation. Old PBKDF2 vaults still unlock via automatic fallback
- **`SecretKey` with `ZeroizeOnDrop`** — encryption keys are zeroed from memory when dropped
- **`argon2` crate `zeroize` feature** — intermediate hash output buffer is also zeroed on drop
- **Vault integrity check** at startup — detects corrupted ciphertext and offers deletion with backup

#### PGP Key Management

- PGP key generation via system `gpg` CLI (RSA-4096, RSA-2048, Ed25519)
- PGP key import from armored private key blocks
- PGP key list, reveal public/private keys, copy, delete
- Per-key metadata: name, fingerprint, key ID, algorithm, bit length, user IDs
- PGP tab in vault dashboard with amber color theme
- QuickPicker search includes PGP keys

#### Favorites & Pinning

- Star/pin SSH keys, API keys, and PGP keys to top of their lists
- Pinned items sort first in search results
- `togglePinSsh`, `togglePinApi`, `togglePinPgp` store actions

#### Git Integration

- Per-repository SSH key assignment (`git_set_ssh_key`)
- Deploy key setup (`git_setup_deploy_key`)
- Remove SSH key from repo config (`git_remove_ssh_key`)
- Check if path is a Git repo (`git_is_repo`)
- Get repo config (`git_get_repo_config`)

#### UX Improvements

- Quick copy hotkey overlay (`Cmd+Shift+K`) — search across SSH, API, and PGP keys
- Auto-lock timer with configurable timeout in Settings
- Dark and light theme support with system preference detection
- Vault export/import (JSON backup and merge)
- Touch ID biometric unlock (macOS via LocalAuthentication framework)
- SSH agent integration: add/remove/list agent keys
- SSH key generation: ed25519, ECDSA, RSA

### Changed

- Vault creation now uses Argon2id for key derivation (existing PBKDF2 vaults unlock unchanged)
- Updated to Tauri 2.0 from earlier version
- Modern slate-based color scheme with emerald accent throughout the UI
- React 18 + TypeScript strict mode
- Crypto module uses `argon2` crate with `zeroize` feature for memory-safe key derivation

### Fixed

- Vault integrity check now runs at startup to detect corrupted ciphertext before unlock attempts
- Ciphertext validation ensures minimum size (nonce + auth tag) before attempting decryption

## [0.2.0] - 2026-04-23

### Added

- Core vault management (create, unlock, lock, delete)
- SSH key storage with copy-to-clipboard and reveal
- API credential storage
- Secure notes
- Settings panel with theme, auto-lock, and defaults
- AES-256-GCM encryption for vault data
- PBKDF2 key derivation (100k iterations)

[Unreleased]: https://github.com/ssh-vault/ssh-vault/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ssh-vault/ssh-vault/releases/tag/v0.2.0
