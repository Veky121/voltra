package panel

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestMinecraftLegacyPropertyEnumBoundariesAndCustomizations(t *testing.T) {
	a := cliTestApp(t)
	egg, err := a.gameLibraryMinecraftLoaderEgg(context.Background(), "forge", true)
	if err != nil {
		t.Fatal(err)
	}
	image := "ghcr.io/pterodactyl/yolks:java_8"
	for _, version := range []string{"1.8", "1.12", "1.12.2", "1.13", "1.13.2", "1.20.1", "26.3", "latest", "1.12.2-pre1", "", "bad"} {
		t.Run(version, func(t *testing.T) {
			legacy := version == "1.8" || version == "1.12" || version == "1.12.2"
			for index := range 4 {
				mode, difficulty := minecraftPropertyEnumNames("gamemode")[index], minecraftPropertyEnumNames("difficulty")[index]
				env := M{"MINECRAFT_VERSION": version, "GAME_MODE": mode, "DIFFICULTY": difficulty, "MAX_PLAYERS": "7", "OTHER": "keep"}
				minecraftRuntimePropertyEnums(egg, env, image)
				if legacy {
					if env["GAME_MODE"] != str(index) || env["DIFFICULTY"] != str(index) {
						t.Fatalf("legacy enum not encoded: %v", env)
					}
				} else if env["GAME_MODE"] != mode || env["DIFFICULTY"] != difficulty {
					t.Fatalf("modern/unknown version modified: %v", env)
				}
				if env["OTHER"] != "keep" || env["MAX_PLAYERS"] != "7" {
					t.Fatal("unrelated environment modified")
				}
			}
		})
	}
	for _, change := range []string{"uuid", "author", "script", "entry", "startup", "installer-image", "runtime-image", "allowed-images", "mapping", "parser"} {
		t.Run("preserve-"+change, func(t *testing.T) {
			raw, _ := json.Marshal(egg)
			custom := M{}
			if err := json.Unmarshal(raw, &custom); err != nil {
				t.Fatal(err)
			}
			actualImage := image
			switch change {
			case "uuid":
				custom["uuid"] = newUUID()
			case "author":
				custom["author"] = "admin@example.invalid"
			case "script":
				custom["script_install"] = str(custom["script_install"]) + "\necho custom"
			case "entry":
				custom["script_entry"] = "custom"
			case "startup":
				custom["startup"] = "custom launcher"
			case "installer-image":
				custom["script_container"] = "custom/installer"
			case "runtime-image":
				actualImage = "custom/java"
			case "allowed-images":
				asMap(custom["docker_images"])["Custom"] = "custom/java"
			case "mapping":
				asMap(asMap(asMap(custom["config_files"])["server.properties"])["find"])["gamemode"] = "{{server.build.env.CUSTOM_MODE}}"
			case "parser":
				asMap(asMap(custom["config_files"])["server.properties"])["parser"] = "file"
			}
			env := M{"MINECRAFT_VERSION": "1.12.2", "GAME_MODE": "creative", "DIFFICULTY": "normal"}
			minecraftRuntimePropertyEnums(custom, env, actualImage)
			if env["GAME_MODE"] != "creative" || env["DIFFICULTY"] != "normal" {
				t.Fatalf("administrator contract changed: %v", env)
			}
		})
	}
}

func TestMinecraftLegacyQuickSetupReadWriteAndWingsConfiguration(t *testing.T) {
	for _, version := range []string{"1.12.2", "1.13"} {
		t.Run(version, func(t *testing.T) {
			a, mux, admin, server, f := quickSetupMinecraftFixture(t)
			ctx := context.Background()
			allocation, err := a.insert(ctx, "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 25580})
			if err != nil {
				t.Fatal(err)
			}
			server, err = a.update(ctx, "servers", num(server["id"]), M{"allocation_id": allocation["id"], "image": "ghcr.io/pterodactyl/yolks:java_8", "java_config": M{"runtime_id": "temurin-8", "required_major": 8}})
			if err != nil {
				t.Fatal(err)
			}
			if err = a.exec(ctx, `INSERT INTO server_variables(server_id,variable_id,variable_value) SELECT $1,id,$3 FROM egg_variables WHERE egg_id=$2 AND env_variable='MINECRAFT_VERSION'`, server["id"], server["egg_id"], version); err != nil {
				t.Fatal(err)
			}
			initial := "gamemode=survival\ndifficulty=easy\n"
			if version == "1.12.2" {
				initial = "gamemode=0\ndifficulty=1\n"
			}
			f.Files["/server.properties"] = append(f.Files["/server.properties"], []byte(initial)...)
			endpoint := "/api/client/servers/" + str(server["uuid_short"]) + "/quick-setup"
			view := asMap(infraExpect(t, mux, admin, "GET", endpoint, nil, 200)["attributes"])
			field := func(view M, key string) string {
				for _, row := range asSlice(view["fields"]) {
					if str(asMap(row)["key"]) == key {
						return str(asMap(row)["value"])
					}
				}
				return ""
			}
			if field(view, "gamemode") != "survival" || field(view, "difficulty") != "easy" {
				t.Fatal("legacy numeric values did not populate named controls")
			}
			saved := asMap(infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"gamemode": "creative", "difficulty": "normal"}}, 200)["attributes"])
			if field(saved, "gamemode") != "creative" || field(saved, "difficulty") != "normal" {
				t.Fatal("saved response lost canonical enum names")
			}
			content := string(f.Files["/server.properties"])
			mode, difficulty := "creative", "normal"
			if version == "1.12.2" {
				mode, difficulty = "1", "2"
			}
			for _, expected := range []string{"gamemode=" + mode, "difficulty=" + difficulty, "unknown-plugin-property=retained", "level-name=custom-world"} {
				if !strings.Contains(content, expected) {
					t.Fatalf("missing encoded/preserved property %q", expected)
				}
			}
			env, err := a.serverEnvironment(ctx, server)
			if err != nil || env["GAME_MODE"] != "creative" || env["DIFFICULTY"] != "normal" {
				t.Fatal("canonical editable environment changed", env, err)
			}
			config, err := a.serverConfig(ctx, server)
			if err != nil {
				t.Fatal(err)
			}
			wings := asMap(config["environment"])
			if wings["GAME_MODE"] != mode || wings["DIFFICULTY"] != difficulty {
				t.Fatal("Wings would overwrite the legacy file with named values", wings["GAME_MODE"], wings["DIFFICULTY"])
			}
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": view["revision"], "settings": M{"difficulty": "hard"}}, 409)
			infraExpect(t, mux, admin, "PUT", endpoint, M{"revision": saved["revision"], "settings": M{"difficulty": "9"}}, 422)
		})
	}
}
