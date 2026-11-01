package panel

import (
	"reflect"
	"testing"
)

func TestCampaignParserEntryPoints(t *testing.T) {
	for _, tc := range []struct{ recipe, file, data, key string }{
		{"Aska/egg-aska.json", askaSettingsPath, "server name=Existing\n", "server name"},
		{"puck/egg-puck.json", puckSettingsPath, `{"useWhitelist":false}`, "/useWhitelist"},
		{tf2SettingsRecipe, tf2SettingsPath, "mp_timelimit 20\n", "mp_timelimit"},
		{rustStagingSettingsRecipe, "/server/rust/cfg/server.cfg", "server.tags \"monthly,vanilla\"\n", "server.tags"},
		{unturnedSettingsRecipe, "/Servers/default/Server/Commands.dat", "Cheats\n", "Cheats"},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			var egg M
			for _, entry := range gameTemplates().Entries {
				if entry.Path == tc.recipe {
					egg = M{"uuid": gameTemplateEggUUID(entry), "_campaign_parser_path": tc.file}
					break
				}
			}
			if egg == nil {
				t.Fatal("missing canonical recipe")
			}
			direct, err := parseGameSettingsForEgg(egg, tc.file, []byte(tc.data))
			if err != nil {
				t.Fatal(err)
			}
			discovered, err := parseDiscoveredGameSettings(egg, tc.file, []byte(tc.data))
			if err != nil || !reflect.DeepEqual(direct.fields, discovered.fields) {
				t.Fatal("parser entry points disagree", err)
			}
			found := false
			for _, field := range direct.fields {
				found = found || field.key == tc.key
			}
			if !found {
				t.Fatal("wrong game's schema selected")
			}
			if _, err := parseGameSettingsForEgg(egg, "/different.cfg", []byte(tc.data)); err == nil {
				t.Fatal("unbound file admitted")
			}
			delete(egg, "_campaign_parser_path")
			if _, err := parseGameSettingsForEgg(egg, tc.file, []byte(tc.data)); err == nil {
				t.Fatal("authority binding bypassed")
			}
		})
	}
}
