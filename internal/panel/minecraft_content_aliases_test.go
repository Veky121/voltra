package panel

import (
	"context"
	"testing"
)

func TestMinecraftContentOriginalRecipeAliases(t *testing.T) {
	for _, tc := range []struct {
		name, loader, version, selected string
		env                             M
	}{
		{"fabric", "fabric", "26.3", "0.19.5", M{"MC_VERSION": "26.3", "LOADER_VERSION": "0.19.5"}},
		{"quilt", "quilt", "1.21.11", "0.30.1", M{"MC_VERSION": "1.21.11", "LOADER_VERSION": "0.30.1"}},
		{"forge explicit overrides stale mc", "forge", "1.20.1", "1.20.1-47.4.0", M{"MC_VERSION": "26.3", "FORGE_VERSION": "1.20.1-47.4.0"}},
		{"old forge suffix", "forge", "1.7.10", "1.7.10-10.13.4.1614-1.7.10", M{"MC_VERSION": "latest", "FORGE_VERSION": "1.7.10-10.13.4.1614-1.7.10"}},
		{"neo old forge", "neoforge", "1.20.1", "1.20.1-47.1.106", M{"MC_VERSION": "26.3", "NEOFORGE_VERSION": "1.20.1-47.1.106"}},
		{"neo modern", "neoforge", "1.21.1", "21.1.264", M{"MC_VERSION": "latest", "NEOFORGE_VERSION": "21.1.264"}},
		{"neo zero patch", "neoforge", "1.21", "21.0.167-beta", M{"NEOFORGE_VERSION": "21.0.167-beta"}},
		{"neo year", "neoforge", "26.3", "26.3.0.95", M{"NEOFORGE_VERSION": "26.3.0.95"}},
		{"neo year patch", "neoforge", "26.1.2", "26.1.2.4-beta", M{"NEOFORGE_VERSION": "26.1.2.4-beta"}},
		{"spigot", "spigot", "26.3", "", M{"DL_VERSION": "26.3"}},
		{"managed precedence", "forge", "26.3", "66.1.0", M{"MINECRAFT_VERSION": "26.3", "MINECRAFT_LOADER_VERSION": "66.1.0", "MC_VERSION": "1.20.1", "FORGE_VERSION": "1.20.1-47.4.0"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.env["MINECRAFT_LOADER"] = tc.loader
			info, reason := mcContentEnvironment(tc.env)
			if reason != "" || info.Version != tc.version || info.LoaderVersion != tc.selected {
				t.Fatalf("incorrect original alias resolution: %#v %q", info, reason)
			}
			if tc.loader == "spigot" && (info.Kind != "plugin" || info.Directory != "/plugins") {
				t.Fatal("Spigot did not reuse plugin browser")
			}
		})
	}
	for _, env := range []M{
		{"MINECRAFT_LOADER": "forge", "MC_VERSION": "26.3", "FORGE_VERSION": "66.1.0"},
		{"MINECRAFT_LOADER": "neoforge", "MC_VERSION": "26.3", "NEOFORGE_VERSION": "26.3.95"},
		{"MINECRAFT_LOADER": "neoforge", "NEOFORGE_VERSION": "garbage"},
		{"MINECRAFT_LOADER": "fabric", "MC_VERSION": "snapshot"},
	} {
		if _, reason := mcContentEnvironment(env); reason == "" {
			t.Fatalf("ambiguous or unresolved identity was exposed as compatible: %#v", env)
		}
	}
}

func TestMinecraftContentOriginalAliasDatabaseResolution(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	eggID := num(f.server["egg_id"])
	if err := f.a.exec(ctx, "DELETE FROM egg_variables WHERE egg_id=$1", eggID); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{"MINECRAFT_LOADER": "neoforge", "MC_VERSION": "26.3", "NEOFORGE_VERSION": "21.1.264"} {
		if _, err := f.a.insert(ctx, "egg_variables", M{"egg_id": eggID, "name": name, "env_variable": name, "default_value": value, "rules": "nullable|string"}); err != nil {
			t.Fatal(err)
		}
	}
	info, reason, err := f.a.mcContentInfo(ctx, f.server)
	if err != nil || reason != "" || info.Version != "1.21.1" || info.LoaderVersion != "21.1.264" || info.Directory != "/mods" {
		t.Fatalf("saved original fields were not resolved: %#v %q %v", info, reason, err)
	}
}

func TestMinecraftContentArclightOriginalLoaderAlias(t *testing.T) {
	for _, loader := range []string{"forge", "neoforge", "fabric"} {
		info, reason := mcContentEnvironment(M{"MINECRAFT_VERSION": "1.21.1", "ARCLIGHT_LOADER": loader})
		if reason != "" || info.Loader != loader || info.Kind != "mod" {
			t.Fatalf("Arclight loader did not resolve: %#v %q", info, reason)
		}
	}
	info, reason := mcContentEnvironment(M{"MINECRAFT_VERSION": "1.21.1", "MINECRAFT_LOADER": "paper", "ARCLIGHT_LOADER": "forge"})
	if reason != "" || info.Loader != "paper" || info.Kind != "plugin" {
		t.Fatalf("Managed loader precedence changed: %#v %q", info, reason)
	}
	f := operationsFixtureNew(t)
	ctx := context.Background()
	eggID := num(f.server["egg_id"])
	if err := f.a.exec(ctx, "DELETE FROM egg_variables WHERE egg_id=$1", eggID); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{"MINECRAFT_VERSION": "1.21.1", "ARCLIGHT_LOADER": "forge"} {
		if _, err := f.a.insert(ctx, "egg_variables", M{"egg_id": eggID, "name": name, "env_variable": name, "default_value": value, "rules": "required|string"}); err != nil {
			t.Fatal(err)
		}
	}
	variable, err := f.a.one(ctx, "SELECT id FROM egg_variables WHERE egg_id=$1 AND env_variable='ARCLIGHT_LOADER'", eggID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.a.insert(ctx, "server_variables", M{"server_id": f.server["id"], "variable_id": variable["id"], "variable_value": "fabric"}); err != nil {
		t.Fatal(err)
	}
	info, reason, err = f.a.mcContentInfo(ctx, f.server)
	if err != nil || reason != "" || info.Loader != "fabric" {
		t.Fatalf("Saved original loader override ignored: %#v %q %v", info, reason, err)
	}
}
