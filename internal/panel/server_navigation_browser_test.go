package panel

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Opt-in browser fixture uses an isolated PostgreSQL schema and fake Wings.
// It never starts background workers or connects to a live game node.
func TestServerNavigationBrowserFixture(t *testing.T) {
	if os.Getenv("NAVIGATION_BROWSER_FIXTURE") != "true" {
		t.Skip("opt-in isolated browser fixture")
	}
	a, _, admin, server, _ := quickSetupMinecraftFixture(t)
	a.Config.DevUserID = admin
	a.Config.PublicURL = "http://127.0.0.1:5199"
	var err error
	a.Config.WebDir, err = filepath.Abs("../../web/dist")
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
	case <-time.After(5 * time.Minute):
		t.Fatal("browser fixture timed out")
	}
}
