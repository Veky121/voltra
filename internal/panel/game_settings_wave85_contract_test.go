package panel

import (
	"bytes"
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestWave85NativeContractsAPI(t *testing.T) {
	for _, tc := range []struct {
		recipe, file, data, key string
		invalid                 []any
		valid                   string
	}{
		{"ark_survival_ascended/egg-ark-survival-ascended.json", "/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini", "[/Script/Engine.GameSession]\nMaxPlayers=70\n[SessionSettings]\nSessionName=Original\n[ServerSettings]\nServerAdminPassword=admin_safe\nServerPassword=join_safe\nServerPVE=False\n; unknown retained\n", "/Script/Engine.GameSession/MaxPlayers", []any{"1.5", "201", "0", "NaN", 12}, "42"},
		{"terraria/tmodloader/egg-t-modloader.json", "/serverconfig.txt", "maxplayers=8\ndifficulty=0\nworldname=world\nworldpath=/home/container/saves/Worlds\nworld=/home/container/saves/Worlds/world.wld\nmodpath=/home/container/custommods\n# preserved\n", "maxplayers", []any{"999", "256", "0", "1.5", "NaN", 12}, "12"},
		{"ark_survival_evolved/egg-ark--survival-evolved.json", "/ShooterGame/Saved/Config/LinuxServer/GameUserSettings.ini", "[/Script/Engine.GameSession]\nMaxPlayers=12\n[SessionSettings]\nSessionName=Original\n[ServerSettings]\nActiveMods=123\nRCONEnabled=True\nServerPassword=safe\nServerPVE=False\n", "/Script/Engine.GameSession/MaxPlayers", []any{"42"}, ""},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			var schemaName string
			var cleanupConfig *pgxpool.Config
			t.Cleanup(func() {
				if cleanupConfig == nil {
					return
				}
				db, e := pgxpool.NewWithConfig(context.Background(), cleanupConfig)
				if e != nil {
					t.Error(e)
					return
				}
				defer db.Close()
				var exists bool
				if e = db.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", schemaName).Scan(&exists); e != nil || exists {
					t.Error("fixture schema cleanup failed")
				} else {
					t.Log("fixture schema removal verified")
				}
			})
			a, mux, admin, s, f := quickSetupMinecraftFixture(t)
			cleanupConfig = a.DB.Config().Copy()
			ctx := context.Background()
			var schema string
			if e := a.DB.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); e != nil {
				t.Fatal(e)
			}
			schemaName = schema
			t.Logf("isolated schema %s; fixture cleanup drops schema", schema)
			egg := batchSettingsRecipeFixture(t, tc.recipe)
			if _, e := a.update(ctx, "eggs", num(s["egg_id"]), egg); e != nil {
				t.Fatal(e)
			}
			if _, e := a.update(ctx, "servers", num(s["id"]), M{"startup": egg["startup"]}); e != nil {
				t.Fatal(e)
			}
			f.Files[tc.file] = []byte(tc.data)
			f.State = "offline"
			route := "/api/client/servers/" + str(s["uuid_short"]) + "/game-settings?file=" + url.QueryEscape(tc.file)
			view := asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
			if tc.recipe == wave85ASE {
				for _, raw := range asSlice(view["fields"]) {
					field := asMap(raw)
					if wave85ASEManaged(egg, tc.file, str(field["key"])) && !boolean(field["readonly"]) {
						t.Fatal("managed field advertised editable")
					}
				}
			}
			infraExpect(t, mux, admin, "PUT", route, M{"revision": "stale", "settings": M{tc.key: "1"}}, 409)
			f.State = "running"
			infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: "1"}}, 409)
			f.State = "offline"

			for _, v := range tc.invalid {
				w := f.Writes
				infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: v}}, 422)
				if f.Writes != w || !bytes.Equal(f.Files[tc.file], []byte(tc.data)) {
					t.Fatal("invalid input mutated file")
				}
			}
			for key, values := range func() map[string][]any {
				if tc.recipe == wave85ASA {
					return map[string][]any{"SessionSettings/SessionName": {"bad?name", "bad\\name", strings.Repeat("a", 257)}, "ServerSettings/ServerAdminPassword": {"", "bad password"}, "ServerSettings/ServerPassword": {"bad?password"}}
				}
				if tc.recipe == wave85TML {
					return map[string][]any{"difficulty": {"4", "1.5", "NaN", true}, "worldname": {"../bad"}, "worldpath": {"/tmp"}, "world": {"/home/container/saves/Worlds/../bad.wld"}}
				}
				return map[string][]any{"ServerSettings/ActiveMods": {"456"}, "ServerSettings/RCONEnabled": {false}}
			}() {
				for _, v := range values {
					w := f.Writes
					infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: v}}, 422)
					if f.Writes != w || string(f.Files[tc.file]) != tc.data {
						t.Fatal("invalid mutation")
					}
				}
			}
			if tc.valid != "" {
				for _, v := range []string{"1", func() string {
					if tc.recipe == wave85ASA {
						return "200"
					}
					return "255"
				}(), tc.valid} {
					view = asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
					infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{tc.key: v}}, 200)
				}
				if tc.recipe == wave85TML && !strings.Contains(string(f.Files[tc.file]), "world=/home/container/saves/Worlds/world.wld\nmodpath=/home/container/custommods\n# preserved\n") {
					t.Fatal("paths or unknown bytes changed")
				}
				if e := os.WriteFile("../../artifacts/game-parity-20261029/wave85-native-editor-contracts/"+func() string {
					if tc.recipe == wave85ASA {
						return "asa-valid.ini"
					}
					return "tml-valid.txt"
				}(), f.Files[tc.file], 0600); e != nil {
					t.Fatal(e)
				}
			} else {
				for key, v := range (M{"SessionSettings/SessionName": "Edited", "ServerSettings/ServerPassword": "edited_safe", "ServerSettings/ServerPVE": true}) {
					view = asMap(infraExpect(t, mux, admin, "GET", route, nil, 200)["attributes"])
					infraExpect(t, mux, admin, "PUT", route, M{"revision": view["revision"], "settings": M{key: v}}, 200)
				}
			}
		})
	}
}
