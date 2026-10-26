package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProxySnapshotsRequireValidAbsenceProof(t *testing.T) {
	for _, tc := range []struct {
		raw                 string
		store, valid, found bool
	}{
		{`{"proxies":[]}`, true, true, false},
		{`{"proxies":[{"name":"managed"}]}`, true, true, true},
		{`{}`, true, false, false},
		{`{"proxies":null}`, true, false, false},
		{`{"proxies":{}}`, true, false, false},
		{`{"proxies":[null]}`, true, false, false},
		{`{"proxies":[{"name":"managed"},{"name":"managed"}]}`, true, false, false},
		{`{}`, false, true, false}, // The real FRPC empty status response.
		{`{"tcp":[],"udp":[{"name":"other"}]}`, false, true, false},
		{`{"tcp":[{"name":"managed"}]}`, false, true, true},
		{`null`, false, false, false},
		{`{"error":"unavailable"}`, false, false, false},
		{`{"tcp":null}`, false, false, false},
		{`{"tcp":{}}`, false, false, false},
		{`{"tcp":[{}]}`, false, false, false},
		{`{"tcp":[{"name":42}]}`, false, false, false},
		{`{"tcp":[{"name":"managed"}],"udp":"invalid"}`, false, false, false},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			var snapshot M
			if err := json.Unmarshal([]byte(tc.raw), &snapshot); err != nil {
				t.Fatal(err)
			}
			var err error
			found := false
			if tc.store {
				var entries []any
				entries, err = proxyStoreEntries(snapshot)
				found = len(entries) > 0
			} else {
				found, err = proxyStatusContains(snapshot, "managed")
			}
			if (err == nil) != tc.valid || tc.valid && found != tc.found {
				t.Fatalf("valid=%v found=%v err=%v", tc.valid, found, err)
			}
		})
	}
}

func TestProxyEmptyHTTPResponseCannotProveRouteRemoval(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer server.Close()
	for _, endpoint := range []string{"/api/status", "/api/store/proxies"} {
		if _, _, err := proxyStoreCall(context.Background(), server.URL, "test", "test", "GET", endpoint, nil); err == nil {
			t.Fatalf("empty %s accepted", endpoint)
		}
	}
	if _, _, err := proxyStoreCall(context.Background(), server.URL, "test", "test", "DELETE", "/api/store/proxies/managed", nil); err != nil {
		t.Fatal("empty successful DELETE response rejected", err)
	}
}
