package panel

import "testing"

func TestWave13UnprovedSchemaRefused(t *testing.T) {
	entries := gameTemplates().Entries
	count := 0
	for _, entry := range entries {
		egg := M{"uuid": gameTemplateEggUUID(entry), "startup": str(entry.Egg["startup"])}
		if !wave13UnprovenSettings(egg) {
			continue
		}
		count++
		// UUID keeps the conservative rule even when an operator changes startup.
		for _, startup := range []string{str(entry.Egg["startup"]), "custom launcher"} {
			egg["startup"] = startup
			for _, file := range []string{"/server.cfg", "/setting.xml", "/WorldSetting.json", "/server_config.sii"} {
				if got := gameSettingsDiscoveryFormat(egg, file); got != "" {
					t.Fatalf("%s %s exposed %s", entry.Path, file, got)
				}
				parsed, err := parseDiscoveredGameSettings(egg, file, []byte("password=private\ntraffic=true\n"))
				if err == nil || len(parsed.fields) != 0 || parsed.patch != nil {
					t.Fatalf("%s accepted unproved fields", entry.Path)
				}
			}
		}
	}
	if count != 7 {
		t.Fatalf("checked %d profiles, want 7", count)
	}
	if wave13UnprovenSettings(M{"name": "The Forest", "startup": "custom launcher"}) {
		t.Fatal("display name established authority")
	}
	if gameSettingsDiscoveryFormat(M{}, "/server.properties") != "properties" {
		t.Fatal("unrelated discovery changed")
	}
}
