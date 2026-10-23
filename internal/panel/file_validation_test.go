package panel

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"testing"
)

func TestFileValidationTypesAndLaravelBooleans(t *testing.T) {
	for _, mode := range []any{"0644", "755", float64(644), 755, int64(644)} {
		entry := M{"file": "a", "mode": mode}
		if err := validateOriginalFileRequest("chmod", M{"files": []any{entry}}); err != nil {
			t.Fatalf("valid numeric mode %v rejected: %v", mode, err)
		}
		if _, ok := entry["mode"].(string); !ok {
			t.Fatal("Wings mode not normalized to string")
		}
	}
	for _, value := range []any{true, false, 0, 1, float64(0), float64(1), "0", "1"} {
		body := M{"url": "https://example.com/a", "use_header": value, "foreground": value, "directory": nil, "filename": nil}
		if err := validateOriginalFileRequest("pull", body); err != nil {
			t.Fatalf("rejected %v: %v", value, err)
		}
		if _, ok := body["use_header"].(bool); !ok {
			t.Fatalf("Wings boolean not normalized: %#v", body)
		}
	}
	for _, tc := range []struct {
		op   string
		body M
	}{
		{"copy", M{"location": 7}}, {"create-folder", M{"name": true}}, {"decompress", M{"file": []any{"a"}}},
		{"rename", M{"files": []any{M{"from": 7, "to": "b"}}}}, {"delete", M{"files": []any{"a"}, "root": 7}},
		{"pull", M{"url": "https://example.com", "filename": true}}, {"pull", M{"url": "https://example.com", "directory": []any{}}},
		{"pull", M{"url": "https://example.com", "foreground": "true"}}, {"pull", M{"url": "https://example.com", "use_header": nil}},
		{"pull", M{"url": "https://example.com", "use_header": M{}}},
	} {
		if err := validateOriginalFileRequest(tc.op, tc.body); err == nil {
			t.Fatalf("accepted malformed %s: %#v", tc.op, tc.body)
		}
	}
}

func TestFileValidationInvalidRequestsNeverReachWings(t *testing.T) {
	f := operationsFixtureNew(t)
	for _, tc := range []struct {
		op   string
		body M
	}{
		{"create-folder", M{"name": 7}}, {"copy", M{"location": true}}, {"delete", M{"root": false, "files": []any{"a"}}},
		{"pull", M{"url": "https://example.com", "foreground": "yes"}},
	} {
		operationsExpect(t, f.request("POST", f.serverPath("/files/"+tc.op), tc.body, f.owner), 422)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) != 0 {
		t.Fatalf("invalid request reached Wings: %#v", f.calls)
	}
}

func TestFilePullLimitSharedByServerAndExpires(t *testing.T) {
	f := operationsFixtureNew(t)
	for i := 0; i < 5; i++ {
		user := f.owner
		if i%2 == 1 {
			user = f.admin
		}
		operationsExpect(t, f.request("POST", f.serverPath("/files/pull"), M{"url": "https://example.com/a"}, user), 204)
	}
	w := f.request("POST", f.serverPath("/files/pull"), M{"url": "https://example.com/a"}, f.admin)
	operationsExpect(t, w, http.StatusTooManyRequests)
	if seconds, err := strconv.Atoi(w.Header().Get("Retry-After")); err != nil || seconds < 1 || seconds > 600 {
		t.Fatalf("bad retry header: %q", w.Header().Get("Retry-After"))
	}
	f.mu.Lock()
	calls := len(f.calls)
	f.mu.Unlock()
	if calls != 5 {
		t.Fatalf("throttled request reached daemon: %d", calls)
	}
	if err := f.a.exec(context.Background(), "UPDATE settings SET value=jsonb_set(value,'{expires}','0'::jsonb) WHERE key=$1", "rate:file-pull:"+str(f.server["uuid"])); err != nil {
		t.Fatal(err)
	}
	operationsExpect(t, f.request("POST", f.serverPath("/files/pull"), M{"url": "https://example.com/a"}, f.owner), 204)
}

func TestFilePullLimitConcurrentAtomicity(t *testing.T) {
	f := operationsFixtureNew(t)
	var wait sync.WaitGroup
	statuses := make(chan int, 12)
	for i := 0; i < 12; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			statuses <- f.request("POST", f.serverPath("/files/pull"), M{"url": "https://example.com/a"}, f.owner).Code
		}()
	}
	wait.Wait()
	close(statuses)
	success, limited := 0, 0
	for status := range statuses {
		switch status {
		case 204:
			success++
		case 429:
			limited++
		default:
			t.Fatalf("unexpected status %d", status)
		}
	}
	if success != 5 || limited != 7 {
		t.Fatalf("concurrent limit bypassed: %d accepted, %d limited", success, limited)
	}
}
