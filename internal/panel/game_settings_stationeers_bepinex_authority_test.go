package panel

import (
	"testing"
)

func stationeersAuthorityFixture(t *testing.T) settingsAuthorityInput {
	t.Helper()
	in := settingsAuthorityInput{Startup: stationeersBepinexAuthorityStartup, Env: map[string]string{"VOLTRA_NATIVE_FAMILY": "stationeers", "VOLTRA_STATIONEERS_VARIANT": "bepinex"}, Files: map[string][]byte{"setting.xml": []byte(`<SettingData><ServerName>Existing</ServerName><GamePort>27016</GamePort><ServerPassword>private</ServerPassword></SettingData>`)}}
	for name, data := range wave53Emissions(t, stationeersBepinexRecipe) {
		in.Files[name] = data
	}
	return in
}

func TestStationeersBepinexAuthorityRefusals(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*settingsAuthorityInput)
	}{
		{"vanilla launcher", func(i *settingsAuthorityInput) {
			i.Startup = "exec python3 .voltra/stationeers_wurm_starbound_runtime.py"
		}},
		{"custom path", func(i *settingsAuthorityInput) { i.Startup += " -settingsfile other.xml" }},
		{"cli override", func(i *settingsAuthorityInput) { i.Startup += " -settings ServerName Other" }},
		{"cwd wrapper", func(i *settingsAuthorityInput) { i.Startup = "cd other && " + i.Startup }},
		{"variant", func(i *settingsAuthorityInput) { i.Env["VOLTRA_STATIONEERS_VARIANT"] = "vanilla" }},
		{"family", func(i *settingsAuthorityInput) { delete(i.Env, "VOLTRA_NATIVE_FAMILY") }},
		{"absent", func(i *settingsAuthorityInput) { delete(i.Files, "setting.xml") }},
		{"custom file only", func(i *settingsAuthorityInput) {
			i.Files["other.xml"] = i.Files["setting.xml"]
			delete(i.Files, "setting.xml")
		}},
		{"malformed", func(i *settingsAuthorityInput) { i.Files["setting.xml"] = []byte(`<SettingData>`) }},
		{"owner drift", func(i *settingsAuthorityInput) { i.Files[".voltra/stationeers_bepinex_owner.py"] = []byte("changed") }},
		{"runtime absent", func(i *settingsAuthorityInput) { delete(i.Files, ".voltra/stationeers_wurm_starbound_runtime.py") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := stationeersAuthorityFixture(t)
			tc.change(&in)
			b, e := stationeersBepinexSettingsAuthority(stationeersBepinexRecipe, stationeersBepinexAuthorityStartup, in)
			if e == nil || b != (settingsPathAuthority{}) {
				t.Fatal("unsafe authority accepted")
			}
		})
	}
	in := stationeersAuthorityFixture(t)
	for _, args := range [][2]string{{"stationeers/vanilla", in.Startup}, {stationeersBepinexRecipe, "custom"}} {
		if _, e := stationeersBepinexSettingsAuthority(args[0], args[1], in); e == nil {
			t.Fatal("identity accepted")
		}
	}
}

func TestStationeersBepinexAuthoritySafeSelection(t *testing.T) {
	in := stationeersAuthorityFixture(t)
	selectPath := func() settingsPathAuthority {
		t.Helper()
		b, e := stationeersBepinexSettingsAuthority(stationeersBepinexRecipe, in.Startup, in)
		if e != nil || b.Path != "/setting.xml" || len(b.Revision) != 64 {
			t.Fatalf("%+v %v", b, e)
		}
		return b
	}
	initial := selectPath()
	// These ordinary settings are intentionally file-owned, despite env values.
	for _, key := range []string{"SERVER_NAME", "SERVER_PASSWD", "MAX_PLAYERS", "SAVE_INTERVAL", "AUTOSAVE", "UPNP", "SETTINGS_PATH"} {
		in.Env[key] = "ignored-for-file-authority"
	}
	if selectPath() != initial {
		t.Fatal("ignored environment changed authority")
	}
	for _, key := range []string{"SAVE_NAME", "WORLD_NAME", "SERVER_PORT", "UPDATE_PORT", "VOLTRA_ALLOCATED_PORTS"} {
		in.Env[key] = "changed"
		if selectPath().Revision == initial.Revision {
			t.Fatal("launch selection not bound")
		}
		delete(in.Env, key)
	}
	// Document revision is independently enforced by the shared API.
	in.Files["setting.xml"] = []byte(`<SettingData><ServerName>Changed</ServerName></SettingData>`)
	if selectPath() != initial {
		t.Fatal("document revision mixed into path authority")
	}
}
