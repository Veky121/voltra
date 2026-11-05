package panel

import "testing"

func TestWave65BooleanConversion(t *testing.T) {
	for _, tc := range []struct {
		recipe, file, key string
		raw               []byte
	}{
		{"gta/openmp/egg-open-m-p.json", "/openmp/config.json", "/announce", []byte(`{"announce":false}`)},
		{"rimworld/open_world/egg-rimworld-open-world.json", "/Data/Config.json", "/EnforceMods", []byte(`{"EnforceMods":false}`)},
	} {
		var p gameSettingsParsed
		var e error
		if tc.key == "/announce" {
			p, e = parseOpenMPNativeSettings(tc.raw)
		} else {
			p, e = parseRimworldSettings(tc.recipe, tc.file, tc.raw)
		}
		if e != nil {
			t.Fatal(e)
		}
		changes, e := gameSettingsChanges(p.fields, M{tc.key: true}, M{}, tc.file)
		if e != nil {
			t.Fatal(e)
		}
		if changes[tc.key] != "true" {
			t.Fatal("boolean conversion lost")
		}
		if _, e = p.patch(changes); e != nil {
			t.Fatal(e)
		}
	}
}
