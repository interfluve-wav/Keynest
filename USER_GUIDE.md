# SSH Vault - User Guide

## Getting Started

### 60-Second Agent Setup (No Code)

Use this when you want Claude Code, Hermes, OpenClaw, or Cursor to call APIs through KeyChest safely.

1. Unlock your vault
2. Open the **Proxy** tab
3. Click **Start Proxy**
4. Add one **Credential** (target API host + auth type)
5. Add one **Rule** (allow host/path/method)
6. Create one **RBAC Binding** (vault → credential + rule)
7. Open **Agents** tab
8. Click **Create Invite**
9. Redeem invite in the same tab
10. Pick your preset (`Claude Code`, `Hermes`, `OpenClaw`, or `Cursor`)
11. Click **Copy Config Snippet** (or **Download Snippet**) and paste into your tool setup

Required runtime values are included in the snippet:
- `HTTPS_PROXY`
- `Proxy-Authorization` (recommended: `Bearer <agent-token>`)
- `X-Vault-ID`
- `X-Agent-ID`
- `X-Agent-Token`

Compatibility note:
- Most tools work best with `Proxy-Authorization`.
- `X-*` headers are still supported as a fallback.

For deeper details, see [AGENT_ONBOARDING.md](./AGENT_ONBOARDING.md) and [AGENT_CHEST.md](./AGENT_CHEST.md).

### Creating Your First Vault

1. Open SSH Vault
2. Click **"Create New Vault"**
3. Enter a name (e.g., "Personal" or "Work")
4. Set a strong password
5. Your vault is created and automatically unlocked

### Unlocking with Touch ID

**First time:**
1. Enter your password to unlock
2. The encryption key is automatically stored in Keychain with Touch ID protection

**Subsequent unlocks:**
1. Click "Unlock with Touch ID"
2. Authenticate with your fingerprint
3. Vault unlocks instantly—no password needed

**Note:** The key remains in Keychain after locking, so Touch ID continues to work.

### Quick Copy Hotkey (Cmd+Shift+K)

When a vault is unlocked, you can quickly copy any key from anywhere:

1. Press `Cmd+Shift+K` from any app
2. Type to search for your key
3. Use ↑/↓ arrows to select
4. Press Enter to copy private key to clipboard
5. Paste where needed

This works even when SSH Vault is not the active window.

## Managing SSH Keys

### Importing Existing Keys

1. In your vault dashboard, click **"Import Keys"**
2. The app scans `~/.ssh` for existing keys
3. Select keys to import
4. Click **"Import Selected"**

**Important:** Keys are copied into the vault. Your original `~/.ssh` files remain untouched.

### Generating New Keys

1. Click **"Generate Key"**
2. Enter a name (e.g., "github-personal")
3. Choose key type:
   - **ed25519** (recommended - modern, secure, fast)
   - **ecdsa** (legacy compatibility)
   - **rsa** (4096-bit for old systems)
4. Add an optional comment
5. Key is generated and stored in vault

### Using Keys

**Copy private key:**
- Click the copy icon next to any key
- Or use `Cmd+Shift+K` quick picker

**Add to SSH agent:**
1. Click key to expand details
2. Click **"Add to Agent"**
3. Key is loaded into ssh-agent with optional lifetime

**Export key:**
1. Click key to expand
2. Click **"Export"**
3. Choose location and whether to include private key

**Delete key:**
1. Click key to expand
2. Click **"Delete"**
3. Confirm deletion

**Note:** Deleting from SSH Vault only removes the copy in your encrypted vault. It does NOT delete files from `~/.ssh`.

## Managing API Keys

### Adding API Keys

1. Switch to **"API Keys"** tab
2. Click **"Add API Key"**
3. Enter:
   - Name (e.g., "AWS Production")
   - Service (e.g., "AWS", "Stripe", "GitHub")
   - Key value (the actual API key)
4. Add optional notes
5. Click **Save**

### Using API Keys

- Click copy icon to copy key to clipboard
- Keys are encrypted with the same protection as SSH keys

## Git Integration

### Setting SSH Key for a Repository

1. Navigate to a Git repository in terminal
2. The app can auto-detect this, or you can manually configure
3. Click **"Configure Git"** on a key
4. Select repository path
5. The app sets up `.git/config` to use that SSH key

### Auto-Configuration

When you open a terminal in a Git repository:
1. SSH Vault detects the repository
2. Suggests appropriate SSH key based on remote URL
3. One-click to configure

## Secure Notes

### Adding Notes

1. Go to **"Notes"** tab
2. Click **"New Note"**
3. Enter title and content
4. Content is encrypted with your vault

### Use Cases

- Server connection details
- VPN credentials
- Two-factor backup codes
- Any text you want encrypted

## Settings

### Accessing Settings

Click **gear icon** in top-right of vault dashboard.

### Auto-Lock

Set timeout to automatically lock vault after inactivity:
- **Never** - Stay unlocked until manually locked
- **1 minute** - Lock after 1 minute of inactivity
- **5/15/30/60 minutes** - Longer timeouts

### Appearance

**Theme options:**
- **Dark** (default)
- **Light**
- **System** - Follows macOS appearance

*Note: Full light mode support is in development*

### Touch ID Management

**Clear Touch ID for this vault:**
1. Go to Settings → Security
2. Click **"Clear Touch ID"**
3. Next unlock will require password

### SSH Key Defaults

Set default key type for new key generation:
- **ed25519** (recommended)
- **ecdsa**
- **rsa**

## Backup and Restore

### Exporting Vault

1. Go to Settings
2. Click **"Export Vault"**
3. Choose location
4. Encrypted JSON file is created

**Security:** The export is encrypted with your vault password. It's safe to store in cloud storage or send via email.

### Importing Vault

1. Go to Settings
2. Click **"Import Vault"**
3. Select exported JSON file
4. Items are merged with current vault

**Note:** Duplicate items (same ID) are skipped.

## Security Best Practices

### Password Strength

- Use a unique password for each vault
- Minimum 12 characters recommended
- Mix letters, numbers, symbols
- Consider a passphrase (4-5 random words)

### Touch ID

- Re-enable Touch ID after major macOS updates
- Clear Touch ID if you sell or service your Mac
- Touch ID is convenience; password is ultimate security

### Key Rotation

- Rotate SSH keys every 90 days for production systems
- Delete old keys from vault after rotation
- Update GitHub/GitLab with new public keys

### Backup Strategy

1. Export vault after creating important keys
2. Store export in secure location (encrypted cloud, USB drive)
3. Test import periodically to ensure backups work

## Troubleshooting

### "Failed to decrypt vault"

- Wrong password entered
- Vault file may be corrupted
- Try restoring from backup

### "Touch ID not available"

- Touch ID not set up on this Mac
- No biometric key stored yet (use password first)
- Check System Settings → Touch ID

### "Key not found in ssh-agent"

- Click "Add to Agent" in the app
- Or run: `ssh-add ~/.ssh/your_key`

### Quick picker not working

- Make sure vault is unlocked
- Check macOS System Settings → Keyboard → Shortcuts
- Ensure no other app uses Cmd+Shift+K

### Keys not importing

- Ensure keys are valid OpenSSH format
- Check that keys start with `-----BEGIN`
- Keys without `.pub` need matching public keys

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+K` | Open quick picker (global) |
| `Esc` | Close quick picker / modal |
| `↑` / `↓` | Navigate in quick picker |
| `Enter` | Select item in quick picker |
| `Cmd+Shiftt+?` | Show keyboard shortcuts (planned) |

## FAQ

**Q: Can I sync my vault between Macs?**  
A: Use Export/Import feature. Copy the exported file via iCloud, Dropbox, or USB.

**Q: What if I forget my vault password?**  
A: There is no recovery. Store your password in a password manager or write it down securely.

**Q: Does deleting a key from SSH Vault delete it from ~/.ssh?**  
A: No. SSH Vault only works with copies in the encrypted vault.

**Q: Can I use this on Windows or Linux?**  
A: Not currently. It's designed specifically for macOS to leverage Touch ID and native integrations.

**Q: Is my data sent to any server?**  
A: No. SSH Vault is completely offline. No analytics, no cloud, no servers.

**Q: Can someone access my keys if my Mac is stolen?**  
A: Not without your vault password or your fingerprint. The vault file is encrypted.

## Getting Help

- Check this guide first
- Review the [README](./README.md) for technical details
- See [ROADMAP](./ROADMAP.md) for upcoming features
- File issues on GitHub (if public repo)
