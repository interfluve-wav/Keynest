package proposals

import (
	"path/filepath"
	"testing"
)

func TestPersistenceAcrossReload(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "proposals.json")

	mgr := NewManagerWithFile(statePath)
	created := mgr.Create(Proposal{
		VaultID: "vault-a",
		Host:    "api.example.com",
		Path:    "/v1/models",
		Method:  "GET",
		Reason:  "no matching rules",
		AgentID: "agent-1",
	})
	if created.ID == "" {
		t.Fatalf("expected proposal ID")
	}

	updated, ok := mgr.Resolve(created.ID, StatusApproved, "rule-1")
	if !ok {
		t.Fatalf("expected resolve to succeed")
	}
	if updated.Status != StatusApproved {
		t.Fatalf("expected approved status, got %q", updated.Status)
	}

	reloaded := NewManagerWithFile(statePath)
	list := reloaded.List("vault-a", "")
	if len(list) != 1 {
		t.Fatalf("expected 1 proposal after reload, got %d", len(list))
	}
	if list[0].Status != StatusApproved {
		t.Fatalf("expected approved proposal after reload, got %q", list[0].Status)
	}
	if list[0].CreatedRuleID != "rule-1" {
		t.Fatalf("expected created rule id persisted, got %q", list[0].CreatedRuleID)
	}
}
