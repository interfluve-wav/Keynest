package proposals

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Status string

const (
	StatusPending  Status = "pending"
	StatusApproved Status = "approved"
	StatusDenied   Status = "denied"
)

type Proposal struct {
	ID            string `json:"id"`
	VaultID       string `json:"vault_id"`
	Host          string `json:"host"`
	Path          string `json:"path"`
	Method        string `json:"method"`
	Reason        string `json:"reason"`
	AgentID       string `json:"agent_id"`
	Status        Status `json:"status"`
	CreatedRuleID string `json:"created_rule_id,omitempty"`
	CreatedAt     string `json:"created_at"`
	ResolvedAt    string `json:"resolved_at,omitempty"`
}

type Manager struct {
	mu        sync.RWMutex
	path      string
	proposals []Proposal
}

func NewManager() *Manager {
	return NewManagerWithFile("")
}

func NewManagerWithFile(path string) *Manager {
	m := &Manager{
		path:      path,
		proposals: make([]Proposal, 0),
	}
	m.load()
	return m
}

func (m *Manager) load() {
	if m.path == "" {
		return
	}
	data, err := os.ReadFile(m.path)
	if err != nil {
		return
	}
	var items []Proposal
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.proposals = items
}

func (m *Manager) persistLocked() error {
	if m.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m.proposals, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

func (m *Manager) Create(p Proposal) Proposal {
	m.mu.Lock()
	defer m.mu.Unlock()

	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	if p.Path == "" {
		p.Path = "/"
	}
	if p.Method == "" {
		p.Method = "*"
	}
	p.Method = strings.ToUpper(p.Method)
	if p.Status == "" {
		p.Status = StatusPending
	}
	if p.CreatedAt == "" {
		p.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	m.proposals = append(m.proposals, p)
	_ = m.persistLocked()
	return p
}

func (m *Manager) List(vaultID string, status Status) []Proposal {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]Proposal, 0, len(m.proposals))
	for _, p := range m.proposals {
		if vaultID != "" && p.VaultID != vaultID {
			continue
		}
		if status != "" && p.Status != status {
			continue
		}
		out = append(out, p)
	}
	return out
}

func (m *Manager) Resolve(id string, status Status, createdRuleID string) (Proposal, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i := range m.proposals {
		if m.proposals[i].ID != id {
			continue
		}
		m.proposals[i].Status = status
		m.proposals[i].CreatedRuleID = createdRuleID
		m.proposals[i].ResolvedAt = time.Now().UTC().Format(time.RFC3339)
		_ = m.persistLocked()
		return m.proposals[i], true
	}
	return Proposal{}, false
}
