package panel

import (
	"context"
	"strings"
	"testing"
)

func TestCanvasDifficultyGuidanceAPI(t *testing.T) {
	a, mux, admin, server, f := quickSetupMinecraftFixture(t)
	ctx := context.Background()
	originalEgg, err := a.one(ctx, "SELECT * FROM eggs WHERE id=$1", server["egg_id"])
	if err != nil {
		t.Fatal(err)
	}
	var canvas gameTemplate
	for _, entry := range gameTemplates().Entries {
		if entry.Path == canvasSettingsRecipe {
			canvas = entry
		}
	}
	if canvas.Path == "" {
		t.Fatal("Canvas profile missing")
	}
	f.mu.Lock()
	f.Files["/server.properties"] = []byte("# operator\r\ndifficulty=easy\r\nmax-players=10\r\nunknown=retained\r\n")
	f.mu.Unlock()
	endpoint := "/api/client/servers/" + str(server["uuid_short"])
	readonly := map[string]bool{}
	for _, tc := range []struct {
		name   string
		egg    M
		canvas bool
	}{
		{"Canvas", M{"uuid": gameTemplateEggUUID(canvas), "startup": canvas.Egg["startup"]}, true},
		{"Other Minecraft", M{"uuid": originalEgg["uuid"], "startup": originalEgg["startup"]}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, e := a.update(ctx, "eggs", num(server["egg_id"]), tc.egg); e != nil {
				t.Fatal(e)
			}
			for _, suffix := range []string{"/quick-setup", "/game-settings?file=%2Fserver.properties"} {
				view := asMap(infraExpect(t, mux, admin, "GET", endpoint+suffix, nil, 200)["attributes"])
				found := false
				for _, v := range asSlice(view["fields"]) {
					field := asMap(v)
					if str(field["key"]) != "difficulty" {
						continue
					}
					found = true
					expected := "Difficulty"
					if tc.canvas {
						expected = "New-world difficulty"
					}
					if str(field["label"]) != expected {
						t.Fatalf("%s difficulty label: %v", suffix, field)
					}
					if tc.canvas {
						readonly[suffix] = boolean(field["readonly"])
					} else if readonly[suffix] != boolean(field["readonly"]) {
						t.Fatal("Canvas presentation changed editing policy")
					}
					if tc.canvas && str(field["description"]) != "Sets the difficulty for newly created worlds." {
						t.Fatal("missing new-world description")
					}
					if str(field["value"]) != "easy" || len(asSlice(field["options"])) != 4 {
						t.Fatalf("presentation changed value, choices or editing: %v", field)
					}
				}
				if !found {
					t.Fatalf("difficulty missing from %s", suffix)
				}
				help := false
				for _, h := range asSlice(view["help"]) {
					if strings.Contains(str(asMap(h)["text"]), "execute in <dimension> run difficulty") {
						help = true
					}
				}
				if help != tc.canvas {
					t.Fatalf("%s help scoped incorrectly", suffix)
				}
			}
		})
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Writes != 0 {
		t.Fatal("view changed native files")
	}
}
