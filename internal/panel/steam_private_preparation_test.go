package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestPrivateSteamPreparationRecipe(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		if privateTemplateApp(entry) == 0 {
			continue
		}
		before, _ := json.Marshal(entry.Egg)
		prepared, err := privatePreparationEntry(entry)
		if err != nil {
			t.Fatal(err)
		}
		after, _ := json.Marshal(entry.Egg)
		if string(before) != string(after) || gameTemplateEggUUID(prepared) == gameTemplateEggUUID(entry) {
			t.Fatal("preparation mutated normal recipe identity")
		}
		original := str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
		staged := str(asMap(asMap(prepared.Egg["scripts"])["installation"])["script"])
		prefix := strings.TrimSuffix(strings.TrimRight(original, "\r\n"), "\npython3 .voltra/light_games_next_install.py banana")
		if !strings.HasPrefix(staged, prefix) || strings.Contains(strings.TrimPrefix(staged, prefix), "light_games_next_install.py") {
			t.Fatal("preparation changed helpers or invoked acquisition")
		}
		env := M{"AUTO_UPDATE": "1", "STEAM_USER": "", "STEAM_PASS": "", "STEAM_GSLT": "fixture-game-token"}
		got, err := privatePreparationEnvironment(env)
		if err != nil || got["AUTO_UPDATE"] != "0" || env["AUTO_UPDATE"] != "1" || got["STEAM_GSLT"] != env["STEAM_GSLT"] {
			t.Fatal("preparation environment changed operator input or game token")
		}
		for _, key := range []string{"STEAM_USER", "STEAM_PASS", "STEAM_AUTH", "SRCDS_BETAPASS"} {
			if _, err = privatePreparationEnvironment(M{key: "secret"}); err == nil {
				t.Fatal("credential accepted in game environment", key)
			}
		}
	}
}

func TestPrivateSteamTemplatePreparation(t *testing.T) {
	a, _, admin, node, wings := steamGamesFixture(t)
	mux := http.NewServeMux()
	a.registerGameTemplates(mux)
	var entry gameTemplate
	for _, candidate := range gameTemplates().Entries {
		if privateTemplateApp(candidate) != 0 {
			entry = candidate
			break
		}
	}
	if entry.ID == "" {
		t.Fatal("private recipe missing")
	}
	_, variables, err := parseEggDocument(entry.Egg)
	if err != nil {
		t.Fatal(err)
	}
	env := M{}
	for _, v := range variables {
		env[str(v["env_variable"])] = v["default_value"]
	}
	image := ""
	for _, value := range asMap(entry.Egg["docker_images"]) {
		image = str(value)
		break
	}
	var allocation int64
	if err = a.DB.QueryRow(context.Background(), "SELECT id FROM allocations WHERE node_id=$1 ORDER BY id LIMIT 1", node["id"]).Scan(&allocation); err != nil {
		t.Fatal(err)
	}
	body := M{"name": "Private preparation fixture", "request_id": newUUID(), "memory": 2048, "disk": 8192, "image": image, "allocation_id": allocation, "environment": env, "private_content": true}
	endpoint := "/api/client/game-library/templates/" + entry.ID + "/install"
	infraExpect(t, mux, admin, "POST", endpoint, body, 409)
	if wings.Creates != 0 {
		t.Fatal("disabled private node created a server")
	}
	a.privateHub().ready = func(context.Context, int64, uint32) bool { return true }
	created := asMap(infraExpect(t, mux, admin, "POST", endpoint, body, 201)["attributes"])
	retry := asMap(infraExpect(t, mux, admin, "POST", endpoint, body, 200)["attributes"])
	if created["identifier"] != retry["identifier"] || wings.Creates != 1 {
		t.Fatal("private preparation retry duplicated server")
	}
	server, err := a.one(context.Background(), "SELECT * FROM servers WHERE uuid_short=$1", created["identifier"])
	if err != nil {
		t.Fatal(err)
	}
	profile, _, err := privateContentProfile(context.Background(), a.DB, server)
	if err != nil || profile.AppID != 2406780 {
		t.Fatal("prepared server lost private policy binding", err)
	}
	if blockPublicSteamOwnership(context.Background(), a.DB, num(server["id"])) == nil {
		t.Fatal("prepared server allowed public startup before any private job")
	}
	value, err := a.one(context.Background(), "SELECT sv.variable_value FROM server_variables sv JOIN egg_variables ev ON ev.id=sv.variable_id WHERE sv.server_id=$1 AND ev.env_variable='AUTO_UPDATE'", server["id"])
	if err != nil || value["variable_value"] != "0" {
		t.Fatal("prepared server retained public updates", err)
	}
	body["private_content"] = false
	infraExpect(t, mux, admin, "POST", endpoint, body, 409)
	if wings.Creates != 1 {
		t.Fatal("mode conflict reached Wings")
	}
	if err = a.exec(context.Background(), "UPDATE eggs SET uuid=$2 WHERE id=$1", server["egg_id"], newUUID()); err != nil {
		t.Fatal(err)
	}
	if blockPublicSteamOwnership(context.Background(), a.DB, num(server["id"])) == nil {
		t.Fatal("preparation ownership boundary disappeared with a historical recipe identity")
	}
}
