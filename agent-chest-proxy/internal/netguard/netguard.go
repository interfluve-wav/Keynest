package netguard

import (
	"net"
	"strings"
)

type Mode string

const (
	Public  Mode = "public"
	Private Mode = "private"
)

var blockedAlways = []struct {
	network string
	desc    string
}{
	{"169.254.169.254/32", "AWS/GCP/Azure instance metadata (IPv4)"},
	{"fd00:ec2::254/128", "AWS IMDSv2 (IPv6)"},
}

var blockedPublic = []struct {
	network string
	desc    string
}{
	{"10.0.0.0/8", "RFC1918 private (10.0.0.0/8)"},
	{"172.16.0.0/12", "RFC1918 private (172.16.0.0/12)"},
	{"192.168.0.0/16", "RFC1918 private (192.168.0.0/16)"},
	{"127.0.0.0/8", "loopback (IPv4)"},
	{"::1/128", "loopback (IPv6)"},
	{"169.254.0.0/16", "link-local (IPv4)"},
	{"fe80::/10", "link-local (IPv6)"},
	{"fc00::/7", "IPv6 unique local"},
	{"100.64.0.0/10", "carrier-grade NAT"},
	{"0.0.0.0/32", "unspecified"},
}

type Guard struct {
	mode          Mode
	alwaysNets   []*net.IPNet
	publicNets    []*net.IPNet
	metadataNets  []*net.IPNet
}

func New(mode Mode) *Guard {
	g := &Guard{mode: mode}
	for _, entry := range blockedAlways {
		_, network, err := net.ParseCIDR(entry.network)
		if err == nil {
			g.alwaysNets = append(g.alwaysNets, network)
		}
	}
	for _, entry := range blockedPublic {
		_, network, err := net.ParseCIDR(entry.network)
		if err == nil {
			g.publicNets = append(g.publicNets, network)
		}
	}
	g.metadataNets = g.alwaysNets
	return g
}

func (g *Guard) Allowed(host string) (bool, string) {
	if strings.Contains(host, ":") {
		splitHost, _, err := net.SplitHostPort(host)
		if err == nil {
			host = splitHost
		}
	}

	ip := net.ParseIP(host)
	if ip == nil {
		ips, err := net.LookupIP(host)
		if err != nil || len(ips) == 0 {
			return false, "DNS resolution failed: " + host
		}
		ip = ips[0]
	}

	if ip.IsUnspecified() {
		return false, "unspecified address"
	}

	for _, network := range g.metadataNets {
		if network.Contains(ip) {
			return false, "cloud metadata endpoint blocked"
		}
	}

	if g.mode == Public {
		for _, network := range g.publicNets {
			if network.Contains(ip) {
				return false, "private/reserved IP blocked"
			}
		}
	}

	return true, ""
}

func (g *Guard) ResolveAndCheck(host string) (net.IP, bool, string) {
	resolvedHost := host
	if strings.Contains(resolvedHost, ":") {
		splitHost, _, err := net.SplitHostPort(resolvedHost)
		if err == nil {
			resolvedHost = splitHost
		}
	}

	ip := net.ParseIP(resolvedHost)
	if ip == nil {
		ips, err := net.LookupIP(resolvedHost)
		if err != nil || len(ips) == 0 {
			return nil, false, "DNS resolution failed: " + resolvedHost
		}
		ip = ips[0]
	}

	if ip.IsUnspecified() {
		return nil, false, "unspecified address"
	}

	for _, network := range g.metadataNets {
		if network.Contains(ip) {
			return nil, false, "cloud metadata endpoint blocked"
		}
	}

	if g.mode == Public {
		for _, network := range g.publicNets {
			if network.Contains(ip) {
				return nil, false, "private/reserved IP blocked"
			}
		}
	}

	return ip, true, ""
}