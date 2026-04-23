# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Global quick picker (Cmd+Shift+K) for fast key search and copy
- Touch ID biometric unlock support (macOS)
- PGP key generation, import, and management via system GPG
- Git integration: per-repository SSH key assignment and deploy key setup
- Vault export/import (JSON backup and merge)
- Auto-lock timer with configurable timeout
- Dark and light theme support

### Changed
- Modern slate-based color scheme with emerald accent
- React 18 + TypeScript strict mode
- Tauri 2.0 backend with AES-256-GCM encryption

### Fixed
- N/A (initial release)

## [0.2.0] - 2026-04-23

### Added
- Initial public beta release
- Core vault management (create, unlock, lock, delete)
- SSH key storage with copy-to-clipboard and reveal
- API credential storage
- Secure notes
- Settings panel with theme, auto-lock, and defaults
- Integrity check for corrupted vaults

[Unreleased]: https://github.com/ssh-vault/ssh-vault/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ssh-vault/ssh-vault/releases/tag/v0.2.0
