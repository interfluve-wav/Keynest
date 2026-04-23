# SSH Vault Tauri - Product Roadmap

## Overview

This document outlines planned features and enhancements for SSH Vault Tauri, organized by user impact and implementation priority.

---

## Tier 1: Daily Workflow Changers

These features provide the highest daily value and transform the core user experience.

### 1. Menu Bar App

**Status:** Not Started  
**Effort:** Medium  
**Impact:** High

**Description:**  
A lightweight menu bar companion that provides instant access to vault functions without opening the full application window.

**User Flow:**
```
Click menu bar icon → See list of locked vaults → Touch ID prompt → Copy key to clipboard
```

**Benefits:**
- No window management or dock clutter
- Always available without context switching
- 10x faster than opening full app for quick operations
- Ideal for copying keys multiple times per day

**Technical Notes:**
- Requires Tauri tray/MenuBar API
- Needs to run as background agent
- Consider memory footprint when idle

---

### 2. CLI Tool (`sv` command)

**Status:** Not Started  
**Effort:** High  
**Impact:** High

**Description:**  
A command-line companion tool that integrates SSH Vault into terminal workflows.

**Proposed Commands:**
```bash
# Unlock and add key to SSH agent
sv use production

# Copy key to clipboard
sv copy github-work

# Generate new key and add to vault
sv generate aws-prod --type ed25519

# List available keys
sv list

# Lock all vaults
sv lock

# Check which key is active in agent
sv status
```

**Benefits:**
- Developers spend 90% of time in terminal
- Eliminates context switching (terminal → GUI → terminal)
- Enables scripting and automation
- Natural integration with existing SSH workflows

**Technical Notes:**
- Rust binary that communicates with Tauri backend
- Socket or IPC communication with running app
- Consider standalone mode (when GUI not running)

---

### 3. Quick Copy Hotkey

**Status:** Not Started  
**Effort:** Medium  
**Impact:** High

**Description:**  
Global keyboard shortcut for instant key copying without mouse interaction.

**User Flow:**
```
Cmd+Shift+K → Search overlay appears → Type "prod" → Enter → Key copied
```

**Configuration:**
- Customizable hotkey (default: Cmd+Shift+K)
- Option for Touch ID verification on each use
- Recently used keys appear first

**Benefits:**
- Copy a key in under 2 seconds
- No visual context switching
- Power user feature that creates evangelists

**Technical Notes:**
- Requires global hotkey registration (Tauri plugin)
- Secure overlay window (can't be screenshotted)
- Handle focus/blur correctly

## Tier 2: Friction Reducers

Features that remove common points of friction in SSH key management.

### 4. SSH Config Editor (GUI)

**Status:** Not Started  
**Effort:** High  
**Impact:** Medium-High

**Description:**  
Visual editor for `~/.ssh/config` that eliminates syntax errors and simplifies complex configurations.

**Features:**
```
Visual tree view:
├── Host: github.com
│   ├── User: git
│   ├── IdentityFile: github_work (linked to vault key)
│   └── Add to agent: true
├── Host: production-*
│   ├── HostName: %h.example.com
│   ├── User: deploy
│   ├── ProxyJump: bastion
│   └── IdentityFile: production_deploy
└── Host: bastion
    ├── HostName: bastion.example.com
    └── IdentityFile: bastion_key

Visual connection builder:
[Local] --SSH--> [Bastion] --SSH--> [Production]
```

**Benefits:**
- `~/.ssh/config` syntax is error-prone and cryptic
- Visual editing reduces "why isn't this connection working?" debugging
- Auto-generate configs from stored keys
- Discover existing configs and import keys

**Technical Notes:**
- Parse and write SSH config format
- Handle wildcards and includes
- Link IdentityFile entries to vault keys

---

### 5. Key Templates

**Status:** Not Started  
**Effort:** Low  
**Impact:** Medium

**Description:**  
Pre-configured templates for common key types that auto-fill optimal settings.

**Templates:**
| Template | Algorithm | Bits | Comment Format | Use Case |
|----------|-----------|------|----------------|----------|
| GitHub Personal | ed25519 | - | user@hostname | Git signing, GitHub auth |
| GitHub Work | ed25519 | - | work@hostname | Corporate GitHub |
| AWS EC2 | rsa | 4096 | - | AWS key pairs (legacy) |
| AWS Modern | ed25519 | - | - | Newer AWS regions |
| GitLab | ed25519 | - | gitlab@hostname | GitLab auth |
| Generic Server | ed25519 | - | username@hostname | General purpose |

**Benefits:**
- Removes "what settings do I use?" decisions
- Prevents format mismatches (e.g., RSA for old AWS)
- Consistent naming conventions
- Educational for new users

**Technical Notes:**
- Simple preset system in config
- Can be extended by users
- Suggest template based on key name patterns

---

### 6. Per-Project Auto-Configuration

**Status:** Not Started  
**Effort:** Medium  
**Impact:** Medium-High

**Description:**  
Automatically detects Git repositories and suggests appropriate SSH keys based on remote URL.

**User Flow:**
```
Terminal: cd ~/work/acme-project

SSH Vault (detects .git/config):
  Remote: git@github.com:acmecorp/project.git
  
  "Use 'github-work' key for AcmeCorp repositories?"
  
  [Yes] [Always for acmecorp] [Different Key] [Ignore]
```

**Smart Detection:**
- Parse Git remote URLs (GitHub, GitLab, Bitbucket, etc.)
- Match to existing keys by comment or name
- Learn from user choices
- Support Git worktrees and submodules

**Benefits:**
- Zero-thought SSH setup for new projects
- Prevents committing with wrong Git identity
- Reduces "why is this pushing to the wrong account?" issues

**Technical Notes:**
- File watcher for .git/config changes
- Parse Git remote URLs
- Potentially modify ~/.ssh/config
- macOS folder actions or periodic scan

---

## Tier 3: Occasional but High Impact

Features used infrequently but provide significant value when needed.

### 7. Smart Key Expiration & Rotation

**Status:** Not Started  
**Effort:** Medium  
**Impact:** Medium

**Description:**  
Visual indicators and guided workflows for key rotation based on age and usage.

**Features:**
```
Key List View:
├── github_personal       [🟢 12 days old]
├── aws_production        [🟡 68 days old]  
├── legacy_server         [🔴 145 days old]  [Rotate?]
└── deploy_key            [⚪ Never used]    [Consider deleting?]

Rotation Wizard:
1. Generate new key pair
2. Update GitHub/remote server (with instructions/API integration)
3. Test connection
4. Mark old key as "retiring" (kept for 30 days)
5. Auto-archive old key after grace period
```

**Configuration:**
- Warning threshold: 60 days (configurable)
- Critical threshold: 90 days (configurable)
- Grace period: 30 days before archive

**Benefits:**
- Security without anxiety
- Removes friction from "ugh I should rotate but it's hard"
- Compliance-friendly (SOC 2, ISO 27001)
- Visual status at a glance

**Technical Notes:**
- Store creation date with each key
- Background job for age checking
- Integration with GitHub API for automated rotation

---

### 8. Favorites & Smart Sorting

**Status:** Not Started  
**Effort:** Low  
**Impact:** Medium

**Description:**  
Pin frequently used keys to top and intelligent sorting that surfaces relevant keys.

**Sorting Algorithm:**
```
1. Pinned favorites (manual)
2. Recently used (last 7 days)
3. Most frequently used (all time)
4. Recently created
5. Alphabetical (fallback)
```

**Visual Indicators:**
- ⭐ Pinned
- 🕐 Used today
- 📊 Used 50+ times
- 📌 New (created this week)

**Benefits:**
- Reduces list scanning with 20+ keys
- Surfaces relevant keys automatically
- Zero configuration needed

---

### 9. PGP Key Support

**Status:** Completed (2026-04-23)  
**Effort:** Medium  
**Impact:** High (completes the vault)

**Description:**  
Full PGP key management integrated into the vault — generation, import, and copy of both public and private keys.

**Completed Features:**
- PGP tab in vault dashboard with dedicated UI
- Generate new PGP keys via `gpg --batch --gen-key` (RSA-4096, RSA-2048, Ed25519)
- Import existing PGP keys from armored private key blocks
- Per-key metadata: name, fingerprint, key ID, algorithm, bit length, user IDs
- Public and private key reveal/copy with amber color theme
- QuickPicker cross-key search with PGP type badge
- Vault stores `pgp_keys: PgpKey[]` alongside SSH and API keys

**Technical Notes:**
- Uses system `gpg` CLI with temp homedir for isolation during key generation
- Fingerprint extracted via `%echo` marker to avoid second GPG invocation
- `PgpKeyMetadata` (import/generate result) differs from `PgpKey` (stored vault model)

---

## Security Hardening

**Status:** Completed (2026-04-23)

### Implemented

| Feature | Description |
|---------|-------------|
| **Argon2id KDF** | New vaults use Argon2id (m=64 MiB, t=3, p=4) instead of PBKDF2. Memory-hard design resists GPU/ASIC attacks far better than PBKDF2's CPU-only cost factor. |
| **Backward compat** | Old PBKDF2 vaults unlock automatically — UnlockVault tries Argon2id first, falls back to PBKDF2. New vaults always use Argon2id. |
| **`SecretKey` with `ZeroizeOnDrop`** | Derived keys are stored in a `#[derive(Zeroize, ZeroizeOnDrop)]` struct. When the `SecretKey` goes out of scope, the 32-byte key material is overwritten with zeros automatically. |
| **`argon2` zeroize feature** | `argon2 0.5` is compiled with `features = ["password-hash", "zeroize"]`, so the intermediate hash `Output` buffer is also zeroed on drop. |
| **PBKDF2 still available** | `pbkdf2_key_derive` Tauri command is retained for opening old vaults. |

### Cryptographic Parameters

| Parameter | Argon2id (new) | PBKDF2 (legacy) |
|-----------|---------------|-----------------|
| Memory | 64 MiB | N/A |
| Iterations | 3 | 100,000 |
| Parallelism | 4 | N/A |
| Salt length | 32 bytes | 32 bytes |
| Key length | 256 bits | 256 bits |

---

## Tier 4: Future Considerations

Features to evaluate based on user feedback and adoption.

### Hardware Key Integration (YubiKey, OnlyKey)

**Use Case:** Store SSH keys in hardware security key, use Touch ID / PIN to authenticate

**Benefits:**
- Keys never leave hardware
- Portable across machines
- Phishing-resistant

**Challenges:**
- Complex implementation
- Limited to users with hardware keys
- Cross-platform differences

---

### Team Vaults & Access Control

**Use Case:** Shared vaults with role-based permissions for teams

**Features:**
- Owner, Admin, Member roles
- Request/approve workflows
- Shared vault encryption (Shamir's Secret Sharing)

**Challenges:**
- Major architecture change
- Sync mechanism needed
- Complexity vs. single-user focus

---

### CI/CD Integration

**Use Case:** Inject keys into GitHub Actions, GitLab CI, etc.

**Example:**
```yaml
- uses: ssh-vault/action@v1
  with:
    vault-file: .ssh-vault/production.json
    password: ${{ secrets.VAULT_PASSWORD }}
    key: deploy-key
```

**Benefits:**
- Secure key storage for CI/CD
- Audit trail
- Automatic key rotation

**Challenges:**
- Requires trust in CI platform
- Secrets in CI are still risky
- Different syntax for each platform

---

### Mobile Companion (iOS)

**Use Case:** View/copy keys on iPhone

**Features:**
- iCloud Keychain sync (encrypted blob)
- QR code for quick import
- Apple Watch complication

**Challenges:**
- iOS app development
- Sync complexity
- Limited use case (how often do you need SSH on mobile?)

---

## Deferred / Won't Build

Features intentionally excluded based on low UX value or misalignment with product goals.

| Feature | Reason |
|---------|--------|
| **Watch App** | Cool demo, negligible real-world usage |
| **QR Code Export** | Rarely needed; keys don't transfer to mobile often |
| **Breach Detection** | Creates anxiety without actionable workflow |
| **Port Knocking** | Niche security technique, complex UX |
| **iCloud Sync** | Trust issues with key synchronization; local-first philosophy |
| **Browser Extension** | Outside scope; SSH keys != web passwords |
| **Windows/Linux Support** | macOS-native experience is core differentiator |

---

## Implementation Priority

### Phase 1: Solidify Core
- [x] PGP key support (completed 2026-04-23)
- [x] Security hardening: Argon2id + ZeroizeOnDrop (completed 2026-04-23)
- [ ] Bug fixes and stability
- [ ] Performance optimization (large vaults)
- [ ] Complete test coverage

### Phase 2: Daily Workflow (Next 3 months)
1. Menu bar app
2. Quick copy hotkey
3. Favorites & smart sorting

### Phase 3: Power User Features (3-6 months)
1. CLI tool
2. SSH config editor
3. Key templates
4. Per-project auto-configuration

### Phase 4: Security & Compliance (6-12 months)
1. Key expiration & rotation
2. Encrypted sharing improvements
3. Audit logging

### Phase 5: Enterprise (Future)
1. Team vaults (if demand exists)
2. CI/CD integration
3. Advanced access controls

---

## Success Metrics

Track these metrics to validate feature value:

| Metric | Target |
|--------|--------|
| Daily active users | 70%+ of installs |
| Avg unlock time | < 3 seconds (Touch ID) |
| Keys per user | 8-12 (indicates engaged usage) |
| Feature adoption | 60%+ use top 3 features |
| Support tickets | < 5% of user base per month |

---

## Feedback Channels

- GitHub Issues: Feature requests
- In-app feedback: Usage analytics
- Beta testing: TestFlight (if applicable)
- User interviews: Monthly cohort analysis

---

*Last Updated:* 2026-04-23 (PGP + Argon2id security hardening)
*Next Review:* Quarterly or after major milestone
