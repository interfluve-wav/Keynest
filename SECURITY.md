# Security Policy

## Supported Versions

We release security updates for the latest version only. Please always keep your SSH Vault installation up to date.

## Reporting a Vulnerability

We take the security of SSH Vault seriously. If you believe you have found a security vulnerability, please report it to us privately so we can investigate and patch before public disclosure.

### How to Report

**DO NOT** open a GitHub issue for security issues. Instead, email us directly at:

**security@sshvault.dev** *(placeholder — replace with actual contact)*

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (code, environment, OS version).
- Any relevant logs or screenshots (avoid exposing secrets).

We aim to respond to all security reports within **72 hours** and will work with you to understand and fix the issue.

### What to Expect

- Initial acknowledgment within 72 hours.
- Discussion on remediation approach.
- A patch and coordinated disclosure timeline (typically 90 days after fix, or sooner if critical).
- Public credit in the release notes (unless you prefer anonymity).

## Security Best Practices for Users

- Use a strong, unique passphrase for each vault.
- Enable Touch ID for convenience but understand it stores a key in the Secure Enclave/Keychain.
- Keep your macOS and Tauri runtime updated.
- Verify downloads via checksums when available.
- Do not store vault files in cloud-synced locations (they're already encrypted, but reduce attack surface).

## Known Security Considerations

- **Local-only storage**: Vault data is stored unencrypted in memory while unlocked. The auto-lock feature mitigates this.
- **Clipboard**: Copied keys are placed in the system clipboard and may be read by other apps. Clipboard is cleared automatically by the OS after a time, but be cautious.
- **Global hotkey**: Registered at the OS level; other apps could theoretically intercept. macOS handles this securely.
- **ssh-agent integration**: Keys added to the agent are available to any process that can access the agent socket. The agent is per-user and per-session.

## Future Improvements

- Memory locking (mlock) to prevent swapping to disk.
- Optional passphrase expiration / rotation.
- Audit logging for key access.
- Hardware security key (YubiKey) support for vault unlock.

---

*This security policy is governed by the [MIT License](LICENSE).*
