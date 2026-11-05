package panel

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestFS25HealthFreshness(t *testing.T) {
	now := time.UnixMilli(1000000)
	report := func(checked, started int64) []byte {
		return []byte(fmt.Sprintf(`{"portal":"online","game":"online","checked_at":%d,"started_at":%d}`, checked, started))
	}
	for _, tc := range []struct {
		name   string
		data   []byte
		uptime int64
		want   string
	}{
		{"fresh", report(999000, 950000), 50000, "online"},
		{"stale", report(970000, 950000), 50000, "unknown"},
		{"recent previous container", report(999000, 950000), 500, "unknown"},
		{"previous container", report(999000, 900000), 50000, "unknown"},
		{"future", report(1000001, 950000), 50000, "unknown"},
		{"invalid", []byte(`{`), 50000, "unknown"},
		{"no uptime", report(999000, 950000), 0, "unknown"},
		{"portal failed", []byte(`{"portal":"unknown","game":"online","checked_at":999000,"started_at":950000}`), 50000, "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := fs25HealthSnapshot(tc.data, "running", tc.uptime, now); got["game"] != tc.want {
				t.Fatalf("%v", got)
			}
		})
	}
	if got := fs25HealthSnapshot(report(999000, 950000), "stopping", 50000, now); got["game"] != "stopping" {
		t.Fatal(got)
	}
}

// Exercise the actual resource route and daemon file transport, not just the
// timestamp parser. These HTTP/database fixtures do not start a native game.
func TestFS25ResourceServices(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	if _, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"features": []string{"voltra_fs25"}}); err != nil {
		t.Fatal(err)
	}
	state, reportStatus, reportBody, reads := "running", 200, "", 0
	f.a.HTTP.Transport = fs25InspectTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method != "GET" {
			return nil, fmt.Errorf("health check sent a mutation: %s", r.Method)
		}
		body, status := fmt.Sprintf(`{"state":%q,"utilization":{"uptime":60000}}`, state), 200
		if strings.HasSuffix(r.URL.Path, "/files/contents") {
			if r.URL.Query().Get("file") != "/.voltra/fs25/health.json" {
				return nil, fmt.Errorf("unexpected health path")
			}
			reads++
			body, status = reportBody, reportStatus
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	report := func(game string, age int64) string {
		at := time.Now().UnixMilli()
		return fmt.Sprintf(`{"portal":"online","game":%q,"checked_at":%d,"started_at":%d}`, game, at-age, at-60000)
	}
	for _, tc := range []struct {
		name, body   string
		status       int
		portal, game string
	}{
		{"portal up game stopped", report("offline", 1000), 200, "online", "offline"},
		{"game started", report("online", 1000), 200, "online", "online"},
		{"stale", report("online", 30000), 200, "unknown", "unknown"},
		{"missing helper", "", 404, "unknown", "unknown"},
		{"malformed", "{", 200, "unknown", "unknown"},
		{"oversized", strings.Repeat(" ", 4097), 200, "unknown", "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reportBody, reportStatus = tc.body, tc.status
			attrs := asMap(operationsExpect(t, f.request("GET", f.serverPath("/resources"), nil, f.owner), 200)["attributes"])
			services := asMap(attrs["fs25_services"])
			if attrs["current_state"] != "running" || services["portal"] != tc.portal || services["game"] != tc.game {
				t.Fatalf("unexpected service state: %v", attrs)
			}
		})
	}
	before := reads
	state = "offline"
	attrs := asMap(operationsExpect(t, f.request("GET", f.serverPath("/resources"), nil, f.owner), 200)["attributes"])
	if services := asMap(attrs["fs25_services"]); services["portal"] != "offline" || services["game"] != "offline" || reads != before {
		t.Fatal("stopped container must not read an old health report", attrs)
	}
	if _, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"features": []string{}}); err != nil {
		t.Fatal(err)
	}
	state = "running"
	attrs = asMap(operationsExpect(t, f.request("GET", f.serverPath("/resources"), nil, f.owner), 200)["attributes"])
	if attrs["fs25_services"] != nil || reads != before {
		t.Fatal("non-FS25 server fetched a health report", attrs)
	}
}
