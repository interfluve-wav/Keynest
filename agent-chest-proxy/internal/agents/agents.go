package agents

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Agent struct {
	ID        string `json:"id"`
	VaultID   string `json:"vault_id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Token     string `json:"token,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type Invite struct {
	ID         string `json:"id"`
	Code       string `json:"code"`
	VaultID    string `json:"vault_id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	RedeemedBy string `json:"redeemed_by,omitempty"`
	CreatedAt  string `json:"created_at"`
	RedeemedAt string `json:"redeemed_at,omitempty"`
}

type agentRecord struct {
	ID        string `json:"id"`
	VaultID   string `json:"vault_id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	TokenHash string `json:"token_hash"`
	ExpiresAt string `json:"expires_at,omitempty"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type snapshot struct {
	Agents  []agentRecord `json:"agents"`
	Invites []Invite      `json:"invites"`
}

type Manager struct {
	mu      sync.RWMutex
	path    string
	agents  map[string]agentRecord
	invites map[string]Invite
}

func NewManager() *Manager {
	return NewManagerWithFile("")
}

func NewManagerWithFile(path string) *Manager {
	m := &Manager{
		path:    path,
		agents:  make(map[string]agentRecord),
		invites: make(map[string]Invite),
	}
	m.load()
	return m
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func newSecretToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func toPublicAgent(rec agentRecord) Agent {
	return Agent{
		ID:        rec.ID,
		VaultID:   rec.VaultID,
		Name:      rec.Name,
		Status:    rec.Status,
		ExpiresAt: rec.ExpiresAt,
		CreatedAt: rec.CreatedAt,
		UpdatedAt: rec.UpdatedAt,
	}
}

func (m *Manager) load() {
	if m.path == "" {
		return
	}
	data, err := os.ReadFile(m.path)
	if err != nil {
		return
	}
	var s snapshot
	if err := json.Unmarshal(data, &s); err != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, rec := range s.Agents {
		m.agents[rec.ID] = rec
	}
	for _, inv := range s.Invites {
		m.invites[inv.Code] = inv
	}
}

func (m *Manager) persistLocked() error {
	if m.path == "" {
		return nil
	}
	s := snapshot{
		Agents:  make([]agentRecord, 0, len(m.agents)),
		Invites: make([]Invite, 0, len(m.invites)),
	}
	for _, rec := range m.agents {
		s.Agents = append(s.Agents, rec)
	}
	for _, inv := range m.invites {
		s.Invites = append(s.Invites, inv)
	}
	sort.Slice(s.Agents, func(i, j int) bool { return s.Agents[i].CreatedAt < s.Agents[j].CreatedAt })
	sort.Slice(s.Invites, func(i, j int) bool { return s.Invites[i].CreatedAt < s.Invites[j].CreatedAt })

	if err := os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

func (m *Manager) CreateInvite(vaultID, name string) Invite {
	m.mu.Lock()
	defer m.mu.Unlock()
	invite := Invite{
		ID:        uuid.NewString(),
		Code:      uuid.NewString(),
		VaultID:   vaultID,
		Name:      name,
		Status:    "pending",
		CreatedAt: now(),
	}
	m.invites[invite.Code] = invite
	_ = m.persistLocked()
	return invite
}

func (m *Manager) ListInvites(vaultID string) []Invite {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Invite, 0, len(m.invites))
	for _, inv := range m.invites {
		if vaultID != "" && inv.VaultID != vaultID {
			continue
		}
		out = append(out, inv)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

func (m *Manager) RedeemInvite(code, name string, ttl time.Duration) (Invite, Agent, string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	inv, ok := m.invites[code]
	if !ok || inv.Status != "pending" {
		return Invite{}, Agent{}, "", false
	}
	agentName := name
	if agentName == "" {
		agentName = inv.Name
	}
	token := newSecretToken()
	rec := agentRecord{
		ID:        uuid.NewString(),
		VaultID:   inv.VaultID,
		Name:      agentName,
		Status:    "active",
		TokenHash: hashToken(token),
		CreatedAt: now(),
		UpdatedAt: now(),
	}
	if ttl > 0 {
		rec.ExpiresAt = time.Now().UTC().Add(ttl).Format(time.RFC3339)
	}
	m.agents[rec.ID] = rec

	inv.Status = "redeemed"
	inv.RedeemedBy = rec.ID
	inv.RedeemedAt = now()
	m.invites[code] = inv
	_ = m.persistLocked()
	return inv, toPublicAgent(rec), token, true
}

func (m *Manager) ListAgents(vaultID string) []Agent {
	m.expireAgents()

	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Agent, 0, len(m.agents))
	for _, rec := range m.agents {
		if vaultID != "" && rec.VaultID != vaultID {
			continue
		}
		out = append(out, toPublicAgent(rec))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

func (m *Manager) RotateToken(id string, ttl time.Duration) (Agent, string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	agent, ok := m.agents[id]
	if !ok {
		return Agent{}, "", false
	}
	token := newSecretToken()
	agent.TokenHash = hashToken(token)
	agent.Status = "active"
	if ttl > 0 {
		agent.ExpiresAt = time.Now().UTC().Add(ttl).Format(time.RFC3339)
	} else {
		agent.ExpiresAt = ""
	}
	agent.UpdatedAt = now()
	m.agents[id] = agent
	_ = m.persistLocked()
	return toPublicAgent(agent), token, true
}

func (m *Manager) Revoke(id string) (Agent, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	agent, ok := m.agents[id]
	if !ok {
		return Agent{}, false
	}
	agent.Status = "revoked"
	agent.TokenHash = ""
	agent.ExpiresAt = ""
	agent.UpdatedAt = now()
	m.agents[id] = agent
	_ = m.persistLocked()
	return toPublicAgent(agent), true
}

func (m *Manager) Authenticate(agentID, vaultID, token string) (Agent, bool) {
	m.expireAgents()

	m.mu.RLock()
	defer m.mu.RUnlock()
	rec, ok := m.agents[agentID]
	if !ok || rec.Status != "active" || token == "" {
		return Agent{}, false
	}
	if vaultID != "" && rec.VaultID != vaultID {
		return Agent{}, false
	}
	tokenHash := hashToken(token)
	if len(rec.TokenHash) != len(tokenHash) {
		return Agent{}, false
	}
	if subtle.ConstantTimeCompare([]byte(rec.TokenHash), []byte(tokenHash)) != 1 {
		return Agent{}, false
	}
	return toPublicAgent(rec), true
}

// AuthenticateByToken resolves an active agent from token alone.
// This is used for standard proxy-auth flows where client tooling can only
// provide Proxy-Authorization and not custom X-* headers.
func (m *Manager) AuthenticateByToken(token string) (Agent, bool) {
	m.expireAgents()

	if token == "" {
		return Agent{}, false
	}
	tokenHash := hashToken(token)

	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, rec := range m.agents {
		if rec.Status != "active" || rec.TokenHash == "" {
			continue
		}
		if len(rec.TokenHash) != len(tokenHash) {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(rec.TokenHash), []byte(tokenHash)) == 1 {
			return toPublicAgent(rec), true
		}
	}
	return Agent{}, false
}

func (m *Manager) expireAgents() {
	m.mu.Lock()
	defer m.mu.Unlock()
	changed := false
	nowTime := time.Now().UTC()
	for id, rec := range m.agents {
		if rec.Status != "active" || rec.ExpiresAt == "" {
			continue
		}
		expiresAt, err := time.Parse(time.RFC3339, rec.ExpiresAt)
		if err != nil {
			continue
		}
		if !nowTime.Before(expiresAt) {
			rec.Status = "revoked"
			rec.TokenHash = ""
			rec.UpdatedAt = now()
			m.agents[id] = rec
			changed = true
		}
	}
	if changed {
		_ = m.persistLocked()
	}
}
