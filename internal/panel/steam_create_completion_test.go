package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

func TestSteamGameCreateStartOnCompletion(t *testing.T) {
	for _, test := range []struct {
		name          string
		value         any
		present, want bool
	}{
		{"default", nil, false, true},
		{"enabled", true, true, true},
		{"install-only", false, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, mux, admin, node, _ := steamGamesFixture(t)
			options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/steam/palworld", nil, 200)["attributes"])
			if options["supports_install_only"] != true {
				t.Fatal("Install-only capability missing")
			}
			input := steamGamesInput("palworld", node)
			if test.present {
				input["start_on_completion"] = test.value
			}
			response := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld/install", input, 201)
			job, err := a.one(context.Background(), "SELECT j.* FROM steam_jobs j JOIN servers s ON s.id=j.server_id WHERE s.uuid_short=$1", asMap(response["attributes"])["identifier"])
			if err != nil || str(job["operation"]) != "install" || boolean(job["start_after"]) != test.want {
				t.Fatalf("Install completion policy not retained: %v", err)
			}
			replayed := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld/install", input, 200)
			if asMap(replayed["attributes"])["identifier"] != asMap(response["attributes"])["identifier"] {
				t.Fatal("Replay created a different server")
			}
			input["start_on_completion"] = !test.want
			infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld/install", input, 409)
		})
	}
	spec, _ := steamGameSpecFor("palworld")
	for _, value := range []any{nil, "false", 0, M{}} {
		if _, err := steamParseGameInput(spec, M{"start_on_completion": value}); err == nil {
			t.Fatal("Untyped completion policy accepted")
		}
	}
}

func TestSteamGameCompletionFingerprintLegacyBytes(t *testing.T) {
	type legacyInput struct {
		Name, RequestID, Password string
		NodeID, Memory, Players   int64
		Catalog                   *steamCatalogConfiguration
	}
	for _, catalog := range []*steamCatalogConfiguration{nil, {Secrets: map[string]string{"ADMIN_PASSWORD": "fixture-private"}, Values: M{"SRCDS_APPID": "2394010"}}} {
		input := steamGameInput{Name: "Fixture", RequestID: newUUID(), Password: "fixture-join", NodeID: 249, Memory: 8192, Players: 11, Catalog: catalog, StartOnCompletion: true}
		var secrets map[string]string
		if catalog != nil {
			secrets = catalog.Secrets
		}
		legacy, _ := json.Marshal(struct {
			Game        string
			Input       legacyInput
			Credentials map[string]string
		}{"palworld", legacyInput{input.Name, input.RequestID, input.Password, input.NodeID, input.Memory, input.Players, input.Catalog}, secrets})
		if !bytes.Equal(legacy, steamGameProvisionBytes("palworld", input)) {
			t.Fatal("Default create fingerprint bytes changed across upgrade")
		}
		input.StartOnCompletion = false
		installOnly := steamGameProvisionBytes("palworld", input)
		if bytes.Equal(legacy, installOnly) || !bytes.Contains(installOnly, []byte(`"install_only":true`)) {
			t.Fatal("Install-only policy missing from fingerprint")
		}
	}
}
