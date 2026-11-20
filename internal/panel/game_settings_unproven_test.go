package panel

import (
	"testing"
	"voltra/internal/gamesettings"
)

func TestWave12UnprovedSchemaRefused(t *testing.T) {
	entries := gameTemplates().Entries
	count := 0
	for _, entry := range entries {
		egg := M{"uuid": gameTemplateEggUUID(entry), "startup": str(entry.Egg["startup"])}
		if !gamesettings.UnprovenSettingsA(egg) {
			continue
		}
		count++
		// UUID keeps the conservative rule even when an operator changes startup.
		for _, startup := range []string{str(entry.Egg["startup"]), "custom launcher"} {
			egg["startup"] = startup
			for _, file := range []string{"/server.cfg", "/setting.xml", "/WorldSetting.json", "/server_config.sii"} {
				if got := gamesettings.DiscoveryFormat(egg, file); got != "" {
					t.Fatalf("%s %s exposed %s", entry.Path, file, got)
				}
				parsed, err := gamesettings.ParseDiscovered(egg, file, []byte("password=private\ntraffic=true\n"))
				if err == nil || len(parsed.Fields) != 0 || parsed.Patch != nil {
					t.Fatalf("%s accepted unproved fields", entry.Path)
				}
			}
		}
	}
	if count != 8 {
		t.Fatalf("checked %d profiles, want 8", count)
	}
	if gamesettings.UnprovenSettingsA(M{"name": "The Forest", "startup": "custom launcher"}) {
		t.Fatal("display name established authority")
	}
	if gamesettings.DiscoveryFormat(M{}, "/server.properties") != "properties" {
		t.Fatal("unrelated discovery changed")
	}
}

func TestWave13UnprovedSchemaRefused(t *testing.T) {
	entries := gameTemplates().Entries
	count := 0
	for _, entry := range entries {
		egg := M{"uuid": gameTemplateEggUUID(entry), "startup": str(entry.Egg["startup"])}
		if !gamesettings.UnprovenSettingsB(egg) {
			continue
		}
		count++
		// UUID keeps the conservative rule even when an operator changes startup.
		for _, startup := range []string{str(entry.Egg["startup"]), "custom launcher"} {
			egg["startup"] = startup
			for _, file := range []string{"/server.cfg", "/setting.xml", "/WorldSetting.json", "/server_config.sii"} {
				if got := gamesettings.DiscoveryFormat(egg, file); got != "" {
					t.Fatalf("%s %s exposed %s", entry.Path, file, got)
				}
				parsed, err := gamesettings.ParseDiscovered(egg, file, []byte("password=private\ntraffic=true\n"))
				if err == nil || len(parsed.Fields) != 0 || parsed.Patch != nil {
					t.Fatalf("%s accepted unproved fields", entry.Path)
				}
			}
		}
	}
	if count != 7 {
		t.Fatalf("checked %d profiles, want 7", count)
	}
	if gamesettings.UnprovenSettingsB(M{"name": "The Forest", "startup": "custom launcher"}) {
		t.Fatal("display name established authority")
	}
	if gamesettings.DiscoveryFormat(M{}, "/server.properties") != "properties" {
		t.Fatal("unrelated discovery changed")
	}
}
