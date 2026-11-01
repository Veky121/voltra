package panel

import "testing"

func TestForestAuthority(t *testing.T) {
	in := authorityFixture(t, true)
	a, err := forestSettingsAuthority(in)
	if err != nil || a.Path != "/TheForestDedicatedServer_Data/forest/config/config.cfg" {
		t.Fatal(a, err)
	}
	for _, key := range []string{"SERVER_NAME", "MAX_PLAYERS", "SERVER_PASS", "ADMIN_PASS", "STEAM_ACC", "VAC", "INIT_TYPE", "SERVER_DIFFICULTY"} {
		in.Env[key] = "operator secret or stale seed"
		b, err := forestSettingsAuthority(in)
		if err != nil || a != b {
			t.Fatal("seed changes existing authority", key, err)
		}
	}
	for _, key := range []string{"CONFIG_FILE", "CONFIG_PATH", "SAVE_PATH", "EXTRA_ARGS", "SRCDS_APPID", "WINDOWS_INSTALL"} {
		in = authorityFixture(t, true)
		in.Env[key] = "../custom"
		if _, err := forestSettingsAuthority(in); err == nil {
			t.Fatal(key)
		}
	}
	in = authorityFixture(t, true)
	in.Startup += " -configfilepath /other"
	if _, err := forestSettingsAuthority(in); err == nil {
		t.Fatal("custom CLI")
	}
	in = authorityFixture(t, true)
	delete(in.Files, ".voltra/forest-native.py")
	if _, err := forestSettingsAuthority(in); err == nil {
		t.Fatal("missing helper")
	}
	in = authorityFixture(t, true)
	in.Files[".voltra/forest-survival.py"] = []byte("changed")
	if _, err := forestSettingsAuthority(in); err == nil {
		t.Fatal("changed dependency")
	}
}
