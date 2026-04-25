# Agent Onboarding (No Code)

This guide shows the fastest way to connect an AI agent to KeyChest without writing scripts.

## What you get

- Agent credentials are brokered at the proxy layer (agent never sees API keys).
- Per-agent identity with revocable tokens.
- One-click export snippets for:
  - Claude Code
  - Hermes
  - OpenClaw
  - Cursor

## Prerequisites

- KeyChest app is installed and opens successfully.
- You can unlock a vault.

## Step-by-step

1. Open **Proxy** tab in KeyChest.
2. Click **Start Proxy**.
3. Add at least one **Credential** (target host + auth type).
4. Add at least one **Rule** (allow host/path/method).
5. Create an **RBAC Binding** linking vault → credential(s) + rule(s).
6. Open **Agents** tab.
7. Click **Create Invite** (name your agent).
8. In **Redeem Invite**, paste invite code and click **Redeem**.
9. Use the generated **New Agent Token** panel:
   - pick your tool preset
   - click **Copy Config Snippet** or **Download Snippet**
10. Paste that snippet into your agent tool/session config.

## Required runtime headers

Every proxied request must include:

- `X-Vault-ID`
- `X-Agent-ID`
- `X-Agent-Token`

And the runtime proxy variable:

- `HTTPS_PROXY=http://127.0.0.1:8080`

## Token lifecycle

- **Redeem**: creates agent + first token (shown once).
- **Rotate Token**: issues a new token (shown once, old token invalidated).
- **Revoke**: disables the agent token immediately.

## Troubleshooting

### “agent-chest-proxy binary not found”

Use the latest packaged app/dmg. Current builds bundle the proxy binary automatically.

### Agent gets 401 Unauthorized

Verify:

- `X-Agent-ID` is correct
- `X-Agent-Token` is current (not revoked/old)
- `X-Vault-ID` matches the agent’s vault

### Agent gets 403 Forbidden

Likely no matching allow rule or network guard block.

- Check **Proposals** tab for one-click approval.
- Check **Audit** tab for exact deny reason.

### CONNECT test returns curl `000`

This can happen when tunnel setup fails before a normal response. Use **Audit** tab to verify block reason.
