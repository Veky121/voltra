package panel

import (
	"context"
	"testing"
	"voltra/internal/steamapi"
)

func TestSteamCatalogProtonExecuteRequestPlatform(t *testing.T) {
	rt := steamRuntime(t)
	a, ctx := rt.app, context.Background()
	node, err := a.one(ctx, "SELECT * FROM nodes WHERE id=$1", rt.server["node_id"])
	if err != nil {
		t.Fatal(err)
	}
	h := a.connectors()
	h.mu.Lock()
	h.controls[num(node["id"])].capabilities[steamapi.PalworldBridgeCapability] = true
	h.controls[num(node["id"])].capabilities[steamapi.WindowsCapability] = true
	h.mu.Unlock()
	for _, game := range []string{"palworld-proton", "palworld-native", "palworld"} {
		token := newUUID()
		job, err := a.insert(ctx, "steam_jobs", M{"id": newUUID(), "server_id": rt.server["id"], "operation": "install", "status": "running", "lease_token": token})
		if err != nil {
			t.Fatal(err)
		}
		_, err = a.executeSteam(ctx, rt.server, M{"game": game, "app_id": 2394010, "branch": "public"}, job, token, "install")
		if err != nil {
			t.Fatal(err)
		}
		rt.mu.Lock()
		request := rt.requests[len(rt.requests)-1]
		rt.mu.Unlock()
		want := ""
		if game == "palworld-proton" {
			want = "windows"
		}
		if request.Platform != want || request.AppID != 2394010 || request.Operation != "install" {
			t.Fatalf("Wrong captured node request for %s: platform=%q", game, request.Platform)
		}
		if err = a.exec(ctx, "UPDATE steam_jobs SET status='completed' WHERE id=$1", job["id"]); err != nil {
			t.Fatal(err)
		}
	}
}
