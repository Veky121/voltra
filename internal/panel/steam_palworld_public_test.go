package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"voltra/internal/steamapi"
)

func TestPalworldProtonPublicSetupAndCapabilities(t *testing.T) {
	a, mux, admin, node, f := steamGamesFixture(t)
	spec, _ := steamGameSpecFor("palworld-proton")
	if spec.UnavailableReason != "" || !strings.Contains(spec.AfterSetup, "compatibility review") || !strings.Contains(spec.Description, "maintained MIT UE4SS") {
		t.Fatal("Reviewed public setup/migration help missing")
	}
	input := steamGamesInput("palworld-proton", node)
	input["start_on_completion"] = false
	input["server_password"] = "public_fixture_join"
	h := a.connectors()
	for _, capability := range []string{steamapi.PalworldBridgeCapability, steamapi.WindowsCapability} {
		h.mu.Lock()
		h.controls[num(node["id"])].capabilities[capability] = false
		h.mu.Unlock()
		options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/steam/palworld-proton", nil, 200)["attributes"])
		if boolean(asMap(asSlice(options["nodes"])[0])["setup_available"]) {
			t.Fatal("Old node advertised compatible Proton setup")
		}
		infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld-proton/install", input, 409)
		count, err := a.one(context.Background(), "SELECT count(*) AS count FROM servers")
		if err != nil || num(count["count"]) != 0 || f.Creates != 0 {
			t.Fatal("Missing capability partially provisioned")
		}
		h.mu.Lock()
		h.controls[num(node["id"])].capabilities[capability] = true
		h.mu.Unlock()
	}
	options := asMap(infraExpect(t, mux, admin, "GET", "/api/client/game-library/steam/palworld-proton", nil, 200)["attributes"])
	if !boolean(asMap(asSlice(options["nodes"])[0])["setup_available"]) || options["supports_install_only"] != true {
		t.Fatal("Supported public node not offered")
	}
	response := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld-proton/install", input, 201)
	replay := infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld-proton/install", input, 200)
	if asMap(response["attributes"])["identifier"] != asMap(replay["attributes"])["identifier"] || f.Creates != 1 {
		t.Fatal("Public Proton replay duplicated server")
	}
	state, err := a.one(context.Background(), "SELECT st.*,j.start_after FROM steam_servers st JOIN servers s ON s.id=st.server_id JOIN steam_jobs j ON j.server_id=s.id WHERE s.uuid_short=$1", asMap(response["attributes"])["identifier"])
	if err != nil || str(state["game"]) != "palworld-proton" || boolean(state["start_after"]) || !strings.HasPrefix(str(state["console_password_encrypted"]), "enc:v1:") || !strings.HasPrefix(str(state["join_password_encrypted"]), "enc:v1:") {
		t.Fatal("Public setup lost typed identity/secret/install-only boundaries")
	}
	encoded, _ := json.Marshal(response)
	if strings.Contains(string(encoded), "fixture_admin") || strings.Contains(string(encoded), "public_fixture_join") {
		t.Fatal("Public response exposed credentials")
	}
	input["start_on_completion"] = true
	infraExpect(t, mux, admin, "POST", "/api/client/game-library/steam/palworld-proton/install", input, 409)
}
