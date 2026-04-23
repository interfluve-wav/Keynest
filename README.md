# SSH Vault Tauri

A secure, native macOS application for managing SSH keys and API credentials with Touch ID biometric authentication.

## What This App Does

SSH Vault provides a secure, encrypted vault to store and manage:
- **SSH private/public keys** - Keep all your SSH keys in one encrypted location
- **API keys and tokens** - Store API credentials securely
- **Secure notes** - Private notes encrypted with your vault

## Core Features

### 🔐 Security-First Design
- **AES-256-GCM encryption** with PBKDF2 key derivation (100k iterations)
- **Touch ID biometric unlock** - Passwordless access using macOS Keychain
- **Local-only storage** - No cloud, no servers, your data never leaves your Mac
- **Hardware-backed** - Uses macOS Secure Enclave when available

### ⚡ Quick Access
- **Global hotkey** `Cmd+Shift+K` - Quick search and copy any key from anywhere
- **SSH Agent integration** - Add keys to ssh-agent directly from the app
- **Git integration** - Configure SSH keys per Git repository

### 🗝️ Key Management
- Generate new SSH keys (ed25519, ECDSA, RSA)
- Import existing keys from `~/.ssh` (copies into vault, originals untouched)
- Export keys when needed
- Delete keys from vault (does NOT affect original files)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    SSH Vault Tauri                           │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript)                              │
│  ├── Components: VaultList, UnlockVault, VaultDashboard     │
│  ├── QuickPicker: Global hotkey overlay                     │
│  └── Settings: Theme, auto-lock, Touch ID management        │
├─────────────────────────────────────────────────────────────┤
│  Backend (Rust + Tauri)                                     │
│  ├── crypto.rs: AES-256-GCM, PBKDF2                         │
│  ├── models.rs: Vault serialization/deserialization         │
│  ├── ssh.rs: ssh-keygen wrapper, ssh-agent integration      │
│  ├── biometric.rs: Touch ID via LocalAuthentication         │
│  └── git.rs: Git repository SSH configuration               │
├─────────────────────────────────────────────────────────────┤
│  Storage                                                    │
│  ├── Vault files: ~/.ssh-vault/{vault_id}.json              │
│  ├── Settings: macOS app storage                            │
│  └── Biometric keys: macOS Keychain                         │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
/Users/suhaas/Documents/Developer/ssh-vault-tauri/
├── src/                          # Frontend source
│   ├── components/               # React components
│   │   ├── VaultList.tsx         # Main vault selection screen
│   │   ├── CreateVault.tsx       # Create new vault flow
│   │   ├── UnlockVault.tsx       # Password/Touch ID unlock
│   │   ├── VaultDashboard.tsx    # Main app interface
│   │   ├── Settings.tsx          # App settings panel
│   │   └── QuickPicker.tsx       # Cmd+Shift+K overlay
│   ├── lib/
│   │   ├── api.ts                # Tauri command wrappers
│   │   ├── store.ts              # Zustand state management
│   │   └── types.ts              # TypeScript interfaces
│   └── App.tsx                   # Main app component
│
├── src-tauri/src/                # Rust backend
│   ├── crypto.rs                 # Encryption/decryption
│   ├── models.rs                 # Vault data structures
│   ├── ssh.rs                    # SSH key operations
│   ├── biometric.rs              # Touch ID integration
│   ├── git.rs                    # Git repository handling
│   ├── settings.rs               # Settings persistence
│   └── main.rs                   # App entry point
│
├── src-tauri/tauri.conf.json     # Tauri configuration
├── package.json                  # Node.js dependencies
├── tailwind.config.js            # Tailwind CSS config
└── ROADMAP.md                    # Future feature plans
```

## Data Flow

### Creating a Vault
1. User enters vault name and password
2. App generates random 32-byte salt
3. PBKDF2 derives encryption key from password + salt
4. Empty vault data encrypted with AES-256-GCM
5. Vault metadata + ciphertext saved to disk

### Unlocking with Password
1. User enters password
2. App reads vault salt from file
3. PBKDF2 derives key (same as creation)
4. Attempts AES-GCM decryption
5. Success → vault unlocked, data loaded

### Unlocking with Touch ID
1. Check if biometric key exists in Keychain
2. If yes: Prompt for Touch ID
3. Touch ID success → retrieve stored encryption key
4. Decrypt vault without password
5. If no key exists: Fall back to password unlock

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
| Vault file stolen | AES-256-GCM encryption, PBKDF2 key derivation |
| Memory dump | Keys only in memory while vault unlocked |
| Biometric bypass | Touch ID only retrieves key, doesn't bypass encryption |
| Key logger | Biometric unlock doesn't require password entry |
| Cloud compromise | No cloud storage, completely offline |

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
| `pbkdf2_key_derive` | crypto | Derive encryption key |
| `aes_encrypt` | crypto | Encrypt data |
| `aes_decrypt` | crypto | Decrypt data |
| `ssh_generate_key` | ssh | Generate new SSH keypair |
| `ssh_import_keys` | ssh | Scan ~/.ssh for keys |
| `ssh_agent_add` | ssh | Add key to ssh-agent |
| `ssh_agent_list` | ssh | List agent keys |
| `biometric_available` | biometric | Check Touch ID support |
| `biometric_store_key` | biometric | Store key in Keychain |
| `biometric_retrieve_key` | biometric | Get key with Touch ID |
| `biometric_unlock` | biometric | Full Touch ID unlock flow |
| `git_set_ssh_key` | git | Configure repo SSH key |

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

# Development (hot reload)
npm run tauri dev

# Production build
npm run build
cd src-tauri
cargo build --release
```

## Dependencies

### Frontend
- React 18
- TypeScript
- Tailwind CSS
- Zustand (state management)
- Lucide React (icons)

### Backend
- Tauri 2.0
- aes-gcm (encryption)
- argon2 (key derivation via `argon2` crate)
- pbkdf2 (key derivation via `pbkdf2` crate)
- LocalAuthentication (Touch ID via `security` CLI macOS Keychain)

## Platform Support

| Feature | macOS | Notes |
|---------|-------|-------|
| Core vault | ✅ | Full support |
| Touch ID | ✅ | macOS 10.15+ |
| ssh-agent | ✅ | Native integration |
| Global hotkey | ✅ | Cmd+Shift+K |
| Menu bar | ❌ | Planned |
| Windows/Linux | ❌ | Not planned |

## License

MIT / Proprietary (TBD)

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned features and implementation timeline.
