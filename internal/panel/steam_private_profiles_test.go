package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"voltra/internal/steamapi"
)

func TestPrivateSteamBananaCatalogBinding(t *testing.T) {
	rt, client, base := privateBrowser(t)
	a, ctx := rt.app, context.Background()
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if candidate.Path == "banana_shooter/egg-banana-shooter.json" {
			entry = candidate
		}
	}
	if entry.Path == "" {
		t.Fatal("missing canonical Banana recipe")
	}
	image := ""
	for _, value := range asMap(entry.Egg["docker_images"]) {
		image = str(value)
		break
	}
	for _, change := range []struct {
		sql  string
		args []any
	}{
		{"DELETE FROM steam_servers WHERE server_id=$1", []any{rt.server["id"]}},
		{"UPDATE eggs SET uuid=$2 WHERE id=$1", []any{rt.server["egg_id"], gameTemplateEggUUID(entry)}},
		{"UPDATE servers SET startup=$2,image=$3 WHERE id=$1", []any{rt.server["id"], entry.Egg["startup"], image}},
	} {
		if err := a.exec(ctx, change.sql, change.args...); err != nil {
			t.Fatal(err)
		}
	}
	origin := strings.Split(base, "/api/")[0]
	status, result, _ := setupHTTP(t, client, "GET", base, nil, origin)
	attrs := asMap(result["attributes"])
	if status != 200 || !boolean(attrs["supported"]) || num(attrs["app_id"]) != 2406780 {
		t.Fatalf("catalog discovery: %d %v", status, result)
	}
	status, result, _ = setupHTTP(t, client, "POST", base+"/authorizations", M{"username": "fixture-only", "password": "fixture-only", "save_password": true}, origin)
	if status != 201 {
		t.Fatal(status)
	}
	id := asMap(result["attributes"])["id"]
	status, _, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": id, "operation": "install"}, origin)
	if status != 202 {
		t.Fatalf("catalog queue status %d", status)
	}
	row, err := a.one(ctx, "SELECT request FROM steam_private_jobs")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(row["request"])
	var request steamapi.PrivateRequest
	if json.Unmarshal(raw, &request) != nil || request.Selection.App != 2406780 || request.Selection.Platform != "linux" || request.Selection.Architecture != "64" || len(request.Selection.Protected) != 2 || request.Selection.Protected[1] != "Servers" || request.Username != "" || request.Password != "" {
		t.Fatal("catalog queue lost fixed policy or persisted credentials in public request")
	}
	token := newUUID()
	job, err := a.claimSteamJob(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	current, err := a.privateJobRow(ctx, str(job["id"]))
	if err != nil || a.privateJobAllowed(ctx, current, token) != nil {
		t.Fatal("exact catalog binding did not survive shared claim")
	}
	// A matching name/app variable cannot authorize a modified startup or image.
	for _, mutation := range []string{"UPDATE servers SET startup=startup||' --modified'", "UPDATE servers SET startup='exec python3 .voltra/light_games_next_runtime.py banana',image='unreviewed:local'"} {
		if err := a.exec(ctx, mutation); err != nil {
			t.Fatal(err)
		}
		current, err = a.privateJobRow(ctx, str(job["id"]))
		if err != nil || a.privateJobAllowed(ctx, current, token) == nil {
			t.Fatal("running job did not reject modified catalog binding")
		}
		status, result, _ = setupHTTP(t, client, "POST", base+"/jobs", M{"authorization_id": id, "operation": "update"}, origin)
		encoded, _ := json.Marshal(result)
		if status != 409 || !strings.Contains(string(encoded), "PrivateSteamProfileUnavailable") {
			t.Fatalf("modified template accepted: %d %s", status, encoded)
		}
	}
}
