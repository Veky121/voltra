package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSharedTransferProgressScopeAndMeasuredBytes(t *testing.T) {
	m := transferTestManager(t)
	scope := transferTestScope()
	id := transferTestCreate(t, m, scope, "world.zip", 8)
	response := transferTestRequest(m, scope, http.MethodPatch, id, bytes.NewReader([]byte("data")), map[string]string{"Upload-Offset": "0", "Content-Type": "application/offset+octet-stream"})
	if response.Code != 204 {
		t.Fatal(response.Code, response.Body.String())
	}
	records, err := m.sharedProgress(context.Background(), "server-9", 3)
	if err != nil || len(records) != 1 {
		t.Fatal(records, err)
	}
	if num(records[0]["received_bytes"]) != 4 || num(records[0]["total_bytes"]) != 8 || records[0]["state"] != "uploading" || records[0]["size_known"] != true {
		t.Fatal(records)
	}
	stale := time.Now().Add(-time.Minute).Truncate(time.Second)
	if err := os.Chtimes(filepath.Join(m.store.Path, id), stale, stale); err != nil {
		t.Fatal(err)
	}
	// Reading/renewing metadata must not turn a paused byte stream into activity.
	response = transferTestRequest(m, scope, http.MethodHead, id, nil, nil)
	records, err = m.sharedProgress(context.Background(), "server-9", 3)
	if err != nil || len(records) != 1 || num(records[0]["updated"]) != stale.UnixMilli() {
		t.Fatal("metadata read invented upload activity", records, err)
	}
	raw, _ := json.Marshal(records)
	for _, secret := range []string{"owner", "secret", "daemon_token", "uploadURL", m.store.Path} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("private transfer data exposed", secret)
		}
	}
	for _, other := range []struct {
		server string
		node   int64
	}{{"other-server", 3}, {"server-9", 4}} {
		records, err = m.sharedProgress(context.Background(), other.server, other.node)
		if err != nil || len(records) != 0 {
			t.Fatal("cross-server progress leaked", records, err)
		}
	}
	response = transferTestRequest(m, scope, http.MethodPatch, id, bytes.NewReader([]byte("more")), map[string]string{"Upload-Offset": "4", "Content-Type": "application/offset+octet-stream"})
	if response.Code != 204 {
		t.Fatal(response.Code, response.Body.String())
	}
	records, err = m.sharedProgress(context.Background(), "server-9", 3)
	if err != nil || records[0]["state"] != "awaiting_save" {
		t.Fatal(records, err)
	}
}
