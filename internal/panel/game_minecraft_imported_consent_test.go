package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestImportedMinecraftConsent(t *testing.T) {
	for _, path := range []string{"minecraft/java/magma/egg-magma.json", "minecraft/java/mohist/egg-mohist.json", "minecraft/java/spongeforge/egg-sponge-forge.json"} {
		entry := gameTemplate{Path: path}
		for _, value := range []any{nil, M{}, M{"EULA_ACCEPTED": "false"}, M{"EULA_ACCEPTED": true}} {
			if requireTemplateAgreements(entry, value) == nil {
				t.Fatalf("%s inferred consent", path)
			}
		}
		if err := requireTemplateAgreements(entry, M{"EULA_ACCEPTED": "true"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestImportedMinecraftSpongeJavaModes(t *testing.T) {
	data, err := os.ReadFile("testdata/game-settings/game-parity-20261029/minecraft-imported-consent/profiles.pending.json")
	if err != nil {
		t.Fatal(err)
	}
	var proposals map[string]gameTemplateOverride
	if err = json.Unmarshal(data, &proposals); err != nil {
		t.Fatal(err)
	}
	egg, _, err := parseEggDocument(proposals["minecraft/java/spongeforge/egg-sponge-forge.json"].Egg)
	if err != nil {
		t.Fatal(err)
	}
	for _, major := range []int64{8, 21} {
		_, env, err := javaInvocation(egg, M{"startup": egg["startup"]}, M{"major": major, "jvm_args": "-Xms256M -Xmx2048M"})
		if err != nil {
			t.Fatal(major, err)
		}
		script := str(env["VOLTRA_JAVA_SCRIPT"])
		if major == 8 && (strings.Contains(script, "@") || !strings.Contains(script, `-jar "${SERVER_JARFILE}"`)) {
			t.Fatal("legacy launcher mismatch", script)
		}
		if major == 21 && !strings.Contains(script, "@user_jvm_args.txt") {
			t.Fatal("modern memory args missing", script)
		}
	}
}

// Uses the real PostgreSQL fixture and actual proposed imported egg, with a local
// Wings protocol fixture. This proves delivery, never native acquisition.
func TestImportedMinecraftConsentAPI(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	data, err := os.ReadFile("testdata/game-settings/game-parity-20261029/minecraft-imported-consent/profiles.pending.json")
	if err != nil {
		t.Fatal(err)
	}
	var proposals map[string]gameTemplateOverride
	if err = json.Unmarshal(data, &proposals); err != nil {
		t.Fatal(err)
	}
	for path, proposal := range proposals {
		t.Run(path, func(t *testing.T) {
			entry := gameTemplate{Path: path, ID: newUUID(), Egg: proposal.Egg, Defaults: proposal.Defaults, Profile: proposal.Revision}
			length := len(templates.Entries)
			gameTemplates()
			length = len(templates.Entries)
			templates.Entries = append(templates.Entries, entry)
			defer func(n int) { templates.Entries = templates.Entries[:n] }(length)
			mux := http.NewServeMux()
			a.registerGameTemplates(mux)
			count := func() int64 {
				var n int64
				if err := a.DB.QueryRow(context.Background(), "SELECT (SELECT count(*) FROM servers)+(SELECT count(*) FROM eggs)+(SELECT count(*) FROM allocations)+(SELECT count(*) FROM nests)").Scan(&n); err != nil {
					t.Fatal(err)
				}
				return n
			}
			env := M{}
			for _, raw := range asSlice(entry.Egg["variables"]) {
				v := asMap(raw)
				env[str(v["env_variable"])] = v["default_value"]
			}
			options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/templates/"+entry.ID, nil, 200)["attributes"])
			images := asSlice(options["images"])
			if len(images) == 0 || !strings.Contains(str(asMap(images[0])["label"]), "(reviewed default)") {
				t.Fatal("creation did not select the reviewed image first")
			}
			image := str(asMap(images[0])["value"])
			input := M{"name": "Imported consent fixture", "request_id": newUUID(), "node_id": node["id"], "automatic_ports": true, "image": image, "memory": 4096, "disk": 10240, "environment": env}
			before, creates := count(), wings.Creates
			for _, value := range []any{nil, "false", true} {
				if value == nil {
					delete(env, "EULA_ACCEPTED")
				} else {
					env["EULA_ACCEPTED"] = value
				}
				infraExpect(t, mux, admin, "POST", "/api/client/game-library/templates/"+entry.ID+"/install", input, 422)
				if count() != before || wings.Creates != creates {
					t.Fatal("refusal mutated provisioning")
				}
			}
			env["EULA_ACCEPTED"] = "true"
			created := asMap(infraExpect(t, mux, admin, "POST", "/api/client/game-library/templates/"+entry.ID+"/install", input, 201)["attributes"])
			var delivered int
			if err := a.DB.QueryRow(context.Background(), "SELECT count(*) FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id JOIN servers s ON s.id=sv.server_id WHERE s.uuid_short=$1 AND ev.env_variable='EULA_ACCEPTED' AND sv.variable_value='true'", str(created["identifier"])).Scan(&delivered); err != nil || delivered != 1 {
				t.Fatal("consent not delivered", err)
			}
			if wings.Creates != creates+1 {
				t.Fatal("installer boundary not reached")
			}
		})
	}
}
