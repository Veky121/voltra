package panel

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// Exercise authenticated public routes after private custody has been removed.
// The durable parent job, rather than a live credential, owns this boundary.
func TestPrivateSteamPublicRoutesAfterCustodyDeletion(t *testing.T) {
	rt, client, base, job, token := privateRunningFixture(t)
	ctx := context.Background()
	a := rt.app
	a.finishPrivateSteamJob(ctx, job, token, errPrivateCancelled)
	if err := a.exec(ctx, "DELETE FROM steam_private_authorizations WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	before, err := a.one(ctx, "SELECT status,installation_id FROM servers WHERE id=$1", rt.server["id"])
	if err != nil {
		t.Fatal(err)
	}
	origin := strings.Split(base, "/api/")[0]
	serverBase := strings.TrimSuffix(base, "/steam/private")
	for _, route := range []struct {
		path string
		body M
	}{
		{serverBase + "/power", M{"signal": "start"}},
		{serverBase + "/power", M{"signal": "restart"}},
		{serverBase + "/settings/reinstall", M{}},
		{serverBase + "/steam/update", M{}},
		{origin + "/api/application/servers/" + str(rt.server["id"]) + "/reinstall", M{}},
	} {
		t.Run(strings.TrimPrefix(route.path, origin), func(t *testing.T) {
			status, result, _ := setupHTTP(t, client, "POST", route.path, route.body, origin)
			body, _ := json.Marshal(result)
			if status != 409 || !strings.Contains(string(body), "PrivateSteamOwnershipConflict") {
				t.Fatalf("status=%d response=%s", status, body)
			}
		})
	}
	after, err := a.one(ctx, "SELECT status,installation_id FROM servers WHERE id=$1", rt.server["id"])
	if err != nil || str(after["status"]) != str(before["status"]) || str(after["installation_id"]) != str(before["installation_id"]) {
		t.Fatalf("blocked requests changed installation state: %v", err)
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if len(rt.powers) != 0 || len(rt.requests) != 0 || len(rt.syncStartups) != 0 {
		t.Fatal("blocked public requests reached Wings or Steam execution")
	}
}

func TestPrivateSteamSocketPowerPreparedWithoutPublicState(t *testing.T) {
	rt, _, _ := privateBrowser(t)
	a, ctx := rt.app, context.Background()
	if err := a.exec(ctx, "DELETE FROM steam_servers WHERE server_id=$1", rt.server["id"]); err != nil {
		t.Fatal(err)
	}
	if err := a.exec(ctx, `UPDATE eggs SET features='["voltra:steam-private-prepared-v1"]'::jsonb WHERE id=$1`, rt.server["egg_id"]); err != nil {
		t.Fatal(err)
	}
	user, err := a.one(ctx, "SELECT * FROM users WHERE id=$1", rt.user)
	if err != nil {
		t.Fatal(err)
	}
	for _, signal := range []string{"start", "restart"} {
		raw, _ := json.Marshal(M{"event": "set state", "args": []string{signal}})
		handled, err := a.steamSocketPower(ctx, user, rt.server, raw)
		var apiError APIError
		if !handled || !errors.As(err, &apiError) || apiError.Code != "PrivateSteamOwnershipConflict" {
			t.Fatalf("private socket power bypassed boundary: %s %v %v", signal, handled, err)
		}
	}
	rt.mu.Lock()
	if len(rt.powers) != 0 {
		t.Fatal("blocked socket power reached Wings")
	}
	rt.mu.Unlock()
	handled, err := a.steamSocketPower(ctx, user, rt.server, []byte(`{"event":"set state","args":["stop"]}`))
	if !handled || err != nil {
		t.Fatalf("private socket stop unavailable: %v %v", handled, err)
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if len(rt.powers) != 1 || rt.powers[0] != "stop" {
		t.Fatal("stop did not use normal Wings transport")
	}
}

func TestPrivateSteamReadinessDiscovery(t *testing.T) {
	rt, client, base := privateBrowser(t)
	origin := strings.Split(base, "/api/")[0]
	rt.app.privateHub().ready = nil
	status, result, response := setupHTTP(t, client, "GET", base, nil, origin)
	got, ok := result["attributes"].(map[string]any)
	if status != 200 || !ok || got["ready"] != false || got["supported"] != true || got["private_content"] != false || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("default discovery did not fail closed: %d %v", status, result)
	}
	rt.app.privateHub().ready = func(context.Context, int64, uint32) bool { return true }
	status, result, _ = setupHTTP(t, client, "GET", base, nil, origin)
	got = result["attributes"].(map[string]any)
	if status != 200 || got["ready"] != true {
		t.Fatalf("explicit fixture readiness not reported: %d %v", status, result)
	}
}
