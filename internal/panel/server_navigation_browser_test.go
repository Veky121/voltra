package panel

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Opt-in browser fixture uses an isolated PostgreSQL schema and fake Wings.
// It never starts background workers or connects to a live game node.
func TestServerNavigationBrowserFixture(t *testing.T) {
	if os.Getenv("NAVIGATION_BROWSER_FIXTURE") != "true" {
		t.Skip("opt-in isolated browser fixture")
	}
	a, _, admin, server, wings := quickSetupMinecraftFixture(t)
	a.Config.DevUserID = admin
	a.Config.PublicURL = "http://127.0.0.1:5199"
	if os.Getenv("NAVIGATION_BROWSER_AUTH") == "true" {
		a.Config.DevMode = false
		hash, err := bcrypt.GenerateFromPassword([]byte("performance-fixture-only-2026"), bcrypt.MinCost)
		if err != nil {
			t.Fatal(err)
		}
		if err = a.exec(t.Context(), "UPDATE users SET password_hash=$1 WHERE id=$2", string(hash), admin); err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(setupState{Completed: true, PublicURL: a.Config.PublicURL, AccessMode: "local", TLSMode: "proxy"})
		if err = a.exec(t.Context(), "INSERT INTO settings(key,value) VALUES('panel:setup',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", raw); err != nil {
			t.Fatal(err)
		}
	}
	// Supply the Wings upload/rename protocol only inside this disposable fixture.
	// Normal file reads/writes/listings continue through its HTTP fake Wings.
	a.HTTP = &http.Client{Timeout: 10 * time.Second, Transport: gameLibraryTransport(func(r *http.Request) (*http.Response, error) {
		if r.Method == "POST" && r.URL.Path == "/upload/file" {
			reader, err := r.MultipartReader()
			if err != nil {
				return nil, err
			}
			for {
				part, err := reader.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					return nil, err
				}
				body, err := io.ReadAll(part)
				if err != nil {
					return nil, err
				}
				wings.mu.Lock()
				wings.Files[path.Join(r.URL.Query().Get("directory"), part.FileName())] = body
				wings.mu.Unlock()
			}
			return &http.Response{StatusCode: 204, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		if r.Method == "PUT" && strings.HasSuffix(r.URL.Path, "/files/rename") {
			var body struct {
				Root  string `json:"root"`
				Files []struct {
					From string `json:"from"`
					To   string `json:"to"`
				} `json:"files"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				return nil, err
			}
			wings.mu.Lock()
			for _, file := range body.Files {
				from, to := path.Join(body.Root, file.From), path.Join(body.Root, file.To)
				wings.Files[to] = wings.Files[from]
				delete(wings.Files, from)
			}
			wings.mu.Unlock()
			return &http.Response{StatusCode: 204, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		return http.DefaultTransport.RoundTrip(r)
	})}
	var err error
	webDir := os.Getenv("NAVIGATION_BROWSER_WEB_DIR")
	if webDir == "" {
		webDir = "../../web/dist"
	}
	a.Config.WebDir, err = filepath.Abs(webDir)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(t.Context(), "UPDATE servers SET name='Development Sandbox' WHERE id=$1", server["id"]); err != nil {
		t.Fatal(err)
	}
	allocation, err := a.insert(t.Context(), "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 25565})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.exec(t.Context(), "UPDATE servers SET allocation_id=$1 WHERE id=$2", allocation["id"], server["id"]); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:5199")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{}, 1)
	application := a.Handler()
	fixture := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/__fixture/finish" {
			select {
			case done <- struct{}{}:
			default:
			}
			w.WriteHeader(204)
			return
		}
		application.ServeHTTP(w, r)
	}), ReadHeaderTimeout: 5 * time.Second}
	t.Cleanup(func() { _ = fixture.Close() })
	go func() { _ = fixture.Serve(listener) }()
	t.Log("isolated navigation browser fixture ready on http://127.0.0.1:5199")
	select {
	case <-done:
	case <-time.After(12 * time.Minute):
		t.Fatal("browser fixture timed out")
	}
}
