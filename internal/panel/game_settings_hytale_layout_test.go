package panel

import (
	"context"
	"testing"
	"voltra/internal/gamesettings"
)

func TestHytaleLayoutDocumentDiscovery(t *testing.T) {
	a, _, _, server, f := quickSetupMinecraftFixture(t)
	egg := batchSettingsRecipeFixture(t, "hytale/egg-hytale.json")
	f.mu.Lock()
	f.Files["/config.json"] = []byte(`{"Legacy":true}`)
	f.Files["/Server/config.json"] = []byte(`{"ServerName":"Operator","Update":{"Enabled":false,"Patchline":"release"}}`)
	f.Files["/Server/auth.enc"] = []byte("private fixture")
	f.mu.Unlock()
	docs, _, err := a.gameSettingsService().Documents(context.Background(), server, egg, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 1 || docs[0].Path != "/Server/config.json" {
		t.Fatalf("inactive/private documents exposed: %v", docs)
	}
}

func TestHytaleLayoutSettingsAuthority(t *testing.T) {
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "hytale/egg-hytale.json" {
			egg = M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		}
	}
	if !gamesettings.HytaleLayoutSettings(egg) {
		t.Fatal("new launcher not recognized")
	}
	if docs := gamesettings.DeclaredDocuments(egg); len(docs) != 1 || docs[0] != "/Server/config.json" {
		t.Fatalf("wrong active document: %v", docs)
	}
	if !gamesettings.RecipeManaged(egg, "/Server/config.json", "/Update/Patchline") {
		t.Fatal("runtime patchline editable")
	}
	for _, key := range []string{"/Update/Enabled", "/ServerName", "/Unknown"} {
		if gamesettings.RecipeManaged(egg, "/Server/config.json", key) {
			t.Fatalf("operator key blocked: %s", key)
		}
	}
	if gamesettings.RecipeManaged(egg, "/config.json", "/Update/Patchline") {
		t.Fatal("legacy document gained authority")
	}
	egg["startup"] = "exec python3 .voltra/publisher_runtime.py"
	if gamesettings.HytaleLayoutSettings(egg) {
		t.Fatal("old installed launcher misidentified")
	}
	if gamesettings.HytaleLayoutSettings(M{"name": "Hytale", "startup": "exec python3 .voltra/hytale_runtime.py"}) {
		t.Fatal("name established authority")
	}
}
