package panel

import "testing"

func TestNativeSettingsImportedAdapterDispatch(t *testing.T) {
	for _, entry := range gameTemplates().Entries {
		var game, file, content, key, value string
		switch entry.Path {
		case "arma/arma3/egg-arma3.json":
			game, file, content, key, value = "arma3", "/server.cfg", "class Missions {class One {};};\nhostname=\"old\";", "hostname", "new"
		case "counter_strike/counter_strike_2/egg-counter--strike2.json":
			game, file, content, key, value = "cs2", sourceSettingsPath, "// operator\nmp_friendlyfire 0\n", "mp_friendlyfire", "1"
		default:
			continue
		}
		egg := M{"uuid": gameTemplateEggUUID(entry), "startup": entry.Egg["startup"]}
		if steamGameID(egg) != "" || nativeSettingsGameID(egg) != game {
			t.Fatalf("imported %s adapter was not identified", game)
		}
		if game == "arma3" || game == "cs2" {
			if _, err := parseGameSettingsForEgg(egg, file, []byte(content)); err == nil {
				t.Fatalf("%s parser accepted an unprepared authority fixture", game)
			}
			// This unit test exercises dispatch after preparation. Real installed
			// helper and lock checks are exercised by the Arma3 and CS2 handler tests.
			egg["_campaign_parser_path"] = file
			egg["_campaign_parser_binding"] = "unit-prepared-authority"
		}
		parsed, err := parseGameSettingsForEgg(egg, file, []byte(content))
		if err != nil || len(parsed.fields) != 1 {
			t.Fatalf("%s dispatch failed: %v, %d fields", game, err, len(parsed.fields))
		}
		if _, err := parsed.patch(map[string]string{key: value}); err != nil {
			t.Fatalf("%s setting is unreachable: %v", game, err)
		}
	}
	if nativeSettingsGameID(M{"name": "Arma 3", "startup": "echo .voltra/not-arma-native.py run arma3"}) != "" {
		t.Fatal("display names or partial helper names must not select a parser")
	}
}
