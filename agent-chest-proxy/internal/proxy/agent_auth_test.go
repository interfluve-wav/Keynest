package proxy

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func redeemTestAgent(t *testing.T, h http.Handler, vaultID string) (string, string) {
	t.Helper()

	createInviteReq := httptest.NewRequest(http.MethodPost, "/v1/invites", bytes.NewBufferString(`{
		"vault_id":"`+vaultID+`",
		"name":"worker-a"
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

	redeemReq := httptest.NewRequest(http.MethodPost, "/v1/invites/"+code+"/redeem", nil)
	redeemRec := httptest.NewRecorder()
	h.ServeHTTP(redeemRec, redeemReq)
	if redeemRec.Code != http.StatusCreated {
		t.Fatalf("expected invite redeem 201, got %d body=%s", redeemRec.Code, redeemRec.Body.String())
	}

	var redeemed map[string]any
	if err := json.Unmarshal(redeemRec.Body.Bytes(), &redeemed); err != nil {
		t.Fatalf("failed to decode redeem response: %v", err)
	}
	agent, _ := redeemed["agent"].(map[string]any)
	agentID, _ := agent["id"].(string)
	token, _ := redeemed["token"].(string)
	if agentID == "" || token == "" {
		t.Fatalf("expected agent id and token from redeem response")
	}
	return agentID, token
}

func TestExplicitProxyRequiresAgentToken(t *testing.T) {
	p := newTestProxy(t)
	h := p.ManagementHandler()
	vaultID := "vault-auth"
	agentID, token := redeemTestAgent(t, h, vaultID)

	missingTokenReq := httptest.NewRequest(http.MethodGet, "/proxy/example.com/path", nil)
	missingTokenReq.Header.Set("X-Vault-ID", vaultID)
	missingTokenReq.Header.Set("X-Agent-ID", agentID)
	missingTokenRec := httptest.NewRecorder()
	h.ServeHTTP(missingTokenRec, missingTokenReq)
	if missingTokenRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing token, got %d body=%s", missingTokenRec.Code, missingTokenRec.Body.String())
	}

	wrongTokenReq := httptest.NewRequest(http.MethodGet, "/proxy/example.com/path", nil)
	wrongTokenReq.Header.Set("X-Vault-ID", vaultID)
	wrongTokenReq.Header.Set("X-Agent-ID", agentID)
	wrongTokenReq.Header.Set("X-Agent-Token", "wrong")
	wrongTokenRec := httptest.NewRecorder()
	h.ServeHTTP(wrongTokenRec, wrongTokenReq)
	if wrongTokenRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong token, got %d body=%s", wrongTokenRec.Code, wrongTokenRec.Body.String())
	}

	validTokenReq := httptest.NewRequest(http.MethodGet, "/proxy/example.com/path", nil)
	validTokenReq.Header.Set("X-Vault-ID", vaultID)
	validTokenReq.Header.Set("X-Agent-ID", agentID)
	validTokenReq.Header.Set("X-Agent-Token", token)
	validTokenRec := httptest.NewRecorder()
	h.ServeHTTP(validTokenRec, validTokenReq)
	if validTokenRec.Code == http.StatusUnauthorized {
		t.Fatalf("expected non-auth outcome with valid token, got 401 body=%s", validTokenRec.Body.String())
	}
}
