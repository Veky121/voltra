package panel

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"voltra/internal/gamesettings"
)

func TestDiscoveryIdentityAndPaths(t *testing.T) {
	var profiles map[string]gameTemplateOverride
	if err := json.Unmarshal(gameTemplateOverridesJSON, &profiles); err != nil {
		t.Fatal(err)
	}
	for key, profile := range profiles {
		before := gameTemplateOverrideDigest(profile)
		entry := gameTemplate{Path: key, SHA256: before}
		uuid := gameTemplateEggUUID(entry)
		profile.SettingsDocuments = []string{"nested/settings.json"}
		entry.SHA256 = gameTemplateOverrideDigest(profile)
		if entry.SHA256 != before || gameTemplateEggUUID(entry) != uuid {
			t.Fatal("discovery changed identity", key)
		}
	}
	for _, p := range []string{"../settings.json", "/config.json", "a//b.json", "mods/config.json", "x/Plugins/config.json", "a/{{VAR}}.json", "a/*.json", "a\\b.json", "a/../b.json"} {
		if gamesettings.SafeSettingsDocument(p) {
			t.Fatal("unsafe", p)
		}
	}
	if !gamesettings.SafeSettingsDocument("ShooterGame/Saved/Config/LinuxServer/Game.ini") {
		t.Fatal("literal path rejected")
	}
	entries := []gameTemplate{{Path: "one", SHA256: "a", Egg: M{"startup": "exact"}}, {Path: "two", SHA256: "b", Egg: M{"startup": "exact"}}}
	if _, ok := gamesettings.ProfileFrom(M{"startup": "exact", "name": "one"}, gameSettingsProfilesOf(entries)); ok {
		t.Fatal("ambiguous startup")
	}
	if got, ok := gamesettings.ProfileFrom(M{"uuid": gameTemplateEggUUID(entries[0]), "startup": "exact"}, gameSettingsProfilesOf(entries)); !ok || got.Path != "one" {
		t.Fatal("UUID did not win")
	}
	if _, ok := gamesettings.ProfileFrom(M{"startup": "exact extra"}, gameSettingsProfilesOf(entries[:1])); ok {
		t.Fatal("partial startup match")
	}
}

// Inject the staged overlay only into this test's catalog. Production embedded
// overrides stay unchanged until root reviews and merges the artifact.
func discoveryOverlay(t *testing.T) {
	t.Helper()
	gameTemplates()
	old := templates
	t.Cleanup(func() { templates = old })
	data, err := os.ReadFile("../gamesettings/testdata/game-settings/game-parity-20261029/discovery-profile.json")
	if err != nil {
		t.Fatal(err)
	}
	var overlay map[string]gameTemplateOverride
	if err = json.Unmarshal(data, &overlay); err != nil {
		t.Fatal(err)
	}
	next := append([]gameTemplate(nil), templates.Entries...)
	for i := range next {
		if p, ok := overlay[next[i].Path]; ok {
			next[i].SettingsDocuments = p.SettingsDocuments
		}
	}
	templates.Entries = next
}
func TestDiscoveryEcoJSONAndUnsupported(t *testing.T) {
	discoveryOverlay(t)
	for _, entry := range gameTemplates().Entries {
		egg := M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		if entry.Path == "eco/egg-eco.json" {
			if gamesettings.DiscoveryFormat(egg, "/Configs/Network.eco") != "json" || gamesettings.DiscoveryFormat(egg, "/Configs/Other.eco") != "" {
				t.Fatal("Eco format scope")
			}
			parsed, err := gamesettings.ParseDiscovered(egg, "/Configs/Network.eco", []byte(`{"PublicServer":true,"MaxPlayers":20}`))
			if err != nil || len(parsed.Fields) != 2 {
				t.Fatal("Eco JSON", err)
			}
			if _, err = gamesettings.ParseDiscovered(egg, "/Configs/Network.eco", []byte(`{"x":1,"x":2}`)); err == nil {
				t.Fatal("duplicate JSON accepted")
			}
		}
		if entry.Path == "foundry/egg-foundry.json" || entry.Path == "ddnet/egg-d-d-net.json" {
			if gamesettings.DiscoveryFormat(egg, "/server.cfg") != "" {
				t.Fatal("executable CFG enabled")
			}
		}
	}
}
func TestDiscoveryExistingParentGate(t *testing.T) {
	discoveryOverlay(t)
	a, _, _, server, f := quickSetupMinecraftFixture(t)
	var egg M
	var script string
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "spacestation_14/egg-spacestation14.json" {
			egg = M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"], "config_files": M{}, "java_config": M{}}
			script = str(asMap(asMap(entry.Egg["scripts"])["installation"])["script"])
		}
	}
	if egg == nil {
		t.Fatal("SS14 recipe missing")
	}
	allocation, err := a.insert(context.Background(), "allocations", M{"node_id": server["node_id"], "server_id": server["id"], "ip": "127.0.0.1", "port": 29371})
	if err != nil {
		t.Fatal(err)
	}
	server["allocation_id"] = allocation["id"]
	if _, err := a.update(context.Background(), "eggs", num(server["egg_id"]), egg); err != nil {
		t.Fatal(err)
	}
	if _, err := a.update(context.Background(), "servers", num(server["id"]), M{"startup": egg["startup"], "allocation_id": allocation["id"]}); err != nil {
		t.Fatal(err)
	}
	server["startup"] = egg["startup"]
	emittedFiles := map[string][]byte{}
	// Discovery must operate on the real reviewed launcher contract, including
	// its emitted helpers. Missing runtime metadata is tested independently.
	for _, chunk := range strings.Split(script, "cat > ")[1:] {
		head, body, ok := strings.Cut(chunk, "\n")
		if !ok {
			continue
		}
		name, marker, ok := strings.Cut(head, " <<'")
		if !ok || !strings.HasPrefix(name, ".voltra/") {
			continue
		}
		marker = strings.TrimSuffix(marker, "'")
		emitted, _, ok := strings.Cut(body, "\n"+marker+"\n")
		if !ok {
			t.Fatal("Malformed emitted helper", name)
		}
		emittedFiles["/"+name] = []byte(emitted + "\n")
	}
	f.mu.Lock()
	for name, body := range emittedFiles {
		f.Files[name] = body
	}
	f.Files["/ss14/server_config.toml"] = []byte("[game]\nhostname=\"Existing\"\n")
	f.mu.Unlock()
	docs, _, err := a.gameSettingsService().Documents(context.Background(), server, egg, false, false)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, d := range docs {
		if d.Path == "/ss14/server_config.toml" {
			found = true
		}
	}
	if !found {
		t.Fatal("existing nested document missing")
	}
	f.mu.Lock()
	delete(f.Files, "/ss14/server_config.toml")
	f.mu.Unlock()
	docs, _, err = a.gameSettingsService().Documents(context.Background(), server, egg, false, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range docs {
		if d.Path == "/ss14/server_config.toml" {
			t.Fatal("nonexistent document exposed")
		}
	}
	if gamesettings.QuickFileEntry(M{"file": true, "symlink": true}) {
		t.Fatal("symlink accepted")
	}
}
