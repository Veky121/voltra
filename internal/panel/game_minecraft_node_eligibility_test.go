package panel

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestMinecraftEncryptedNodeEligibilityWithoutAllocations(t *testing.T) {
	a, _, admin := infraTestApp(t)
	ctx := context.Background()
	var unavailable atomic.Bool
	var probes atomic.Int32
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		probes.Add(1)
		if r.Header.Get("Authorization") != "Bearer eligibility-fixture" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if unavailable.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path != "/api/system" || r.Method != http.MethodGet {
			t.Errorf("unexpected mutation/request %s %s", r.Method, r.URL.Path)
		}
		writeJSON(w, http.StatusOK, M{"os": "linux"})
	}))
	defer daemon.Close()
	transport := http.DefaultTransport
	a.HTTP = &http.Client{Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "piston-meta.mojang.com" {
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"latest":{"release":"1.21.1"},"versions":[{"id":"1.21.1","type":"release","url":"https://piston-meta.mojang.com/version.json"}]}`))}, nil
		}
		return transport.RoundTrip(r)
	})}
	location, err := a.insert(ctx, "locations", M{"short": "eligibility"})
	if err != nil {
		t.Fatal(err)
	}
	data := daemonTestNode(t, daemon)
	data["uuid"], data["name"], data["location_id"] = newUUID(), "Encrypted empty node", location["id"]
	data["public"], data["memory"], data["disk"] = true, 8192, 40960
	data["daemon_token"], err = a.seal("eligibility-fixture")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(str(data["daemon_token"]), "enc:") {
		t.Fatal("fixture must store encrypted credentials")
	}
	if _, err = a.insert(ctx, "nodes", data); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.registerGameLibrary(mux)
	for _, offline := range []bool{false, true} {
		unavailable.Store(offline)
		options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/minecraft", nil, 200)["attributes"])
		nodes := asSlice(options["nodes"])
		if len(nodes) != 1 {
			t.Fatal("node missing")
		}
		node := asMap(nodes[0])
		if !boolean(node["automatic_ports"]) || num(node["free_allocations"]) != 0 || boolean(node["setup_available"]) == offline {
			t.Fatal("eligibility does not reflect authenticated reachability without preallocated ports")
		}
		if offline && str(node["unavailable_reason"]) != "Node is unreachable." {
			t.Fatal("unreachable node lost its reason")
		}
	}
	var allocations int
	if err = a.DB.QueryRow(ctx, "SELECT count(*) FROM allocations").Scan(&allocations); err != nil {
		t.Fatal(err)
	}
	if allocations != 0 || probes.Load() != 2 {
		t.Fatal("options mutated allocations or skipped authenticated probes")
	}
}
