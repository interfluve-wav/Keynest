package rbac

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type Binding struct {
	ID            string   `json:"id"`
	VaultID       string   `json:"vault_id"`
	CredentialIDs []string `json:"credential_ids"`
	RuleIDs       []string `json:"rule_ids"`
	CreatedAt     string   `json:"created_at"`
}

type Manager struct {
	mu       sync.RWMutex
	bindings map[string]Binding
}

func NewManager() *Manager {
	return &Manager{
		bindings: make(map[string]Binding),
	}
}

func (m *Manager) Bind(vaultID string, credentialIDs, ruleIDs []string) Binding {
	m.mu.Lock()
	defer m.mu.Unlock()
	b := Binding{
		ID:            uuid.New().String(),
		VaultID:       vaultID,
		CredentialIDs: credentialIDs,
		RuleIDs:       ruleIDs,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
	}
	m.bindings[b.ID] = b
	return b
}

func (m *Manager) Unbind(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.bindings, id)
}

func (m *Manager) List() []Binding {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]Binding, 0, len(m.bindings))
	for _, b := range m.bindings {
		result = append(result, b)
	}
	return result
}

func (m *Manager) GetBindingsForVault(vaultID string) []Binding {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var result []Binding
	for _, b := range m.bindings {
		if b.VaultID == vaultID {
			result = append(result, b)
		}
	}
	return result
}

func (m *Manager) IsCredentialBoundToVault(credentialID, vaultID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, b := range m.bindings {
		if b.VaultID == vaultID {
			for _, id := range b.CredentialIDs {
				if id == credentialID {
					return true
				}
			}
		}
	}
	return false
}

func (m *Manager) AddRuleToVaultBindings(vaultID, ruleID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, b := range m.bindings {
		if b.VaultID != vaultID {
			continue
		}

		exists := false
		for _, rid := range b.RuleIDs {
			if rid == ruleID {
				exists = true
				break
			}
		}
		if exists {
			continue
		}

		b.RuleIDs = append(b.RuleIDs, ruleID)
		m.bindings[id] = b
	}
}
