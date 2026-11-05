package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestWave3BarotraumaSettingsAPI(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	for _, entry := range gameTemplates().Entries {
		if entry.Path != "barotrauma/egg-barotrauma.json" {
			continue
		}
		if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), M{"startup": entry.Egg["startup"]}); err != nil {
			t.Fatal(err)
		}
		original := `<?xml version="1.0"?><!--keep--><serversettings servername="Before" password="barotrauma-secret-sentinel" maxplayers="8" ispublic="true" port="28000" queryport="28001" unknown="preserve"><child mode="retained"/></serversettings>`
		f.mu.Lock()
		f.Files[barotraumaSettingsPath], f.State = []byte(original), "offline"
		f.mu.Unlock()
		endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/game-settings?file=%2Fserversettings.xml"
		view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
		encoded, _ := json.Marshal(view)
		if strings.Contains(string(encoded), "barotrauma-secret-sentinel") || len(asSlice(view["fields"])) != 4 {
			t.Fatal("incorrect typed fields or secret masking")
		}
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"port": "9999"}}, 422)
		infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"ispublic": false, "maxplayers": "12"}}, 200)
		f.mu.Lock()
		updated := string(f.Files[barotraumaSettingsPath])
		f.mu.Unlock()
		want := strings.Replace(strings.Replace(original, `ispublic="true"`, `ispublic="false"`, 1), `maxplayers="8"`, `maxplayers="12"`, 1)
		if updated != want {
			t.Fatal("unrelated XML bytes changed")
		}
		return
	}
	t.Fatal("missing Barotrauma recipe")
}
