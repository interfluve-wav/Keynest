package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/ssh-vault/agent-chest-proxy/internal/audit"
	"github.com/ssh-vault/agent-chest-proxy/internal/netguard"
	"github.com/ssh-vault/agent-chest-proxy/internal/proxy"
	"github.com/ssh-vault/agent-chest-proxy/internal/rbac"
	"github.com/ssh-vault/agent-chest-proxy/internal/rules"
	"github.com/ssh-vault/agent-chest-proxy/internal/vault"
)

type AppConfig struct {
	Credentials []vault.Credential `json:"credentials"`
	Rules       []rules.Rule       `json:"rules"`
	Bindings    []rbac.Binding     `json:"bindings"`
}

func defaultStatePath(fileName string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".agent-chest", fileName)
}

func main() {
	proxyPort := flag.Int("proxy-port", 8080, "Port for the HTTPS proxy server")
	mgmtPort := flag.Int("mgmt-port", 8081, "Port for the management API")
	configPath := flag.String("config", "", "Path to config file")
	auditPath := flag.String("audit-log", "", "Path to audit log file")
	agentsStatePath := flag.String("agents-state", "", "Path to persisted agents/invites state")
	proposalsStatePath := flag.String("proposals-state", "", "Path to persisted proposals state")
	netMode := flag.String("network-mode", "public", "Network guard mode: public (blocks private IPs) or private (blocks only metadata)")
	flag.Parse()

	if *agentsStatePath == "" {
		*agentsStatePath = defaultStatePath("agents.json")
	}
	if *proposalsStatePath == "" {
		*proposalsStatePath = defaultStatePath("proposals.json")
	}

	vaultStore := vault.NewMemoryStore()
	ruleEngine := rules.NewEngine()
	rbacMgr := rbac.NewManager()
	auditLogger, err := audit.NewLogger(*auditPath)
	if err != nil {
		log.Fatalf("Failed to initialize audit logger: %v", err)
	}
	defer auditLogger.Close()

	guard := netguard.New(netguard.Mode(*netMode))

	if *configPath != "" {
		data, err := os.ReadFile(*configPath)
		if err != nil {
			log.Fatalf("Failed to read config: %v", err)
		}
		var cfg AppConfig
		if err := json.Unmarshal(data, &cfg); err != nil {
			log.Fatalf("Failed to parse config: %v", err)
		}
		for _, c := range cfg.Credentials {
			if err := vaultStore.Put(c); err != nil {
				log.Printf("Warning: failed to load credential %s: %v", c.ID, err)
			}
		}
		for _, r := range cfg.Rules {
			ruleEngine.Add(r)
		}
		for _, b := range cfg.Bindings {
			rbacMgr.Bind(b.VaultID, b.CredentialIDs, b.RuleIDs)
		}
		log.Printf("Loaded config: %d credentials, %d rules, %d bindings",
			len(cfg.Credentials), len(cfg.Rules), len(cfg.Bindings))
	}

	p := proxy.NewWithState(vaultStore, ruleEngine, rbacMgr, auditLogger, guard, *proposalsStatePath, *agentsStatePath)

	proxySrv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *proxyPort),
		Handler:      p.ProxyHandler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	mgmtSrv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *mgmtPort),
		Handler:      p.ManagementHandler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("Agent Chest proxy listening on :%d (network mode: %s)", *proxyPort, *netMode)
		if err := proxySrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Proxy server error: %v", err)
		}
	}()

	go func() {
		log.Printf("Management API listening on :%d", *mgmtPort)
		if err := mgmtSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Management server error: %v", err)
		}
	}()

	auditLogger.Subscribe(func(entry audit.AuditEntry) {
		log.Printf("[audit] %s %s %s %s %s %d %s",
			entry.AgentID, entry.Method, entry.Target, entry.Action,
			entry.CredentialID, entry.StatusCode, entry.Rule)
	})

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	proxySrv.Shutdown(ctx)
	mgmtSrv.Shutdown(ctx)
}
