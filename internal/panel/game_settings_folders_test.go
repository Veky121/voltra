package panel

import (
	"context"
	"testing"
)

func TestGameFolderShortcutsProbeExistingNativeDirectories(t *testing.T) {
	a, _, _, node, wings := steamGamesFixture(t)
	server := M{"uuid": newUUID(), "node_id": node["id"]}
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "mindustry/egg-mindustry.json" {
			egg = M{"uuid": gameTemplateEggUUID(entry)}
			break
		}
	}
	if egg == nil {
		t.Fatal("missing canonical Mindustry recipe")
	}
	wings.Files["/config/saves/world.msav"] = []byte("fixture save")
	wings.Folders["/config/maps"] = []M{}
	probe := func() ([]M, error) {
		ctx := context.WithValue(context.Background(), quickListingContextKey{}, map[string][]M{})
		return a.appendGameFolderShortcuts(ctx, server, egg, []M{{"label": "Existing config", "path": "/config"}})
	}
	folders, err := probe()
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, folder := range folders {
		counts[str(folder["path"])]++
	}
	for _, folder := range []string{"/", "/config", "/config/saves", "/config/maps"} {
		if counts[folder] != 1 {
			t.Fatalf("expected one existing shortcut for %s, got %v", folder, folders)
		}
	}
	if counts["/config/mods"] != 0 {
		t.Fatal("advertised absent mods directory")
	}
	if wings.Creates != 0 || wings.Writes != 0 {
		t.Fatal("folder discovery mutated game files")
	}
	wings.Folders["/config"] = []M{{"name": "saves", "directory": true, "symlink": true}}
	folders, err = probe()
	if err == nil {
		for _, folder := range folders {
			if str(folder["path"]) == "/config/saves" {
				t.Fatal("symlink save directory was advertised")
			}
		}
	}
	delete(wings.Folders, "/config")
	wings.ListFailures = map[string]int{"/config": 403}
	if _, err = probe(); err == nil {
		t.Fatal("unreadable directory was silently treated as absent")
	}
}
