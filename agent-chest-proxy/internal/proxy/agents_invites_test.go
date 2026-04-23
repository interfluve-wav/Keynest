package proxy

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInviteRedeemAndAgentTokenLifecycle(t *testing.T) {
	p := newTestProxy(t)
	h := p.ManagementHandler()

	// Create invite
	createInviteReq := httptest.NewRequest(http.MethodPost, "/v1/invites", bytes.NewBufferString(`{
		"vault_id":"vault-abc",
		"name":"Codex Worker"
	}`))
	createInviteReq.Header.Set("Content-Type", "application/json")
	createInviteRec := httptest.NewRecorder()
	h.ServeHTTP(createInviteRec, createInviteReq)
	if createInviteRec.Code != http.StatusCreated {
		t.Fatalf("expected invite create 201, got %d body=%s", createInviteRec.Code, createInviteRec.Body.String())
	}

	var invite map[string]any
	if err := json.Unmarshal(createInviteRec.Body.Bytes(), &invite); err != nil {
		t.Fatalf("failed to decode invite create response: %v", err)
	}
	code, _ := invite["code"].(string)
	if code == "" {
		t.Fatalf("expected invite code")
	}

	// Redeem invite into an agent + token
	redeemReq := httptest.NewRequest(http.MethodPost, "/v1/invites/"+code+"/redeem", bytes.NewBufferString(`{
		"name":"Codex Worker A"
	}`))
	redeemReq.Header.Set("Content-Type", "application/json")
	redeemRec := httptest.NewRecorder()
	h.ServeHTTP(redeemRec, redeemReq)
	if redeemRec.Code != http.StatusCreated {
		t.Fatalf("expected invite redeem 201, got %d body=%s", redeemRec.Code, redeemRec.Body.String())
	}

	var redeemed map[string]any
	if err := json.Unmarshal(redeemRec.Body.Bytes(), &redeemed); err != nil {
		t.Fatalf("failed to decode redeem response: %v", err)
	}
	agentObj, ok := redeemed["agent"].(map[string]any)
	if !ok {
		t.Fatalf("expected agent object in redeem response")
	}
	agentID, _ := agentObj["id"].(string)
	if agentID == "" {
		t.Fatalf("expected agent id in redeem response")
	}
	initialToken, _ := redeemed["token"].(string)
	if initialToken == "" {
		t.Fatalf("expected initial token in redeem response")
	}

	// List agents
	listAgentsReq := httptest.NewRequest(http.MethodGet, "/v1/agents?vault_id=vault-abc", nil)
	listAgentsRec := httptest.NewRecorder()
	h.ServeHTTP(listAgentsRec, listAgentsReq)
	if listAgentsRec.Code != http.StatusOK {
		t.Fatalf("expected list agents 200, got %d body=%s", listAgentsRec.Code, listAgentsRec.Body.String())
	}

	var agents []map[string]any
	if err := json.Unmarshal(listAgentsRec.Body.Bytes(), &agents); err != nil {
		t.Fatalf("failed to decode list agents response: %v", err)
	}
	if len(agents) != 1 {
		t.Fatalf("expected 1 agent, got %d", len(agents))
	}

	// Rotate token
	rotateReq := httptest.NewRequest(http.MethodPost, "/v1/agents/"+agentID+"/rotate-token", nil)
	rotateRec := httptest.NewRecorder()
	h.ServeHTTP(rotateRec, rotateReq)
	if rotateRec.Code != http.StatusOK {
		t.Fatalf("expected rotate token 200, got %d body=%s", rotateRec.Code, rotateRec.Body.String())
	}

	var rotateResp map[string]any
	if err := json.Unmarshal(rotateRec.Body.Bytes(), &rotateResp); err != nil {
		t.Fatalf("failed to decode rotate response: %v", err)
	}
	newToken, _ := rotateResp["token"].(string)
	if newToken == "" || newToken == initialToken {
		t.Fatalf("expected new token different from initial token")
	}

	// Revoke agent
	revokeReq := httptest.NewRequest(http.MethodPost, "/v1/agents/"+agentID+"/revoke", nil)
	revokeRec := httptest.NewRecorder()
	h.ServeHTTP(revokeRec, revokeReq)
	if revokeRec.Code != http.StatusOK {
		t.Fatalf("expected revoke 200, got %d body=%s", revokeRec.Code, revokeRec.Body.String())
	}

	var revokeResp map[string]any
	if err := json.Unmarshal(revokeRec.Body.Bytes(), &revokeResp); err != nil {
		t.Fatalf("failed to decode revoke response: %v", err)
	}
	if status, _ := revokeResp["status"].(string); status != "revoked" {
		t.Fatalf("expected revoked status, got %q", status)
	}
}
