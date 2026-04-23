# SSH Vault Tauri

A secure, native macOS application for managing SSH keys, API credentials, and PGP keys with Touch ID biometric authentication — now with **Agent Chest**, an HTTP credential proxy for AI agents.

## What This App Does

SSH Vault provides a secure, encrypted vault to store and manage:
- **SSH private/public keys** — Keep all your SSH keys in one encrypted location
- **API keys and tokens** — Store API credentials securely
- **PGP keys** — Generate, import, and manage PGP keys via system GPG
- **Secure notes** — Private notes encrypted with your vault

### Agent Chest: Credential Proxy for AI Agents

AI agents shouldn't hold raw API keys. Agent Chest runs a local HTTPS proxy that injects credentials into outbound requests, so agents never touch them.

**How it works:**
1. Agent sets `HTTPS_PROXY=http://127.0.0.1:8080`, `X-Vault-ID`, `X-Agent-ID`, and `X-Agent-Token`
2. Agent makes normal HTTP requests — no keys in code
3. Proxy matches request host to stored credentials
4. Proxy injects auth headers (Bearer token, API key header, Basic auth)
5. Proxy forwards the request to the target API
6. Every request is logged to an audit trail

**What you get:**
- Brokered access through HTTPS_PROXY, not retrieval — nothing to exfiltrate
- Firewall-like access rules (allow/deny by host, path, method)
- Multi-vault RBAC to scope agents to a tight blast radius
- Explicit `/proxy/{host}/{path}` denials return JSON with `proposal_hint`
- CONNECT denials may only be visible in the audit log; `curl` can report `000` if the tunnel never completes
- Full audit trail of every passing call
- Single Go binary; available as a Docker container

See [AGENT_CHEST.md](./AGENT_CHEST.md) for full documentation.
See [AGENT_ONBOARDING.md](./AGENT_ONBOARDING.md) for a no-code agent setup flow.

### Agent Onboarding (No Code)

From the app UI (Proxy tab):
1. Start Proxy
2. Add Credential, Rule, and RBAC Binding
3. Create Invite
4. Redeem Invite (gets `X-Agent-ID` + one-time token)
5. Use the built-in one-click snippet exporter (`Claude Code`, `Hermes`, `OpenClaw`, `Cursor`)
6. Copy or download snippet and paste into your agent tool config

## Core Features

### 🔐 Security-First Design
- **AES-256-GCM encryption** with Argon2id key derivation (64 MiB, 3 iterations, parallelism 4) — new vaults use Argon2id, old PBKDF2 vaults unlock automatically
- **ZeroizeOnDrop** — encryption keys are zeroed from memory when no longer needed
- **Touch ID biometric unlock** — Passwordless access using macOS Keychain
- **Local-only storage** — No cloud, no servers, your data never leaves your Mac
- **Agent Chest proxy** — Credentials never leave the vault; brokered at the proxy layer

### ⚡ Quick Access
- **Global hotkey** `Cmd+Shift+K` — Quick search and copy any key from anywhere
- **Agent Chest proxy** — Start/stop from the Proxy tab, manage credentials, rules, and audit trail
- **SSH Agent integration** — Add keys to ssh-agent directly from the app
- **Git integration** — Configure SSH keys per Git repository

### 🗝️ Key Management
- Generate new SSH keys (ed25519, ECDSA, RSA)
- Import existing keys from `~/.ssh` (copies into vault, originals untouched)
- Import PGP keys from armored private key blocks
- Export keys when needed
- Pin favorites to top of list
- Delete keys from vault (does NOT affect original files)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SSH Vault Tauri                               │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript)                                │
│  ├── Components: VaultList, UnlockVault, VaultDashboard        │
│  ├── ProxyManager: Credential proxy UI (discover/CRUD/proposals/agents/audit) │
│  ├── QuickPicker: Global hotkey overlay (Cmd+Shift+K)          │
│  └── Settings: Theme, auto-lock, Touch ID management           │
├─────────────────────────────────────────────────────────────────┤
│  Backend (Rust + Tauri)                                       │
│  ├── crypto.rs: AES-256-GCM, Argon2id, PBKDF2                 │
│  ├── models.rs: Vault serialization/deserialization              │
│  ├── proxy.rs: Agent Chest process management + API bridge      │
│  ├── ssh.rs: ssh-keygen wrapper, ssh-agent integration           │
│  ├── pgp.rs: PGP key management via gpg                        │
│  ├── biometric.rs: Touch ID via LocalAuthentication             │
│  └── git.rs: Git repository SSH configuration                  │
├─────────────────────────────────────────────────────────────────┤
│  Agent Chest Proxy (Go binary — separate process)              │
│  ├── HTTP/HTTPS proxy on :8080                                 │
│  ├── Management API on :8081                                    │
│  ├── Credential injection (Bearer, API key header, Basic)      │
│  ├── Access rules (allow/deny by host/path/method)             │
│  ├── Multi-vault RBAC bindings                                 │
│  └── Audit logger (file + memory)                              │
├─────────────────────────────────────────────────────────────────┤
│  Storage                                                       │
│  ├── Vault files: ~/.ssh-vault/{vault_id}.json                  │
│  ├── Settings: macOS app storage                                │
│  └── Biometric keys: macOS Keychain                            │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
/Users/suhaas/Documents/Developer/ssh-vault-tauri/
├── src/                          # Frontend source
│   ├── components/
│   │   ├── VaultList.tsx         # Main vault selection screen
│   │   ├── CreateVault.tsx       # Create new vault flow
│   │   ├── UnlockVault.tsx       # Password/Touch ID unlock
│   │   ├── VaultDashboard.tsx    # Main app interface (4 tabs + proxy)
│   │  ├── ProxyManager.tsx      # Agent Chest proxy management UI
│   │   ├── Settings.tsx           # App settings panel
│   │   └── QuickPicker.tsx       # Cmd+Shift+K overlay
│   ├── lib/
│   │   ├── api.ts                # Tauri command wrappers (including proxy)
│   │   ├── store.ts              # Zustand state (including proxy state)
│   │   └── types.ts              # TypeScript interfaces (including proxy types)
│   └── App.tsx                   # Main app component
│
├── src-tauri/src/                # Rust backend
│   ├── crypto.rs                 # Encryption/decryption (AES-256-GCM, Argon2id, PBKDF2)
│   ├── models.rs                 # Vault data structures & persistence
│   ├── proxy.rs                  # Agent Chest proxy management + API bridge
│   ├── ssh.rs                    # SSH key operations
│   ├── pgp.rs                    # PGP key management
│   ├── biometric.rs              # Touch ID integration
│   ├── git.rs                    # Git repository handling
│   ├── settings.rs               # Settings persistence
│   ├── lib.rs                    # Module declarations & re-exports
│   └── main.rs                   # App entry point with all invoke handlers
│
├── agent-chest-proxy/            # Go proxy binary
│   ├── cmd/agent-chest-proxy/
│   │   └── main.go               # CLI entry point (proxy + mgmt servers)
│   └── internal/
│       ├── audit/audit.go        # Audit logging (file + memory + subscribers)
│       ├── proxy/proxy.go         # HTTP/HTTPS proxy handler + management API
│       ├── rules/rules.go         # Firewall-like rule engine (allow/deny)
│       ├── rbac/rbac.go           # Multi-vault role-based access control
│       └── vault/vault.go         # In-memory credential store + AES-256-GCM
│
├── src-tauri/tauri.conf.json     # Tauri configuration
├── package.json                  # Node.js dependencies
├── tailwind.config.js            # Tailwind CSS config
├── AGENT_CHEST.md                # Agent Chest documentation
├── AGENT_ONBOARDING.md           # No-code agent onboarding guide
├── CHANGELOG.md                  # Changelog
├── ROADMAP.md                    # Future feature plans
└── README.md                     # This file
```

## Data Flow

### Creating a Vault
1. User enters vault name and password
2. App generates random 32-byte salt
3. Argon2id derives encryption key from password + salt (m=64 MiB, t=3, p=4)
4. Empty vault data encrypted with AES-256-GCM
5. Vault metadata + ciphertext saved to disk

### Unlocking with Password
1. User enters password
2. App reads vault salt from file
3. Argon2id derives key (tries first; falls back to PBKDF2 for old vaults)
4. Attempts AES-GCM decryption
5. Success → vault unlocked, data loaded

### Unlocking with Touch ID
1. Check if biometric key exists in Keychain
2. If yes: Prompt for Touch ID
3. Touch ID success → retrieve stored encryption key
4. Decrypt vault without password
5. If no key exists: Fall back to password unlock

### Agent Chest Proxy Flow
1. User starts proxy from the Proxy tab (or CLI)
2. Proxy listens on `:8080` (HTTPS proxy) and `:8081` (management API)
3. Agent configures `HTTPS_PROXY=http://127.0.0.1:8080` and sets `X-Vault-ID`, `X-Agent-ID`, and `X-Agent-Token` headers
4. Agent makes normal HTTP(S) request to target API
5. Proxy intercepts request, matches target host to stored credentials
6. Proxy evaluates access rules (allow/deny)
7. Proxy injects auth header and forwards to target
8. Response returned to agent; request logged to audit trail
9. If the explicit `/proxy/` endpoint or network guard blocks the request, the proxy returns JSON with `proposal_hint` so callers can surface a remediation hint

### Storing Keys in Vault

SSH keys are **copied** into the vault, not referenced:

```
Before Import:
~/.ssh/
├── id_rsa          ← Original file
└── id_rsa.pub

Import Process:
1. Read id_rsa content
2. Encrypt with vault key
3. Store in vault file

After Import:
~/.ssh/
├── id_rsa          ← Still here (untouched)
└── id_rsa.pub

~/.ssh-vault/
└── my-vault.json   ← Contains encrypted copy

Deleting from app:
- Removes encrypted copy from vault
- Original ~/.ssh/id_rsa remains
```

## Security Model

### Threats Addressed
| Threat | Mitigation |
|--------|------------|
| Vault file stolen | AES-256-GCM encryption, Argon2id key derivation |
| Memory dump | Keys only in memory while vault unlocked; `ZeroizeOnDrop` in Rust |
| Biometric bypass | Touch ID only retrieves key, doesn't bypass encryption |
| Key logger | Biometric unlock doesn't require password entry |
| Cloud compromise | No cloud storage, completely offline |
| AI agent credential exfiltration | Agent Chest brokered access — keys never leave the proxy |
| Agent accessing unauthorized APIs | Firewall rules deny by host/path/method |
| Agent blast radius | Multi-vault RBAC scopes credentials per vault |
| SSRF attacks | Network guard blocks private IPs, loopback, and cloud metadata endpoints |
| DNS rebinding | Proxy resolves hostname, validates IP, then connects directly |

### Not Addressed
- Physical access to unlocked machine
- Malware with root access
- User accidentally sharing vault password

## Commands Reference

### Tauri Commands (Frontend → Backend)

| Command | Module | Description |
|---------|--------|-------------|
| `vault_list` | models | List all vault files |
| `vault_save` | models | Save vault metadata |
| `vault_load` | models | Load vault by ID |
| `vault_delete` | models | Delete vault file |
| `pbkdf2_key_derive` | crypto | Derive key with PBKDF2 (legacy) |
| `argon2_key_derive` | crypto | Derive key with Argon2id |
| `aes_encrypt` | crypto | Encrypt data |
| `aes_decrypt` | crypto | Decrypt data |
| `ssh_generate_key` | ssh | Generate new SSH keypair |
| `ssh_import_keys` | ssh | Scan ~/.ssh for keys |
| `ssh_agent_add` | ssh | Add key to ssh-agent |
| `ssh_agent_list` | ssh | List agent keys |
| `ssh_agent_remove` | ssh | Remove key from agent |
| `ssh_agent_clear` | ssh | Clear all agent keys |
| `ssh_export_key` | ssh | Export key to file |
| `ssh_get_fingerprint` | ssh | Get key fingerprint |
| `pgp_generate_key` | pgp | Generate PGP key |
| `pgp_import_key` | pgp | Import PGP key |
| `pgp_delete_key` | pgp | Delete PGP key |
| `pgp_list_keys` | pgp | List PGP keys |
| `git_set_ssh_key` | git | Configure repo SSH key |
| `git_is_repo` | git | Check if path is a Git repo |
| `git_set_ssh_key` | git | Set SSH key per repo |
| `git_remove_ssh_key` | git | Remove SSH key from repo |
| `git_setup_deploy_key` | git | Generate and configure deploy key |
| `biometric_available` | biometric | Check Touch ID support |
| `biometric_store_key` | biometric | Store key in Keychain |
| `biometric_retrieve_key` | biometric | Get key with Touch ID |
| `biometric_unlock` | biometric | Full Touch ID unlock flow |
| `biometric_delete_key` | biometric | Delete biometric key |
| `proxy_start` | proxy | Start Agent Chest proxy |
| `proxy_stop` | proxy | Stop Agent Chest proxy |
| `proxy_status` | proxy | Check proxy status |
| `proxy_discover` | proxy | Discover available services and credential keys |
| `proxy_list_credentials` | proxy | List proxy credentials |
| `proxy_add_credential` | proxy | Add proxy credential |
| `proxy_delete_credential` | proxy | Delete proxy credential |
| `proxy_list_rules` | proxy | List access rules |
| `proxy_add_rule` | proxy | Add access rule |
| `proxy_delete_rule` | proxy | Delete access rule |
| `proxy_list_bindings` | proxy | List RBAC bindings |
| `proxy_add_binding` | proxy | Create RBAC binding |
| `proxy_delete_binding` | proxy | Delete RBAC binding |
| `proxy_list_proposals` | proxy | List access proposals |
| `proxy_create_proposal` | proxy | Create proposal |
| `proxy_approve_proposal` | proxy | Approve proposal and materialize allow rule |
| `proxy_deny_proposal` | proxy | Deny proposal |
| `proxy_list_agents` | proxy | List registered agents |
| `proxy_rotate_agent_token` | proxy | Rotate agent token |
| `proxy_revoke_agent` | proxy | Revoke agent |
| `proxy_list_invites` | proxy | List invites |
| `proxy_create_invite` | proxy | Create invite |
| `proxy_redeem_invite` | proxy | Redeem invite into agent + token |
| `proxy_audit_log` | proxy | Query audit trail |

## Vault Integrity Diagnostics

Run the diagnostic to check for corrupted vault ciphertexts:
```bash
python3 scripts/vault-diagnostic.py
```

This performs a fast structural check without attempting decryption:
- `INVALID BASE64` → ciphertext is garbled and cannot be decoded
- `CIPHERTEXT TOO SHORT` → ciphertext is truncated (data is missing)
- `SUSPICIOUSLY SMALL` → valid but unusually small for real vault content

Auto-delete all corrupted vaults with a backup:
```bash
python3 scripts/vault-diagnostic.py --fix
```

**Expected ciphertext sizes** (AES-256-GCM = 12-nonce + N-ct + 16-tag):

| Vault contents | Raw bytes | Base64 chars |
|---|---|---|
| Empty vault (all arrays) | ~64 B | ~88 |
| 1–5 SSH keys | ~100–300 B | ~140–420 |
| 10+ keys / notes | ~500–1000 B | ~700–1400 |

Anything under ~50 raw bytes is structurally invalid and cannot contain real data.

**Why corruption happens:** Bugs in earlier app versions wrote malformed ciphertext. The app now runs `vault_check_integrity` at startup to surface this before unlock, and all crypto operations are covered by unit tests (8 passing).

## Build Instructions

```bash
# Install dependencies
npm install

# Build the Go proxy binary
cd agent-chest-proxy && go build -o ../src-tauri/ ./cmd/agent-chest-proxy/ && cd ..

# Development (hot reload)
npm run tauri dev

# Production build
npm run build
cd src-tauri && cargo build --release
```

## Running Tests

```bash
# Frontend tests
npm run test

# Rust backend tests
cd src-tauri && cargo test

# Go proxy tests
cd agent-chest-proxy && go test ./...
```

## Dependencies

### Frontend
- React 18
- TypeScript (strict mode)
- Tailwind CSS
- Zustand (state management)
- Lucide React (icons)

### Backend (Rust)
- Tauri 2.0
- aes-gcm (encryption)
- argon2 (key derivation, with zeroize)
- pbkdf2 (legacy key derivation)
- reqwest (proxy management API bridge)
- LocalAuthentication (Touch ID via macOS Keychain)

### Agent Chest Proxy (Go)
- net/http (proxy + management servers)
- crypto/aes + crypto/cipher (AES-256-GCM)
- golang.org/x/crypto/argon2 (key derivation)
- Google UUID (unique IDs)
- Zero external dependencies beyond stdlib

## Platform Support

| Feature | macOS | Notes |
|---------|-------|-------|
| Core vault | ✅ | Full support |
| Touch ID | ✅ | macOS 10.15+ |
| ssh-agent | ✅ | Native integration |
| Global hotkey | ✅ | Cmd+Shift+K |
| PGP keys | ✅ | Via system GPG |
| Agent Chest proxy | ✅ | HTTP/HTTPS credential broker |
| Menu bar | ❌ | Planned |
| Windows/Linux | ❌ | Not planned |

## License

MIT / Proprietary (TBD)

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned features and implementation timeline.
