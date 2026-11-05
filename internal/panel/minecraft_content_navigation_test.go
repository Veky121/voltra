package panel

import (
	"context"
	"testing"
)

func TestMinecraftContentNavigationCapability(t *testing.T) {
	f := operationsFixtureNew(t)
	ctx := context.Background()
	if _, err := f.a.update(ctx, "eggs", num(f.server["egg_id"]), M{"features": []string{"minecraft"}}); err != nil {
		t.Fatal(err)
	}
	if err := f.a.exec(ctx, `UPDATE subusers SET permissions='["file.read"]' WHERE server_id=$1`, f.server["id"]); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"MINECRAFT_VERSION", "MINECRAFT_LOADER"} {
		_, err := f.a.insert(ctx, "egg_variables", M{"egg_id": f.server["egg_id"], "env_variable": name, "name": name, "default_value": "", "user_viewable": false})
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		loader, version string
		supported       bool
	}{
		{"vanilla", "1.21.1", false}, {"paper", "1.21.1", true}, {"folia", "1.21.1", true}, {"spigot", "1.21.1", true},
		{"fabric", "1.21.1", true}, {"forge", "1.21.1", true}, {"neoforge", "1.21.1", true}, {"quilt", "1.21.1", true},
		{"unknown", "1.21.1", false}, {"paper", "latest", false}, {"", "1.21.1", false},
	} {
		if err := f.a.exec(ctx, `UPDATE egg_variables SET default_value=CASE env_variable WHEN 'MINECRAFT_VERSION' THEN $2 ELSE $3 END WHERE egg_id=$1 AND env_variable IN ('MINECRAFT_VERSION','MINECRAFT_LOADER')`, f.server["egg_id"], tc.version, tc.loader); err != nil {
			t.Fatal(err)
		}
		server, err := f.a.clientServer(ctx, f.sub, f.server)
		if err != nil {
			t.Fatal(err)
		}
		if boolean(server["minecraft_content_supported"]) != tc.supported {
			t.Fatalf("%s %s: capability=%v", tc.loader, tc.version, server["minecraft_content_supported"])
		}
		if len(asSlice(asMap(asMap(server["relationships"])["variables"])["data"])) != 0 {
			t.Fatal("navigation capability exposed hidden variables")
		}
		_, reason, err := f.a.mcContentInfo(ctx, f.server)
		if err != nil || (reason == "") != tc.supported {
			t.Fatalf("catalog and navigation disagree: %s %s %v", tc.loader, reason, err)
		}
	}
}

func TestMinecraftContentNavigationConflictingEnvironment(t *testing.T) {
	rows := []M{{"env_variable": "MINECRAFT_VERSION", "server_value": "1.21.1"}, {"env_variable": "MINECRAFT_LOADER", "server_value": "paper"}, {"env_variable": "MINECRAFT_LOADER", "server_value": "vanilla"}}
	if _, reason := mcContentEnvironmentRows(rows, "server_value"); reason == "" {
		t.Fatal("conflicting loader enabled content navigation")
	}
}
