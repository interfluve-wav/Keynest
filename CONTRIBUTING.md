# Contributing to SSH Vault

Thank you for your interest in contributing! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- **Rust** (edition 2021) — [rustup.rs](https://rustup.rs/)
- **Node.js** 18+ — for frontend tooling
- **Tauri CLI** — `cargo install tauri-cli`
- **macOS** — This project is macOS-only (uses Touch ID via LocalAuthentication)

### Development Setup

```bash
# Clone and install dependencies
npm install

# Run in dev mode (frontend hot-reload + Tauri)
npm run tauri dev

# Or run frontend only
npm run dev
```

### Building for Production

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/macos/SSH\ Vault.app
```

## Project Structure

```
src/               # Frontend (React + TypeScript + Tailwind)
  components/      # React components
  lib/
    api.ts         # Tauri command wrappers
    store.ts       # Zustand state
src-tauri/src/     # Backend (Rust)
  crypto.rs        # AES-256-GCM, Argon2id, PBKDF2
  ssh.rs           # SSH key generation, ssh-agent integration
  pgp.rs           # PGP key management via gpg
  git.rs           # Git integration
  biometric.rs     # Touch ID via Keychain
  models.rs        # Data structures & vault persistence
```

## Coding Standards

- **Frontend**: Follow existing patterns — functional components, Tailwind CSS, Lucide icons. Keep components small and focused.
- **Rust**: Run `cargo fmt` before committing. Run `cargo clippy` — all warnings must be resolved.
- **TypeScript**: Strict mode enabled. No `any` unless absolutely necessary.
- **Commits**: Write clear, descriptive commit messages. Reference issues if applicable.

## Security

This project handles sensitive cryptographic material. When contributing:

- Never log secrets, keys, or plaintext passwords.
- Always use constant-time comparisons for secrets (use `subtle` or `constant_time` crates).
- Ensure all user input is validated before use.
- New crypto changes must include unit tests.

See [SECURITY.md](SECURITY.md) for responsible disclosure.

## Testing

### Frontend (Vitest)
```bash
npm run test        # Run once
npm run test:watch  # Watch mode
```

### Rust (cargo test)
```bash
cargo test          # All unit tests
cargo test --lib   # Library tests only
```

Please add tests for new functionality or bug fixes.

## Submitting Changes

1. Fork the repository.
2. Create a feature branch (`git checkout -b feat/your-feature`).
3. Make your changes, add tests, ensure all tests pass.
4. Run `cargo fmt` and `cargo clippy` — fix any warnings.
5. Commit with a clear message.
6. Push and open a Pull Request.

## Code of Conduct

Be respectful, inclusive, and constructive. Harassment or discrimination of any kind is not tolerated.

## Questions?

Open an issue for discussion before starting large changes.

---

Happy coding! 🔐
