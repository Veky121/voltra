package panel

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// Download headers are public compatibility hints, never credentials. Match an
// exact HTTPS host on its default port; do not inherit from another egg.
// The one supported pattern covers GIANTS' numbered CDN hosts, not arbitrary
// subdomains or wildcard domains.
const giantsDownloadHostPattern = "cdn*.giants-software.com"

func giantsDownloadHost(host string) bool {
	if !strings.HasPrefix(host, "cdn") || !strings.HasSuffix(host, ".giants-software.com") {
		return false
	}
	number := strings.TrimSuffix(strings.TrimPrefix(host, "cdn"), ".giants-software.com")
	for _, c := range number {
		if c < '0' || c > '9' {
			return false
		}
	}
	return len(host) <= 253 && len(number)+3 <= 63
}

func normalizeDownloadHeaders(value any) (M, error) {
	if value == nil {
		return M{}, nil
	}
	rules, ok := value.(M)
	if !ok {
		if m, valid := value.(map[string]any); valid {
			rules, ok = M(m), true
		}
	}
	if !ok || len(rules) > 16 {
		return nil, bad("download_headers must be an object with at most 16 hosts")
	}
	out := M{}
	for host, raw := range rules {
		validatedHost := host
		if host == giantsDownloadHostPattern {
			validatedHost = "cdn.giants-software.com"
		}
		if host != strings.ToLower(host) || strings.HasSuffix(host, ".") || !strings.Contains(host, ".") || net.ParseIP(host) != nil {
			return nil, bad("Download header hosts must be exact lowercase DNS names")
		}
		for _, label := range strings.Split(validatedHost, ".") {
			if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
				return nil, bad("Invalid download header host")
			}
			for _, c := range label {
				if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
					return nil, bad("Invalid download header host")
				}
			}
		}
		if len(host) > 253 {
			return nil, bad("Invalid download header host")
		}
		headers, valid := raw.(M)
		if !valid {
			if m, ok := raw.(map[string]any); ok {
				headers, valid = M(m), true
			}
		}
		if !valid || len(headers) == 0 || len(headers) > 4 {
			return nil, bad("Each download host needs 1 to 4 headers")
		}
		clean := M{}
		for key, rawValue := range headers {
			name := http.CanonicalHeaderKey(key)
			switch name {
			case "Referer", "User-Agent", "Accept", "Accept-Language":
			default:
				return nil, bad("Only Referer, User-Agent, Accept and Accept-Language download headers are supported")
			}
			v, ok := rawValue.(string)
			if !ok || len(v) == 0 || len(v) > 1024 {
				return nil, bad("Download header values must contain 1 to 1024 characters")
			}
			for _, c := range v {
				if c < 32 || c > 126 {
					return nil, bad("Download header values must be printable ASCII")
				}
			}
			if _, exists := clean[name]; exists {
				return nil, bad("Duplicate download header")
			}
			if name == "Referer" {
				u, err := url.Parse(v)
				if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
					return nil, bad("Download Referer must be a public HTTPS URL without credentials, query or fragment")
				}
			}
			clean[name] = v
		}
		out[host] = clean
	}
	return out, nil
}

func downloadHeadersForURL(rules M, rawURL string) M {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return nil
	}
	host := strings.ToLower(u.Hostname())
	if exact, exists := rules[host]; exists {
		return asMap(exact)
	}
	if giantsDownloadHost(host) {
		return asMap(rules[giantsDownloadHostPattern])
	}
	return nil
}

func (a *App) applyDownloadHeaders(ctx context.Context, server M, body M) error {
	// A client must never supply its own daemon headers, even on an egg with
	// no configured rules.
	for key := range body {
		if strings.EqualFold(key, "headers") || strings.EqualFold(key, "download_headers") || strings.EqualFold(key, "remote_headers") {
			delete(body, key)
		}
	}
	egg, err := a.one(ctx, "SELECT download_headers FROM eggs WHERE id=$1", server["egg_id"])
	if err != nil {
		return err
	}
	rules, err := normalizeDownloadHeaders(egg["download_headers"])
	if err != nil {
		return err
	}
	headers := downloadHeadersForURL(rules, str(body["url"]))
	if len(headers) == 0 {
		return nil
	}
	node, err := a.node(ctx, num(server["node_id"]))
	if err != nil {
		return err
	}
	res, err := a.daemon(ctx, node, http.MethodGet, "/api/system", nil)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.Header.Get("X-Voltra-Download-Headers") != "1" {
		return &APIError{Status: 409, Code: "DownloadHeadersUnsupported", Detail: "This download needs egg headers. Update this node to a Voltra Wings build with download-header support."}
	}
	body["remote_headers"] = headers
	return nil
}
