# Agent Chest — HTTP Credential Proxy for AI Agents

Agent Chest is an HTTP credential proxy and vault built into SSH Vault Tauri. It prevents AI agents from ever touching raw API credentials by brokering authentication at the proxy layer.

## The Problem

Secret managers return credentials to the caller and trust them to behave. AI agents break that assumption — they are non-deterministic, prompt-injectable, and increasingly sitting in front of production APIs.

## The Solution

Instead of returning credentials to the agent, Agent Chest forces the agent to proxy requests through it. Credentials stay encrypted in the vault. The proxy injects them into outbound requests and forwards to the target API. The agent never sees the keys.

```
Without Agent Chest:
  Agent → "Give me the key" → Vault → returns sk-prod-key → Agent sends request with key
                                                           ↑ Key in agent memory. Exfiltratable.

With Agent Chest:
  Agent → HTTPS_PROXY=http://127.0.0.1:8080
  Agent → sends normal HTTP request (no key)
  Proxy → matches host to stored credential
  Proxy → injects Authorization header
  Proxy → forwards to target API
  Proxy → logs request to audit trail
           ↑ Agent never saw the credential.
```

## Features

### Brokered Access via HTTPS_PROXY
Agents configure `HTTPS_PROXY` and send `X-Vault-ID`, `X-Agent-ID`, and `X-Agent-Token`. The proxy intercepts requests, validates agent identity and vault scope, matches the target host to stored credentials, injects auth headers, and forwards. Nothing to exfiltrate.

### Firewall-like Access Rules
Define allow/deny rules by host pattern, path pattern, and HTTP method. Agents can only reach whitelisted endpoints.

| Rule | Host Match | Path Match | Methods | Action |
|------|------------|------------|---------|--------|
| Allow OpenAI | `api.openai.com` | `/v1/*` | GET, POST | Allow |
| Deny Internal | `*.internal.example.com` | `*` | * | Deny |
| Allow GitHub | `api.github.com` | `*` | * | Allow |

### Multi-Vault RBAC
Bind credentials and rules to specific vault IDs. Agent A with vault X can access OpenAI. Agent B with vault Y can only access GitHub. Blast radius is scoped.

### Full Audit Trail
Every request is logged with:
- Timestamp, agent ID, vault ID
- Method, target host, path
- Action (allow, deny, broker, error)
- HTTP status code, matched credential, matched rule
- Source IP, user agent, duration in ms

### Single Go Binary
The proxy compiles to a single Go binary. Available as a Docker container. No external dependencies.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  SSH Vault Tauri App                                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Frontend (React)                                           │ │
│  │  ├── ProxyManager component — start/stop, credentials,     │ │
│  │  │   rules, RBAC bindings, audit trail                      │ │
│  │  └── Proxy tab in VaultDashboard                            │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │  Rust Backend (proxy.rs)                                    │ │
│  │  ├── Spawns agent-chest-proxy binary                        │ │
│  │  ├── Bridges management API (localhost:8081)               │ │
│  │  └── Tauri commands: start/stop/status, discover, CRUD, proposals, agents, invites, audit │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  agent-chest-proxy (Go binary — separate process)                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  Proxy Server │  │  Mgmt API    │  │  Audit Logger       │   │
│  │  :8080        │  │  :8081       │  │  (file + memory)    │   │
│  │  ┌──────────┐ │  │  ┌────────┐  │  └────────────────────┘   │
│  │  │ HTTP     │ │  │  │ CRUD   │  │  ┌────────────────────┐   │
│  │  │ CONNECT │ │  │  │ Rules  │  │  │  Network Guard     │   │
│  │  │ Forward  │ │  │  │ RBAC   │  │  │  · Block private IPs│   │
│  │  └──────────┘ │  │  │ Audit  │  │  │  · Block metadata  │   │
│  │  ┌──────────┐ │  │  │Discover│  │  └────────────────────┘   │
│  │  │ /proxy/* │ │  │  └────────┘  │  ┌────────────────────┐   │
│  │  └──────────┘ │  │  /api/v1/*    │  │  In-Memory Stores  │   │
│  └──────────────┘  └──────────────┘  │  · Credentials     │   │
│                                       │  · Rules           │   │
│                                       │  · Bindings        │   │
│                                       └────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Build the proxy binary

```bash
cd agent-chest-proxy
go build -o ../src-tauri/ ./cmd/agent-chest-proxy/
```

### 2. Start the app

```bash
npm run tauri dev
```

### 3. Start the proxy

Open the app, unlock a vault, click the **Proxy** tab, and hit **Start Proxy**. Or start it manually:

```bash
./src-tauri/agent-chest-proxy --proxy-port 8080 --mgmt-port 8081
```

### 4. Configure your agent

```bash
export HTTPS_PROXY=http://127.0.0.1:8080
export X_VAULT_ID=your-vault-id-here
export X_AGENT_ID=agent-id-from-redeem
export X_AGENT_TOKEN=agent-token-from-redeem

# Agent makes normal requests — proxy handles auth
curl https://api.openai.com/v1/chat/completions
```

### 5. No-code onboarding (recommended)

In the app Proxy tab:
1. Create invite
2. Redeem invite
3. Copy/download the generated one-click snippet
4. Use a preset: `Claude Code`, `Hermes`, `OpenClaw`, or `Cursor`

## Management API Reference

The management API runs on port 8081 by default.

### Status

```
GET /api/v1/status
→ {"status":"running","audit_entries":42}
```

### Discover

Returns available services and credential keys for agents to learn what they can access.

```
GET /api/v1/discover?vault_id=<vault-id>
→ {
    "vault": "vault-uuid",
    "services": [
      {"host": "api.openai.com", "description": "OpenAI API"},
      {"host": "*.github.com", "description": "GitHub API"}
    ],
    "available_credential_keys": ["OPENAI_KEY", "GITHUB_TOKEN"]
  }
```

### Explicit Proxy Endpoint

For clients that can't use `HTTPS_PROXY`, requests can be made through the management API:

```
GET  http://127.0.0.1:8081/proxy/api.openai.com/v1/chat/completions
X-Vault-ID: <vault-id>
X-Agent-ID: <agent-id>
X-Agent-Token: <agent-token>
```

The proxy matches the target host against credentials, injects auth, and forwards over HTTPS. Returns 403 with a `proposal_hint` if the host is not allowed.

### Proposals

```
GET  /v1/proposals?vault_id=<vault-id>&status=pending
POST /v1/proposals
POST /v1/proposals/:id/approve
POST /v1/proposals/:id/deny
```

When `/proxy/*` is denied due to missing allow rules, the proxy can create a proposal (`proposal_id`) for one-click approval.

### Invites and Agents

```
GET  /v1/invites?vault_id=<vault-id>
POST /v1/invites
POST /v1/invites/:code/redeem

GET  /v1/agents?vault_id=<vault-id>
POST /v1/agents/:id/rotate-token
POST /v1/agents/:id/revoke
```

Notes:
- `redeem` and `rotate-token` return the one-time plaintext token.
- `list agents` does not return plaintext tokens.
- proxy data-plane requests require `X-Agent-ID` and `X-Agent-Token`.

### Credentials

```
GET    /api/v1/credentials          — List all credentials
POST   /api/v1/credentials          — Add credential
GET    /api/v1/credentials/:id      — Get credential
DELETE /api/v1/credentials/:id      — Delete credential
```

**Credential object:**
```json
{
  "id": "uuid",
  "name": "OpenAI API Key",
  "vault_id": "vault-uuid",
  "target_host": "api.openai.com",
  "target_prefix": "/v1",
  "auth_type": "bearer",
  "header_name": "",
  "header_value": "sk-...",
  "created_at": "2026-04-23T00:00:00Z"
}
```

**Auth types:**
| Type | Behavior |
|------|----------|
| `bearer` | Sets `Authorization: Bearer <value>` |
| `api_key_header` | Sets `<header_name>: <value>` (e.g., `steel-api-key: <key>`) |
| `basic_auth` | Sets `Authorization: Basic <value>` (value = base64(user:pass)) |

### Access Rules

```
GET    /api/v1/rules         — List all rules
POST   /api/v1/rules         — Add rule
DELETE /api/v1/rules/:id      — Delete rule
```

**Rule object:**
```json
{
  "id": "uuid",
  "vault_id": "vault-uuid",
  "name": "Allow OpenAI",
  "host_match": "api.openai.com",
  "path_match": "/v1/*",
  "methods": ["GET", "POST"],
  "action": "allow",
  "created_at": "2026-04-23T00:00:00Z"
}
```

**Pattern matching:**
| Pattern | Matches |
|---------|---------|
| `*` | Any host/path |
| `api.openai.com` | Exact match |
| `*.example.com` | Any subdomain of example.com |
| `/v1/*` | Any path starting with /v1/ |

### RBAC Bindings

```
GET    /api/v1/bindings         — List all bindings
POST   /api/v1/bindings         — Create binding
DELETE /api/v1/bindings/:id      — Delete binding
```

**Binding object:**
```json
{
  "id": "uuid",
  "vault_id": "vault-uuid",
  "credential_ids": ["cred-1", "cred-2"],
  "rule_ids": ["rule-1", "rule-2"],
  "created_at": "2026-04-23T00:00:00Z"
}
```

### Audit Log

```
GET /api/v1/audit?limit=100&offset=0
```

**Audit entry:**
```json
{
  "timestamp": "2026-04-23T19:18:59Z",
  "agent_id": "my-agent-1",
  "vault_id": "vault-uuid",
  "method": "GET",
  "target": "api.openai.com",
  "path": "/v1/chat/completions",
  "action": "broker",
  "status_code": 200,
  "credential_id": "cred-uuid",
  "rule": "allowed by rule: Allow OpenAI",
  "source_ip": "127.0.0.1:63939",
  "user_agent": "python-requests/2.31.0",
  "duration_ms": 148
}
```

## Docker

```bash
docker build -t agent-chest-proxy ./agent-chest-proxy
docker run -p 8080:8080 -p 8081:8081 agent-chest-proxy
```

With a config file:
```bash
docker run -p 8080:8080 -p 8081:8081 \
  -v ./config.json:/etc/agent-chest/config.json \
  agent-chest-proxy --config /etc/agent-chest/config.json
```

## Configuration File

```json
{
  "credentials": [
    {
      "id": "prod-openai",
      "name": "OpenAI Production",
      "vault_id": "vault-uuid",
      "target_host": "api.openai.com",
      "target_prefix": "/v1",
      "auth_type": "bearer",
      "header_name": "",
      "header_value": "sk-prod-xxx",
      "created_at": "2026-04-23T00:00:00Z"
    }
  ],
  "rules": [
    {
      "id": "allow-openai",
      "vault_id": "vault-uuid",
      "name": "Allow OpenAI API",
      "host_match": "api.openai.com",
      "path_match": "/v1/*",
      "methods": ["GET", "POST"],
      "action": "allow",
      "created_at": "2026-04-23T00:00:00Z"
    }
  ],
  "bindings": [
    {
      "id": "agent-a-binding",
      "vault_id": "vault-uuid",
      "credential_ids": ["prod-openai"],
      "rule_ids": ["allow-openai"],
      "created_at": "2026-04-23T00:00:00Z"
    }
  ]
}
```

## How Credential Injection Works

| Auth Type | Host Match | Behavior |
|-----------|------------|----------|
| `bearer` | Request host matches `target_host` | Injects `Authorization: Bearer <header_value>` |
| `api_key_header` | Request host matches `target_host` | Injects `<header_name>: <header_value>` (e.g., `steel-api-key: xxx`) |
| `basic_auth` | Request host matches `target_host` | Injects `Authorization: Basic <header_value>` |
| `passthrough` | Request host matches `target_host` | No credential injection — client's headers flow through unchanged |

For HTTPS (CONNECT) requests where a matching credential exists, the proxy upgrades the connection to a forward-proxy request — it makes the TLS request itself with injected headers and relays the response back, ensuring credentials are injected even over HTTPS.

For HTTPS requests with no matching credential, the proxy tunnels the connection transparently (standard CONNECT behavior).

## Network Guard (SSRF Prevention)

Agent Chest includes a network guard that validates every outbound proxy connection at the IP level, preventing agents from using the proxy to reach internal infrastructure.

### Modes

| Mode | Behavior |
|------|----------|
| `public` (default) | Blocks private/reserved IPs and cloud metadata endpoints |
| `private` | Blocks only cloud metadata endpoints (for trusted networks) |

Set via `--network-mode=private` CLI flag.

### Always blocked (both modes)

- `169.254.169.254/32` — AWS/GCP/Azure instance metadata
- `fd00:ec2::254/128` — AWS IMDSv2 IPv6

### Blocked in public mode

- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` — RFC1918 private
- `127.0.0.0/8`, `::1/128` — loopback
- `169.254.0.0/16`, `fe80::/10` — link-local
- `fc00::/7` — IPv6 unique local
- `100.64.0.0/10` — carrier-grade NAT
- `0.0.0.0/32` — unspecified

### DNS rebinding protection

The guard resolves hostnames, validates the IP against the block list, then connects. This prevents DNS rebinding where a hostname resolves to a safe IP during validation but a different (internal) IP during connection.

## Security Considerations

- **Credentials/rules/bindings are runtime-managed** — they are loaded from config or management API.
- **Agents/invites/proposals are persisted** — state survives proxy restart.
- **Management API has no auth** — bind to localhost only. In production, put an auth proxy in front.
- **Vault encryption is AES-256-GCM** — the same encryption used for the main vault.
- **Audit logs** can be written to disk for forensics and compliance.
- **Host pattern matching** prevents agents from reaching unintended endpoints.
- **Method filtering** restricts agents to safe HTTP methods (e.g., GET/POST only, no DELETE).
- **Network guard** blocks SSRF attacks — agents cannot reach private IPs, loopback, or cloud metadata endpoints through the proxy.
