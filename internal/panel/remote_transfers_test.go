package panel

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestRemoteTransfersProtocolAndPermission(t *testing.T) {
	f := operationsFixtureNew(t)
	var payload M
	f.daemon.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			writeJSON(w, 200, M{"transfers": []M{{"identifier": "test-download", "directory": "/mods", "name": "mod.zip", "state": "failed", "error": "Download site returned 403 Forbidden"}}})
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		writeJSON(w, 202, M{"identifier": "test-download"})
	})
	response := f.request("POST", f.serverPath("/files/pull"), M{"url": "https://example.com/mod.zip", "directory": "/mods", "tracked": true, "foreground": true, "use_header": true}, f.owner)
	operationsExpect(t, response, 202)
	if payload["root"] != "/mods" || payload["foreground"] != false || payload["use_header"] != true {
		t.Fatal(payload)
	}
	var result M
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result["identifier"] != "test-download" {
		t.Fatal(response.Body.String(), err)
	}
	response = f.request("GET", f.serverPath("/files/pulls"), nil, f.owner)
	operationsExpect(t, response, 200)
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("cached transfer status")
	}
	// Read-only collaborators see progress initiated by the owner.
	operationsExpect(t, f.request("GET", f.serverPath("/files/pulls"), nil, f.sub), 200)
	operationsExpect(t, f.request("POST", f.serverPath("/files/pull"), M{"url": "https://example.com/mod.zip"}, f.sub), 403)
}
