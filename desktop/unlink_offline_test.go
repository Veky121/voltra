package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestOfflineUnlinkClearsProtectedConnectionWithoutWaiting(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows DPAPI required")
	}
	blocked, started := make(chan struct{}), make(chan struct{}, 1)
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		select {
		case <-blocked:
		case <-r.Context().Done():
		}
	}))
	defer remote.Close()
	defer close(blocked)
	dir := t.TempDir()
	want := session{PanelURL: remote.URL, Token: "vdt_" + strings.Repeat("c", 64), DeviceID: "offline-device", Name: "Offline computer"}
	if err := saveSession(dir, want); err != nil {
		t.Fatal(err)
	}
	h := newHost(dir, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("Voltra")}})
	launch, stop, err := h.start()
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 2 * time.Second}
	response, err := client.Get(launch)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	post := func(origin string) int {
		t.Helper()
		request, _ := http.NewRequest("POST", h.origin+"/desktop/unlink", bytes.NewBufferString("{}"))
		request.Header.Set("Origin", origin)
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		return response.StatusCode
	}
	if post("https://attacker.example.test") != http.StatusForbidden || h.current().Token == "" {
		t.Fatal("cross-origin request removed the saved connection")
	}
	if post(h.origin) != http.StatusOK {
		t.Fatal("offline unlink failed")
	}
	if h.current().Token != "" || h.current().PanelURL != "" {
		t.Fatal("in-memory connection survived unlink")
	}
	if _, err := os.Stat(filepath.Join(dir, "connection.dat")); !os.IsNotExist(err) {
		t.Fatal("protected connection file survived unlink")
	}
	if restarted := newHost(dir, fstest.MapFS{}); restarted.current().Token != "" {
		t.Fatal("unlinked connection was restored on restart")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("remote revocation was not attempted")
	}
}
