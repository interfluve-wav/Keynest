# Release Checklist

Use this checklist before shipping a new build.

## 1) Local verification

- `cd /Users/suhaas/Documents/Developer/ssh-vault-tauri/agent-chest-proxy && go test ./...`
- `cd /Users/suhaas/Documents/Developer/ssh-vault-tauri && ./scripts/test-proxy.sh`
- `cd /Users/suhaas/Documents/Developer/ssh-vault-tauri && npm run build`
- `cd /Users/suhaas/Documents/Developer/ssh-vault-tauri/src-tauri && cargo check`

## 2) Manual smoke test in app

- Launch app: `npm run tauri dev`
- Create or unlock a vault.
- Open Proxy tab:
  - Start proxy.
  - Add credential, rule, and binding.
  - Create invite, redeem invite, rotate token, revoke agent.
  - Verify one-click snippets for `Claude Code`, `Hermes`, `OpenClaw`, and `Cursor`.
  - Confirm audit entries update.
- Stop proxy and restart it, verify:
  - agents/invites/proposals persisted.

## 3) Security checks

- Confirm request brokering requires:
  - `X-Vault-ID`
  - `X-Agent-ID`
  - `X-Agent-Token`
- Confirm `/v1/agents` does not leak raw tokens.
- Confirm network guard blocks private IP / metadata access.

## 4) Build artifacts

- Build proxy binary:
  - `cd /Users/suhaas/Documents/Developer/ssh-vault-tauri/agent-chest-proxy && go build -o ../src-tauri/ ./cmd/agent-chest-proxy/`
- Build desktop app bundle:
  - `cd /Users/suhaas/Documents/Developer/ssh-vault-tauri && npm run tauri build`

## 5) Release metadata

- Update version fields (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`) if needed.
- Update `README.md` and changelog/release notes.
- Tag release commit.
