package proxy

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ssh-vault/agent-chest-proxy/internal/audit"
	"github.com/ssh-vault/agent-chest-proxy/internal/netguard"
	"github.com/ssh-vault/agent-chest-proxy/internal/rbac"
	"github.com/ssh-vault/agent-chest-proxy/internal/rules"
	"github.com/ssh-vault/agent-chest-proxy/internal/vault"
)

func newTestProxy(t *testing.T) *Proxy {
	t.Helper()

	auditLogger, err := audit.NewLogger("")
	if err != nil {
		t.Fatalf("failed to create audit logger: %v", err)
	}

	return New(
		vault.NewMemoryStore(),
		rules.NewEngine(),
		rbac.NewManager(),
		auditLogger,
		netguard.New(netguard.Public),
	)
}

func TestProposalLifecycleAndApprovalMaterializesRule(t *testing.T) {
	p := newTestProxy(t)
	h := p.ManagementHandler()

	// Create one binding up-front; approval should attach the rule to this vault's bindings.
	createBindingReq := httptest.NewRequest(http.MethodPost, "/api/v1/bindings", bytes.NewBufferString(`{
		"vault_id":"vault-123",
		"credential_ids":["cred-1"],
		"rule_ids":[]
	}`))
	createBindingReq.Header.Set("Content-Type", "application/json")
	createBindingRec := httptest.NewRecorder()
	h.ServeHTTP(createBindingRec, createBindingReq)
	if createBindingRec.Code != http.StatusCreated {
		t.Fatalf("expected binding create 201, got %d body=%s", createBindingRec.Code, createBindingRec.Body.String())
	}

	createProposalReq := httptest.NewRequest(http.MethodPost, "/v1/proposals", bytes.NewBufferString(`{
		"vault_id":"vault-123",
		"host":"api.example.com",
		"path":"/v1/models",
		"method":"GET",
		"reason":"no matching rules — default allow",
		"agent_id":"agent-a"
	}`))
	createProposalReq.Header.Set("Content-Type", "application/json")
	createProposalRec := httptest.NewRecorder()
	h.ServeHTTP(createProposalRec, createProposalReq)
	if createProposalRec.Code != http.StatusCreated {
		t.Fatalf("expected proposal create 201, got %d body=%s", createProposalRec.Code, createProposalRec.Body.String())
	}

	var created map[string]any
	if err := json.Unmarshal(createProposalRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to decode proposal create response: %v", err)
	}

	proposalID, _ := created["id"].(string)
	if proposalID == "" {
		t.Fatalf("expected proposal id in create response")
	}

	listProposalReq := httptest.NewRequest(http.MethodGet, "/v1/proposals?vault_id=vault-123", nil)
	listProposalRec := httptest.NewRecorder()
	h.ServeHTTP(listProposalRec, listProposalReq)
	if listProposalRec.Code != http.StatusOK {
		t.Fatalf("expected proposal list 200, got %d body=%s", listProposalRec.Code, listProposalRec.Body.String())
	}

	var proposals []map[string]any
	if err := json.Unmarshal(listProposalRec.Body.Bytes(), &proposals); err != nil {
		t.Fatalf("failed to decode proposal list response: %v", err)
	}
	if len(proposals) != 1 {
		t.Fatalf("expected 1 proposal, got %d", len(proposals))
	}

	approveReq := httptest.NewRequest(http.MethodPost, "/v1/proposals/"+proposalID+"/approve", nil)
	approveRec := httptest.NewRecorder()
	h.ServeHTTP(approveRec, approveReq)
	if approveRec.Code != http.StatusOK {
		t.Fatalf("expected proposal approve 200, got %d body=%s", approveRec.Code, approveRec.Body.String())
	}

	var approved map[string]any
	if err := json.Unmarshal(approveRec.Body.Bytes(), &approved); err != nil {
		t.Fatalf("failed to decode approve response: %v", err)
	}
	if status, _ := approved["status"].(string); status != "approved" {
		t.Fatalf("expected approved status, got %q", status)
	}
	if rid, _ := approved["created_rule_id"].(string); rid == "" {
		t.Fatalf("expected created_rule_id in approve response")
	}

	// Verify rule was materialized.
	listRulesReq := httptest.NewRequest(http.MethodGet, "/api/v1/rules", nil)
	listRulesRec := httptest.NewRecorder()
	h.ServeHTTP(listRulesRec, listRulesReq)
	if listRulesRec.Code != http.StatusOK {
		t.Fatalf("expected rule list 200, got %d body=%s", listRulesRec.Code, listRulesRec.Body.String())
	}

	var ruleList []map[string]any
	if err := json.Unmarshal(listRulesRec.Body.Bytes(), &ruleList); err != nil {
		t.Fatalf("failed to decode rules list response: %v", err)
	}
	if len(ruleList) != 1 {
		t.Fatalf("expected 1 rule after approval, got %d", len(ruleList))
	}
	if hostMatch, _ := ruleList[0]["host_match"].(string); hostMatch != "api.example.com" {
		t.Fatalf("expected host_match api.example.com, got %q", hostMatch)
	}

	// Verify the binding picked up the materialized rule id.
	listBindingsReq := httptest.NewRequest(http.MethodGet, "/api/v1/bindings", nil)
	listBindingsRec := httptest.NewRecorder()
	h.ServeHTTP(listBindingsRec, listBindingsReq)
	if listBindingsRec.Code != http.StatusOK {
		t.Fatalf("expected binding list 200, got %d body=%s", listBindingsRec.Code, listBindingsRec.Body.String())
	}

	var bindings []map[string]any
	if err := json.Unmarshal(listBindingsRec.Body.Bytes(), &bindings); err != nil {
		t.Fatalf("failed to decode bindings list response: %v", err)
	}
	if len(bindings) != 1 {
		t.Fatalf("expected 1 binding, got %d", len(bindings))
	}
	ruleIDs, ok := bindings[0]["rule_ids"].([]any)
	if !ok || len(ruleIDs) != 1 {
		t.Fatalf("expected one rule id on binding after approval, got %#v", bindings[0]["rule_ids"])
	}
}
