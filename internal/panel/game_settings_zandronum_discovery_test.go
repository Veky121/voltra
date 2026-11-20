package panel

import (
	"testing"

	"voltra/internal/gamesettings"
)

func TestZandronumDiscoveryBoundary(t *testing.T) {
	egg := M{"startup": gamesettings.ZandronumSettingsStartup}
	if gamesettings.CampaignParserRecipe(egg) != gamesettings.ZandronumSettingsRecipe {
		t.Fatal("recipe registration")
	}
	if docs := gamesettings.DeclaredDocuments(egg); len(docs) != 0 {
		t.Fatal("unprepared discovery", docs)
	}
	egg["_campaign_parser_path"] = gamesettings.ZandronumSettingsPath
	docs := gamesettings.DeclaredDocuments(egg)
	if len(docs) != 1 || docs[0] != gamesettings.ZandronumSettingsPath {
		t.Fatal(docs)
	}
	for _, file := range []string{"/other.ini", "/zandronum/Zandronum.ini", "/zandronum/../zandronum/zandronum.ini"} {
		if _, e := gamesettings.ParseDiscovered(egg, file, []byte("[Doom.NetServerInfo]\nsv_website=\n")); e == nil {
			t.Fatal("wrong path", file)
		}
	}
	if _, e := gamesettings.ParseDiscovered(egg, gamesettings.ZandronumSettingsPath, []byte("[Doom.NetServerInfo]\nsv_website=\n")); e != nil {
		t.Fatal(e)
	}
	if gamesettings.CampaignParserRecipe(M{"name": "Zandronum", "startup": gamesettings.ZandronumSettingsStartup + " "}) != "" {
		t.Fatal("startup drift")
	}
}
