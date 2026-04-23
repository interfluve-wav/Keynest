package agents

import (
	"path/filepath"
	"testing"
)

func TestPersistenceAndAuthentication(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "agents.json")

	mgr := NewManagerWithFile(statePath)
	inv := mgr.CreateInvite("vault-a", "worker-a")
	_, agent, token, ok := mgr.RedeemInvite(inv.Code, "")
	if !ok {
		t.Fatalf("expected redeem to succeed")
	}
	if _, ok := mgr.Authenticate(agent.ID, "vault-a", token); !ok {
		t.Fatalf("expected token to authenticate")
	}

	reloaded := NewManagerWithFile(statePath)
	agents := reloaded.ListAgents("vault-a")
	if len(agents) != 1 {
		t.Fatalf("expected 1 agent after reload, got %d", len(agents))
	}
	if agents[0].Token != "" {
		t.Fatalf("expected listed agent token to be omitted")
	}
	if _, ok := reloaded.Authenticate(agent.ID, "vault-a", token); !ok {
		t.Fatalf("expected persisted token hash to authenticate")
	}

	_, rotatedToken, ok := reloaded.RotateToken(agent.ID)
	if !ok {
		t.Fatalf("expected rotate token to succeed")
	}
	if rotatedToken == token {
		t.Fatalf("expected rotated token to differ")
	}
	if _, ok := reloaded.Authenticate(agent.ID, "vault-a", token); ok {
		t.Fatalf("expected old token to fail after rotation")
	}
	if _, ok := reloaded.Authenticate(agent.ID, "vault-a", rotatedToken); !ok {
		t.Fatalf("expected new token to authenticate")
	}
}
