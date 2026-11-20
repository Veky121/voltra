package panel

import (
	"testing"
	"voltra/internal/gamesettings"
)

func TestImpostorManagedJSONCaseAliases(t *testing.T) {
	var egg M
	for _, entry := range gameTemplates().Entries {
		if entry.Path == "among_us/impostor_server/egg-among-us--impostor-server.json" {
			egg = M{"uuid": gameTemplateEggUUID(entry)}
		}
	}
	if egg == nil {
		t.Fatal("missing Impostor recipe")
	}
	for _, key := range []string{"/server/listenip", "/Server/listenport", "/httpserver/listenport", "/HTTPSERVER/LISTENIP", "/HttpServer:listenport", "/server:PublicIp", "/Server/PublicPort"} {
		if !gamesettings.SettingManaged(egg, "/impostor/config.json", key) {
			t.Fatalf("editable native listener alias %s", key)
		}
		if _, err := gamesettings.Changes([]gamesettings.Setting{{Key: key, Kind: "number"}}, M{key: "1"}, egg, "/impostor/config.json"); err == nil {
			t.Fatalf("native listener patch accepted %s", key)
		}
		if gamesettings.RecipeManaged(egg, "/other.json", key) || gamesettings.RecipeManaged(M{"name": "Impostor"}, "/impostor/config.json", key) {
			t.Fatal("case guard escaped exact recipe/document")
		}
	}
	for _, key := range []string{"/MyPlugin/ListenPort", "/HttpServer/ListenPortExtra", "/HttpServer/Enabled"} {
		if gamesettings.RecipeManaged(egg, "/impostor/config.json", key) {
			t.Fatalf("ordinary native field blocked %s", key)
		}
	}
}
