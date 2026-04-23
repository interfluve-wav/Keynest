#!/usr/bin/env bash
set -euo pipefail

# Agent Chest Proxy Integration Tests
# Usage: ./scripts/test-proxy.sh [ --skip-build ]

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

PROXY_PID=""
PROXY_PORT=18080
MGMT_PORT=18081
PROXY_BIN=""
VAULT_ID="test-vault-$(date +%s)"
AGENT_ID=""
AGENT_TOKEN=""

cleanup() {
    if [ -n "$PROXY_PID" ]; then
        kill "$PROXY_PID" 2>/dev/null || true
        wait "$PROXY_PID" 2>/dev/null || true
    fi
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════${NC}"
    if [ "$FAIL" -gt 0 ]; then
        exit 1
    fi
}
trap cleanup EXIT

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo -e "  ${GREEN}✓${NC} $desc"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $desc"
        echo -e "    expected: $expected"
        echo -e "    actual:   $actual"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    local desc="$1" haystack="$2" needle="$3"
    if echo "$haystack" | grep -q "$needle"; then
        echo -e "  ${GREEN}✓${NC} $desc"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $desc"
        echo -e "    expected to contain: $needle"
        echo -e "    actual: $haystack"
        FAIL=$((FAIL + 1))
    fi
}

assert_not_contains() {
    local desc="$1" haystack="$2" needle="$3"
    if ! echo "$haystack" | grep -q "$needle"; then
        echo -e "  ${GREEN}✓${NC} $desc"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $desc"
        echo -e "    expected NOT to contain: $needle"
        echo -e "    actual: $haystack"
        FAIL=$((FAIL + 1))
    fi
}

wait_for_proxy() {
    local max_attempts=20
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/status" >/dev/null 2>&1; then
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 0.25
    done
    return 1
}

# ─── Build ──────────────────────────────────────────────────────────────────

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}  Agent Chest Proxy — Integration Tests${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

PROXY_BIN="$(dirname "$0")/../src-tauri/agent-chest-proxy"
if [ ! -f "$PROXY_BIN" ]; then
    PROXY_BIN="./src-tauri/agent-chest-proxy"
fi

if [ "${1:-}" != "--skip-build" ]; then
    echo -e "${YELLOW}Building agent-chest-proxy...${NC}"
    (cd "$(dirname "$0")/../agent-chest-proxy" && go build -o ../src-tauri/agent-chest-proxy ./cmd/agent-chest-proxy/)
    echo -e "${GREEN}Build succeeded${NC}"
    echo ""
fi

# ─── Start Proxy ──────────────────────────────────────────────────────────

echo -e "${YELLOW}Starting proxy on :$PROXY_PORT (mgmt: :$MGMT_PORT)...${NC}"
"$PROXY_BIN" --proxy-port "$PROXY_PORT" --mgmt-port "$MGMT_PORT" --network-mode public &
PROXY_PID=$!

if wait_for_proxy; then
    echo -e "${GREEN}Proxy is running (PID: $PROXY_PID)${NC}"
else
    echo -e "${RED}Proxy failed to start${NC}"
    FAIL=$((FAIL + 1))
    exit 1
fi
echo ""

# ─── Bootstrap Agent Identity ──────────────────────────────────────────────

INVITE_RESP=$(curl -sf -X POST "http://127.0.0.1:$MGMT_PORT/v1/invites" \
    -H 'Content-Type: application/json' \
    -d "{
        \"vault_id\": \"$VAULT_ID\",
        \"name\": \"test-agent\"
    }")
INVITE_CODE=$(echo "$INVITE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")

REDEEM_RESP=$(curl -sf -X POST "http://127.0.0.1:$MGMT_PORT/v1/invites/$INVITE_CODE/redeem" \
    -H 'Content-Type: application/json' \
    -d '{"name":"test-agent"}')
AGENT_ID=$(echo "$REDEEM_RESP" | python3 -c "import sys,json; print((json.load(sys.stdin).get('agent') or {}).get('id',''))" 2>/dev/null || echo "")
AGENT_TOKEN=$(echo "$REDEEM_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

if [ -z "$AGENT_ID" ] || [ -z "$AGENT_TOKEN" ]; then
    echo -e "${RED}Failed to bootstrap agent auth token${NC}"
    FAIL=$((FAIL + 1))
    exit 1
fi
echo ""

# ─── Test 1: Status Endpoint ──────────────────────────────────────────────

echo -e "${CYAN}[1/10] Status endpoint${NC}"
STATUS=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/status")
assert_contains "status endpoint returns running" "$STATUS" "running"
echo ""

# ─── Test 2: Network Guard (via explicit /proxy/ and audit log) ──────────

echo -e "${CYAN}[2/10] Network guard (SSRF prevention)${NC}"

# Private IP blocked via explicit proxy
# Private IP blocked via explicit proxy
BODY_FILE=$(mktemp)
RESP=$(curl -s -o "$BODY_FILE" -w "%{http_code}" \
    -H "X-Vault-ID: $VAULT_ID" \
    -H "X-Agent-ID: $AGENT_ID" \
    -H "X-Agent-Token: $AGENT_TOKEN" \
    "http://127.0.0.1:$MGMT_PORT/proxy/192.168.1.1/headers" 2>/dev/null)
BODY=$(cat "$BODY_FILE" 2>/dev/null || echo "")
rm -f "$BODY_FILE"
assert_eq "explicit proxy: private IP blocked (192.168.1.1)" "403" "$RESP"
assert_contains "private IP block response has proposal_hint" "$BODY" "proposal_hint"

# Cloud metadata blocked
RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Vault-ID: $VAULT_ID" \
    -H "X-Agent-ID: $AGENT_ID" \
    -H "X-Agent-Token: $AGENT_TOKEN" \
    "http://127.0.0.1:$MGMT_PORT/proxy/169.254.169.254/latest/meta-data/" 2>/dev/null)
assert_eq "explicit proxy: cloud metadata blocked" "403" "$RESP"

# Loopback blocked
RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Vault-ID: $VAULT_ID" \
    -H "X-Agent-ID: $AGENT_ID" \
    -H "X-Agent-Token: $AGENT_TOKEN" \
    "http://127.0.0.1:$MGMT_PORT/proxy/127.0.0.1:3000/api" 2>/dev/null)
assert_eq "explicit proxy: loopback blocked" "403" "$RESP"

# Verify netguard entries in audit log
AUDIT=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/audit?limit=50&offset=0")
assert_contains "audit log contains netguard denials" "$AUDIT" "netguard"
echo ""

# ─── Test 3: Add Credentials ──────────────────────────────────────────────

echo -e "${CYAN}[3/10] Credential CRUD${NC}"

RESP=$(curl -sf -X POST "http://127.0.0.1:$MGMT_PORT/api/v1/credentials" \
    -H 'Content-Type: application/json' \
    -d "{
        \"id\": \"cred-bearer\",
        \"name\": \"Test Bearer Token\",
        \"vault_id\": \"$VAULT_ID\",
        \"target_host\": \"httpbin.org\",
        \"target_prefix\": \"\",
        \"auth_type\": \"bearer\",
        \"header_name\": \"\",
        \"header_value\": \"test-bearer-token-123\",
        \"created_at\": \"2026-01-01T00:00:00Z\"
    }")
assert_contains "add bearer credential" "$RESP" "cred-bearer"

RESP=$(curl -sf -X POST "http://127.0.0.1:$MGMT_PORT/api/v1/credentials" \
    -H 'Content-Type: application/json' \
    -d "{
        \"id\": \"cred-apikey\",
        \"name\": \"Test API Key\",
        \"vault_id\": \"$VAULT_ID\",
        \"target_host\": \"api.anthropic.com\",
        \"target_prefix\": \"\",
        \"auth_type\": \"api_key_header\",
        \"header_name\": \"x-api-key\",
        \"header_value\": \"sk-ant-test-key\",
        \"created_at\": \"2026-01-01T00:00:00Z\"
    }")
assert_contains "add API key credential" "$RESP" "cred-apikey"

RESP=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/credentials")
CREDCOUNT=$(echo "$RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
assert_eq "credential count is 2" "2" "$CREDCOUNT"

curl -sf -X DELETE "http://127.0.0.1:$MGMT_PORT/api/v1/credentials/cred-apikey" >/dev/null
RESP=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/credentials")
CREDCOUNT=$(echo "$RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
assert_eq "credential count after delete is 1" "1" "$CREDCOUNT"
echo ""

# ─── Test 4: Access Rules ────────────────────────────────────────────────

echo -e "${CYAN}[4/10] Access rules (allow/deny)${NC}"

RESP=$(curl -sf -X POST "http://127.0.0.1:$MGMT_PORT/api/v1/rules" \
    -H 'Content-Type: application/json' \
    -d "{
        \"id\": \"rule-allow-httpbin\",
        \"vault_id\": \"$VAULT_ID\",
        \"name\": \"Allow httpbin\",
        \"host_match\": \"httpbin.org\",
        \"path_match\": \"/*\",
        \"methods\": [\"GET\", \"POST\"],
        \"action\": \"allow\",
        \"created_at\": \"2026-01-01T00:00:00Z\"
    }")
assert_contains "add allow rule" "$RESP" "rule-allow-httpbin"

RESP=$(curl -sf -X POST "http://127.0.0.1:$MGMT_PORT/api/v1/rules" \
    -H 'Content-Type: application/json' \
    -d "{
        \"id\": \"rule-deny-internal\",
        \"vault_id\": \"\",
        \"name\": \"Deny internal\",
        \"host_match\": \"*.internal.example.com\",
        \"path_match\": \"*\",
        \"methods\": [\"*\"],
        \"action\": \"deny\",
        \"created_at\": \"2026-01-01T00:00:00Z\"
    }")
assert_contains "add deny rule" "$RESP" "rule-deny-internal"

RESP=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/rules")
RULECOUNT=$(echo "$RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
assert_eq "rule count is 2" "2" "$RULECOUNT"
echo ""

# ─── Test 5: RBAC Bindings ───────────────────────────────────────────────

echo -e "${CYAN}[5/10] RBAC bindings${NC}"

RESP=$(curl -sf -X POST "http://127.0.0.1:$MGMT_PORT/api/v1/bindings" \
    -H 'Content-Type: application/json' \
    -d "{
        \"vault_id\": \"$VAULT_ID\",
        \"credential_ids\": [\"cred-bearer\"],
        \"rule_ids\": [\"rule-allow-httpbin\"]
    }")
assert_contains "create binding" "$RESP" "$VAULT_ID"

RESP=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/bindings")
BINDCOUNT=$(echo "$RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
assert_eq "binding count is 1" "1" "$BINDCOUNT"
echo ""

# ─── Test 6: Discover Endpoint ───────────────────────────────────────────

echo -e "${CYAN}[6/10] Discover endpoint${NC}"

RESP=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/discover?vault_id=$VAULT_ID")
assert_contains "discover returns vault" "$RESP" "$VAULT_ID"
assert_contains "discover returns services" "$RESP" "services"
assert_contains "discover includes httpbin.org" "$RESP" "httpbin.org"
assert_contains "discover returns credential keys" "$RESP" "available_credential_keys"
echo ""

# ─── Test 7: Credential Injection via HTTPS_PROXY ─────────────────────────

echo -e "${CYAN}[7/10] Credential injection (CONNECT proxy)${NC}"

RESP=$(curl -s -k -x http://127.0.0.1:$PROXY_PORT \
    --proxy-header "X-Vault-ID: $VAULT_ID" \
    --proxy-header "X-Agent-ID: $AGENT_ID" \
    --proxy-header "X-Agent-Token: $AGENT_TOKEN" \
    "https://httpbin.org/headers" 2>/dev/null || echo "")

if [ -z "$RESP" ]; then
    echo -e "  ${YELLOW}⊘${NC} HTTPS CONNECT proxy test skipped (no internet or httpbin unreachable)"
    SKIP=$((SKIP + 1))
else
    assert_contains "bearer token injected into request" "$RESP" "test-bearer-token-123"
fi
echo ""

# CONNECT blocks should be validated via audit logs rather than curl HTTP codes.
curl -s -k -x http://127.0.0.1:$PROXY_PORT \
    --proxy-header "X-Vault-ID: $VAULT_ID" \
    --proxy-header "X-Agent-ID: $AGENT_ID" \
    --proxy-header "X-Agent-Token: $AGENT_TOKEN" \
    --connect-timeout 3 --max-time 5 \
    "https://192.168.1.1/" >/dev/null 2>&1 || true

AUDIT=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/audit?limit=100&offset=0")
assert_contains "CONNECT block recorded in audit" "$AUDIT" "\"method\":\"CONNECT\""
assert_contains "CONNECT block recorded as deny" "$AUDIT" "\"action\":\"deny\""
assert_contains "CONNECT block targets private IP" "$AUDIT" "192.168.1.1"
echo ""

# ─── Test 8: Explicit Proxy Endpoint ──────────────────────────────────────

echo -e "${CYAN}[8/10] Explicit /proxy/ endpoint${NC}"

RESP=$(curl -sf -H "X-Vault-ID: $VAULT_ID" -H "X-Agent-ID: $AGENT_ID" -H "X-Agent-Token: $AGENT_TOKEN" \
    "http://127.0.0.1:$MGMT_PORT/proxy/httpbin.org/headers" 2>/dev/null || echo "")

if [ -z "$RESP" ]; then
    echo -e "  ${YELLOW}⊘${NC} Explicit proxy test skipped (no internet or httpbin unreachable)"
    SKIP=$((SKIP + 1))
else
    assert_contains "explicit proxy injects bearer token" "$RESP" "test-bearer-token-123"
fi

# Test that an allowed host but with netguard-blocked target returns 403 with JSON
BODY_FILE=$(mktemp)
HTTP_CODE=$(curl -s -o "$BODY_FILE" -w "%{http_code}" \
    -H "X-Vault-ID: $VAULT_ID" \
    -H "X-Agent-ID: $AGENT_ID" \
    -H "X-Agent-Token: $AGENT_TOKEN" \
    "http://127.0.0.1:$MGMT_PORT/proxy/192.168.1.1/test" 2>/dev/null)
BODY=$(cat "$BODY_FILE" 2>/dev/null || echo "")
rm -f "$BODY_FILE"
assert_eq "netguard block returns 403" "403" "$HTTP_CODE"
assert_contains "netguard 403 includes proposal_hint" "$BODY" "proposal_hint"
echo ""

# ─── Test 9: Passthrough Auth ────────────────────────────────────────────

echo -e "${CYAN}[9/10] Passthrough auth type${NC}"

RESP=$(curl -sf -X POST "http://127.0.0.1:$MGMT_PORT/api/v1/credentials" \
    -H 'Content-Type: application/json' \
    -d "{
        \"id\": \"cred-passthrough\",
        \"name\": \"Passthrough\",
        \"vault_id\": \"$VAULT_ID\",
        \"target_host\": \"example.com\",
        \"target_prefix\": \"\",
        \"auth_type\": \"passthrough\",
        \"header_name\": \"\",
        \"header_value\": \"\",
        \"created_at\": \"2026-01-01T00:00:00Z\"
    }")
assert_contains "add passthrough credential" "$RESP" "cred-passthrough"

RESP=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/discover?vault_id=$VAULT_ID")
assert_contains "discover includes passthrough host" "$RESP" "example.com"
echo ""

# ─── Test 10: Audit Logging ───────────────────────────────────────────────

echo -e "${CYAN}[10/10] Audit logging${NC}"

RESP=$(curl -sf "http://127.0.0.1:$MGMT_PORT/api/v1/audit?limit=100&offset=0")
assert_contains "audit log has entries" "$RESP" "timestamp"
assert_contains "audit log contains netguard denials" "$RESP" "netguard"

ENTRYCOUNT=$(echo "$RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$ENTRYCOUNT" -gt 0 ]; then
    echo -e "  ${GREEN}✓${NC} audit log has $ENTRYCOUNT entries"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}✗${NC} audit log is empty"
    FAIL=$((FAIL + 1))
fi
echo ""

# ─── Cleanup ──────────────────────────────────────────────────────────────

echo -e "${YELLOW}Cleaning up...${NC}"
if [ -n "$PROXY_PID" ]; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
    PROXY_PID=""
fi
