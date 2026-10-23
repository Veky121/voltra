package panel

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Manual browser acceptance uses an isolated schema and fake Wings, without
// background workers or any real accounts, game servers, or node connections.
func TestServerSettingsBrowserFixture(t *testing.T) {
	if os.Getenv("SERVER_SETTINGS_BROWSER_FIXTURE") != "true" {
		t.Skip("opt-in isolated browser fixture")
	}
	f, _ := startupPasswordFixture(t)
	a := f.a
	a.Config.DevMode, a.Config.DevUserID = true, num(f.admin["id"])
	a.Config.PublicURL = "http://127.0.0.1:5199"
	var err error
	a.Config.WebDir, err = filepath.Abs("../../.local/server-settings-web")
	if err != nil {
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
	t.Logf("isolated server settings fixture: http://127.0.0.1:5199/server/%s/startup; admin /admin/servers/%s", f.server["uuid"], str(f.server["id"]))
	select {
	case <-done:
	case <-time.After(8 * time.Minute):
		t.Fatal("browser fixture timed out")
	}
}
