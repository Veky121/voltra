package panel

import (
	"context"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

type reinstallRecordingTransport struct {
	base  http.RoundTripper
	calls atomic.Int64
}

func (t *reinstallRecordingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/reinstall") {
		t.calls.Add(1)
	}
	return t.base.RoundTrip(r)
}

func TestManagedSteamNativeReinstallRoutes(t *testing.T) {
	for _, route := range []struct {
		path string
		code int
	}{
		{"/api/client/servers/%s/settings/reinstall", http.StatusAccepted},
		{"/api/application/servers/%s/reinstall", http.StatusNoContent},
	} {
		t.Run(route.path, func(t *testing.T) {
			a, mux, admin, node, wings := steamGamesFixture(t)
			ctx := context.Background()
			installed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/satisfactory/install", steamGamesInput("satisfactory", node), 201)
			identifier := str(asMap(installed["attributes"])["identifier"])
			server, err := a.one(ctx, "SELECT * FROM servers WHERE uuid_short=$1", identifier)
			if err != nil {
				t.Fatal(err)
			}
			for _, sql := range []string{"UPDATE servers SET status=NULL,installation_id=NULL,installed_at=now()", "UPDATE steam_jobs SET status='completed'", "UPDATE steam_servers SET initialized=true"} {
				if err = a.exec(ctx, sql); err != nil {
					t.Fatal(err)
				}
			}
			a.registerOperations(mux)
			a.registerLifecycle(mux)
			base := http.DefaultTransport
			if a.HTTP != nil && a.HTTP.Transport != nil {
				base = a.HTTP.Transport
			}
			recording := &reinstallRecordingTransport{base: base}
			a.HTTP = &http.Client{Transport: recording}
			endpoint := strings.Replace(route.path, "%s", identifier, 1)
			member, err := a.insert(ctx, "users", M{"uuid": newUUID(), "username": "reinstall-other", "email": "reinstall-other@example.invalid"})
			if err != nil {
				t.Fatal(err)
			}
			denied := http.StatusForbidden
			if strings.HasPrefix(route.path, "/api/client/") {
				denied = http.StatusNotFound // Preserve native non-owner concealment.
			}
			infraExpect(t, mux, num(member["id"]), "POST", endpoint, nil, denied)
			for _, state := range []string{"running", "starting", "stopping"} {
				wings.mu.Lock()
				wings.State = state
				wings.mu.Unlock()
				infraExpect(t, mux, admin, "POST", endpoint, nil, 409)
			}
			wings.mu.Lock()
			wings.State = "offline"
			wings.Files["/operator-save"] = []byte("retain")
			wings.mu.Unlock()
			infraExpect(t, mux, admin, "POST", endpoint, nil, route.code)
			job, err := a.one(ctx, "SELECT * FROM steam_jobs WHERE server_id=$1 AND status='queued'", server["id"])
			if err != nil {
				t.Fatal(err)
			}
			if str(job["operation"]) != "install" || !boolean(job["force"]) || boolean(job["start_after"]) || boolean(job["restart"]) {
				t.Fatal("reinstall must force real installation and remain stopped")
			}
			infraExpect(t, mux, admin, "POST", endpoint, nil, route.code)
			count, err := a.one(ctx, "SELECT count(*) AS count FROM steam_jobs WHERE server_id=$1 AND status='queued'", server["id"])
			if err != nil || num(count["count"]) != 1 {
				t.Fatal("duplicate reinstall must reuse its queued job", err)
			}
			if err = a.exec(ctx, "UPDATE steam_jobs SET operation='verify' WHERE id=$1", job["id"]); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, admin, "POST", endpoint, nil, 409)
			if err = a.exec(ctx, "UPDATE steam_jobs SET status='completed' WHERE id=$1", job["id"]); err != nil {
				t.Fatal(err)
			}
			for _, update := range []string{"status='installing'", "installation_id='pending:fixture'"} {
				if err = a.exec(ctx, "UPDATE servers SET "+update+" WHERE id=$1", server["id"]); err != nil {
					t.Fatal(err)
				}
				infraExpect(t, mux, admin, "POST", endpoint, nil, 409)
				if err = a.exec(ctx, "UPDATE servers SET status=NULL,installation_id=NULL WHERE id=$1", server["id"]); err != nil {
					t.Fatal(err)
				}
			}
			transfer, err := a.insert(ctx, "server_transfers", M{"server_id": server["id"], "old_node": node["id"], "new_node": node["id"]})
			if err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, admin, "POST", endpoint, nil, 409)
			if err = a.exec(ctx, "DELETE FROM server_transfers WHERE id=$1", transfer["id"]); err != nil {
				t.Fatal(err)
			}
			if err = a.exec(ctx, "UPDATE servers SET status='reinstall_failed' WHERE id=$1", server["id"]); err != nil {
				t.Fatal(err)
			}
			infraExpect(t, mux, admin, "POST", endpoint, nil, route.code)
			if recording.calls.Load() != 0 {
				t.Fatal("managed reinstall called Wings bootstrap reinstall")
			}
			wings.mu.Lock()
			retained := string(wings.Files["/operator-save"])
			wings.mu.Unlock()
			if retained != "retain" {
				t.Fatal("enqueue modified operator files")
			}
		})
	}
}
