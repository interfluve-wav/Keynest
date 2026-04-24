package proxy

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/ssh-vault/agent-chest-proxy/internal/agents"
	"github.com/ssh-vault/agent-chest-proxy/internal/audit"
	"github.com/ssh-vault/agent-chest-proxy/internal/netguard"
	"github.com/ssh-vault/agent-chest-proxy/internal/proposals"
	"github.com/ssh-vault/agent-chest-proxy/internal/rbac"
	"github.com/ssh-vault/agent-chest-proxy/internal/rules"
	"github.com/ssh-vault/agent-chest-proxy/internal/vault"
)

type Proxy struct {
	vaultStore  vault.Store
	ruleEngine  *rules.Engine
	rbacMgr     *rbac.Manager
	proposalMgr *proposals.Manager
	agentMgr    *agents.Manager
	auditLog    *audit.Logger
	netGuard    *netguard.Guard
}

func New(vaultStore vault.Store, ruleEngine *rules.Engine, rbacMgr *rbac.Manager, auditLog *audit.Logger, netGuard *netguard.Guard) *Proxy {
	return NewWithState(vaultStore, ruleEngine, rbacMgr, auditLog, netGuard, "", "")
}

func NewWithState(vaultStore vault.Store, ruleEngine *rules.Engine, rbacMgr *rbac.Manager, auditLog *audit.Logger, netGuard *netguard.Guard, proposalStatePath, agentStatePath string) *Proxy {
	proposalMgr := proposals.NewManager()
	if proposalStatePath != "" {
		proposalMgr = proposals.NewManagerWithFile(proposalStatePath)
	}
	agentMgr := agents.NewManager()
	if agentStatePath != "" {
		agentMgr = agents.NewManagerWithFile(agentStatePath)
	}
	return &Proxy{
		vaultStore:  vaultStore,
		ruleEngine:  ruleEngine,
		rbacMgr:     rbacMgr,
		proposalMgr: proposalMgr,
		agentMgr:    agentMgr,
		auditLog:    auditLog,
		netGuard:    netGuard,
	}
}

type DiscoverResponse struct {
	Vault                   string            `json:"vault"`
	Services                []DiscoverService `json:"services"`
	AvailableCredentialKeys []string          `json:"available_credential_keys"`
}

type DiscoverService struct {
	Host        string `json:"host"`
	Description string `json:"description"`
}

type RuleTestRequest struct {
	VaultID string            `json:"vault_id"`
	Host    string            `json:"host"`
	Path    string            `json:"path"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
}

type RuleTestResponse struct {
	Allow       bool        `json:"allow"`
	Reason      string      `json:"reason"`
	MatchedRule *rules.Rule `json:"matched_rule,omitempty"`
	Host        string      `json:"host"`
	Path        string      `json:"path"`
	Method      string      `json:"method"`
}

type PolicyTemplate struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Rules       []rules.Rule `json:"rules"`
}

func parseTokenTTL(raw string) (time.Duration, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "none":
		return 0, true
	case "15m":
		return 15 * time.Minute, true
	case "1h":
		return time.Hour, true
	case "24h":
		return 24 * time.Hour, true
	default:
		return 0, false
	}
}

func (p *Proxy) policyTemplates() []PolicyTemplate {
	now := time.Now().UTC().Format(time.RFC3339)
	return []PolicyTemplate{
		{
			ID:          "openai",
			Name:        "OpenAI API",
			Description: "Allow only OpenAI API traffic on common REST endpoints.",
			Rules: []rules.Rule{
				{ID: uuid.NewString(), Name: "OpenAI API allow", HostMatch: "api.openai.com", PathMatch: "/v1/*", Methods: []string{"GET", "POST"}, Action: rules.Allow, CreatedAt: now},
			},
		},
		{
			ID:          "github",
			Name:        "GitHub API",
			Description: "Allow GitHub API access for repos/issues/pulls operations.",
			Rules: []rules.Rule{
				{ID: uuid.NewString(), Name: "GitHub REST allow", HostMatch: "api.github.com", PathMatch: "/*", Methods: []string{"GET", "POST", "PUT", "PATCH", "DELETE"}, Action: rules.Allow, CreatedAt: now},
				{ID: uuid.NewString(), Name: "GitHub upload allow", HostMatch: "uploads.github.com", PathMatch: "/*", Methods: []string{"POST"}, Action: rules.Allow, CreatedAt: now},
			},
		},
		{
			ID:          "stripe",
			Name:        "Stripe API",
			Description: "Allow Stripe API calls while blocking dashboard domains by omission.",
			Rules: []rules.Rule{
				{ID: uuid.NewString(), Name: "Stripe API allow", HostMatch: "api.stripe.com", PathMatch: "/v1/*", Methods: []string{"GET", "POST", "DELETE"}, Action: rules.Allow, CreatedAt: now},
			},
		},
		{
			ID:          "aws",
			Name:        "AWS STS + S3",
			Description: "Safe starter set for AWS token and object operations.",
			Rules: []rules.Rule{
				{ID: uuid.NewString(), Name: "AWS STS allow", HostMatch: "sts.amazonaws.com", PathMatch: "/*", Methods: []string{"GET", "POST"}, Action: rules.Allow, CreatedAt: now},
				{ID: uuid.NewString(), Name: "AWS S3 allow", HostMatch: "*.s3.amazonaws.com", PathMatch: "/*", Methods: []string{"GET", "PUT", "POST", "DELETE"}, Action: rules.Allow, CreatedAt: now},
			},
		},
	}
}

func scrubControlHeaders(h http.Header) {
	h.Del("X-Vault-ID")
	h.Del("X-Agent-ID")
	h.Del("X-Agent-Token")
	h.Del("Proxy-Connection")
	h.Del("Proxy-Authorization")
}

func (p *Proxy) denyAgentAuth(w http.ResponseWriter, status int, jsonBody bool, reason string, agentID, vaultID, method, target, path string, r *http.Request, start time.Time) {
	p.auditLog.Log(audit.AuditEntry{
		AgentID:    agentID,
		VaultID:    vaultID,
		Method:     method,
		Target:     target,
		Path:       path,
		Action:     audit.ActionDeny,
		StatusCode: status,
		Rule:       reason,
		SourceIP:   r.RemoteAddr,
		UserAgent:  r.UserAgent(),
		DurationMs: time.Since(start).Milliseconds(),
	})
	if jsonBody {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":  "unauthorized",
			"reason": reason,
		})
		return
	}
	http.Error(w, "Unauthorized: "+reason, status)
}

func parseProxyAuthorizationToken(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}

	parts := strings.Fields(raw)
	if len(parts) != 2 {
		return "", false
	}

	scheme := strings.ToLower(parts[0])
	payload := strings.TrimSpace(parts[1])
	if payload == "" {
		return "", false
	}

	switch scheme {
	case "bearer":
		return payload, true
	case "basic":
		decoded, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return "", false
		}
		userPass := string(decoded)
		if idx := strings.IndexByte(userPass, ':'); idx >= 0 {
			password := strings.TrimSpace(userPass[idx+1:])
			if password != "" {
				return password, true
			}
			username := strings.TrimSpace(userPass[:idx])
			if username != "" {
				return username, true
			}
			return "", false
		}
		userPass = strings.TrimSpace(userPass)
		if userPass == "" {
			return "", false
		}
		return userPass, true
	default:
		return "", false
	}
}

func (p *Proxy) requireAgentAccess(w http.ResponseWriter, r *http.Request, start time.Time, agentID, vaultID, method, target, path string, jsonBody bool) (string, string, bool) {
	token := strings.TrimSpace(r.Header.Get("X-Agent-Token"))
	if agentID != "" || vaultID != "" || token != "" {
		if agentID == "" || vaultID == "" || token == "" {
			p.denyAgentAuth(w, http.StatusUnauthorized, jsonBody, "missing X-Agent-ID, X-Vault-ID, or X-Agent-Token", agentID, vaultID, method, target, path, r, start)
			return "", "", false
		}
		if _, ok := p.agentMgr.Authenticate(agentID, vaultID, token); ok {
			return agentID, vaultID, true
		}
	}

	if token, ok := parseProxyAuthorizationToken(r.Header.Get("Proxy-Authorization")); ok {
		if agent, authOK := p.agentMgr.AuthenticateByToken(token); authOK {
			return agent.ID, agent.VaultID, true
		}
		p.denyAgentAuth(w, http.StatusUnauthorized, jsonBody, "invalid or revoked proxy token", agentID, vaultID, method, target, path, r, start)
		return "", "", false
	}

	p.denyAgentAuth(w, http.StatusUnauthorized, jsonBody, "missing X-Agent headers or Proxy-Authorization token", agentID, vaultID, method, target, path, r, start)
	return "", "", false
}

func (p *Proxy) ProxyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		agentID := r.Header.Get("X-Agent-ID")
		vaultID := r.Header.Get("X-Vault-ID")

		if r.Method == http.MethodConnect {
			p.handleConnect(w, r, agentID, vaultID, start)
			return
		}

		p.handleHTTP(w, r, agentID, vaultID, start)
	})
}

func (p *Proxy) handleHTTP(w http.ResponseWriter, r *http.Request, agentID, vaultID string, start time.Time) {
	targetHost := r.URL.Host
	if targetHost == "" {
		targetHost = r.Host
	}
	targetPath := r.URL.Path
	if targetPath == "" {
		targetPath = "/"
	}
	resolvedAgentID, resolvedVaultID, ok := p.requireAgentAccess(w, r, start, agentID, vaultID, r.Method, targetHost, targetPath, false)
	if !ok {
		return
	}
	agentID = resolvedAgentID
	vaultID = resolvedVaultID

	allowed, reason := p.netGuard.Allowed(targetHost)
	if !allowed {
		p.auditLog.Log(audit.AuditEntry{
			AgentID:    agentID,
			VaultID:    vaultID,
			Method:     r.Method,
			Target:     targetHost,
			Path:       targetPath,
			Action:     audit.ActionDeny,
			StatusCode: 403,
			Rule:       "netguard: " + reason,
			SourceIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
			DurationMs: time.Since(start).Milliseconds(),
		})
		http.Error(w, "Forbidden: network policy: "+reason, http.StatusForbidden)
		return
	}

	decision := p.ruleEngine.Evaluate(vaultID, targetHost, targetPath, r.Method)
	if !decision.Allow {
		p.auditLog.Log(audit.AuditEntry{
			AgentID:    agentID,
			VaultID:    vaultID,
			Method:     r.Method,
			Target:     targetHost,
			Path:       targetPath,
			Action:     audit.ActionDeny,
			StatusCode: 403,
			Rule:       decision.Reason,
			SourceIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
			DurationMs: time.Since(start).Milliseconds(),
		})
		http.Error(w, "Forbidden: "+decision.Reason, http.StatusForbidden)
		return
	}

	creds, err := p.vaultStore.FindByTarget(targetHost)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	var matchedCred *vault.Credential
	for _, c := range creds {
		if c.VaultID == vaultID || vaultID == "" {
			if p.rbacMgr.IsCredentialBoundToVault(c.ID, vaultID) || vaultID == "" {
				matchedCred = c
				break
			}
		}
	}

	outReq := r.Clone(context.Background())
	outReq.RequestURI = ""
	scrubControlHeaders(outReq.Header)

	if matchedCred != nil {
		p.injectCredential(outReq, matchedCred)
	}

	resp, err := http.DefaultTransport.RoundTrip(outReq)
	duration := time.Since(start).Milliseconds()

	if err != nil {
		p.auditLog.Log(audit.AuditEntry{
			AgentID:    agentID,
			VaultID:    vaultID,
			Method:     r.Method,
			Target:     targetHost,
			Path:       targetPath,
			Action:     audit.ActionError,
			StatusCode: 502,
			Rule:       decision.Reason,
			SourceIP:   r.RemoteAddr,
			UserAgent:  r.UserAgent(),
			DurationMs: duration,
		})
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	credID := ""
	if matchedCred != nil {
		credID = matchedCred.ID
	}
	p.auditLog.Log(audit.AuditEntry{
		AgentID:      agentID,
		VaultID:      vaultID,
		Method:       r.Method,
		Target:       targetHost,
		Path:         targetPath,
		Action:       audit.ActionBroker,
		StatusCode:   resp.StatusCode,
		CredentialID: credID,
		Rule:         decision.Reason,
		SourceIP:     r.RemoteAddr,
		UserAgent:    r.UserAgent(),
		DurationMs:   duration,
	})

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (p *Proxy) handleConnect(w http.ResponseWriter, r *http.Request, agentID, vaultID string, start time.Time) {
	host := r.URL.Hostname()
	port := r.URL.Port()
	if port == "" {
		port = "443"
	}
	resolvedAgentID, resolvedVaultID, ok := p.requireAgentAccess(w, r, start, agentID, vaultID, "CONNECT", net.JoinHostPort(host, port), "/", false)
	if !ok {
		return
	}
	agentID = resolvedAgentID
	vaultID = resolvedVaultID

	allowed, reason := p.netGuard.Allowed(host)
	if !allowed {
		p.auditLog.Log(audit.AuditEntry{
			AgentID:    agentID,
			VaultID:    vaultID,
			Method:     "CONNECT",
			Target:     net.JoinHostPort(host, port),
			Action:     audit.ActionDeny,
			StatusCode: 403,
			Rule:       "netguard: " + reason,
			SourceIP:   r.RemoteAddr,
			DurationMs: time.Since(start).Milliseconds(),
		})
		http.Error(w, "Forbidden: network policy: "+reason, http.StatusForbidden)
		return
	}

	decision := p.ruleEngine.Evaluate(vaultID, host, "/", "CONNECT")
	if !decision.Allow {
		p.auditLog.Log(audit.AuditEntry{
			AgentID:    agentID,
			VaultID:    vaultID,
			Method:     "CONNECT",
			Target:     net.JoinHostPort(host, port),
			Action:     audit.ActionDeny,
			StatusCode: 403,
			Rule:       decision.Reason,
			SourceIP:   r.RemoteAddr,
			DurationMs: time.Since(start).Milliseconds(),
		})
		http.Error(w, "Forbidden: "+decision.Reason, http.StatusForbidden)
		return
	}

	creds, err := p.vaultStore.FindByTarget(host)
	if err == nil && len(creds) > 0 {
		var matchedCred *vault.Credential
		for _, c := range creds {
			if c.VaultID == vaultID || vaultID == "" {
				if p.rbacMgr.IsCredentialBoundToVault(c.ID, vaultID) || vaultID == "" {
					matchedCred = c
					break
				}
			}
		}
		if matchedCred != nil {
			targetURL := "https://" + host + r.URL.Path
			if r.URL.Path == "" || r.URL.Path == "/" {
				targetURL = "https://" + host + "/"
			}

			outReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, nil)
			if err != nil {
				p.auditLog.Log(audit.AuditEntry{
					AgentID:    agentID,
					VaultID:    vaultID,
					Method:     "CONNECT-PROXY",
					Target:     host,
					Action:     audit.ActionError,
					StatusCode: 502,
					SourceIP:   r.RemoteAddr,
					DurationMs: time.Since(start).Milliseconds(),
				})
				http.Error(w, "Bad Gateway", http.StatusBadGateway)
				return
			}

			for k, vv := range r.Header {
				if k == "X-Vault-Id" || k == "X-Agent-Id" || k == "X-Agent-Token" || k == "Proxy-Connection" || k == "Proxy-Authorization" {
					continue
				}
				for _, v := range vv {
					outReq.Header.Add(k, v)
				}
			}

			p.injectCredential(outReq, matchedCred)

			resp, err := http.DefaultTransport.RoundTrip(outReq)
			duration := time.Since(start).Milliseconds()

			if err != nil {
				p.auditLog.Log(audit.AuditEntry{
					AgentID:      agentID,
					VaultID:      vaultID,
					Method:       "CONNECT-PROXY",
					Target:       host,
					Path:         r.URL.Path,
					Action:       audit.ActionError,
					StatusCode:   502,
					CredentialID: matchedCred.ID,
					Rule:         decision.Reason,
					SourceIP:     r.RemoteAddr,
					UserAgent:    r.UserAgent(),
					DurationMs:   duration,
				})
				http.Error(w, "Bad Gateway", http.StatusBadGateway)
				return
			}
			defer resp.Body.Close()

			p.auditLog.Log(audit.AuditEntry{
				AgentID:      agentID,
				VaultID:      vaultID,
				Method:       "CONNECT-PROXY",
				Target:       host,
				Path:         r.URL.Path,
				Action:       audit.ActionBroker,
				StatusCode:   resp.StatusCode,
				CredentialID: matchedCred.ID,
				Rule:         decision.Reason,
				SourceIP:     r.RemoteAddr,
				UserAgent:    r.UserAgent(),
				DurationMs:   duration,
			})

			for k, vv := range resp.Header {
				for _, v := range vv {
					w.Header().Add(k, v)
				}
			}
			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
			return
		}
	}

	destIP, ipAllowed, ipReason := p.netGuard.ResolveAndCheck(net.JoinHostPort(host, port))
	if !ipAllowed {
		p.auditLog.Log(audit.AuditEntry{
			AgentID:    agentID,
			VaultID:    vaultID,
			Method:     "CONNECT",
			Target:     net.JoinHostPort(host, port),
			Action:     audit.ActionDeny,
			StatusCode: 403,
			Rule:       "netguard: " + ipReason,
			SourceIP:   r.RemoteAddr,
			DurationMs: time.Since(start).Milliseconds(),
		})
		http.Error(w, "Forbidden: network policy: "+ipReason, http.StatusForbidden)
		return
	}

	destConn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 10*time.Second)
	if err != nil {
		p.auditLog.Log(audit.AuditEntry{
			AgentID:    agentID,
			VaultID:    vaultID,
			Method:     "CONNECT",
			Target:     net.JoinHostPort(host, port),
			Action:     audit.ActionError,
			StatusCode: 502,
			SourceIP:   r.RemoteAddr,
			DurationMs: time.Since(start).Milliseconds(),
		})
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		return
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "Hijacking not supported", http.StatusInternalServerError)
		return
	}

	hjConn, _, err := hijacker.Hijack()
	if err != nil {
		http.Error(w, "Hijack failed", http.StatusInternalServerError)
		return
	}

	p.auditLog.Log(audit.AuditEntry{
		AgentID:    agentID,
		VaultID:    vaultID,
		Method:     "CONNECT",
		Target:     net.JoinHostPort(host, port),
		Action:     audit.ActionBroker,
		StatusCode: 200,
		Rule:       decision.Reason,
		SourceIP:   r.RemoteAddr,
		DurationMs: time.Since(start).Milliseconds(),
	})

	_, _ = hjConn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))

	go io.Copy(destConn, hjConn)
	go io.Copy(hjConn, destConn)

	_ = destIP
}

func (p *Proxy) injectCredential(r *http.Request, cred *vault.Credential) {
	switch cred.AuthType {
	case "bearer":
		token := cred.HeaderValue
		if cred.EncryptedKey != "" {
			token = cred.PlainKey
		}
		r.Header.Set("Authorization", "Bearer "+token)
	case "api_key_header":
		headerName := cred.HeaderName
		if headerName == "" {
			headerName = "X-API-Key"
		}
		value := cred.HeaderValue
		if cred.EncryptedKey != "" {
			value = cred.PlainKey
		}
		if value != "" {
			r.Header.Set(headerName, value)
		}
	case "basic_auth":
		r.Header.Set("Authorization", "Basic "+cred.HeaderValue)
	case "passthrough":
		// No credential injection - client's headers flow through
	}
}

func (p *Proxy) ManagementHandler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":        "running",
			"audit_entries": p.auditLog.Count(),
		})
	})

	mux.HandleFunc("/api/v1/discover", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		vaultID := r.URL.Query().Get("vault_id")
		if vaultID == "" {
			vaultID = r.Header.Get("X-Vault-ID")
		}

		creds, _ := p.vaultStore.List()
		ruleList := p.ruleEngine.List()

		var services []DiscoverService
		seen := map[string]bool{}
		credentialKeys := map[string]bool{}

		for _, r := range ruleList {
			host := r.HostMatch
			if r.VaultID != "" && r.VaultID != vaultID && vaultID != "" {
				continue
			}
			if !seen[host] {
				services = append(services, DiscoverService{
					Host:        host,
					Description: r.Name,
				})
				seen[host] = true
			}
		}

		for _, c := range creds {
			if c.VaultID != "" && c.VaultID != vaultID && vaultID != "" {
				continue
			}
			if !seen[c.TargetHost] {
				services = append(services, DiscoverService{
					Host:        c.TargetHost,
					Description: c.Name,
				})
				seen[c.TargetHost] = true
			}
			keyName := c.Name
			if keyName == "" {
				keyName = c.ID
			}
			credentialKeys[keyName] = true
		}

		keys := make([]string, 0, len(credentialKeys))
		for k := range credentialKeys {
			keys = append(keys, k)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(DiscoverResponse{
			Vault:                   vaultID,
			Services:                services,
			AvailableCredentialKeys: keys,
		})
	})

	mux.HandleFunc("/v1/proposals", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			vaultID := r.URL.Query().Get("vault_id")
			status := proposals.Status(strings.ToLower(r.URL.Query().Get("status")))
			items := p.proposalMgr.List(vaultID, status)
			json.NewEncoder(w).Encode(items)
		case http.MethodPost:
			var req proposals.Proposal
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			created := p.proposalMgr.Create(req)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(created)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/v1/proposals/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/proposals/"), "/")
		if len(parts) != 2 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		id, action := parts[0], parts[1]
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		switch action {
		case "approve":
			items := p.proposalMgr.List("", "")
			var target *proposals.Proposal
			for i := range items {
				if items[i].ID == id {
					target = &items[i]
					break
				}
			}
			if target == nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}

			ruleID := uuid.NewString()
			pathMatch := target.Path
			if pathMatch == "" {
				pathMatch = "*"
			}
			method := strings.ToUpper(target.Method)
			if method == "" {
				method = "*"
			}
			createdRule := rules.Rule{
				ID:        ruleID,
				VaultID:   target.VaultID,
				Name:      "Approved proposal: " + target.Host,
				HostMatch: target.Host,
				PathMatch: pathMatch,
				Methods:   []string{method},
				Action:    rules.Allow,
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
			}
			p.ruleEngine.Add(createdRule)
			p.rbacMgr.AddRuleToVaultBindings(target.VaultID, createdRule.ID)

			updated, ok := p.proposalMgr.Resolve(id, proposals.StatusApproved, createdRule.ID)
			if !ok {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(updated)
		case "deny":
			updated, ok := p.proposalMgr.Resolve(id, proposals.StatusDenied, "")
			if !ok {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(updated)
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	})

	mux.HandleFunc("/v1/invites", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			vaultID := r.URL.Query().Get("vault_id")
			json.NewEncoder(w).Encode(p.agentMgr.ListInvites(vaultID))
		case http.MethodPost:
			var req struct {
				VaultID string `json:"vault_id"`
				Name    string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			invite := p.agentMgr.CreateInvite(req.VaultID, req.Name)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(invite)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/v1/invites/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/invites/"), "/")
		if len(parts) != 2 || parts[1] != "redeem" || r.Method != http.MethodPost {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		code := parts[0]
		var req struct {
			Name string `json:"name"`
			TTL  string `json:"ttl"`
		}
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&req)
		}
		ttl, ok := parseTokenTTL(req.TTL)
		if !ok {
			http.Error(w, "invalid ttl, allowed values: 15m, 1h, 24h, none", http.StatusBadRequest)
			return
		}
		invite, agent, token, ok := p.agentMgr.RedeemInvite(code, req.Name, ttl)
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"invite": invite,
			"agent": map[string]interface{}{
				"id":         agent.ID,
				"vault_id":   agent.VaultID,
				"name":       agent.Name,
				"status":     agent.Status,
				"expires_at": agent.ExpiresAt,
				"created_at": agent.CreatedAt,
				"updated_at": agent.UpdatedAt,
			},
			"token": token,
		})
	})

	mux.HandleFunc("/v1/agents", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		vaultID := r.URL.Query().Get("vault_id")
		json.NewEncoder(w).Encode(p.agentMgr.ListAgents(vaultID))
	})

	mux.HandleFunc("/v1/agents/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/agents/"), "/")
		if len(parts) != 2 || r.Method != http.MethodPost {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		id, action := parts[0], parts[1]
		switch action {
		case "rotate-token":
			var req struct {
				TTL string `json:"ttl"`
			}
			if r.Body != nil {
				_ = json.NewDecoder(r.Body).Decode(&req)
			}
			ttl, ok := parseTokenTTL(req.TTL)
			if !ok {
				http.Error(w, "invalid ttl, allowed values: 15m, 1h, 24h, none", http.StatusBadRequest)
				return
			}
			agent, token, ok := p.agentMgr.RotateToken(id, ttl)
			if !ok {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(map[string]interface{}{
				"id":         agent.ID,
				"vault_id":   agent.VaultID,
				"name":       agent.Name,
				"status":     agent.Status,
				"token":      token,
				"expires_at": agent.ExpiresAt,
				"created_at": agent.CreatedAt,
				"updated_at": agent.UpdatedAt,
			})
		case "revoke":
			agent, ok := p.agentMgr.Revoke(id)
			if !ok {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(agent)
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	})

	mux.HandleFunc("/proxy/", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		agentID := r.Header.Get("X-Agent-ID")
		vaultID := r.Header.Get("X-Vault-ID")
		if vaultID == "" {
			vaultID = r.URL.Query().Get("vault_id")
		}

		path := strings.TrimPrefix(r.URL.Path, "/proxy/")
		slashIdx := strings.Index(path, "/")
		var targetHost, targetPath string
		if slashIdx == -1 {
			targetHost = path
			targetPath = "/"
		} else {
			targetHost = path[:slashIdx]
			targetPath = path[slashIdx:]
		}

		if targetHost == "" {
			http.Error(w, "missing target host", http.StatusBadRequest)
			return
		}
		resolvedAgentID, resolvedVaultID, ok := p.requireAgentAccess(w, r, start, agentID, vaultID, r.Method, targetHost, targetPath, true)
		if !ok {
			return
		}
		agentID = resolvedAgentID
		vaultID = resolvedVaultID

		allowed, reason := p.netGuard.Allowed(targetHost)
		if !allowed {
			p.auditLog.Log(audit.AuditEntry{
				AgentID:    agentID,
				VaultID:    vaultID,
				Method:     r.Method,
				Target:     targetHost,
				Path:       targetPath,
				Action:     audit.ActionDeny,
				StatusCode: 403,
				Rule:       "netguard: " + reason,
				SourceIP:   r.RemoteAddr,
				UserAgent:  r.UserAgent(),
				DurationMs: time.Since(start).Milliseconds(),
			})
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":         "forbidden",
				"reason":        "network policy: " + reason,
				"proposal_hint": map[string]string{"host": targetHost, "endpoint": "/v1/proposals"},
			})
			return
		}

		decision := p.ruleEngine.Evaluate(vaultID, targetHost, targetPath, r.Method)
		if !decision.Allow {
			p.auditLog.Log(audit.AuditEntry{
				AgentID:    agentID,
				VaultID:    vaultID,
				Method:     r.Method,
				Target:     targetHost,
				Path:       targetPath,
				Action:     audit.ActionDeny,
				StatusCode: 403,
				Rule:       "forbidden: " + decision.Reason,
				SourceIP:   r.RemoteAddr,
				UserAgent:  r.UserAgent(),
				DurationMs: time.Since(start).Milliseconds(),
			})
			var proposalID string
			if strings.Contains(decision.Reason, "no matching rules") {
				created := p.proposalMgr.Create(proposals.Proposal{
					VaultID: vaultID,
					Host:    targetHost,
					Path:    targetPath,
					Method:  r.Method,
					Reason:  decision.Reason,
					AgentID: agentID,
				})
				proposalID = created.ID
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":         "forbidden",
				"reason":        decision.Reason,
				"proposal_hint": map[string]string{"host": targetHost, "endpoint": "/v1/proposals"},
				"proposal_id":   proposalID,
			})
			return
		}

		creds, err := p.vaultStore.FindByTarget(targetHost)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		targetURL := "https://" + targetHost + targetPath
		if r.URL.RawQuery != "" {
			targetURL += "?" + r.URL.RawQuery
		}

		outReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		for k, vv := range r.Header {
			switch strings.ToLower(k) {
			case "x-vault-id", "x-agent-id", "x-agent-token", "proxy-connection", "proxy-authorization", "authorization":
				continue
			}
			for _, v := range vv {
				outReq.Header.Add(k, v)
			}
		}

		var matchedCred *vault.Credential
		for _, c := range creds {
			if c.VaultID == vaultID || vaultID == "" {
				if p.rbacMgr.IsCredentialBoundToVault(c.ID, vaultID) || vaultID == "" {
					matchedCred = c
					break
				}
			}
		}

		if matchedCred != nil {
			p.injectCredential(outReq, matchedCred)
		}

		resp, err := http.DefaultTransport.RoundTrip(outReq)
		duration := time.Since(start).Milliseconds()

		if err != nil {
			credID := ""
			if matchedCred != nil {
				credID = matchedCred.ID
			}
			p.auditLog.Log(audit.AuditEntry{
				AgentID:      agentID,
				VaultID:      vaultID,
				Method:       r.Method,
				Target:       targetHost,
				Path:         targetPath,
				Action:       audit.ActionError,
				StatusCode:   502,
				CredentialID: credID,
				Rule:         decision.Reason,
				SourceIP:     r.RemoteAddr,
				UserAgent:    r.UserAgent(),
				DurationMs:   duration,
			})
			http.Error(w, "Bad Gateway", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		credID := ""
		if matchedCred != nil {
			credID = matchedCred.ID
		}
		p.auditLog.Log(audit.AuditEntry{
			AgentID:      agentID,
			VaultID:      vaultID,
			Method:       r.Method,
			Target:       targetHost,
			Path:         targetPath,
			Action:       audit.ActionBroker,
			StatusCode:   resp.StatusCode,
			CredentialID: credID,
			Rule:         decision.Reason,
			SourceIP:     r.RemoteAddr,
			UserAgent:    r.UserAgent(),
			DurationMs:   duration,
		})

		for k, vv := range resp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	mux.HandleFunc("/api/v1/credentials", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			creds, _ := p.vaultStore.List()
			json.NewEncoder(w).Encode(creds)
		case http.MethodPost:
			var cred vault.Credential
			if err := json.NewDecoder(r.Body).Decode(&cred); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			p.vaultStore.Put(cred)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(cred)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/v1/credentials/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/credentials/")
		switch r.Method {
		case http.MethodGet:
			cred, err := p.vaultStore.Get(id)
			if err != nil {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(cred)
		case http.MethodDelete:
			p.vaultStore.Delete(id)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/v1/rules", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(p.ruleEngine.List())
		case http.MethodPost:
			var rule rules.Rule
			if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			p.ruleEngine.Add(rule)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(rule)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/v1/rules/test", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req RuleTestRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		host := strings.TrimSpace(req.Host)
		if host == "" {
			http.Error(w, "host is required", http.StatusBadRequest)
			return
		}
		method := strings.ToUpper(strings.TrimSpace(req.Method))
		if method == "" {
			method = http.MethodGet
		}
		path := strings.TrimSpace(req.Path)
		if path == "" {
			path = "/"
		}
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}

		allowed, reason := p.netGuard.Allowed(host)
		if !allowed {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(RuleTestResponse{
				Allow:  false,
				Reason: "netguard: " + reason,
				Host:   host,
				Path:   path,
				Method: method,
			})
			return
		}

		decision := p.ruleEngine.Evaluate(req.VaultID, host, path, method)
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(RuleTestResponse{
			Allow:       decision.Allow,
			Reason:      decision.Reason,
			MatchedRule: decision.Rule,
			Host:        host,
			Path:        path,
			Method:      method,
		})
	})

	mux.HandleFunc("/api/v1/rules/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/rules/")
		switch r.Method {
		case http.MethodDelete:
			p.ruleEngine.Remove(id)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/v1/bindings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(p.rbacMgr.List())
		case http.MethodPost:
			var b rbac.Binding
			if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			result := p.rbacMgr.Bind(b.VaultID, b.CredentialIDs, b.RuleIDs)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(result)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/v1/bindings/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/bindings/")
		switch r.Method {
		case http.MethodDelete:
			p.rbacMgr.Unbind(id)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/v1/policy-templates", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			templates := p.policyTemplates()
			sort.Slice(templates, func(i, j int) bool { return templates[i].Name < templates[j].Name })
			_ = json.NewEncoder(w).Encode(templates)
		case http.MethodPost:
			var req struct {
				VaultID    string `json:"vault_id"`
				TemplateID string `json:"template_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			if strings.TrimSpace(req.TemplateID) == "" {
				http.Error(w, "template_id is required", http.StatusBadRequest)
				return
			}

			var selected *PolicyTemplate
			for _, tpl := range p.policyTemplates() {
				if tpl.ID == req.TemplateID {
					tmp := tpl
					selected = &tmp
					break
				}
			}
			if selected == nil {
				http.Error(w, "template not found", http.StatusNotFound)
				return
			}

			created := make([]rules.Rule, 0, len(selected.Rules))
			for _, base := range selected.Rules {
				rule := base
				rule.ID = uuid.NewString()
				rule.VaultID = req.VaultID
				rule.CreatedAt = time.Now().UTC().Format(time.RFC3339)
				p.ruleEngine.Add(rule)
				if req.VaultID != "" {
					p.rbacMgr.AddRuleToVaultBindings(req.VaultID, rule.ID)
				}
				created = append(created, rule)
			}

			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"template_id": req.TemplateID,
				"created":     created,
			})
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/v1/audit", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		limit := 100
		offset := 0
		if v := r.URL.Query().Get("limit"); v != "" {
			fmt.Sscanf(v, "%d", &limit)
		}
		if v := r.URL.Query().Get("offset"); v != "" {
			fmt.Sscanf(v, "%d", &offset)
		}
		json.NewEncoder(w).Encode(p.auditLog.Query(limit, offset))
	})

	return mux
}
