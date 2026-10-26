package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
)

// Real API handler + isolated PostgreSQL schema + explicit fixture Wings; no live node/game.
func TestExiledStagedConsentAPI(t *testing.T) {
	data, err := os.ReadFile("../../.local/exiled-eula-source-fix/profiles.json")
	if os.IsNotExist(err) {
		t.Skip("Optional EXILED profile stage is absent")
	}
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"default", "0", "1"} {
		t.Run(value, func(t *testing.T) {
			a, _, admin, node, _ := steamGamesFixture(t)
			ctx := context.Background()
			var staged map[string]struct {
				Egg M `json:"egg"`
			}
			if err = json.Unmarshal(data, &staged); err != nil {
				t.Fatal(err)
			}
			var entry gameTemplate
			for _, e := range gameTemplates().Entries {
				if e.Path == "scpsl/exiled/egg-s-c-p--s-l--exiled.json" {
					entry = e
				}
			}
			entry.Egg = staged[entry.Path].Egg
			egg, vars, err := parseEggDocument(entry.Egg)
			if err != nil {
				t.Fatal(err)
			}
			imported, err := a.ensureGameTemplateEgg(ctx, entry, egg, vars)
			if err != nil {
				t.Fatal(err)
			}
			env := M{}
			for _, v := range vars {
				env[str(v["env_variable"])] = v["default_value"]
			}
			if env["SCPSL_ACCEPT_EULA"] != "0" {
				t.Fatal("consent not default-off")
			}
			if value == "default" {
				env["SCPSL_ACCEPT_EULA"] = "0"
			} else {
				env["SCPSL_ACCEPT_EULA"] = value
			}
			env["ACCEPT_SCPSL_EULA"] = "TRUE" // Unknown publisher alias must not bypass declared control.
			allocation, err := a.insert(ctx, "allocations", M{"node_id": node["id"], "ip": "127.0.0.1", "port": 28000})
			if err != nil {
				t.Fatal(err)
			}
			mux := http.NewServeMux()
			a.registerLifecycle(mux)
			response := infraExpect(t, mux, admin, "POST", "/api/application/servers", M{"name": "isolated EXILED consent " + value, "user": admin, "node_id": node["id"], "egg": imported["id"], "docker_image": firstGameImage(entry.Egg), "startup": entry.Egg["startup"], "skip_scripts": true, "environment": env, "allocation": M{"default": allocation["id"], "additional": []any{}}, "limits": M{"memory": 4096, "swap": 0, "disk": 8192, "io": 500, "cpu": 100}, "feature_limits": M{"databases": 0, "allocations": 0, "backups": 1}, "start_on_completion": false}, 201)
			server := asMap(response["attributes"])
			stored, err := a.one(ctx, "SELECT * FROM servers WHERE id=$1", server["id"])
			if err != nil {
				t.Fatal(err)
			}
			actual, err := a.serverEnvironment(ctx, stored)
			if err != nil {
				t.Fatal(err)
			}
			want := value
			if value == "default" {
				want = "0"
			}
			if str(actual["SCPSL_ACCEPT_EULA"]) != want {
				t.Fatal("declared consent lost", actual["SCPSL_ACCEPT_EULA"])
			}
			if _, exists := actual["ACCEPT_SCPSL_EULA"]; exists {
				t.Fatal("inherited alias persisted")
			}
		})
	}
}
func firstGameImage(egg M) string {
	for _, v := range asMap(egg["docker_images"]) {
		return str(v)
	}
	return ""
}
